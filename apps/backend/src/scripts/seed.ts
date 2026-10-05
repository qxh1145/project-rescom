import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { randomBytes } from 'crypto';
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import {
  registerSchema,
  SCHOOL_YEAR_VALUES,
  submitSurveyFeedbackInputSchema,
  type SchoolYear,
  type UpdateUserProfileInput,
  type UserProfileDto,
} from '@rescom/schemas';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/database/prisma.service';
import { AuthService } from '../modules/auth/application/auth.service';
import { UserAdminService } from '../modules/users/application/user-admin.service';
import { DemographicsService } from '../modules/users/application/demographics.service';
import { UserProfileService } from '../modules/users/application/user-profile.service';
import { TopUpService } from '../modules/economy/application/top-up.service';
import { StarterPointsCoordinator } from '../modules/economy/application/starter-points.coordinator';
import { FormsService } from '../modules/forms/application/forms.service';
import { SurveyModerationService } from '../modules/moderation/application/survey-moderation.service';
import { ParticipationService } from '../modules/participation/application/participation.service';
import { SurveyFeedbackService } from '../modules/participation/application/survey-feedback.service';
import {
  AnswerProfile,
  createRng,
  FEEDBACK,
  PUBLISHERS,
  RESPONDENTS,
  SCORING_POLICY,
  SEED_EMAIL_DOMAIN,
  SeedExternalSurvey,
  SeedInternalSurvey,
  SeedSurvey,
  SURVEYS,
  TOP_UP_REJECTION_REASON,
} from './seed-data';

/**
 * Go-live demo seed (Vietnamese, multi-topic).
 *
 * Drives the real application services through a Nest application context so
 * the Ledger (starter grants, top-ups, Escrow, rewards, refunds), the Outbox,
 * notifications and audit rows stay consistent. Raw Prisma is used only where
 * no service path exists:
 * - promoting the two seed ADMINs (no API creates the first one; the second
 *   is promoted the same way so adding it to an existing seed does not depend
 *   on the first Admin's current role or status);
 * - inserting the active ScoringPolicy (nothing in the app writes it);
 * - moving an attempt's `startedAt` back a few minutes before submitting, to
 *   pass the server-side Time Barrier the way a real respondent would;
 * - backdating non-ledger timestamps at the end so the data spreads over the
 *   past weeks (ledger rows are append-only and keep the seed time).
 *
 * Idempotent: only seed-owned rows are inspected (seed accounts by email, seed
 * surveys by their External Idempotency-Key or Internal title), so data that
 * testers add later never blocks a re-run. A complete prior seed is skipped,
 * one created before the second Admin existed gets only that account, and a
 * run that stopped half-way is refused (the ledger cannot be resumed). Every
 * run that finds the seed accounts also fills their still-empty onboarding
 * profile fields (not ledger data, so safe to repeat).
 *
 * Usage: `npm run seed` (see README "Seed dữ liệu demo").
 */

// Plain console output: the Nest logger is limited to warnings/errors so
// bootstrap and system-metrics lines do not drown the seed progress.
const logger = {
  log: (message: string) => console.log(`[seed] ${message}`),
  error: (message: unknown) => console.error('[seed]', message),
};
const DAY_MS = 24 * 60 * 60 * 1000;
const CREDENTIALS_FILE = resolve(
  process.cwd(),
  process.env.SEED_CREDENTIALS_FILE ?? '.seed-credentials.local.md',
);

interface SeedAccount {
  /** `admin`, `admin2`, or the publisher / respondent key from seed-data. */
  key: string;
  email: string;
  password: string;
  passwordSource: 'env' | 'generated';
  role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT';
  label: string;
}

interface CompletedAttempt {
  surveyKey: string;
  respondentKey: string;
  attemptId: string;
  responseId: string | null;
}

interface SeedServices {
  prisma: PrismaService;
  auth: AuthService;
  userAdmin: UserAdminService;
  demographics: DemographicsService;
  profiles: UserProfileService;
  topUps: TopUpService;
  starterPoints: StarterPointsCoordinator;
  forms: FormsService;
  moderation: SurveyModerationService;
  participation: ParticipationService;
  feedback: SurveyFeedbackService;
}

function assertEnvironmentAllowed(): void {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ALLOW_PRODUCTION !== 'true'
  ) {
    throw new Error(
      'Refusing to seed demo data with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true to override.',
    );
  }
}

function generatePassword(): string {
  // 24 URL-safe characters (144 bits): satisfies the 12-grapheme / 72-byte rule.
  return randomBytes(18).toString('base64url');
}

