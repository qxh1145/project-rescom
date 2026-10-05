import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { formManagementTimes } from './form-management-times';
import { FormsService } from './forms.service';

/**
 * Pins the invariant `formManagementTimes` relies on (see its RISK note):
 * no FormsService command rewrites a MODERATION_QUEUE or CLOSED row in place,
 * so its `updatedAt` stays the queue-entry / close time. A command may only
 * leave the row untouched or move it to another status.
 */
describe('formManagementTimes (submittedAt / closedAt from updatedAt)', () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const adminId = '99999999-9999-4999-8999-999999999999';
  const formId = '22222222-2222-4222-8222-222222222222';
  const stamped = new Date('2026-09-20T08:00:00Z');

  function form(status: FormEntity['status'], type: 'INTERNAL' | 'EXTERNAL') {
    const entity = new FormEntity(
      formId,
      ownerId,
      type,
      status,
      'Survey',
      null,
      0,
      10,
      new Date('2026-09-01T00:00:00Z'),
      stamped,
    );
    return status === 'CLOSED'
      ? new FormEntity(
          formId,
          ownerId,
          type,
          'MODERATION_QUEUE',
          'Survey',
          null,
          0,
          10,
          new Date('2026-09-01T00:00:00Z'),
          stamped,
        ).close('OWNER', stamped)
      : entity;
  }

  function version() {
    return new FormVersionEntity(
      '33333333-3333-4333-8333-333333333333',
      formId,
      1,
      {
        title: 'Survey',
        blocks: [],
        metadata: { expectedEffortSeconds: 60 },
      } as any,
      null,
      true,
      'https://docs.google.com/forms/d/e/x/viewform',
      'verifier',
      stamped,
      stamped,
    );
  }

  it('derives the dates from the transition time, null otherwise', () => {
    expect(formManagementTimes(form('MODERATION_QUEUE', 'INTERNAL'))).toEqual({
      submittedAt: stamped.toISOString(),
      closedAt: null,
    });
    expect(formManagementTimes(form('CLOSED', 'INTERNAL'))).toEqual({
      submittedAt: null,
      closedAt: stamped.toISOString(),
    });
    expect(formManagementTimes(form('PUBLISHED', 'INTERNAL'))).toEqual({
      submittedAt: null,
      closedAt: null,
    });
  });

  describe.each(['MODERATION_QUEUE', 'CLOSED'] as const)(
    'no command rewrites a %s row in place',
    (status) => {
      const commands: Array<
        [string, (service: FormsService) => Promise<unknown>]
      > = [
        [
          'updateDraft',
          (service) =>
            service.updateDraft(
              formId,
              { userId: ownerId, role: 'PUBLISHER' },
              { title: 'New' },
            ),
        ],
        [
          'createNewVersion',
          (service) =>
            service.createNewVersion(formId, {
              userId: ownerId,
              role: 'PUBLISHER',
            }),
        ],
        [
          'rotateCompletionCode',
          (service) =>
            service.rotateCompletionCode(formId, {
              userId: ownerId,
              role: 'PUBLISHER',
            }),
        ],
        [
          'deleteDraft',
          (service) =>
            service.deleteDraft(formId, { userId: ownerId, role: 'PUBLISHER' }),
        ],
        [
          'publishForm',
          (service) =>
            service.publishForm(formId, { userId: ownerId, role: 'PUBLISHER' }),
        ],
        [
          'closeFormIfQuotaMet',
          (service) => service.closeFormIfQuotaMet(formId, new Date()),
        ],
        [
          'closeFormAtDeadline',
          (service) => service.closeFormAtDeadline(formId, new Date()),
        ],
        [
          'admin transition to the same status',
          (service) =>
            service.transitionStatus(
              formId,
              { userId: adminId, role: 'ADMIN' },
              { status } as any,
            ),
        ],
      ];

      it.each(commands)('%s', async (_name, run) => {
        for (const type of ['INTERNAL', 'EXTERNAL'] as const) {
          const repo = new InMemoryFormRepository();
          await repo.create(form(status, type), version());
          const service = new FormsService(repo, {
            generateSixDigitCode: () => '123456',
            computeVerifier: () => 'verifier-2',
          } as any);
          await run(service).catch(() => undefined);
          const after = repo.peekForm(formId);
          if (after && after.status === status) {
            expect(after.updatedAt.toISOString()).toBe(stamped.toISOString());
          }
        }
      });
    },
  );
});
