import {
  PrismaDemographicProfileRepository,
  toDemographicProfileEntity,
} from './prisma-demographic-profile.repository';
import { PrismaService } from '../../../common/database/prisma.service';

describe('toDemographicProfileEntity (Prisma row mapping)', () => {
  const base = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: '11111111-1111-4111-8111-111111111111',
    age: 21,
    location: 'Đà Nẵng',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    updatedAt: new Date('2026-09-26T10:00:00.000Z'),
  };

  it('unpacks gender, occupation, field of study and interests from the JSON column', () => {
    const entity = toDemographicProfileEntity({
      ...base,
      specificInterests: {
        gender: 'FEMALE',
        occupation: 'Sinh viên đại học',
        fieldOfStudy: 'Công nghệ thông tin',
        customInterests: ['Trí tuệ nhân tạo (AI)'],
      },
    });

    expect(entity.gender).toBe('FEMALE');
    expect(entity.occupation).toBe('Sinh viên đại học');
    expect(entity.fieldOfStudy).toBe('Công nghệ thông tin');
    expect(entity.specificInterests).toEqual(['Trí tuệ nhân tạo (AI)']);
    expect(entity.isComplete()).toBe(true);
  });

  it('does not leak the packed JSON as interests when no interests were saved', () => {
    const entity = toDemographicProfileEntity({
      ...base,
      specificInterests: {
        gender: 'MALE',
        occupation: 'Student',
        fieldOfStudy: 'IT',
      },
    });

    expect(entity.specificInterests).toBeNull();
    expect(entity.isComplete()).toBe(false);
    expect(entity.missingFields()).toEqual(['specificInterests']);
  });

  it('keeps legacy rows whose JSON column is a plain interest array', () => {
    const entity = toDemographicProfileEntity({
      ...base,
      specificInterests: ['Du lịch & Ẩm thực'],
    });

    expect(entity.specificInterests).toEqual(['Du lịch & Ẩm thực']);
    expect(entity.gender).toBeNull();
    expect(entity.missingFields()).toEqual([
      'gender',
      'occupation',
      'fieldOfStudy',
    ]);
  });

  it('handles an empty JSON column', () => {
    const entity = toDemographicProfileEntity({
      ...base,
      specificInterests: null,
    });

    expect(entity.specificInterests).toBeNull();
    expect(entity.gender).toBeNull();
  });

  describe('PrismaDemographicProfileRepository.upsert', () => {
    function sqlOf(call: unknown[]): string {
      return (call[0] as TemplateStringsArray).join('?');
    }

    /**
     * Mocked interactive transaction over one stored row (`existing`, or
     * `null` for a first-time write). Mirrors Prisma: `createMany` with
     * `skipDuplicates` inserts a bare row only when none exists, `update`
     * applies its `data` to the stored row. `upsert` must no longer be used
     * (Epic 7 review P6).
     */
    function repositoryWith(
      existing: Record<string, unknown> | null,
      options: { updateFailure?: unknown } = {},
    ) {
      const calls: string[] = [];
      let row: Record<string, unknown> | null = existing;

      const tx = {
        $queryRaw: jest.fn(async () => {
          calls.push('lock');
          return row ? [{ id: row.id }] : [];
        }),
        demographicProfile: {
          createMany: jest.fn(async (_args: any) => {
            calls.push('ensure');
            if (row) return { count: 0 };
            row = {
              ...base,
              age: null,
              location: null,
              householdIncome: null,
              specificInterests: null,
            };
            return { count: 1 };
          }),
          findUnique: jest.fn(async () => {
            calls.push('read');
            return row;
          }),
          update: jest.fn(async (args: any) => {
            calls.push('update');
            if (options.updateFailure) throw options.updateFailure;
            if (!row) throw new Error('Record to update not found.');
            row = { ...row, ...args.data };
            return row;
          }),
          upsert: jest.fn(),
        },
      };
      const $transaction = jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      );
      const prisma = { $transaction } as unknown as PrismaService;
      return {
        repo: new PrismaDemographicProfileRepository(prisma),
        tx,
        update: tx.demographicProfile.update,
        $transaction,
        calls,
      };
    }

    it('packs every survey field on a first-time write and returns a complete entity', async () => {
      const { repo, tx, update } = repositoryWith(null);

      const entity = await repo.upsert(base.userId, {
        age: 21,
        gender: 'FEMALE',
        location: 'Đà Nẵng',
        occupation: 'Sinh viên đại học',
        fieldOfStudy: 'Công nghệ thông tin',
        householdIncome: 'Dưới 5 triệu VNĐ/tháng',
        specificInterests: ['AI'],
      });

      expect(tx.demographicProfile.upsert).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        where: { userId: base.userId },
        data: {
          age: 21,
          location: 'Đà Nẵng',
          householdIncome: 'Dưới 5 triệu VNĐ/tháng',
          specificInterests: {
            gender: 'FEMALE',
            occupation: 'Sinh viên đại học',
            fieldOfStudy: 'Công nghệ thông tin',
            customInterests: ['AI'],
          },
        },
      });
      expect(entity.isComplete()).toBe(true);
    });

    it('keeps a legacy interest array when other fields are updated', async () => {
      const { repo, update } = repositoryWith({
        ...base,
        specificInterests: ['Du lịch'],
      });

      const entity = await repo.upsert(base.userId, { gender: 'MALE' });

      expect(update.mock.calls[0][0].data.specificInterests).toEqual({
        customInterests: ['Du lịch'],
        gender: 'MALE',
      });
      expect(entity.specificInterests).toEqual(['Du lịch']);
    });

    it('ensures the row exists (skipDuplicates) before locking it FOR UPDATE, in one transaction (Epic 7 review P6)', async () => {
      const { repo, tx, $transaction, calls } = repositoryWith(null);

      await repo.upsert(base.userId, { occupation: 'Student' });

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(tx.demographicProfile.createMany).toHaveBeenCalledWith({
        data: [{ userId: base.userId }],
        skipDuplicates: true,
      });
      expect(sqlOf(tx.$queryRaw.mock.calls[0])).toMatch(
        /SELECT id FROM demographic_profiles WHERE user_id = \?::uuid FOR UPDATE/,
      );
      expect((tx.$queryRaw.mock.calls[0] as unknown[])[1]).toBe(base.userId);
      expect(calls).toEqual(['ensure', 'lock', 'read', 'update']);
    });

    it('merges a later first-time partial write onto the row an earlier one created', async () => {
      const { repo, update } = repositoryWith(null);

      await repo.upsert(base.userId, {
        gender: 'FEMALE',
        occupation: 'Student',
      });
      const entity = await repo.upsert(base.userId, {
        fieldOfStudy: 'IT',
        specificInterests: ['AI'],
      });

      expect(update.mock.calls[1][0].data.specificInterests).toEqual({
        gender: 'FEMALE',
        occupation: 'Student',
        fieldOfStudy: 'IT',
        customInterests: ['AI'],
      });
      expect(entity.gender).toBe('FEMALE');
      expect(entity.occupation).toBe('Student');
      expect(entity.fieldOfStudy).toBe('IT');
      expect(entity.specificInterests).toEqual(['AI']);
    });

    it('keeps the columns an update leaves undefined', async () => {
      const { repo, update } = repositoryWith({
        ...base,
        specificInterests: { gender: 'FEMALE' },
      });

      const entity = await repo.upsert(base.userId, { occupation: 'Student' });

      expect(update.mock.calls[0][0].data).toEqual({
        specificInterests: { gender: 'FEMALE', occupation: 'Student' },
      });
      expect(entity.age).toBe(base.age);
      expect(entity.location).toBe(base.location);
      expect(entity.householdIncome).toBe(base.householdIncome);
    });

    it('propagates a failed write without retrying', async () => {
      const failure = new Error('connection lost');
      const { repo, $transaction } = repositoryWith(null, {
        updateFailure: failure,
      });

      await expect(repo.upsert(base.userId, { age: 30 })).rejects.toBe(failure);
      expect($transaction).toHaveBeenCalledTimes(1);
    });

    it('clears each packed field and each column on an explicit null', async () => {
      const { repo, update: write } = repositoryWith({
        ...base,
        specificInterests: {
          gender: 'FEMALE',
          occupation: 'Student',
          fieldOfStudy: 'IT',
          customInterests: ['AI'],
        },
      });

      const entity = await repo.upsert(base.userId, {
        age: null,
        location: null,
        householdIncome: null,
        gender: null,
        occupation: null,
        fieldOfStudy: null,
        specificInterests: null,
      });

      const update = write.mock.calls[0][0].data;
      expect(update).toEqual(
        expect.objectContaining({
          age: null,
          location: null,
          householdIncome: null,
        }),
      );
      expect(update.specificInterests).toEqual({
        gender: null,
        occupation: null,
        fieldOfStudy: null,
        customInterests: null,
      });
      expect(entity.age).toBeNull();
      expect(entity.location).toBeNull();
      expect(entity.householdIncome).toBeNull();
      expect(entity.gender).toBeNull();
      expect(entity.occupation).toBeNull();
      expect(entity.fieldOfStudy).toBeNull();
      expect(entity.specificInterests).toBeNull();
      expect(entity.missingFields()).toEqual([
        'age',
        'gender',
        'location',
        'occupation',
        'fieldOfStudy',
        'householdIncome',
        'specificInterests',
      ]);
    });

    it.each([
      ['a scalar string', 'not-json-object'],
      ['a number', 42],
      ['JSON null', null],
    ])(
      'tolerates malformed stored JSON (%s) and keeps only the new values',
      async (_label, stored) => {
        const { repo, update } = repositoryWith({
          ...base,
          specificInterests: stored,
        });

        const entity = await repo.upsert(base.userId, { gender: 'MALE' });

        expect(update.mock.calls[0][0].data.specificInterests).toEqual({
          gender: 'MALE',
        });
        expect(entity.gender).toBe('MALE');
        expect(entity.specificInterests).toBeNull();
      },
    );
  });
});