function resolvePassword(
  envName: 'SEED_ADMIN_PASSWORD' | 'SEED_DEMO_PASSWORD',
): { password: string; source: 'env' | 'generated' } {
  const fromEnv = process.env[envName];
  if (!fromEnv) {
    return { password: generatePassword(), source: 'generated' };
  }
  const check = registerSchema.shape.password.safeParse(fromEnv);
  if (!check.success) {
    throw new Error(
      `${envName} is invalid: ${check.error.issues[0]?.message ?? 'rejected by the password policy'}`,
    );
  }
  return { password: fromEnv, source: 'env' };
}

function buildAccounts(): SeedAccount[] {
  const adminEmail = (
    process.env.SEED_ADMIN_EMAIL ?? `admin@${SEED_EMAIL_DOMAIN}`
  )
    .trim()
    .toLowerCase();
  // An Admin can never approve their own survey or top-up
  // (MODERATION_SELF_REVIEW_FORBIDDEN / TOPUP_SELF_REVIEW_FORBIDDEN), so the
  // seed provides a second one to review the first Admin's requests.
  const admin2Email = (
    process.env.SEED_ADMIN2_EMAIL ?? `admin2@${SEED_EMAIL_DOMAIN}`
  )
    .trim()
    .toLowerCase();
  if (admin2Email === adminEmail) {
    throw new Error(
      'SEED_ADMIN2_EMAIL must differ from SEED_ADMIN_EMAIL: the two seed Admins review each other.',
    );
  }
  // SEED_ADMIN_PASSWORD is shared by both Admins; otherwise each gets its own.
  const admin = resolvePassword('SEED_ADMIN_PASSWORD');
  const admin2 = resolvePassword('SEED_ADMIN_PASSWORD');
  // One shared demo password when SEED_DEMO_PASSWORD is set; otherwise one
  // generated password per account.
  const demoFromEnv = process.env.SEED_DEMO_PASSWORD
    ? resolvePassword('SEED_DEMO_PASSWORD')
    : null;
  const demo = () => demoFromEnv ?? resolvePassword('SEED_DEMO_PASSWORD');

  const accounts: SeedAccount[] = [
    {
      key: 'admin',
      email: adminEmail,
      password: admin.password,
      passwordSource: admin.source,
      role: 'ADMIN',
      label: 'Quản trị viên RESCOM',
    },
    {
      key: 'admin2',
      email: admin2Email,
      password: admin2.password,
      passwordSource: admin2.source,
      role: 'ADMIN',
      label: 'Quản trị viên RESCOM 2 (duyệt chéo)',
    },
  ];
  for (const publisher of PUBLISHERS) {
    const { password, source } = demo();
    accounts.push({
      key: publisher.key,
      email: publisher.email,
      password,
      passwordSource: source,
      role: 'PUBLISHER',
      label: publisher.displayName,
    });
  }
  for (const respondent of RESPONDENTS) {
    const { password, source } = demo();
    accounts.push({
      key: respondent.key,
      email: respondent.email,
      password,
      passwordSource: source,
      role: 'RESPONDENT',
      label: `${respondent.displayName} (${respondent.activity})`,
    });
  }
  return accounts;
}

function daysAgo(days: number, extraHours = 0): Date {
  return new Date(Date.now() - days * DAY_MS + extraHours * 60 * 60 * 1000);
}

function toAnswerProfile(key: string): AnswerProfile {
  const demographics = RESPONDENTS.find((r) => r.key === key)?.demographics;
  if (!demographics) {
    throw new Error(`Respondent ${key} has no demographic profile.`);
  }
  return {
    age: demographics.age,
    gender: demographics.gender,
    occupation: demographics.occupation,
    fieldOfStudy: demographics.fieldOfStudy,
    isStudent: demographics.occupation === 'Sinh viên đại học',
  };
}

