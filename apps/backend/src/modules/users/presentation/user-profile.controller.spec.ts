import { Test } from '@nestjs/testing';
import {
  GUARDS_METADATA,
  PATH_METADATA,
  PIPES_METADATA,
} from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { updateUserProfileSchema, userProfileSchema } from '@rescom/schemas';
import { UserProfileController } from './user-profile.controller';
import { UserProfileService } from '../application/user-profile.service';
import { InMemoryUserProfileRepository } from '../infrastructure/in-memory-user-profile.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';

describe('UserProfileController (Story IR.4b part A)', () => {
  const user: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'respondent@example.com',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };
  let controller: UserProfileController;

  beforeEach(async () => {
    const service = new UserProfileService(
      new InMemoryUserProfileRepository(),
      () => new Date('2026-06-15T03:00:00.000Z'),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [UserProfileController],
      providers: [{ provide: UserProfileService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(UserProfileController);
  });

  it('is registered under both the bare and api/ prefixes behind the session guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, UserProfileController)).toEqual([
      'users/me/profile',
      'api/users/me/profile',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, UserProfileController)).toEqual(
      [SessionAuthGuard],
    );
  });

  it('protects the update with CSRF and JSON-only guards and the shared schema', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        UserProfileController.prototype.updateProfile,
      ),
    ).toEqual([CsrfGuard, JsonOnlyGuard]);
    const [pipe] = Reflect.getMetadata(
      PIPES_METADATA,
      UserProfileController.prototype.updateProfile,
    ) as ZodValidationPipe[];
    expect(pipe).toBeInstanceOf(ZodValidationPipe);
    expect(() =>
      pipe.transform({ role: 'ADMIN' }, { type: 'body', data: undefined }),
    ).toThrow(BadRequestException);
  });

  it('answers a user without a profile with every field null', async () => {
    const envelope = await controller.getProfile(user);
    expect(envelope).toEqual({
      data: {
        displayName: null,
        birthYear: null,
        school: null,
        schoolYear: null,
        goal: null,
      },
      error: null,
      meta: {},
    });
  });

  it('applies a partial update and returns the full profile', async () => {
    const body = updateUserProfileSchema.parse({
      displayName: ' Linh ',
      goal: 'BOTH',
    });
    const envelope = await controller.updateProfile(user, body);

    expect(envelope.error).toBeNull();
    expect(userProfileSchema.parse(envelope.data)).toEqual({
      displayName: 'Linh',
      birthYear: null,
      school: null,
      schoolYear: null,
      goal: 'BOTH',
    });
    await expect(controller.getProfile(user)).resolves.toMatchObject({
      data: { displayName: 'Linh', goal: 'BOTH' },
    });
  });

  it('rejects a goal outside the enum with 400 VALIDATION_ERROR and format() details', () => {
    const pipe = new ZodValidationPipe(updateUserProfileSchema);
    try {
      pipe.transform({ goal: 'ADMIN' }, { type: 'body', data: undefined });
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        details: { goal?: { _errors: string[] } };
      };
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.details.goal?._errors.length).toBeGreaterThan(0);
    }
  });
});
