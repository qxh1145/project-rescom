import { randomUUID } from 'crypto';
import {
  aggregateFormAnalytics,
  publisherAnalyticsSchema,
  publisherResponsesPageSchema,
  type PublisherResponsesPage,
} from '@rescom/schemas';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import {
  FormNotFoundException,
  FormVersionNotFoundException,
  InvalidResultsCursorException,
  PublisherAnalyticsLimitExceededException,
} from '../../forms/application/exceptions/form.exceptions';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import { InMemoryPublisherResponseReadRepository } from '../infrastructure/in-memory-publisher-response-read.repository';
import { ResponseEntity, ResponseStatus } from '../domain/response.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import {
  projectAnswers,
  PublisherResultsService,
  responseDisplayCode,
} from './publisher-results.service';

describe('Story IR.4a: PublisherResultsService (FR-40)', () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const strangerId = '44444444-4444-4444-8444-444444444444';
  const formId = '22222222-2222-4222-8222-222222222222';
  const v1Id = '33333333-3333-4333-8333-333333333331';
  const v2Id = '33333333-3333-4333-8333-333333333332';

  const blocks = [
    { id: 'q-name', type: 'text', title: 'Tên', order: 0, required: true },
    {
      id: 'q-pick',
      type: 'single_choice',
      title: 'Chọn',
      order: 1,
      required: false,
      allowOther: true,
      options: [
        { id: 'o1', value: 'a', label: 'A' },
        { id: 'o2', value: 'b', label: 'B' },
      ],
    },
    {
      id: 'q-file',
      type: 'file_upload',
      title: 'Tệp',
      order: 2,
      required: false,
    },
    { id: 'q-ok', type: 'text', title: 'Đồng ý', order: 3, required: false },
  ];

  let formRepo: InMemoryFormRepository;
  let participation: InMemoryParticipationRepository;
  let service: PublisherResultsService;

  async function seedForm(
    type: 'INTERNAL' | 'EXTERNAL' = 'INTERNAL',
    versions = 2,
  ) {
    const form = new FormEntity(
      formId,
      ownerId,
      type,
      'PUBLISHED',
      'Khảo sát',
      null,
      0,
      500,
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
    const version = (id: string, number: number, published: boolean) =>
      new FormVersionEntity(
        id,
        formId,
        number,
        { title: 'Khảo sát', blocks } as any,
        null,
        published,
        type === 'EXTERNAL'
          ? 'https://docs.google.com/forms/d/e/x/viewform'
          : null,
        null,
        published ? new Date('2026-09-02T00:00:00Z') : null,
        new Date('2026-09-01T00:00:00Z'),
      );
    await formRepo.create(form, version(v1Id, 1, true));
    if (versions > 1) {
      await formRepo.createVersion(
        formId,
        v2Id,
        new Date('2026-09-10T00:00:00Z'),
        {
          isPublished: true,
          publishedAt: new Date('2026-09-10T00:00:00Z'),
          expectedStatus: 'PUBLISHED',
        },
      );
    }
  }

  function addResponse(options: {
    versionId?: string;
    submittedAt: Date;
    status?: ResponseStatus;
    answers?: Record<string, unknown>;
    startedAt?: Date | null;
    id?: string;
  }): ResponseEntity {
    const id = options.id ?? randomUUID();
    let attemptId: string | null = null;
    if (options.startedAt !== null) {
      attemptId = randomUUID();
      participation.attempts.set(
        attemptId,
        new SurveyAttemptEntity(
          attemptId,
          formId,
          options.versionId ?? v1Id,
          randomUUID(),
          'COMPLETED',
          false,
          options.startedAt ?? new Date(options.submittedAt.getTime() - 90_000),
          options.submittedAt,
          null,
          options.submittedAt,
          options.submittedAt,
        ),
      );
    }
    const response = new ResponseEntity(
      id,
      formId,
      options.versionId ?? v1Id,
      attemptId,
      attemptId ? randomUUID() : null,
      options.status ?? 'VALIDATED',
      (options.answers ?? { 'q-name': 'An' }) as Record<string, unknown>,
      '203.0.113.9',
      attemptId === null,
      options.submittedAt,
      options.submittedAt,
      options.submittedAt,
    );
    participation.responses.set(id, response);
    return response;
  }

  const owner = { userId: ownerId };

  beforeEach(() => {
    formRepo = new InMemoryFormRepository();
    participation = new InMemoryParticipationRepository();
    service = new PublisherResultsService(
      formRepo,
      new InMemoryPublisherResponseReadRepository(participation),
    );
  });

  function available(page: PublisherResponsesPage) {
    if (page.availability !== 'AVAILABLE') throw new Error('NOT_APPLICABLE');
    return page;
  }

  describe('access', () => {
    it('anybody but the owner (an Admin included) gets FORM_NOT_FOUND', async () => {
      await seedForm();
      await expect(
        service.getResponsesPage(formId, { userId: strangerId }, { limit: 50 }),
      ).rejects.toBeInstanceOf(FormNotFoundException);
      await expect(
        service.getAnalytics(formId, { userId: strangerId }, {}),
      ).rejects.toBeInstanceOf(FormNotFoundException);
      await expect(
        service.getResponsesPage(randomUUID(), owner, { limit: 50 }),
      ).rejects.toBeInstanceOf(FormNotFoundException);
    });
  });

  describe('version selection (AC3.2)', () => {
    it('newest version with rows, then newest published, then newest; explicit number; unknown → 404', async () => {
      await seedForm();
      // No rows: the newest published version (v2).
      expect(
        available(await service.getResponsesPage(formId, owner, { limit: 50 }))
          .form.versionNumber,
      ).toBe(2);
      addResponse({
        versionId: v1Id,
        submittedAt: new Date('2026-09-05T00:00:00Z'),
      });
      // Only v1 has rows.
      expect(
        available(await service.getResponsesPage(formId, owner, { limit: 50 }))
          .form.versionId,
      ).toBe(v1Id);
      expect(
        available(
          await service.getResponsesPage(formId, owner, {
            limit: 50,
            versionNumber: 2,
          }),
        ).totalCount,
      ).toBe(0);
      await expect(
        service.getResponsesPage(formId, owner, {
          limit: 50,
          versionNumber: 9,
        }),
      ).rejects.toBeInstanceOf(FormVersionNotFoundException);
    });
  });

  describe('responses', () => {
    it('an External survey is NOT_APPLICABLE, never an empty list', async () => {
      await seedForm('EXTERNAL', 1);
      const page = await service.getResponsesPage(formId, owner, { limit: 50 });
      expect(publisherResponsesPageSchema.parse(page)).toEqual({
        availability: 'NOT_APPLICABLE',
        reason: 'EXTERNAL_FORM',
        form: {
          id: formId,
          title: 'Khảo sát',
          type: 'EXTERNAL',
          externalUrl: 'https://docs.google.com/forms/d/e/x/viewform',
        },
      });
      expect((await service.getAnalytics(formId, owner, {})).availability).toBe(
        'NOT_APPLICABLE',
      );
    });

    it('walks 120 rows as 50 + 50 + 20 with no gap or duplicate, ties broken by id', async () => {
      await seedForm();
      const tie = new Date('2026-09-20T00:00:00Z');
      for (let index = 0; index < 120; index += 1) {
        addResponse({
          submittedAt:
            index < 30 ? tie : new Date(tie.getTime() - index * 60_000),
        });
      }
      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = available(
          await service.getResponsesPage(formId, owner, {
            limit: 50,
            versionNumber: 1,
            cursor,
          }),
        );
        publisherResponsesPageSchema.parse(page);
        expect(page.totalCount).toBe(120);
        sizes.push(page.responses.length);
        seen.push(...page.responses.map((row) => row.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(sizes).toEqual([50, 50, 20]);
      expect(new Set(seen).size).toBe(120);
      const expectedOrder = [...participation.responses.values()]
        .sort(
          (a, b) =>
            b.submittedAt!.getTime() - a.submittedAt!.getTime() ||
            (a.id < b.id ? 1 : -1),
        )
        .map((row) => row.id);
      expect(seen).toEqual(expectedOrder);
    });

    it('rejects a cursor of another version and a malformed cursor', async () => {
      await seedForm();
      addResponse({
        versionId: v1Id,
        submittedAt: new Date('2026-09-05T00:00:00Z'),
      });
      addResponse({
        versionId: v1Id,
        submittedAt: new Date('2026-09-06T00:00:00Z'),
      });
      const page = available(
        await service.getResponsesPage(formId, owner, {
          limit: 1,
          versionNumber: 1,
        }),
      );
      expect(page.nextCursor).not.toBeNull();
      await expect(
        service.getResponsesPage(formId, owner, {
          limit: 1,
          versionNumber: 2,
          cursor: page.nextCursor!,
        }),
      ).rejects.toBeInstanceOf(InvalidResultsCursorException);
      await expect(
        service.getResponsesPage(formId, owner, {
          limit: 1,
          cursor: 'not-a-cursor',
        }),
      ).rejects.toBeInstanceOf(InvalidResultsCursorException);
    });

    it('mixed versions: v1 and v2 lists are disjoint; IN_PROGRESS/DISPUTED/REJECTED are never listed', async () => {
      await seedForm();
      const v1 = addResponse({
        versionId: v1Id,
        submittedAt: new Date('2026-09-05T00:00:00Z'),
      });
      const v2 = addResponse({
        versionId: v2Id,
        status: 'SUBMITTED',
        submittedAt: new Date('2026-09-12T00:00:00Z'),
      });
      for (const status of ['IN_PROGRESS', 'DISPUTED', 'REJECTED'] as const) {
        addResponse({
          versionId: v2Id,
          status,
          submittedAt: new Date('2026-09-13T00:00:00Z'),
        });
      }
      const list = async (versionNumber: number) =>
        available(
          await service.getResponsesPage(formId, owner, {
            limit: 50,
            versionNumber,
          }),
        ).responses.map((row) => row.id);
      expect(await list(1)).toEqual([v1.id]);
      expect(await list(2)).toEqual([v2.id]);
    });

    it('projects rows explicitly: pseudonymous code, known keys only, file names, null guest duration', async () => {
      await seedForm();
      const response = addResponse({
        submittedAt: new Date('2026-09-05T00:01:40Z'),
        startedAt: new Date('2026-09-05T00:00:00Z'),
        answers: {
          'q-name': 'An',
          'q-pick': 'b',
          'q-file': [
            {
              objectId: 'obj-1',
              fileName: 'cv.pdf',
              fileSize: 10,
              mimeType: 'application/pdf',
              status: 'CLEAN',
            },
          ],
          'q-ok': true,
          'stale-question': 'dropped',
        },
      });
      const guest = addResponse({
        submittedAt: new Date('2026-09-04T00:00:00Z'),
        startedAt: null,
      });

      const page = available(
        await service.getResponsesPage(formId, owner, { limit: 50 }),
      );
      const [row, guestRow] = page.responses;

      expect(row).toEqual({
        id: response.id,
        code: responseDisplayCode(response.id),
        formVersionId: v1Id,
        submittedAt: '2026-09-05T00:01:40.000Z',
        durationSeconds: 100,
        integrity: { applicability: 'NOT_ASSESSED' },
        answers: {
          'q-name': 'An',
          'q-pick': 'b',
          'q-file': ['cv.pdf'],
          'q-ok': 'true',
        },
      });
      expect(row.code).toMatch(/^[0-9A-F]{6}$/);
      expect(responseDisplayCode(response.id)).toBe(row.code);
      expect(guestRow.id).toBe(guest.id);
      expect(guestRow.durationSeconds).toBeNull();
      const serialized = JSON.stringify(page);
      for (const leak of [
        '203.0.113.9',
        'obj-1',
        'respondentId',
        'attemptId',
      ]) {
        expect(serialized).not.toContain(leak);
      }
      expect(page.questions.map((question) => question.id)).toEqual([
        'q-name',
        'q-pick',
        'q-file',
        'q-ok',
      ]);
    });

    it('projectAnswers drops non-object input and non-text values', () => {
      expect(projectAnswers(null, [])).toEqual({});
      expect(projectAnswers(['x'], [])).toEqual({});
      expect(
        projectAnswers({ a: { nested: true }, b: Number.NaN, c: 3 }, [
          { id: 'a' },
          { id: 'b' },
          { id: 'c' },
        ] as any),
      ).toEqual({ c: 3 });
    });

    it('an empty version is an empty AVAILABLE page', async () => {
      await seedForm();
      const page = available(
        await service.getResponsesPage(formId, owner, { limit: 50 }),
      );
      expect(page).toMatchObject({
        totalCount: 0,
        responses: [],
        nextCursor: null,
      });
    });
  });

  describe('analytics (decision Q1)', () => {
    it('equals the shared aggregator over the version rows', async () => {
      await seedForm();
      addResponse({
        submittedAt: new Date('2026-09-05T00:00:00Z'),
        answers: { 'q-name': 'An', 'q-pick': 'a' },
      });
      addResponse({
        submittedAt: new Date('2026-09-06T00:00:00Z'),
        answers: { 'q-name': 'Bình', 'q-pick': 'Khác nữa' },
      });
      addResponse({
        versionId: v2Id,
        submittedAt: new Date('2026-09-12T00:00:00Z'),
      });

      const analytics = await service.getAnalytics(formId, owner, {
        versionNumber: 1,
      });
      publisherAnalyticsSchema.parse(analytics);
      if (analytics.availability !== 'AVAILABLE')
        throw new Error('expected rows');
      expect(analytics.totalResponses).toBe(2);
      expect(analytics.lastResponseAt).toBe('2026-09-06T00:00:00.000Z');
      const page = available(
        await service.getResponsesPage(formId, owner, {
          limit: 50,
          versionNumber: 1,
        }),
      );
      expect(analytics.questions).toEqual(
        aggregateFormAnalytics(
          page.questions,
          page.responses.map((row) => ({
            id: row.id,
            submittedAt: row.submittedAt,
            answers: row.answers,
          })),
        ).questions,
      );
    });

    it('refuses above the cap with 422 details and scans in batches below it', async () => {
      await seedForm();
      for (let index = 0; index < 4; index += 1) {
        addResponse({ submittedAt: new Date(Date.UTC(2026, 8, 5, 0, index)) });
      }
      const capped = new PublisherResultsService(
        formRepo,
        new InMemoryPublisherResponseReadRepository(participation),
        3,
      );
      const error = await capped
        .getAnalytics(formId, owner, {})
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PublisherAnalyticsLimitExceededException);
      expect(error).toMatchObject({ totalResponses: 4, limit: 3 });

      for (let index = 0; index < 600; index += 1) {
        addResponse({
          submittedAt: new Date(Date.UTC(2026, 8, 6, 0, 0, index)),
        });
      }
      const analytics = await service.getAnalytics(formId, owner, {});
      expect(
        analytics.availability === 'AVAILABLE' && analytics.totalResponses,
      ).toBe(604);
    });
  });
});