/** Comma-separated list of the first `max` items, then how many more. */
function listSome(items: string[], max = 5): string {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown}, … (+${items.length - max})` : shown;
}

/**
 * Seed surveys without a matching form: owned by the survey's seed publisher
 * and carrying the External survey's Idempotency-Key (immutable) or the
 * Internal survey's title. Any other form of the seed publishers, such as the
 * surveys testers create with those accounts, is ignored.
 */
async function findMissingSurveys(
  prisma: PrismaService,
): Promise<SeedSurvey[]> {
  const publisherEmails = new Map(PUBLISHERS.map((p) => [p.key, p.email]));
  const forms = await prisma.form.findMany({
    where: {
      publisher: { email: { in: [...publisherEmails.values()] } },
      OR: [
        {
          title: {
            in: SURVEYS.filter((s) => s.type === 'INTERNAL').map(
              (s) => s.title,
            ),
          },
        },
        {
          creationIdempotencyKey: {
            in: SURVEYS.flatMap((s) =>
              s.type === 'EXTERNAL' ? [s.idempotencyKey] : [],
            ),
          },
        },
      ],
    },
    select: {
      title: true,
      creationIdempotencyKey: true,
      publisher: { select: { email: true } },
    },
  });
  return SURVEYS.filter(
    (survey) =>
      !forms.some(
        (form) =>
          form.publisher.email === publisherEmails.get(survey.publisher) &&
          (survey.type === 'EXTERNAL'
            ? form.creationIdempotencyKey === survey.idempotencyKey
            : form.title === survey.title),
      ),
  );
}

/**
 * Looks only at seed-owned rows (see `findMissingSurveys`): `RUN` on a
 * database without any seed account; `SKIP` when every seed account and seed
 * survey exists, whatever else was added since; `ADD_ADMIN2` when only the
 * second Admin is missing (a database seeded before it existed). Anything
 * else means a seed run stopped half-way.
 */
async function detectPriorSeed(
  prisma: PrismaService,
  accounts: SeedAccount[],
): Promise<'RUN' | 'SKIP' | 'ADD_ADMIN2'> {
  const users = await prisma.user.findMany({
    where: { email: { in: accounts.map((account) => account.email) } },
    select: { email: true, role: true, status: true },
  });
  const existing = new Map(users.map((user) => [user.email, user]));
  const missingAccounts = accounts.filter((a) => !existing.has(a.email));
  if (missingAccounts.length === accounts.length) {
    return 'RUN';
  }

  const missingSurveys = await findMissingSurveys(prisma);
  if (missingSurveys.length === 0) {
    if (missingAccounts.length === 0) {
      for (const account of accounts.filter((a) => a.role === 'ADMIN')) {
        const user = existing.get(account.email)!;
        if (user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
          logger.log(
            `Warning: seed Admin ${account.email} exists but is not an active ADMIN (role ${user.role}, status ${user.status}); the seed does not change existing accounts.`,
          );
        }
      }
      return 'SKIP';
    }
    if (missingAccounts.length === 1 && missingAccounts[0].key === 'admin2') {
      return 'ADD_ADMIN2';
    }
  }

  const missing = [
    missingAccounts.length > 0
      ? `accounts ${listSome(missingAccounts.map((a) => a.email))}`
      : null,
    missingSurveys.length > 0
      ? `surveys ${listSome(missingSurveys.map((s) => `"${s.title}"`))}`
      : null,
  ]
    .filter((part) => part !== null)
    .join('; ');
  throw new Error(
    `Partial seed detected: ${accounts.length - missingAccounts.length}/${accounts.length} seed accounts and ` +
      `${SURVEYS.length - missingSurveys.length}/${SURVEYS.length} seed surveys exist (missing ${missing}). ` +
      'A seed run that stopped half-way leaves this state. So does renaming or deleting a seed survey after a complete seed; then nothing needs re-seeding. ' +
      'The ledger is append-only, so a stopped run cannot be resumed: on a disposable local database only, reset it (npx prisma migrate reset --skip-seed) and run `npm run seed` again.',
  );
}

async function register(
  services: SeedServices,
  account: SeedAccount,
): Promise<string> {
  const result = await services.auth.register(
    registerSchema.parse({ email: account.email, password: account.password }),
  );
  return result.user.id;
}

/** No API creates the first Admin: the seed Admins are promoted directly. */
async function promoteToAdmin(
  services: SeedServices,
  userId: string,
): Promise<void> {
  await services.prisma.user.update({
    where: { id: userId },
    data: { role: 'ADMIN', status: 'ACTIVE' },
  });
}

async function seedUsers(
  services: SeedServices,
  accounts: SeedAccount[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const key of ['admin', 'admin2']) {
    const account = accounts.find((a) => a.key === key)!;
    const id = await register(services, account);
    await promoteToAdmin(services, id);
    ids.set(key, id);
    logger.log(`Admin ${account.email} created`);
  }
  const adminId = ids.get('admin')!;

  for (const publisher of PUBLISHERS) {
    const account = accounts.find((a) => a.email === publisher.email)!;
    const id = await register(services, account);
    await services.userAdmin.updateUserRole(adminId, id, 'PUBLISHER', {
      source: 'go-live-seed',
    });
    ids.set(publisher.key, id);
  }
  logger.log(`${PUBLISHERS.length} publishers registered and promoted`);

  for (const respondent of RESPONDENTS) {
    const account = accounts.find((a) => a.email === respondent.email)!;
    const id = await register(services, account);
    if (respondent.demographics) {
      await services.demographics.submitMandatorySurvey(
        id,
        respondent.demographics,
      );
    }
    ids.set(respondent.key, id);
  }
  logger.log(`${RESPONDENTS.length} respondents registered`);
  return ids;
}

/** FPT campuses offered by onboarding step 12.6, keyed by the seed location. */
const SEED_CAMPUS_BY_LOCATION: Record<string, string> = {
  'Đà Nẵng': 'Trường Đại học FPT – Đà Nẵng',
  'Hà Nội': 'Trường Đại học FPT – Hà Nội',
  'TP. Hồ Chí Minh': 'Trường Đại học FPT – TP. Hồ Chí Minh',
  'Cần Thơ': 'Trường Đại học FPT – Cần Thơ',
};

/** Calendar year in Vietnam (UTC+7), the clock the profile birth-year rule uses. */
function vietnamYear(): number {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCFullYear();
}

/** 18 → "Năm 1" … 22 and older → "Năm 5+". */
function schoolYearForAge(age: number): SchoolYear {
  return SCHOOL_YEAR_VALUES[Math.min(Math.max(age - 18, 0), 4)];
}

/**
 * The profile onboarding would have stored for a seed account, or `null` for
 * a `NEW` respondent who has not reached the onboarding wizard yet.
 */
function seedProfileFor(account: SeedAccount): UpdateUserProfileInput | null {
  if (account.role === 'ADMIN') {
    return { displayName: account.label };
  }
  const publisher = PUBLISHERS.find((p) => p.key === account.key);
  if (publisher) {
    return { displayName: publisher.displayName, goal: 'COLLECT' };
  }
  const respondent = RESPONDENTS.find((r) => r.key === account.key);
  const demographics = respondent?.demographics;
  if (!respondent || !demographics) {
    return null;
  }
  const isStudent = demographics.occupation === 'Sinh viên đại học';
  const school = isStudent
    ? SEED_CAMPUS_BY_LOCATION[demographics.location]
    : undefined;
  return {
    displayName: respondent.displayName,
    birthYear: vietnamYear() - demographics.age,
    goal: 'EARN',
    ...(school ? { school } : {}),
    ...(isStudent ? { schoolYear: schoolYearForAge(demographics.age) } : {}),
  };
}

/**
 * Stores the onboarding profile (FR-9: display name, birth year, school,
 * school year, goal) of every seed account through the same service as
 * `PATCH /users/me/profile`. Only fields that are still empty are written, so
 * a tester's later edit survives a re-run, and a database seeded before
 * profiles existed gets them back-filled. A database whose migrations are
 * behind (no `user_profiles` table, Prisma P2021) stops the seed with the fix.
 */
async function seedProfiles(
  services: SeedServices,
  accounts: SeedAccount[],
): Promise<void> {
  try {
    await storeSeedProfiles(services, accounts);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2021'
    ) {
      throw new Error(
        'The user_profiles table is missing: the database migrations are behind. ' +
          'Run `npx prisma migrate deploy` in apps/backend first, then re-run `npm run seed`.',
        { cause: error },
      );
    }
    throw error;
  }
}

async function storeSeedProfiles(
  services: SeedServices,
  accounts: SeedAccount[],
): Promise<void> {
  const users = await services.prisma.user.findMany({
    where: { email: { in: accounts.map((account) => account.email) } },
    select: { id: true, email: true },
  });
  const idByEmail = new Map(users.map((user) => [user.email, user.id]));

  let filled = 0;
  for (const account of accounts) {
    const userId = idByEmail.get(account.email);
    const desired = seedProfileFor(account);
    if (!userId || !desired) continue;
    const current = await services.profiles.getOwnProfile(userId);
    const missing = Object.fromEntries(
      Object.entries(desired).filter(
        ([field]) => current[field as keyof UserProfileDto] === null,
      ),
    ) as UpdateUserProfileInput;
    if (Object.keys(missing).length === 0) continue;
    await services.profiles.updateOwnProfile(userId, missing);
    filled += 1;
  }
  logger.log(
    filled === 0
      ? 'Seed profiles already complete'
      : `Profiles stored for ${filled} seed accounts`,
  );
}

async function seedScoringPolicy(prisma: PrismaService): Promise<void> {
  const { name, version, status, definition } = SCORING_POLICY;
  await prisma.scoringPolicy.upsert({
    where: { name_version: { name, version } },
    create: { name, version, status, definition, activatedAt: new Date() },
    update: {},
  });
}

async function seedTopUps(
  services: SeedServices,
  ids: Map<string, string>,
): Promise<void> {
  const adminId = ids.get('admin')!;
  for (const publisher of PUBLISHERS) {
    const userId = ids.get(publisher.key)!;
    for (const amount of publisher.approvedTopUps) {
      const request = await services.topUps.createRequest(userId, { amount });
      await services.topUps.approveTopUp({ topUpId: request.id, adminId });
    }
    for (const amount of publisher.rejectedTopUps) {
      const request = await services.topUps.createRequest(userId, { amount });
      await services.topUps.rejectTopUp({
        topUpId: request.id,
        adminId,
        reason: TOP_UP_REJECTION_REASON,
      });
    }
    for (const amount of publisher.pendingTopUps) {
      await services.topUps.createRequest(userId, { amount });
    }
  }
  logger.log('Top-ups created (approved, rejected and pending)');
}

async function completeInternal(
  services: SeedServices,
  survey: SeedInternalSurvey,
  formId: string,
  respondentKey: string,
  respondentId: string,
  index: number,
): Promise<CompletedAttempt> {
  const rng = createRng(`${survey.key}:${respondentKey}`);
  const started = await services.participation.startAttempt(
    formId,
    respondentId,
    {},
    `198.51.100.${10 + index}`,
  );
  // A real respondent takes minutes; the server-side Time Barrier measures
  // from the recorded start, so the start moves back inside the 30-minute
  // reservation window.
  await services.prisma.surveyAttempt.update({
    where: { id: started.attemptId },
    data: { startedAt: new Date(Date.now() - rng.int(4, 12) * 60 * 1000) },
  });
  const answers = survey.answers!(toAnswerProfile(respondentKey), rng);
  const result = await services.participation.submitInternalResponse(
    started.responseId!,
    respondentId,
    { answers },
  );
  return {
    surveyKey: survey.key,
    respondentKey,
    attemptId: result.attemptId,
    responseId: result.responseId,
  };
}

async function approve(
  services: SeedServices,
  formId: string,
  formVersionId: string,
  adminId: string,
  note?: string,
): Promise<void> {
  await services.moderation.approve({
    formId,
    adminId,
    input: note ? { formVersionId, note } : { formVersionId },
  });
}

async function seedInternalSurvey(
  services: SeedServices,
  survey: SeedInternalSurvey,
  ids: Map<string, string>,
  completed: CompletedAttempt[],
): Promise<string> {
  const publisherId = ids.get(survey.publisher)!;
  const adminId = ids.get('admin')!;
  const requester = { userId: publisherId, role: 'PUBLISHER' };

  const draft = await services.forms.createDraft(publisherId, {
    title: survey.title,
    description: survey.description,
    type: 'INTERNAL',
    rewardPerResponse: survey.rewardPerResponse,
    expectedCompletions: survey.expectedCompletions,
    estimatedDurationMinutes: survey.estimatedDurationMinutes,
    schema: survey.schema,
    targetingJson: survey.targeting ?? null,
  });
  if (survey.scenario === 'DRAFT') {
    return draft.id;
  }

  // Publish = Escrow lock + moderation queue entry (one Unit of Work).
  const queued = await services.forms.publishForm(draft.id, requester, {});
  const versionId = queued.currentVersion.id;
  if (survey.scenario === 'MODERATION_QUEUE') {
    return draft.id;
  }
  if (survey.scenario === 'REJECTED') {
    await services.moderation.reject({
      formId: draft.id,
      adminId,
      input: { formVersionId: versionId, reason: survey.rejectionReason },
    });
    return draft.id;
  }

  await approve(services, draft.id, versionId, adminId, survey.moderationNote);
  for (const [index, respondentKey] of survey.respondents.entries()) {
    completed.push(
      await completeInternal(
        services,
        survey,
        draft.id,
        respondentKey,
        ids.get(respondentKey)!,
        index,
      ),
    );
  }

  if (survey.scenario === 'OWNER_CLOSED') {
    await services.forms.closeForm(draft.id, requester, {
      reason: survey.closeReason,
    });
  }
  return draft.id;
}

async function seedExternalSurvey(
  services: SeedServices,
  survey: SeedExternalSurvey,
  ids: Map<string, string>,
  completed: CompletedAttempt[],
): Promise<string> {
  const publisherId = ids.get(survey.publisher)!;
  const adminId = ids.get('admin')!;

  // autoPublish reserves the Escrow and enters the moderation queue. The
  // Idempotency-Key derives the completion code deterministically.
  const created = await services.forms.createExternalSurvey(
    publisherId,
    {
      title: survey.title,
      description: survey.description,
      externalUrl: survey.externalUrl,
      rewardPerResponse: survey.rewardPerResponse,
      expectedCompletions: survey.expectedCompletions,
      expectedEffortSeconds: survey.estimatedDurationMinutes * 60,
      estimatedDurationMinutes: survey.estimatedDurationMinutes,
      autoPublish: true,
    },
    survey.idempotencyKey,
  );
  await approve(
    services,
    created.id,
    created.currentVersion.id,
    adminId,
    survey.moderationNote,
  );

  for (const [index, respondentKey] of survey.respondents.entries()) {
    const respondentId = ids.get(respondentKey)!;
    const rng = createRng(`${survey.key}:${respondentKey}`);
    const started = await services.participation.startAttempt(
      created.id,
      respondentId,
      {},
      `198.51.100.${60 + index}`,
    );
    await services.prisma.surveyAttempt.update({
      where: { id: started.attemptId },
      data: { startedAt: new Date(Date.now() - rng.int(5, 9) * 60 * 1000) },
    });
    await services.participation.verifyExternalCompletionCode(
      created.id,
      started.attemptId,
      respondentId,
      { completionCode: created.plaintextCompletionCode },
    );
    completed.push({
      surveyKey: survey.key,
      respondentKey,
      attemptId: started.attemptId,
      responseId: null,
    });
  }
  return created.id;
}

async function seedFeedback(
  services: SeedServices,
  ids: Map<string, string>,
  completed: CompletedAttempt[],
): Promise<void> {
  for (const item of FEEDBACK) {
    const attempt = completed.find(
      (c) => c.surveyKey === item.survey && c.respondentKey === item.respondent,
    );
    if (!attempt) {
      throw new Error(
        `Feedback references a missing completion: ${item.survey} / ${item.respondent}`,
      );
    }
    await services.feedback.submitFeedback(
      attempt.attemptId,
      ids.get(item.respondent)!,
      submitSurveyFeedbackInputSchema.parse(item.input),
    );
  }
  logger.log(`${FEEDBACK.length} survey feedback entries submitted`);
}

/**
 * Spreads the non-ledger timeline over the past weeks. Ledger journals,
 * outbox events and notifications keep the seed time (append-only / not
 * user-facing history). External completions stay recent so their Pending
 * credits are still inside the 48-hour review.
 */
async function backdateTimeline(
  prisma: PrismaService,
  ids: Map<string, string>,
  formIds: Map<string, string>,
  completed: CompletedAttempt[],
): Promise<void> {
  for (const key of ['admin', 'admin2']) {
    await prisma.user.update({
      where: { id: ids.get(key)! },
      data: { createdAt: daysAgo(22) },
    });
  }
  for (const publisher of PUBLISHERS) {
    const userId = ids.get(publisher.key)!;
    await prisma.user.update({
      where: { id: userId },
      data: { createdAt: daysAgo(publisher.registeredDaysAgo) },
    });
    const topUps = await prisma.topUpRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    for (const [index, topUp] of topUps.entries()) {
      const createdAt =
        topUp.status === 'PENDING'
          ? daysAgo(1)
          : daysAgo(publisher.registeredDaysAgo - 1, index * 5);
      await prisma.topUpRequest.update({
        where: { id: topUp.id },
        data: {
          createdAt,
          reviewedAt: topUp.reviewedAt
            ? new Date(createdAt.getTime() + 3 * 60 * 60 * 1000)
            : null,
        },
      });
    }
  }
  for (const respondent of RESPONDENTS) {
    const userId = ids.get(respondent.key)!;
    await prisma.user.update({
      where: { id: userId },
      data: { createdAt: daysAgo(respondent.registeredDaysAgo) },
    });
    await prisma.demographicProfile.updateMany({
      where: { userId },
      data: { createdAt: daysAgo(respondent.registeredDaysAgo, 1) },
    });
  }

  for (const survey of SURVEYS) {
    const formId = formIds.get(survey.key)!;
    const publishedAt = daysAgo(survey.publishedDaysAgo);
    const closedAt =
      survey.type === 'INTERNAL' && survey.closedDaysAgo !== undefined
        ? daysAgo(survey.closedDaysAgo)
        : null;
    await prisma.form.update({
      where: { id: formId },
      data: {
        createdAt: daysAgo(survey.publishedDaysAgo + 1),
        updatedAt: closedAt ?? publishedAt,
      },
    });
    await prisma.formVersion.updateMany({
      where: { formId },
      data: { createdAt: daysAgo(survey.publishedDaysAgo + 1) },
    });
    await prisma.formVersion.updateMany({
      where: { formId, publishedAt: { not: null } },
      data: { publishedAt },
    });
    await prisma.surveyModerationDecision.updateMany({
      where: { formId },
      data: { decidedAt: publishedAt, createdAt: publishedAt },
    });

    if (survey.type === 'EXTERNAL') continue;
    const attempts = completed.filter((c) => c.surveyKey === survey.key);
    const windowEnd = (closedAt ?? new Date()).getTime() - 2 * 60 * 60 * 1000;
    const windowStart = publishedAt.getTime() + 2 * 60 * 60 * 1000;
    for (const [index, attempt] of attempts.entries()) {
      const rng = createRng(`timeline:${attempt.attemptId}`);
      const fraction = (index + rng.next()) / attempts.length;
      const submittedAt = new Date(
        windowStart + fraction * (windowEnd - windowStart),
      );
      const startedAt = new Date(
        submittedAt.getTime() - rng.int(4, 12) * 60 * 1000,
      );
      await prisma.surveyAttempt.update({
        where: { id: attempt.attemptId },
        data: { startedAt, submittedAt, createdAt: startedAt },
      });
      if (attempt.responseId) {
        await prisma.response.update({
          where: { id: attempt.responseId },
          data: { createdAt: startedAt, submittedAt },
        });
      }
      await prisma.surveyFeedback.updateMany({
        where: { attemptId: attempt.attemptId },
        data: {
          submittedAt: new Date(submittedAt.getTime() + 60 * 1000),
          createdAt: new Date(submittedAt.getTime() + 60 * 1000),
        },
      });
    }
  }
  logger.log('Timeline backdated over the past three weeks');
}

const CREDENTIALS_TITLE =
  '# RESCOM seed credentials (LOCAL ONLY — do not commit or share)';

const CREDENTIALS_STATUS = {
  REGISTERING:
    'Status: registering accounts. If this line remains, the run stopped early: some of these accounts may exist (with these passwords), the rest of the seed data may not.',
  ACCOUNTS_CREATED:
    'Status: accounts created, seed still running. If this line remains, the run stopped early: these accounts exist, the rest of the seed data may not.',
  COMPLETE: 'Status: seed complete.',
} as const;

/** Fails before any account exists when the credentials file is not writable. */
function assertCredentialsFileWritable(): void {
  accessSync(
    existsSync(CREDENTIALS_FILE) ? CREDENTIALS_FILE : dirname(CREDENTIALS_FILE),
    fsConstants.W_OK,
  );
}

function credentialsTable(accounts: SeedAccount[]): string[] {
  const rows = accounts.map((account) => {
    const password =
      account.passwordSource === 'generated'
        ? `\`${account.password}\``
        : account.role === 'ADMIN'
          ? '(SEED_ADMIN_PASSWORD)'
          : '(SEED_DEMO_PASSWORD)';
    return `| ${account.role} | ${account.email} | ${password} | ${account.label} |`;
  });
  return [
    '| Role | Email | Password | Account |',
    '| --- | --- | --- | --- |',
    ...rows,
  ];
}

/**
 * Written before the accounts are registered (the passwords are known up
 * front), so a failure during or after registration cannot lose the
 * generated passwords; rewritten once the accounts exist and again when the
 * seed completes.
 */
function writeCredentialsFile(
  accounts: SeedAccount[],
  status: 'REGISTERING' | 'ACCOUNTS_CREATED' | 'COMPLETE',
): void {
  const content = [
    CREDENTIALS_TITLE,
    '',
    `Generated by \`npm run seed\` on ${new Date().toISOString()}.`,
    CREDENTIALS_STATUS[status],
    'Passwords shown in backticks were generated randomly for this run;',
    'the others come from the named environment variable.',
    '',
    ...credentialsTable(accounts),
    '',
  ].join('\n');
  writeFileSync(CREDENTIALS_FILE, content, { mode: 0o600 });
  // `mode` only applies when the file is created.
  chmodSync(CREDENTIALS_FILE, 0o600);
  logger.log(`Credentials written to ${CREDENTIALS_FILE}`);
}

/**
 * Accounts added on top of an existing seed are appended: the file keeps the
 * earlier generated passwords, which exist nowhere else.
 */
function appendCredentials(accounts: SeedAccount[], heading: string): void {
  const lines = existsSync(CREDENTIALS_FILE)
    ? []
    : [
        CREDENTIALS_TITLE,
        '',
        'The accounts of the earlier seed run are not listed: their generated passwords',
        "were written only to that run's credentials file.",
      ];
  lines.push(
    '',
    `## ${heading} (\`npm run seed\`, ${new Date().toISOString()})`,
    '',
    ...credentialsTable(accounts),
    '',
  );
  appendFileSync(CREDENTIALS_FILE, lines.join('\n'), { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600);
  logger.log(`Credentials appended to ${CREDENTIALS_FILE}`);
}

/**
 * A database seeded before the second Admin existed: creates only that
 * account, promoted like the first one, and keeps everything else as it is.
 */
async function addSecondAdmin(
  services: SeedServices,
  account: SeedAccount,
): Promise<void> {
  const id = await register(services, account);
  // Recorded before the promotion so the password survives a failure there.
  appendCredentials([account], 'Second Admin added to the existing seed');
  await promoteToAdmin(services, id);
  logger.log(
    `Seed data already present; added the second Admin ${account.email}.`,
  );
}

async function runSeed(
  app: INestApplicationContext,
  accounts: SeedAccount[],
): Promise<void> {
  const services: SeedServices = {
    prisma: app.get(PrismaService),
    auth: app.get(AuthService, { strict: false }),
    userAdmin: app.get(UserAdminService, { strict: false }),
    demographics: app.get(DemographicsService, { strict: false }),
    profiles: app.get(UserProfileService, { strict: false }),
    topUps: app.get(TopUpService, { strict: false }),
    starterPoints: app.get(StarterPointsCoordinator, { strict: false }),
    forms: app.get(FormsService, { strict: false }),
    moderation: app.get(SurveyModerationService, { strict: false }),
    participation: app.get(ParticipationService, { strict: false }),
    feedback: app.get(SurveyFeedbackService, { strict: false }),
  };

  const priorSeed = await detectPriorSeed(services.prisma, accounts);
  if (priorSeed === 'SKIP') {
    logger.log(
      'Seed data already present (all seed accounts and surveys exist).',
    );
    await seedProfiles(services, accounts);
    return;
  }
  assertCredentialsFileWritable();
  if (priorSeed === 'ADD_ADMIN2') {
    await addSecondAdmin(
      services,
      accounts.find((account) => account.key === 'admin2')!,
    );
    await seedProfiles(services, accounts);
    return;
  }

  writeCredentialsFile(accounts, 'REGISTERING');
  const ids = await seedUsers(services, accounts);
  writeCredentialsFile(accounts, 'ACCOUNTS_CREATED');
  await seedProfiles(services, accounts);
  await seedScoringPolicy(services.prisma);
  await seedTopUps(services, ids);

  const formIds = new Map<string, string>();
  const completed: CompletedAttempt[] = [];
  for (const survey of SURVEYS as SeedSurvey[]) {
    const formId =
      survey.type === 'INTERNAL'
        ? await seedInternalSurvey(services, survey, ids, completed)
        : await seedExternalSurvey(services, survey, ids, completed);
    formIds.set(survey.key, formId);
    logger.log(`Survey "${survey.title}" -> ${survey.scenario}`);
  }

  await seedFeedback(services, ids, completed);

  // Idempotent re-check of the FR-8 unlock (the submissions already ran it).
  for (const respondent of RESPONDENTS) {
    if (respondent.activity === 'ACTIVE') {
      await services.starterPoints.checkAndUnlockStarterPoints(
        ids.get(respondent.key)!,
      );
    }
  }

  await backdateTimeline(services.prisma, ids, formIds, completed);
  writeCredentialsFile(accounts, 'COMPLETE');
  logger.log(
    `Done: ${accounts.length} accounts, ${SURVEYS.length} surveys, ${completed.length} completions.`,
  );
}

async function main(): Promise<void> {
  assertEnvironmentAllowed();
  const accounts = buildAccounts();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    await runSeed(app, accounts);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
