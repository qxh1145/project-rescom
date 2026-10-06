import type {
  MockUser,
  MockSession,
  MockSurvey,
  MockSurveyAttempt,
  MockSubmissionResult,
  MockFeedParams,
  MockFeedResult,
  MockOnboardingDraft,
  MockNotification,
  MockNotificationListParams,
  MockTopUpOptions,
  MockTopUpRequest,
  MockOnboardingStatus,
  MockDemographicSurveyResult,
  MockActivationStatus,
  MockStoreState,
  MockSurveyFeedback,
  MockTimeBarrierStatus,
  MockReviewSimulationResult,
} from "./types.ts";
import {
  loadStore,
  saveStore,
  resetStore,
  getCurrentUser,
  setCurrentUserId,
  updateUser,
  getDemographicProfile as getStoredProfile,
  saveDemographicProfile as saveStoredProfile,
  getOnboardingDraft as getStoredDraft,
  saveOnboardingDraft as saveStoredDraft,
  clearOnboardingDraft as clearStoredDraft,
  getAllSurveys,
  getSurvey as getStoredSurvey,
  saveAttempt as saveStoredAttempt,
  getAttempt as getStoredAttempt,
  getWallet as getStoredWallet,
  saveWallet as saveStoredWallet,
  getTransactions as getStoredTransactions,
  appendTransaction,
  getNotifications as getStoredNotifications,
  saveNotifications as saveStoredNotifications,
  getTopUpRequests as getStoredTopUpRequests,
  saveTopUpRequests as saveStoredTopUpRequests,
  getAllTopUpReferences,
  getSurveyFeedback as getStoredSurveyFeedback,
  saveSurveyFeedback as saveStoredSurveyFeedback,
} from "./store.ts";
import { MOCK_TOP_UP_BANK } from "./fixtures.ts";
import {
  MARKETPLACE_ACTIVATION_PATH,
  POST_ONBOARDING_DEFAULT_PATH,
} from "../../lib/onboarding.ts";
import {
  isSurveyTargetingMatch,
  getMissingDemographicFields,
  submitDemographicSurveySchema,
  DEMOGRAPHIC_PROFILE_REQUIRED_CODE,
  REQUIRED_DEMOGRAPHIC_FIELDS,
  type DemographicProfileField,
  type SubmitDemographicSurveyInput,
  calculateWalletTotal,
  type DemographicProfileDto,
  type UpdateDemographicProfileInput,
  type MarketplaceSurveyCardDto,
  type WalletBalanceDto,
  type WalletDetailsDto,
  type WalletTransactionItemDto,
  type NotificationDto,
  type NotificationListDto,
  type NotificationType,
  type MarkNotificationReadResultDto,
  type MarkAllNotificationsReadResultDto,
  type TopUpRequestDto,
  type TopUpRequestListDto,
  verifyExternalCompletionCodeInputSchema,
  listNotificationsQuerySchema,
  POINT_VND_RATE,
  TOP_UP_MIN_POINTS,
  TOP_UP_MAX_POINTS,
  TOP_UP_MAX_PENDING_REQUESTS,
  TOP_UP_PRESET_AMOUNTS,
  TOP_UP_LIST_DEFAULT_LIMIT,
  TOP_UP_REFERENCE_CODE_LENGTH,
  buildTopUpReference,
  buildVietQrPayload,
  pointsToVnd,
  evaluateStarterActivation,
  isStarterActivationRewardEligible,
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  SELF_PARTICIPATION_FORBIDDEN_CODE,
  STARTER_POINTS_DEFAULT_AMOUNT,
  STARTER_POINTS_EXPIRY_DAYS,
  type StarterActivationCompletion,
  type StarterActivationEvaluation,
  type StarterPointsStatusDto,
  computeInternalTimeBarrier,
  evaluateTimeBarrier,
  evaluateCompletionCapacity,
  resolveExternalTimeBarrierSeconds,
  COMPLETION_CODE_LIMIT_REACHED_CODE,
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  RESERVATION_EXPIRY_MS,
  remainingCompletionCodeTries,
  DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
  PARTICIPATION_RATE_LIMITED_CODE,
  SUBMISSION_TOO_FAST_CODE,
  TIME_BARRIER_POLICY_VERSION,
  type ParticipationRateLimitDetails,
  type TimeBarrierRejectionDetails,
  submitSurveyFeedbackInputSchema,
  isSameSurveyFeedbackContent,
  SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE,
  SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE,
  SURVEY_FEEDBACK_NOT_ALLOWED_CODE,
  type SubmitSurveyFeedbackInput,
  type SubmitSurveyFeedbackResultDto,
  type SurveyFeedbackDto,
  type SurveyFeedbackStatusDto,
} from "@rescom/schemas";
import {
  SURVEY_FEEDBACK_ERROR_MESSAGES,
  describeSurveyFeedbackValidationIssue,
} from "../../lib/survey-feedback.ts";

/**
 * `completion-code-policy-v1` (decision E5-D1, provisional pending PRD Open
 * Question 14): 3 wrong codes lock an attempt; 6 per account and survey
 * version (summed across attempts) refuse further attempts on that version
 * until an Admin resets the count.
 */
export const MAX_COMPLETION_CODE_ATTEMPTS =
  COMPLETION_CODE_POLICY.maxFailuresPerAttempt;
export const MAX_COMPLETION_CODE_FAILURES_PER_VERSION =
  COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion;

/** Window event fired whenever the current demo data changes notifications (browser only). */
export const NOTIFICATIONS_CHANGED_EVENT = "rescom:notifications-changed";

function emitNotificationsChanged(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  try {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  } catch {
    // Non-critical UI refresh hint.
  }
}

function toNotificationDto(notification: MockNotification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    message: notification.message,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
  };
}

/** UUID v4 like the backend ids (`crypto.randomUUID` is missing on insecure origins). */
function createMockUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** Newest first; later insertion wins ties so same-millisecond events keep their order. */
function sortNewestFirst(notifications: MockNotification[]): MockNotification[] {
  return notifications
    .map((notification, index) => ({ notification, index }))
    .sort(
      (a, b) =>
        new Date(b.notification.createdAt).getTime() -
          new Date(a.notification.createdAt).getTime() || b.index - a.index,
    )
    .map(({ notification }) => notification);
}

function toSurveyFeedbackDto(feedback: MockSurveyFeedback): SurveyFeedbackDto {
  return {
    id: feedback.id,
    attemptId: feedback.attemptId,
    formId: feedback.surveyId,
    formVersionId: feedback.formVersionId,
    formType: feedback.formType,
    rating: feedback.rating,
    comment: feedback.comment,
    issueTags: [...feedback.issueTags],
    validationStatus: feedback.validationStatus,
    submittedAt: feedback.submittedAt,
  };
}

function toTopUpRequestDto(request: MockTopUpRequest): TopUpRequestDto {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userId, ...dto } = request;
  return dto;
}

function randomReferenceBytes(): Uint8Array {
  const bytes = new Uint8Array(TOP_UP_REFERENCE_CODE_LENGTH);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/** Transfer syntax unique across the demo store (the backend enforces a unique index). */
function createUniqueTopUpReference(): string {
  const taken = getAllTopUpReferences();
  let reference = buildTopUpReference(randomReferenceBytes());
  while (taken.has(reference)) {
    reference = buildTopUpReference(randomReferenceBytes());
  }
  return reference;
}

export type MockRepositoryError = Error & {
  code?: string;
  details?: Record<string, unknown>;
};

function repositoryError(
  message: string,
  code: string,
  details?: Record<string, unknown>,
): MockRepositoryError {
  const error = new Error(message) as MockRepositoryError;
  error.code = code;
  error.details = details;
  return error;
}

function toSubmissionActivation(
  evaluation: StarterActivationEvaluation | null,
): MockSubmissionResult["activation"] {
  if (!evaluation) return undefined;
  return {
    state: evaluation.state,
    confirmsAt:
      evaluation.state === "PENDING_CONFIRMATION"
        ? (evaluation.pendingSurvey?.confirmsAt ?? null)
        : (evaluation.activationSurvey?.confirmsAt ?? null),
    // Code review P7: the receipt offers "unlock now" only while the window is open.
    expiresAt: evaluation.expiresAt.toISOString(),
  };
}

/**
 * Code review P8: `isOnboarded` is derived from the stored profile on every
 * read, never trusted from a persisted flag (a store saved under an older
 * rule, or edited, could otherwise claim a complete profile).
 */
function withDerivedOnboarding(user: MockUser): MockUser {
  const isOnboarded = getMissingDemographicFields(getStoredProfile(user.id)).length === 0;
  return user.isOnboarded === isOnboarded ? user : { ...user, isOnboarded };
}

/**
 * Code review P13: partial-update semantics of `PUT /demographics` —
 * `undefined` keeps the stored value, `null` clears it, strings are trimmed
 * and a blank string clears the field.
 */
function mergeProfileText(
  input: string | null | undefined,
  current: string | null | undefined,
): string | null {
  if (input === undefined) return current ?? null;
  if (input === null) return null;
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

interface ResolvedTimeBarrier {
  requiredSeconds: number;
  questionCount: number | null;
  secondsPerQuestion: number | null;
  publisherMinimumSeconds: number | null;
  policyVersion: string;
}

/**
 * Story 8.2: same rule as the backend (`@rescom/schemas`). Internal = max(
 * answerable questions × 2 s, publisher minimum); External = publisher minimum
 * or 15 s. The mock has one version per survey, so it is also the pinned one.
 */
function resolveSurveyTimeBarrier(survey: MockSurvey): ResolvedTimeBarrier {
  if (survey.type === "INTERNAL") {
    return computeInternalTimeBarrier({
      blocks: survey.blocks ?? [],
      metadata: survey.metadata ?? {
        minTimeBarrierSeconds: survey.minTimeBarrierSeconds,
      },
    });
  }
  const requiredSeconds = resolveExternalTimeBarrierSeconds({
    minTimeBarrierSeconds: survey.minTimeBarrierSeconds,
  });
  return {
    requiredSeconds,
    questionCount: null,
    secondsPerQuestion: null,
    publisherMinimumSeconds: requiredSeconds,
    policyVersion: TIME_BARRIER_POLICY_VERSION,
  };
}

function timeBarrierStatus(
  attempt: MockSurveyAttempt,
  survey: MockSurvey,
): MockTimeBarrierStatus {
  const barrier = resolveSurveyTimeBarrier(survey);
  // The mock repository plays the server: only its own startedAt counts.
  const timing = evaluateTimeBarrier({
    startedAt: attempt.startedAt,
    requiredSeconds: barrier.requiredSeconds,
  });
  return {
    requiredSeconds: barrier.requiredSeconds,
    questionCount: barrier.questionCount,
    secondsPerQuestion: barrier.secondsPerQuestion,
    publisherMinimumSeconds: barrier.publisherMinimumSeconds,
    elapsedSeconds: timing.elapsedSeconds,
    remainingSeconds: timing.remainingSeconds,
    earliestSubmitAt: timing.earliestSubmitAt,
    passed: timing.passed,
  };
}

/** Rejects a too-fast submission without touching the attempt (FR-45). */
function assertTimeBarrier(attempt: MockSurveyAttempt, survey: MockSurvey): void {
  const status = timeBarrierStatus(attempt, survey);
  if (status.passed) return;
  const details: TimeBarrierRejectionDetails = {
    requiredSeconds: status.requiredSeconds,
    elapsedSeconds: status.elapsedSeconds,
    remainingSeconds: status.remainingSeconds,
    retryAfterSeconds: status.remainingSeconds,
    earliestSubmitAt: status.earliestSubmitAt,
    questionCount: status.questionCount,
    secondsPerQuestion: status.secondsPerQuestion,
    publisherMinimumSeconds: status.publisherMinimumSeconds,
    policyVersion: TIME_BARRIER_POLICY_VERSION,
  };
  const rule =
    status.questionCount && status.secondsPerQuestion
      ? `, ${status.questionCount} câu hỏi × ${status.secondsPerQuestion} giây`
      : "";
  throw repositoryError(
    `Thời gian làm bài quá ngắn (${status.elapsedSeconds}s / tối thiểu ${status.requiredSeconds}s${rule}). Hãy dành thời gian đọc kỹ từng câu hỏi. Bạn có thể nộp lại sau ${status.remainingSeconds} giây nữa.`,
    SUBMISSION_TOO_FAST_CODE,
    details,
  );
}

/** "45 giây", "3 phút", "1 giờ 5 phút" (Vietnamese, rounded up). */
function formatWaitDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/**
 * FR-46 completion limit, mirrored from the backend (decision E8-D6): the
 * capacity is reserved when an attempt STARTS — completions in the rolling
 * window plus the user's other open attempts (unexpired IN_PROGRESS). An
 * attempt that was allowed to start can always be submitted, so submit and
 * code verification never re-check it. (The mock has no resume flow: a
 * restart of the same survey supersedes that survey's open attempt.)
 */
function assertStartCapacity(userId: string, surveyId: string): void {
  const policy = DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY;
  const attempts = Object.values(loadStore().attempts).filter(
    (attempt) => attempt.userId === userId,
  );
  const completionTimes = attempts
    .filter(
      (attempt) => attempt.status === "COMPLETED" && Boolean(attempt.completedAt),
    )
    .map((attempt) => attempt.completedAt as string);
  const openAttemptStartTimes = attempts
    .filter(
      (attempt) =>
        attempt.status === "IN_PROGRESS" && attempt.surveyId !== surveyId,
    )
    .map((attempt) => attempt.startedAt);
  const evaluation = evaluateCompletionCapacity({
    completionTimes,
    openAttemptStartTimes,
    limit: policy.completionLimit,
    windowSeconds: policy.completionWindowSeconds,
    reservationSeconds: RESERVATION_EXPIRY_MS / 1000,
  });
  if (evaluation.allowed) return;
  const details: ParticipationRateLimitDetails = {
    scope: "COMPLETIONS",
    limit: policy.completionLimit,
    windowSeconds: policy.completionWindowSeconds,
    retryAfterSeconds: evaluation.retryAfterSeconds,
    retryAt: evaluation.retryAt ?? new Date().toISOString(),
    policyVersion: PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
    completionsInWindow: evaluation.completionsInWindow,
    inProgressAttempts: evaluation.inProgressAttempts,
  };
  throw repositoryError(
    evaluation.inProgressAttempts > 0
      ? `Bạn đã đạt giới hạn ${policy.completionLimit} khảo sát trong ${formatWaitDuration(policy.completionWindowSeconds)} (gồm ${evaluation.completionsInWindow} khảo sát đã hoàn thành và ${evaluation.inProgressAttempts} khảo sát đang làm dở). Hãy hoàn thành khảo sát đang làm, hoặc quay lại sau ${formatWaitDuration(evaluation.retryAfterSeconds)}.`
      : `Bạn đã hoàn thành ${policy.completionLimit} khảo sát trong ${formatWaitDuration(policy.completionWindowSeconds)} gần đây: mức tối đa để bảo vệ chất lượng dữ liệu nghiên cứu. Vui lòng quay lại sau ${formatWaitDuration(evaluation.retryAfterSeconds)}.`,
    PARTICIPATION_RATE_LIMITED_CODE,
    details,
  );
}

/**
 * Decision E5-D1 (backend parity): the user's wrong completion codes on one
 * survey version, summed across attempts.
 */
function countCompletionCodeFailures(
  userId: string,
  formVersionId: string,
): number {
  return Object.values(loadStore().attempts)
    .filter(
      (attempt) =>
        attempt.userId === userId && attempt.formVersionId === formVersionId,
    )
    .reduce((sum, attempt) => sum + (attempt.failedCodeAttempts ?? 0), 0);
}

function completionCodeLimitError(
  formVersionId: string,
  failedVerifications: number,
): MockRepositoryError {
  return repositoryError(
    `Bạn đã dùng hết ${MAX_COMPLETION_CODE_FAILURES_PER_VERSION} lần nhập mã hoàn thành cho phiên bản khảo sát này. Vui lòng liên hệ Admin RESCOM nếu bạn nhập sai do nhầm lẫn.`,
    COMPLETION_CODE_LIMIT_REACHED_CODE,
    {
      formVersionId,
      failedVerifications,
      limit: MAX_COMPLETION_CODE_FAILURES_PER_VERSION,
      policyVersion: COMPLETION_CODE_POLICY_VERSION,
    },
  );
}

function toSurveyCard(
  survey: MockSurvey,
  isCompletedByCurrentUser: boolean,
): MarketplaceSurveyCardDto {
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    type: survey.type,
    status: "PUBLISHED",
    rewardPerResponse: survey.rewardPerResponse,
    expectedCompletions: survey.expectedCompletions,
    completedCompletions: survey.completedCompletions,
    estimatedEffortSeconds: survey.estimatedEffortSeconds,
    versionNumber: survey.versionNumber,
    publishedAt: survey.publishedAt,
    targetingJson: survey.targetingJson,
    hasTargeting: survey.hasTargeting,
    isCompletedByCurrentUser,
  };
}

class MockRepository {
  private latencyMs: number = 60;
  private simulateError: boolean = false;

  setLatency(ms: number) {
    this.latencyMs = ms;
  }

  setSimulateError(value: boolean) {
    this.simulateError = value;
  }

  getSimulateError(): boolean {
    return this.simulateError;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (this.simulateError) {
      throw new Error("Simulated network failure. Click Retry to try again.");
    }
  }

  // --- Auth & Session ---
  async getCurrentUser(): Promise<MockUser | null> {
    await this.delay();
    const user = getCurrentUser();
    return user ? withDerivedOnboarding(user) : null;
  }

  async getCurrentSession(): Promise<MockSession | null> {
    await this.delay();
    const current = getCurrentUser();
    if (!current) return null;
    const user = withDerivedOnboarding(current);
    return {
      token: `mock-token-${user.id}`,
      user,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  async login(credentials: {
    email: string;
    password?: string;
  }): Promise<{ user: MockUser; redirectUrl: string }> {
    await this.delay();
    const email = credentials.email.trim().toLowerCase();
    const state = loadStore();

    const storedUser = Object.values(state.users).find(
      (u) => u.email.toLowerCase() === email,
    );

    if (!storedUser) {
      throw new Error(
        "Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại thông tin đăng nhập.",
      );
    }

    // Set as active session
    setCurrentUserId(storedUser.id);
    const user = withDerivedOnboarding(storedUser);

    const redirectUrl = user.isOnboarded ? "/dashboard" : "/onboarding";
    return { user, redirectUrl };
  }

  async register(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ user: MockUser; redirectUrl: string }> {
    await this.delay();
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();

    if (!email || !email.includes("@")) {
      throw new Error("Vui lòng nhập địa chỉ email hợp lệ.");
    }
    if (!name || name.length < 2) {
      throw new Error("Họ và tên phải có ít nhất 2 ký tự.");
    }
    if (!input.password || input.password.length < 6) {
      throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
    }

    const state = loadStore();
    const existing = Object.values(state.users).find(
      (u) => u.email.toLowerCase() === email,
    );
    if (existing) {
      throw new Error("Email này đã được sử dụng. Vui lòng chọn email khác hoặc đăng nhập.");
    }

    // Unique even for two registrations in the same millisecond (tests do that).
    const newUserId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newUser: MockUser = {
      id: newUserId,
      email,
      name,
      role: "RESPONDENT",
      isOnboarded: false,
      isActivated: false,
      hasUnlockedFrozenPoints: false,
      streak: 0,
      completedSurveyIds: [],
      createdAt: new Date().toISOString(),
    };

    state.users[newUserId] = newUser;
    state.currentUserId = newUserId;

    // Grant 100 starter Frozen Points
    const initialWallet: WalletBalanceDto = {
      available: 0,
      pending: 0,
      escrow: 0,
      frozen: 100,
      integrityHold: 0,
      total: 100,
    };
    state.wallets[newUserId] = initialWallet;

    const initialTx: WalletTransactionItemDto = {
      id: `tx-starter-${newUserId}`,
      journalId: `j-starter-${newUserId}`,
      amount: 100,
      accountClass: "FROZEN",
      description:
        "Điểm thưởng tân thủ (Khóa cho đến khi hoàn thành hồ sơ + 1 khảo sát)",
      idempotencyKey: `idem-starter-${newUserId}`,
      createdAt: new Date().toISOString(),
      reversesJournalId: null,
    };
    state.transactions[newUserId] = [initialTx];

    saveStore(state);

    return { user: newUser, redirectUrl: "/onboarding" };
  }

  async logout(): Promise<void> {
    await this.delay();
    setCurrentUserId(null);
  }

  async switchDemoUser(userId: string): Promise<MockUser> {
    await this.delay();
    const state = loadStore();
    const user = state.users[userId];
    if (!user) {
      throw new Error(`Demo user not found: ${userId}`);
    }
    setCurrentUserId(userId);
    return withDerivedOnboarding(user);
  }

  // --- Demographics & Onboarding ---
  async getDemographicProfile(): Promise<DemographicProfileDto | null> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) return null;
    return getStoredProfile(user.id);
  }

  async saveDemographicProfile(
    input: UpdateDemographicProfileInput,
  ): Promise<DemographicProfileDto> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) {
      throw new Error("Bạn cần đăng nhập để lưu hồ sơ nhân khẩu học.");
    }

    if (input.age != null && (input.age < 13 || input.age > 100)) {
      throw new Error("Độ tuổi hợp lệ phải từ 13 đến 100.");
    }

    return this.persistDemographicProfile(user.id, input);
  }

  /**
   * Mandatory Demographic Survey submission (Story 7.1, FR-6): every field is
   * required. Mirrors `POST /demographics/survey` and tells the page where to
   * go next (the Marketplace activation step until one survey is completed).
   */
  async submitDemographicSurvey(
    input: SubmitDemographicSurveyInput,
  ): Promise<MockDemographicSurveyResult> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) {
      throw new Error("Bạn cần đăng nhập để lưu hồ sơ nhân khẩu học.");
    }

    const parsed = submitDemographicSurveySchema.safeParse(input);
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
      const fields = REQUIRED_DEMOGRAPHIC_FIELDS.filter((field) => invalid.has(field));
      throw repositoryError(
        "Vui lòng trả lời đầy đủ và hợp lệ tất cả câu hỏi của khảo sát nhân khẩu học.",
        "VALIDATION_ERROR",
        { fields },
      );
    }

    const profile = this.persistDemographicProfile(user.id, parsed.data);
    // Same rule as the backend (code review P4): only a user who still has the
    // activation survey to do goes to the activation step; PENDING_CONFIRMATION,
    // READY_TO_UNLOCK, ACTIVATED, EXPIRED and NOT_GRANTED are done with it.
    const evaluation = this.evaluateActivation(user.id);
    const activationDone =
      evaluation !== null &&
      evaluation.state !== "SURVEY_REQUIRED" &&
      evaluation.state !== "DEMOGRAPHICS_REQUIRED";

    return {
      profile,
      isComplete: true,
      missingFields: [],
      nextStep: activationDone ? "COMPLETED" : "MARKETPLACE_ACTIVATION",
      redirectUrl: activationDone
        ? POST_ONBOARDING_DEFAULT_PATH
        : MARKETPLACE_ACTIVATION_PATH,
    };
  }

  /** Current user's onboarding state for routing guards (Story 7.1). */
  async getOnboardingStatus(): Promise<MockOnboardingStatus> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) {
      return {
        isAuthenticated: false,
        isProfileComplete: false,
        missingFields: [...REQUIRED_DEMOGRAPHIC_FIELDS],
        isActivated: false,
        hasCompletedMarketplaceSurvey: false,
      };
    }
    const missingFields = getMissingDemographicFields(getStoredProfile(user.id));
    const evaluation = this.reconcileStarterPoints(user.id).evaluation;
    return {
      isAuthenticated: true,
      isProfileComplete: missingFields.length === 0,
      missingFields,
      isActivated: evaluation?.isUnlocked ?? user.isActivated,
      hasCompletedMarketplaceSurvey: evaluation?.hasQualifyingSurvey ?? false,
    };
  }

  private persistDemographicProfile(
    userId: string,
    input: UpdateDemographicProfileInput,
  ): DemographicProfileDto {
    const currentProfile = getStoredProfile(userId);
    // Code review P13: same partial-update semantics as the backend —
    // `undefined` keeps, `null` clears (re-engaging the gate).
    const updatedProfile: DemographicProfileDto = {
      userId,
      age: input.age === undefined ? (currentProfile?.age ?? null) : input.age,
      gender: input.gender === undefined ? (currentProfile?.gender ?? null) : input.gender,
      location: mergeProfileText(input.location, currentProfile?.location),
      occupation: mergeProfileText(input.occupation, currentProfile?.occupation),
      fieldOfStudy: mergeProfileText(input.fieldOfStudy, currentProfile?.fieldOfStudy),
      householdIncome: mergeProfileText(
        input.householdIncome,
        currentProfile?.householdIncome,
      ),
      specificInterests:
        input.specificInterests === undefined
          ? (currentProfile?.specificInterests ?? [])
          : input.specificInterests,
      createdAt: currentProfile?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveStoredProfile(userId, updatedProfile);

    // Single shared FR-6 rule (Story 7.1): isOnboarded mirrors profile completeness.
    const completed = getMissingDemographicFields(updatedProfile).length === 0;
    updateUser(userId, (u) => ({ ...u, isOnboarded: completed }));
    if (completed) {
      clearStoredDraft(userId);

      // Activation step (Story 7.2): unlock now if a qualifying survey already exists.
      this.reconcileStarterPoints(userId);
    }

    return updatedProfile;
  }

  /** Earning features require the Mandatory Demographic Survey (Story 7.1, FR-6). */
  private requireCompletedProfile(userId: string): void {
    const missingFields: DemographicProfileField[] = getMissingDemographicFields(
      getStoredProfile(userId),
    );
    if (missingFields.length > 0) {
      throw repositoryError(
        "Bạn cần hoàn thành khảo sát nhân khẩu học bắt buộc trước khi vào Chợ khảo sát hoặc làm khảo sát.",
        DEMOGRAPHIC_PROFILE_REQUIRED_CODE,
        { missingFields },
      );
    }
  }

  async getOnboardingDraft(): Promise<MockOnboardingDraft | null> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) return null;
    return getStoredDraft(user.id);
  }

  async saveOnboardingDraft(draft: {
    step: number;
    answers: Partial<DemographicProfileDto>;
  }): Promise<void> {
    const user = getCurrentUser();
    if (!user) return;
    saveStoredDraft(user.id, {
      step: draft.step,
      answers: draft.answers,
      updatedAt: new Date().toISOString(),
    });
  }

  async clearOnboardingDraft(): Promise<void> {
    const user = getCurrentUser();
    if (!user) return;
    clearStoredDraft(user.id);
  }

  // --- Surveys & Marketplace Feed ---
  async getMarketplaceFeed(params: MockFeedParams = {}): Promise<MockFeedResult> {
    await this.delay();
    // Code review P12: same as the backend (`SessionAuthGuard` → 401, then the
    // Story 7.1 gate → 403): the feed is never served to a signed-out caller.
    const user = this.requireSignedInUser("Vui lòng đăng nhập để xem Chợ khảo sát.");
    this.requireCompletedProfile(user.id);
    const profile = getStoredProfile(user.id);

    const allSurveys = Object.values(getAllSurveys());
    const hideCompleted = params.hideCompleted ?? true;
    const typeFilter = params.type ?? "ALL";
    const search = params.search?.trim().toLowerCase();
    const sortBy = params.sortBy ?? "best_match";

    const filtered = allSurveys.filter((survey) => {
      // Must be published
      if (survey.status !== "PUBLISHED") return false;

      // Decision E4-DN2: a Publisher never sees (or takes) their own survey.
      if (survey.publisherId === user.id) return false;

      // Filter by type
      if (typeFilter !== "ALL" && survey.type !== typeFilter) return false;

      // Filter by search
      if (search) {
        const titleMatch = survey.title.toLowerCase().includes(search);
        const descMatch = survey.description?.toLowerCase().includes(search);
        if (!titleMatch && !descMatch) return false;
      }

      // Demographic targeting (the gate above guarantees a complete profile)
      if (survey.hasTargeting && survey.targetingJson) {
        if (!profile) return false;
        const matchesTargeting = isSurveyTargetingMatch(
          survey.targetingJson,
          profile,
        );
        if (!matchesTargeting) return false;
      }

      // Hide completed
      if (hideCompleted) {
        if (user.completedSurveyIds.includes(survey.id)) {
          return false;
        }
      }

      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === "reward_desc") {
        return b.rewardPerResponse - a.rewardPerResponse;
      }
      if (sortBy === "reward_asc") {
        return a.rewardPerResponse - b.rewardPerResponse;
      }
      if (sortBy === "duration_asc") {
        return a.estimatedEffortSeconds - b.estimatedEffortSeconds;
      }
      if (sortBy === "duration_desc") {
        return b.estimatedEffortSeconds - a.estimatedEffortSeconds;
      }
      if (sortBy === "newest") {
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      }
      // default: best_match (targeted surveys first, then higher reward)
      if (a.hasTargeting !== b.hasTargeting) {
        return a.hasTargeting ? -1 : 1;
      }
      return b.rewardPerResponse - a.rewardPerResponse;
    });

    const userCompletedIds = new Set(user.completedSurveyIds);

    const surveyCards: MarketplaceSurveyCardDto[] = filtered.map((s) =>
      toSurveyCard(s, userCompletedIds.has(s.id)),
    );

    return {
      surveys: surveyCards,
      total: surveyCards.length,
      // Only signed-in users past the onboarding gate get here (Story 7.1).
      profileCompleted: true,
    };
  }

  async getSurveyById(id: string): Promise<MockSurvey | null> {
    await this.delay();
    return getStoredSurvey(id);
  }

  // --- Attempts & Completion ---
  async startSurveyAttempt(surveyId: string): Promise<MockSurveyAttempt> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) {
      throw new Error("Vui lòng đăng nhập để bắt đầu tham gia khảo sát.");
    }
    this.requireCompletedProfile(user.id);

    if (user.completedSurveyIds.includes(surveyId)) {
      throw new Error(
        "Bạn đã hoàn thành khảo sát này rồi. Mỗi tài khoản chỉ được tham gia 1 lần.",
      );
    }

    const survey = getStoredSurvey(surveyId);
    if (!survey) {
      throw new Error("Không tìm thấy khảo sát.");
    }

    // Decision E4-DN2 (backend parity: 403 SELF_PARTICIPATION_FORBIDDEN).
    if (survey.publisherId === user.id) {
      throw repositoryError(
        "Bạn không thể tham gia khảo sát do chính mình đăng. Hãy dùng chế độ xem trước trong trình tạo khảo sát.",
        SELF_PARTICIPATION_FORBIDDEN_CODE,
      );
    }

    // Decision E5-D1: no new attempt once every code try on this External
    // version is used (6 per account and version, summed across attempts).
    if (survey.type === "EXTERNAL") {
      const failedVerifications = countCompletionCodeFailures(
        user.id,
        survey.currentVersionId,
      );
      if (failedVerifications >= MAX_COMPLETION_CODE_FAILURES_PER_VERSION) {
        throw completionCodeLimitError(
          survey.currentVersionId,
          failedVerifications,
        );
      }
    }

    // Story 8.2 (FR-46) + decision E8-D6: the completion limit blocks new
    // attempts temporarily, reserving capacity at start.
    assertStartCapacity(user.id, survey.id);
    const barrier = resolveSurveyTimeBarrier(survey);

    const attemptId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const responseId = survey.type === "INTERNAL" ? `resp-${Date.now()}` : null;

    const attempt: MockSurveyAttempt = {
      attemptId,
      surveyId: survey.id,
      formVersionId: survey.currentVersionId,
      userId: user.id,
      type: survey.type,
      status: "IN_PROGRESS",
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rewardPerResponse: survey.rewardPerResponse,
      minTimeBarrierSeconds: barrier.requiredSeconds,
      questionCount: barrier.questionCount,
      responseId,
      externalUrl: survey.externalUrl || null,
      reportedMissingCode: null,
    };

    saveStoredAttempt(attempt);
    return attempt;
  }

  async getAttempt(attemptId: string): Promise<{
    attempt: MockSurveyAttempt;
    survey: MockSurvey;
  } | null> {
    await this.delay();
    const attempt = getStoredAttempt(attemptId);
    if (!attempt) return null;
    const survey = getStoredSurvey(attempt.surveyId);
    if (!survey) return null;
    return { attempt, survey };
  }

  /**
   * Decision E5-D1: code tries left on an External attempt — the smaller of
   * the attempt's budget (3) and the account+version budget (6 across
   * attempts). The attempt page only renders it.
   */
  async getRemainingCompletionCodeTries(attemptId: string): Promise<number> {
    await this.delay();
    const attempt = getStoredAttempt(attemptId);
    if (!attempt) return 0;
    return remainingCompletionCodeTries({
      attemptFailures: attempt.failedCodeAttempts ?? 0,
      accountFailures: countCompletionCodeFailures(
        attempt.userId,
        attempt.formVersionId,
      ),
    });
  }

  /** Story 8.2: minimum-time status of an attempt (the page only renders it). */
  async getTimeBarrierStatus(
    attemptId: string,
  ): Promise<MockTimeBarrierStatus | null> {
    await this.delay();
    const attempt = getStoredAttempt(attemptId);
    if (!attempt) return null;
    const survey = getStoredSurvey(attempt.surveyId);
    if (!survey) return null;
    return timeBarrierStatus(attempt, survey);
  }

  async submitInternalSurvey(
    attemptId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    answers: Record<string, unknown>,
  ): Promise<MockSubmissionResult> {
    await this.delay();
    const attempt = getStoredAttempt(attemptId);
    if (!attempt) {
      throw new Error("Lượt khảo sát không tồn tại hoặc đã hết hạn.");
    }
    if (attempt.status === "COMPLETED") {
      throw new Error("Lượt khảo sát này đã được hoàn thành trước đó.");
    }

    const user = getCurrentUser();
    if (!user || user.id !== attempt.userId) {
      throw new Error("Phiên làm việc không hợp lệ.");
    }

    if (user.completedSurveyIds.includes(attempt.surveyId)) {
      throw new Error("Bạn đã hoàn thành khảo sát này rồi.");
    }

    const survey = getStoredSurvey(attempt.surveyId);
    if (!survey) {
      throw new Error("Khảo sát không tồn tại.");
    }

    // Story 8.2: Time Barrier (FR-45); the rejection leaves the attempt
    // IN_PROGRESS so the respondent can retry. Decision E8-D6: no completion
    // limit check here — the capacity was reserved when the attempt started.
    assertTimeBarrier(attempt, survey);

    // Mark attempt completed
    attempt.status = "COMPLETED";
    attempt.completedAt = new Date().toISOString();
    saveStoredAttempt(attempt);

    // Add to user completed surveys
    updateUser(user.id, (u) => ({
      ...u,
      streak: u.streak + 1,
      completedSurveyIds: [...u.completedSurveyIds, survey.id],
    }));

    // Credit Internal reward immediately to AVAILABLE balance
    const wallet = getStoredWallet(user.id);
    wallet.available += survey.rewardPerResponse;
    wallet.total = calculateWalletTotal(wallet);
    saveStoredWallet(user.id, wallet);

    appendTransaction(user.id, {
      id: `tx-earn-int-${Date.now()}`,
      journalId: `j-earn-${Date.now()}`,
      amount: survey.rewardPerResponse,
      accountClass: "USER_AVAILABLE",
      description: `Thưởng hoàn thành khảo sát nội bộ: ${survey.title}`,
      idempotencyKey: `idem-earn-${attemptId}`,
      createdAt: new Date().toISOString(),
      reversesJournalId: null,
    });

    // "Points earned" notice (FR-57, decision E9-D2), mirrors the backend
    // REWARD_EARNED event: once per response, with the full credited reward;
    // free surveys publish nothing. The backend keys it on the Response id;
    // the mock keys it on the attempt id (1:1 with its Response, and unique,
    // unlike the timestamp-based mock Response ids).
    if (survey.rewardPerResponse > 0) {
      this.publishNotification(user.id, {
        type: "REWARD_EARNED",
        message: `+${survey.rewardPerResponse} điểm từ khảo sát "${survey.title}" đã được cộng ngay vào số dư Khả dụng của bạn.`,
        dedupeKey: `internal-reward:${attemptId}`,
      });
    }

    // Activation step (Story 7.2): an Internal survey of another publisher counts immediately.
    const { unlocked, evaluation } = this.reconcileStarterPoints(user.id);

    return {
      success: true,
      attemptId,
      rewardEarned: survey.rewardPerResponse,
      rewardType: "AVAILABLE",
      unlockedStarterPoints: unlocked,
      activation: toSubmissionActivation(evaluation),
      newBalance: getStoredWallet(user.id),
      message: unlocked
        ? `Nộp bài thành công! Bạn nhận được +${survey.rewardPerResponse} điểm khả dụng và đã MỞ KHÓA thành công 100 điểm tân thủ! 🎁`
        : `Nộp bài thành công! +${survey.rewardPerResponse} điểm đã được cộng ngay vào tài khoản khả dụng của bạn.`,
    };
  }

  async submitExternalSurvey(
    attemptId: string,
    inputCode: string,
  ): Promise<MockSubmissionResult> {
    await this.delay();
    const attempt = getStoredAttempt(attemptId);
    if (!attempt) {
      throw new Error("Lượt làm bài không hợp lệ hoặc đã hết hạn.");
    }
    if (attempt.status === "COMPLETED") {
      throw new Error("Lượt khảo sát này đã được nộp trước đó.");
    }
    if (attempt.status === "LOCKED") {
      throw repositoryError(
        "Lượt khảo sát này đã bị KHÓA do nhập sai mã 3 lần.",
        "ATTEMPT_LOCKED",
      );
    }

    const user = getCurrentUser();
    if (!user || user.id !== attempt.userId) {
      throw new Error("Phiên làm việc không hợp lệ.");
    }

    if (user.completedSurveyIds.includes(attempt.surveyId)) {
      throw new Error("Bạn đã hoàn thành khảo sát này rồi.");
    }

    const survey = getStoredSurvey(attempt.surveyId);
    if (!survey) {
      throw new Error("Khảo sát không tồn tại.");
    }

    // Time barrier (Story 5.5 value; Story 8.2 structured contract). Decision
    // E8-D6: no completion limit check (capacity reserved at start).
    assertTimeBarrier(attempt, survey);

    // Decision E5-D1: the account+version budget, before the code is judged.
    const accountFailuresBefore = countCompletionCodeFailures(
      user.id,
      attempt.formVersionId,
    );
    if (accountFailuresBefore >= MAX_COMPLETION_CODE_FAILURES_PER_VERSION) {
      throw completionCodeLimitError(
        attempt.formVersionId,
        accountFailuresBefore,
      );
    }

    // Format check mirrors the shared contract and does not consume an attempt.
    const parsed = verifyExternalCompletionCodeInputSchema.safeParse({
      completionCode: inputCode,
    });
    if (!parsed.success) {
      throw repositoryError(
        "Mã hoàn thành gồm đúng 6 chữ số.",
        "VALIDATION_ERROR",
      );
    }
    const normalizedInput = parsed.data.completionCode;
    const expectedCode = (survey.completionCode || "").trim();

    if (normalizedInput !== expectedCode) {
      const failedCodeAttempts = (attempt.failedCodeAttempts ?? 0) + 1;
      const accountFailures = accountFailuresBefore + 1;
      attempt.failedCodeAttempts = failedCodeAttempts;
      const remainingAttempts = remainingCompletionCodeTries({
        attemptFailures: failedCodeAttempts,
        accountFailures,
      });
      if (remainingAttempts <= 0) {
        attempt.status = "LOCKED";
        saveStoredAttempt(attempt);
        throw repositoryError(
          accountFailures >= MAX_COMPLETION_CODE_FAILURES_PER_VERSION
            ? `Mã hoàn thành không chính xác. Lượt khảo sát đã bị KHÓA: bạn đã nhập sai ${MAX_COMPLETION_CODE_FAILURES_PER_VERSION} lần cho phiên bản khảo sát này. Vui lòng liên hệ Admin RESCOM nếu bạn nhập nhầm.`
            : "Mã hoàn thành không chính xác. Lượt khảo sát đã bị KHÓA do nhập sai mã 3 lần.",
          "ATTEMPT_LOCKED",
          { failedCodeAttempts, remainingAttempts: 0 },
        );
      }
      saveStoredAttempt(attempt);
      throw repositoryError(
        `Mã hoàn thành không chính xác. Bạn còn ${remainingAttempts} lần thử trước khi lượt làm bài bị khóa.`,
        "INVALID_COMPLETION_CODE",
        { failedCodeAttempts, remainingAttempts },
      );
    }

    // Mark attempt completed
    attempt.status = "COMPLETED";
    attempt.completedAt = new Date().toISOString();
    attempt.submittedCode = normalizedInput;
    saveStoredAttempt(attempt);

    // Add to completed surveys
    updateUser(user.id, (u) => ({
      ...u,
      streak: u.streak + 1,
      completedSurveyIds: [...u.completedSurveyIds, survey.id],
    }));

    // Credit External reward to PENDING for 48 hours
    const wallet = getStoredWallet(user.id);
    wallet.pending += survey.rewardPerResponse;
    wallet.total = calculateWalletTotal(wallet);
    saveStoredWallet(user.id, wallet);

    appendTransaction(user.id, {
      id: `tx-earn-ext-${Date.now()}`,
      journalId: `j-earn-ext-${Date.now()}`,
      amount: survey.rewardPerResponse,
      accountClass: "PENDING",
      description: `Thưởng hoàn thành khảo sát ngoài (Google Forms): ${survey.title} (Chờ đối soát 48 giờ)`,
      idempotencyKey: `idem-earn-${attemptId}`,
      createdAt: new Date().toISOString(),
      reversesJournalId: null,
    });

    // "Points pending" notice (FR-57), mirrors the backend REWARD_PENDING event.
    if (survey.rewardPerResponse > 0) {
      this.publishNotification(user.id, {
        type: "REWARD_PENDING",
        message: `+${survey.rewardPerResponse} điểm từ khảo sát "${survey.title}" đang chờ đối soát 48 giờ trước khi chuyển sang số dư Khả dụng.`,
        dedupeKey: `external-completion:${attemptId}`,
      });
    }

    // Activation step (Story 7.2): an External completion counts only after
    // its 48-hour review window, so this usually leaves activation pending.
    const { unlocked, evaluation } = this.reconcileStarterPoints(user.id);
    const activation = toSubmissionActivation(evaluation);
    const activationPending = activation?.state === "PENDING_CONFIRMATION";

    return {
      success: true,
      attemptId,
      rewardEarned: survey.rewardPerResponse,
      rewardType: "PENDING",
      pendingHours: 48,
      unlockedStarterPoints: unlocked,
      activation,
      newBalance: getStoredWallet(user.id),
      message: unlocked
        ? `Xác nhận mã thành công! +${survey.rewardPerResponse} điểm đang chờ duyệt (48h) và bạn đã MỞ KHÓA thành công 100 điểm tân thủ khả dụng! 🎁`
        : activationPending
          ? `Xác nhận mã thành công! +${survey.rewardPerResponse} điểm đã vào số dư Chờ duyệt (Pending). ${STARTER_POINTS_DEFAULT_AMOUNT} điểm tân thủ sẽ được mở khóa khi khảo sát này hết thời gian đối soát 48 giờ.`
          : `Xác nhận mã thành công! +${survey.rewardPerResponse} điểm đã vào số dư Chờ duyệt (Pending). Điểm sẽ tự động chuyển sang Khả dụng sau 48 giờ.`,
    };
  }

  async reportMissingCode(
    attemptId: string,
    reason: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.delay();
    const attempt = getStoredAttempt(attemptId);
    if (!attempt) {
      throw new Error("Lượt khảo sát không tồn tại.");
    }
    const cleanReason = reason.trim();
    if (!cleanReason) {
      throw new Error("Vui lòng nhập lý do không tìm thấy mã hoàn thành.");
    }

    attempt.reportedMissingCode = {
      reportedAt: new Date().toISOString(),
      reason: cleanReason,
    };
    saveStoredAttempt(attempt);

    return {
      success: true,
      message:
        "Báo cáo của bạn đã được ghi nhận thành công! Quản trị viên RESCOM sẽ kiểm tra và cộng điểm bù cho bạn trong vòng 24 giờ làm việc.",
    };
  }

  // --- Post-completion feedback (Story 9.2, FR-43) ---
  /** Whether the receipt should prompt for feedback on this attempt. */
  async getSurveyFeedbackStatus(attemptId: string): Promise<SurveyFeedbackStatusDto> {
    await this.delay();
    const user = this.requireFeedbackUser();
    const attempt = this.requireOwnedFeedbackAttempt(attemptId, user);
    const existing = getStoredSurveyFeedback(attempt.attemptId);
    if (existing) {
      return {
        attemptId: attempt.attemptId,
        state: "SUBMITTED",
        feedback: toSurveyFeedbackDto(existing),
      };
    }
    // Publishers cannot rate their own survey (backend parity).
    const isOwnSurvey = getStoredSurvey(attempt.surveyId)?.publisherId === user.id;
    return {
      attemptId: attempt.attemptId,
      state: attempt.status === "COMPLETED" && !isOwnSurvey ? "ELIGIBLE" : "NOT_ELIGIBLE",
      feedback: null,
    };
  }

  /**
   * One feedback per completed attempt (backend parity): an identical
   * re-submission is replayed, a different one conflicts. Never touches the
   * wallet, transactions or notifications, so feedback cannot affect rewards.
   */
  async submitSurveyFeedback(
    attemptId: string,
    input: SubmitSurveyFeedbackInput,
  ): Promise<SubmitSurveyFeedbackResultDto> {
    await this.delay();
    const user = this.requireFeedbackUser();
    const parsed = submitSurveyFeedbackInputSchema.safeParse(input);
    if (!parsed.success) {
      throw repositoryError(
        describeSurveyFeedbackValidationIssue(parsed.error.issues[0]?.path[0]),
        "VALIDATION_ERROR",
      );
    }
    const command = parsed.data;
    const attempt = this.requireOwnedFeedbackAttempt(attemptId, user);

    const existing = getStoredSurveyFeedback(attempt.attemptId);
    if (existing) {
      if (!isSameSurveyFeedbackContent(existing, command)) {
        throw repositoryError(
          SURVEY_FEEDBACK_ERROR_MESSAGES[SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE],
          SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE,
        );
      }
      return { feedback: toSurveyFeedbackDto(existing), replayed: true };
    }

    // Publishers cannot rate their own survey (backend parity).
    if (
      attempt.status !== "COMPLETED" ||
      getStoredSurvey(attempt.surveyId)?.publisherId === user.id
    ) {
      throw repositoryError(
        SURVEY_FEEDBACK_ERROR_MESSAGES[SURVEY_FEEDBACK_NOT_ALLOWED_CODE],
        SURVEY_FEEDBACK_NOT_ALLOWED_CODE,
      );
    }

    const feedback: MockSurveyFeedback = {
      id: createMockUuid(),
      attemptId: attempt.attemptId,
      userId: user.id,
      surveyId: attempt.surveyId,
      formVersionId: attempt.formVersionId,
      formType: attempt.type,
      rating: command.rating,
      comment: command.comment,
      issueTags: command.issueTags,
      // Survey Quality counts feedback only after validation (Phase 2).
      validationStatus: "PENDING",
      submittedAt: new Date().toISOString(),
    };
    saveStoredSurveyFeedback(feedback);
    return { feedback: toSurveyFeedbackDto(feedback), replayed: false };
  }

  // --- Wallet ---
  async getWalletDetails(): Promise<WalletDetailsDto> {
    await this.delay();
    const user = getCurrentUser();
    if (!user) {
      throw new Error("Vui lòng đăng nhập để xem ví điểm.");
    }
    // Simulated Economy background work: matured activation / 30-day expiry.
    this.reconcileStarterPoints(user.id);

    const balance = getStoredWallet(user.id);
    const transactions = getStoredTransactions(user.id);

    return {
      balance,
      transactions,
      accounts: [
        {
          id: `acc-avail-${user.id}`,
          userId: user.id,
          accountClass: "USER_AVAILABLE",
          balance: balance.available,
          currency: "POINTS",
          createdAt: user.createdAt,
          updatedAt: new Date().toISOString(),
        },
        {
          id: `acc-pend-${user.id}`,
          userId: user.id,
          accountClass: "PENDING",
          balance: balance.pending,
          currency: "POINTS",
          createdAt: user.createdAt,
          updatedAt: new Date().toISOString(),
        },
        {
          id: `acc-froz-${user.id}`,
          userId: user.id,
          accountClass: "FROZEN",
          balance: balance.frozen,
          currency: "POINTS",
          createdAt: user.createdAt,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  }

  // --- Notifications (Story 9.6, FR-57) ---
  async getNotifications(
    params: MockNotificationListParams = {},
  ): Promise<NotificationListDto> {
    await this.delay();
    const user = this.requireNotificationUser();
    const parsed = listNotificationsQuerySchema.safeParse(params);
    if (!parsed.success) {
      throw repositoryError(
        "Tham số danh sách thông báo không hợp lệ.",
        "VALIDATION_ERROR",
      );
    }
    const { limit, offset, unreadOnly } = parsed.data;

    const all = getStoredNotifications(user.id);
    const filtered = sortNewestFirst(
      unreadOnly ? all.filter((n) => !n.isRead) : all,
    );
    const items = filtered.slice(offset, offset + limit).map(toNotificationDto);

    return {
      items,
      unreadCount: all.filter((n) => !n.isRead).length,
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + items.length < filtered.length,
    };
  }

  async getUnreadNotificationCount(): Promise<number> {
    await this.delay();
    const user = this.requireNotificationUser();
    return getStoredNotifications(user.id).filter((n) => !n.isRead).length;
  }

  async markNotificationRead(
    notificationId: string,
  ): Promise<MarkNotificationReadResultDto> {
    await this.delay();
    const user = this.requireNotificationUser();
    const all = getStoredNotifications(user.id);
    const target = all.find((n) => n.id === notificationId);
    if (!target) {
      throw repositoryError("Không tìm thấy thông báo.", "NOTIFICATION_NOT_FOUND");
    }

    const updatedTarget: MockNotification = target.isRead
      ? target
      : { ...target, isRead: true, readAt: new Date().toISOString() };
    if (!target.isRead) {
      saveStoredNotifications(
        user.id,
        all.map((n) => (n.id === notificationId ? updatedTarget : n)),
      );
      emitNotificationsChanged();
    }

    return {
      notification: toNotificationDto(updatedTarget),
      unreadCount: getStoredNotifications(user.id).filter((n) => !n.isRead).length,
    };
  }

  async markAllNotificationsRead(): Promise<MarkAllNotificationsReadResultDto> {
    await this.delay();
    const user = this.requireNotificationUser();
    const all = getStoredNotifications(user.id);
    const readAt = new Date().toISOString();
    const updatedCount = all.filter((n) => !n.isRead).length;
    if (updatedCount > 0) {
      saveStoredNotifications(
        user.id,
        all.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt })),
      );
      emitNotificationsChanged();
    }
    return { updatedCount, unreadCount: 0 };
  }

  // --- Point top-up (Story 6.6, FR-34) ---
  async getTopUpOptions(): Promise<MockTopUpOptions> {
    await this.delay();
    return {
      pointVndRate: POINT_VND_RATE,
      minPoints: TOP_UP_MIN_POINTS,
      maxPoints: TOP_UP_MAX_POINTS,
      maxPendingRequests: TOP_UP_MAX_PENDING_REQUESTS,
      presetAmounts: [...TOP_UP_PRESET_AMOUNTS],
      bank: { ...MOCK_TOP_UP_BANK },
    };
  }

  /**
   * Creates a "Pending Payment" transfer request, mirroring
   * `POST /economy/top-ups`. No Points move until an Admin approves it.
   */
  async createTopUpRequest(amount: number): Promise<TopUpRequestDto> {
    await this.delay();
    const user = this.requireSignedInUser(
      "Vui lòng đăng nhập để nạp điểm.",
    );

    if (!Number.isInteger(amount)) {
      throw repositoryError("Số điểm nạp phải là số nguyên.", "VALIDATION_ERROR");
    }
    if (amount < TOP_UP_MIN_POINTS) {
      throw repositoryError(
        `Số điểm nạp tối thiểu ${TOP_UP_MIN_POINTS} điểm (${pointsToVnd(TOP_UP_MIN_POINTS).toLocaleString("vi-VN")} VNĐ).`,
        "VALIDATION_ERROR",
      );
    }
    if (amount > TOP_UP_MAX_POINTS) {
      throw repositoryError(
        `Mỗi yêu cầu nạp tối đa ${TOP_UP_MAX_POINTS.toLocaleString("vi-VN")} điểm.`,
        "VALIDATION_ERROR",
      );
    }

    const existing = getStoredTopUpRequests(user.id);
    const pendingCount = existing.filter((r) => r.status === "PENDING").length;
    if (pendingCount >= TOP_UP_MAX_PENDING_REQUESTS) {
      throw repositoryError(
        `Bạn đang có ${TOP_UP_MAX_PENDING_REQUESTS} yêu cầu nạp chờ thanh toán. Vui lòng chờ quản trị viên xử lý trước khi tạo yêu cầu mới.`,
        "TOPUP_PENDING_LIMIT_REACHED",
        { maxPendingRequests: TOP_UP_MAX_PENDING_REQUESTS },
      );
    }

    const amountVnd = pointsToVnd(amount);
    const transferReference = createUniqueTopUpReference();
    const request: MockTopUpRequest = {
      id: createMockUuid(),
      userId: user.id,
      amount,
      amountVnd,
      status: "PENDING",
      transferReference,
      rejectionReason: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      paymentInstructions: {
        ...MOCK_TOP_UP_BANK,
        amountVnd,
        transferContent: transferReference,
        qrPayload: buildVietQrPayload({
          bankBin: MOCK_TOP_UP_BANK.bankBin,
          accountNumber: MOCK_TOP_UP_BANK.accountNumber,
          amountVnd,
          transferContent: transferReference,
        }),
      },
    };

    saveStoredTopUpRequests(user.id, [...existing, request]);
    return toTopUpRequestDto(request);
  }

  /** The current user's requests, newest first (`GET /economy/top-ups`). */
  async getMyTopUpRequests(): Promise<TopUpRequestListDto> {
    await this.delay();
    const user = this.requireSignedInUser(
      "Vui lòng đăng nhập để xem lịch sử nạp điểm.",
    );
    const items = getStoredTopUpRequests(user.id)
      .map((request, index) => ({ request, index }))
      .sort(
        (a, b) =>
          new Date(b.request.createdAt).getTime() -
            new Date(a.request.createdAt).getTime() || b.index - a.index,
      )
      .map(({ request }) => toTopUpRequestDto(request));
    return {
      items,
      total: items.length,
      limit: Math.max(items.length, TOP_UP_LIST_DEFAULT_LIMIT),
      offset: 0,
      hasMore: false,
    };
  }

  // --- Internal Helpers ---
  private requireSignedInUser(message: string): MockUser {
    const user = getCurrentUser();
    if (!user) {
      throw repositoryError(message, "AUTH_REQUIRED");
    }
    return user;
  }

  private requireFeedbackUser(): MockUser {
    const user = getCurrentUser();
    if (!user) {
      throw repositoryError(SURVEY_FEEDBACK_ERROR_MESSAGES.AUTH_REQUIRED, "AUTH_REQUIRED");
    }
    return user;
  }

  /** Unknown and other users' attempts look the same (backend 404 parity). */
  private requireOwnedFeedbackAttempt(
    attemptId: string,
    user: MockUser = this.requireFeedbackUser(),
  ): MockSurveyAttempt {
    const attempt = getStoredAttempt(attemptId);
    if (!attempt || attempt.userId !== user.id) {
      throw repositoryError(
        SURVEY_FEEDBACK_ERROR_MESSAGES[SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE],
        SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE,
      );
    }
    return attempt;
  }

  private requireNotificationUser(): MockUser {
    const user = getCurrentUser();
    if (!user) {
      throw repositoryError(
        "Vui lòng đăng nhập để xem thông báo.",
        "AUTH_REQUIRED",
      );
    }
    return user;
  }

  /**
   * Records an in-app notification for a domain event, at most once per
   * `(userId, dedupeKey)` — the same identity rule as the backend publisher.
   */
  private publishNotification(
    userId: string,
    event: { type: NotificationType; message: string; dedupeKey: string },
  ): void {
    const existing = getStoredNotifications(userId);
    if (existing.some((n) => n.dedupeKey === event.dedupeKey)) {
      return;
    }
    const notification: MockNotification = {
      id: createMockUuid(),
      userId,
      type: event.type,
      message: event.message,
      isRead: false,
      createdAt: new Date().toISOString(),
      readAt: null,
      dedupeKey: event.dedupeKey,
    };
    saveStoredNotifications(userId, [...existing, notification]);
    emitNotificationsChanged();
  }

  /**
   * Eligible Marketplace survey completions (Story 7.2, FR-7): completed
   * attempts of surveys published by someone else that pay at least 1 point
   * (decision E7-DN2, same filter as the backend provider queries). Internal
   * completions count immediately, External ones after their 48-hour review
   * window (decided by the shared `evaluateStarterActivation`).
   */
  private activationCompletions(
    state: MockStoreState,
    userId: string,
  ): StarterActivationCompletion[] {
    return Object.values(state.attempts)
      .filter(
        (attempt) =>
          attempt.userId === userId &&
          attempt.status === "COMPLETED" &&
          Boolean(attempt.completedAt),
      )
      .flatMap((attempt) => {
        const survey = state.surveys[attempt.surveyId];
        if (
          !survey ||
          survey.publisherId === userId ||
          !isStarterActivationRewardEligible(survey.rewardPerResponse)
        ) {
          return [];
        }
        return [
          {
            source: attempt.type,
            formId: attempt.surveyId,
            completedAt: attempt.completedAt as string,
            rewardPerResponse: survey.rewardPerResponse,
            // Demo-only early review close (E7-DN1); unset for real flows.
            reviewClosedAt:
              attempt.type === "EXTERNAL" ? (attempt.reviewClosedAt ?? null) : null,
          },
        ];
      });
  }

  /** Mirrors `StarterPointsCoordinator` evaluation; `null` for an unknown user. */
  private evaluateActivation(
    userId: string,
    now: Date = new Date(),
  ): StarterActivationEvaluation | null {
    const state = loadStore();
    const user = state.users[userId];
    if (!user) return null;
    const wallet = getStoredWallet(userId);
    return evaluateStarterActivation({
      now,
      registeredAt: new Date(user.createdAt),
      isGranted: true,
      frozenBalance: wallet.frozen,
      isDemographicComplete:
        getMissingDemographicFields(getStoredProfile(userId)).length === 0,
      completions: this.activationCompletions(state, userId),
      unlockedAt: user.hasUnlockedFrozenPoints
        ? new Date(user.activatedAt ?? user.createdAt)
        : null,
      expiredAt: user.starterPointsExpiredAt
        ? new Date(user.starterPointsExpiredAt)
        : null,
    });
  }

  /**
   * Converges the starter points like the backend does after each trigger:
   * unlock exactly once when the activation step is complete (FR-8), or void
   * them once the 30-day window has passed without activation (FR-5, the
   * mock stand-in for the expiry sweep). Both can never apply.
   */
  private reconcileStarterPoints(userId: string): {
    unlocked: boolean;
    evaluation: StarterActivationEvaluation | null;
  } {
    const evaluation = this.evaluateActivation(userId);
    if (!evaluation) return { unlocked: false, evaluation };

    if (evaluation.state === "READY_TO_UNLOCK") {
      const unlocked = this.unlockStarterPoints(userId);
      return { unlocked, evaluation: this.evaluateActivation(userId) };
    }

    if (evaluation.state === "EXPIRED") {
      this.expireStarterPoints(userId);
      return { unlocked: false, evaluation: this.evaluateActivation(userId) };
    }

    return { unlocked: false, evaluation };
  }

  private unlockStarterPoints(userId: string): boolean {
    const user = loadStore().users[userId];
    const wallet = getStoredWallet(userId);
    // Same as the backend: unlock what is Frozen, capped at the 100-point grant.
    const amount = Math.min(wallet.frozen, STARTER_POINTS_DEFAULT_AMOUNT);
    if (!user || user.hasUnlockedFrozenPoints || amount <= 0) {
      return false;
    }

    const now = new Date().toISOString();
    wallet.frozen -= amount;
    wallet.available += amount;
    wallet.total = calculateWalletTotal(wallet);
    saveStoredWallet(userId, wallet);

    const idempotencyKey = `starter-unlock:${userId}`;
    const journalId = `j-starter-unlock-${userId}`;
    appendTransaction(userId, {
      id: `tx-starter-unlock-frozen-${userId}`,
      journalId,
      amount: -amount,
      accountClass: "FROZEN",
      description: `Mở khóa ${amount} điểm tân thủ (chuyển sang Khả dụng)`,
      idempotencyKey,
      createdAt: now,
      reversesJournalId: null,
    });
    appendTransaction(userId, {
      id: `tx-starter-unlock-available-${userId}`,
      journalId,
      amount,
      accountClass: "USER_AVAILABLE",
      description: `Hoàn tất kích hoạt tài khoản: nhận ${amount} điểm tân thủ khả dụng`,
      idempotencyKey,
      createdAt: now,
      reversesJournalId: null,
    });

    updateUser(userId, (u) => ({
      ...u,
      hasUnlockedFrozenPoints: true,
      isActivated: true,
      activatedAt: now,
    }));

    // Account activation notice (FR-57), mirrors the backend ACCOUNT_ACTIVATED event.
    this.publishNotification(userId, {
      type: "ACCOUNT_ACTIVATED",
      message: `Chúc mừng! ${amount} điểm tân thủ đã được mở khóa và chuyển vào số dư Khả dụng của bạn.`,
      dedupeKey: idempotencyKey,
    });
    return true;
  }

  private expireStarterPoints(userId: string): void {
    const user = loadStore().users[userId];
    const wallet = getStoredWallet(userId);
    if (!user || user.hasUnlockedFrozenPoints || user.starterPointsExpiredAt) {
      return;
    }

    const now = new Date().toISOString();
    const voided = wallet.frozen;
    if (voided > 0) {
      wallet.frozen = 0;
      wallet.total = calculateWalletTotal(wallet);
      saveStoredWallet(userId, wallet);
      appendTransaction(userId, {
        id: `tx-starter-expiry-${userId}`,
        journalId: `j-starter-expiry-${userId}`,
        amount: -voided,
        accountClass: "FROZEN",
        description: `Điểm tân thủ hết hạn sau ${STARTER_POINTS_EXPIRY_DAYS} ngày chưa kích hoạt`,
        idempotencyKey: `starter-expiry:${userId}`,
        createdAt: now,
        reversesJournalId: null,
      });
    }

    updateUser(userId, (u) => ({ ...u, starterPointsExpiredAt: now }));

    if (voided > 0) {
      this.publishNotification(userId, {
        type: "WARNING",
        message: `${voided} điểm tân thủ đã hết hạn vì tài khoản chưa hoàn tất kích hoạt trong ${STARTER_POINTS_EXPIRY_DAYS} ngày kể từ khi đăng ký.`,
        dedupeKey: `starter-expiry:${userId}`,
      });
    }
  }

  /**
   * Up to 3 eligible surveys for the activation card: published by someone
   * else, paying at least 1 point, targeting-matched, not yet completed, with
   * quota left. Internal
   * first (they unlock instantly), then the quickest ones. While an External
   * completion is under review only Internal surveys are suggested.
   */
  private recommendActivationSurveys(
    user: MockUser,
    evaluation: StarterActivationEvaluation,
  ): MarketplaceSurveyCardDto[] {
    if (
      evaluation.state !== "SURVEY_REQUIRED" &&
      evaluation.state !== "PENDING_CONFIRMATION"
    ) {
      return [];
    }
    // Code review P7: a completion made after the 30-day deadline never counts
    // (FR-5), so past it (e.g. waiting on an in-window External review) there
    // is nothing worth recommending.
    if (evaluation.isDeadlinePassed) {
      return [];
    }
    const profile = getStoredProfile(user.id);
    const internalOnly = evaluation.state === "PENDING_CONFIRMATION";
    return Object.values(getAllSurveys())
      .filter(
        (survey) =>
          survey.status === "PUBLISHED" &&
          survey.publisherId !== user.id &&
          // Decision E7-DN2: a zero-reward survey would never count.
          isStarterActivationRewardEligible(survey.rewardPerResponse) &&
          !user.completedSurveyIds.includes(survey.id) &&
          survey.completedCompletions < survey.expectedCompletions &&
          (!internalOnly || survey.type === "INTERNAL") &&
          (!survey.hasTargeting ||
            !survey.targetingJson ||
            (profile !== null && isSurveyTargetingMatch(survey.targetingJson, profile))),
      )
      .sort(
        (a, b) =>
          (a.type === b.type ? 0 : a.type === "INTERNAL" ? -1 : 1) ||
          a.estimatedEffortSeconds - b.estimatedEffortSeconds ||
          b.rewardPerResponse - a.rewardPerResponse,
      )
      .slice(0, 3)
      .map((survey) => toSurveyCard(survey, false));
  }

  /**
   * Marketplace activation step (Story 7.2): mock equivalent of
   * `GET /economy/starter-points/status` (after the client-side claim of a
   * `READY_TO_UNLOCK` state) plus recommended eligible surveys.
   */
  async getActivationStatus(): Promise<MockActivationStatus> {
    await this.delay();
    const user = this.requireSignedInUser(
      "Vui lòng đăng nhập để xem tiến độ kích hoạt tài khoản.",
    );
    const { evaluation } = this.reconcileStarterPoints(user.id);
    const current = loadStore().users[user.id] ?? user;
    if (!evaluation) {
      throw repositoryError("Không tìm thấy tài khoản.", "AUTH_REQUIRED");
    }
    const wallet = getStoredWallet(user.id);

    const status: StarterPointsStatusDto = {
      userId: user.id,
      isGranted: true,
      frozenBalance: wallet.frozen,
      isDemographicComplete:
        getMissingDemographicFields(getStoredProfile(user.id)).length === 0,
      hasCompletedMarketplaceSurvey: evaluation.hasQualifyingSurvey,
      isUnlocked: evaluation.isUnlocked,
      isExpired: evaluation.isExpired,
      registeredAt: new Date(current.createdAt).toISOString(),
      expiresAt: evaluation.expiresAt.toISOString(),
      daysRemaining: evaluation.daysRemaining,
      unlockEligibility: {
        eligible: evaluation.eligible,
        missingSteps: evaluation.missingSteps,
      },
      activationState: evaluation.state,
      activatedAt: evaluation.isUnlocked
        ? (current.activatedAt ?? current.createdAt)
        : null,
      activationSurvey: evaluation.activationSurvey,
      isVerifiedMember: evaluation.isVerifiedMember,
    };

    return {
      status,
      recommendedSurveys: this.recommendActivationSurveys(current, evaluation),
    };
  }

  /**
   * DEMO ONLY — "Mô phỏng hết 48 giờ đối soát" (decision E7-DN1, option A).
   * The 48-hour review rule for External completions is kept; the mock simply
   * cannot wait 48 hours. For the signed-in user, every completed External
   * attempt is matured as if its window had closed without a dispute:
   * - one still under review gets `reviewClosedAt = now` (its `completedAt`
   *   is never rewritten, so the 30-day activation window and the rate
   *   limits are unaffected);
   * - its Pending reward moves to Available once (`release-pending:{attemptId}`
   *   + REWARD_RELEASED notice) — also for completions whose 48 h already
   *   passed in real time, since the mock has no background release;
   * then the starter-points activation is re-evaluated (unlock exactly once).
   * Idempotent: a second call finds nothing left to mature.
   */
  async simulateExternalReviewElapsed(): Promise<MockReviewSimulationResult> {
    await this.delay();
    const user = this.requireSignedInUser(
      "Vui lòng đăng nhập để mô phỏng hết thời gian đối soát.",
    );
    const reviewMs = EXTERNAL_COMPLETION_REVIEW_HOURS * 60 * 60 * 1000;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const completed = Object.values(loadStore().attempts).filter(
      (attempt) =>
        attempt.userId === user.id &&
        attempt.type === "EXTERNAL" &&
        attempt.status === "COMPLETED" &&
        Boolean(attempt.completedAt),
    );

    let maturedCount = 0;
    let releasedPoints = 0;
    for (const attempt of completed) {
      const underReview =
        !attempt.reviewClosedAt &&
        new Date(attempt.completedAt as string).getTime() + reviewMs > nowMs;
      if (underReview) {
        saveStoredAttempt({ ...attempt, reviewClosedAt: nowIso });
      }
      const released = this.releasePendingReward(user.id, attempt);
      releasedPoints += released;
      if (underReview || released > 0) maturedCount += 1;
    }

    const { unlocked } = this.reconcileStarterPoints(user.id);
    return {
      maturedCount,
      releasedPoints,
      unlockedStarterPoints: unlocked,
      message:
        maturedCount === 0
          ? "Không có khảo sát Google Forms nào đang chờ đối soát."
          : `Đã mô phỏng hết 48 giờ đối soát cho ${maturedCount} khảo sát Google Forms` +
            (releasedPoints > 0 ? `: +${releasedPoints} điểm chuyển sang Khả dụng` : "") +
            (unlocked
              ? `, và ${STARTER_POINTS_DEFAULT_AMOUNT} điểm tân thủ đã được mở khóa.`
              : "."),
    };
  }

  /**
   * Moves one External completion's Pending credit to Available, exactly once
   * (mirrors the backend `release-pending:{attemptId}` journal and its
   * REWARD_RELEASED notice). Returns the points released.
   */
  private releasePendingReward(userId: string, attempt: MockSurveyAttempt): number {
    const idempotencyKey = `release-pending:${attempt.attemptId}`;
    const transactions = getStoredTransactions(userId);
    if (transactions.some((tx) => tx.idempotencyKey === idempotencyKey)) {
      return 0;
    }
    const credit = transactions.find(
      (tx) =>
        tx.idempotencyKey === `idem-earn-${attempt.attemptId}` &&
        tx.accountClass === "PENDING" &&
        tx.amount > 0,
    );
    const wallet = getStoredWallet(userId);
    const amount = Math.min(credit?.amount ?? 0, wallet.pending);
    if (amount <= 0) return 0;

    wallet.pending -= amount;
    wallet.available += amount;
    wallet.total = calculateWalletTotal(wallet);
    saveStoredWallet(userId, wallet);

    const title = getStoredSurvey(attempt.surveyId)?.title ?? "khảo sát ngoài";
    const createdAt = new Date().toISOString();
    const journalId = `j-release-pending-${attempt.attemptId}`;
    appendTransaction(userId, {
      id: `tx-release-pending-${attempt.attemptId}`,
      journalId,
      amount: -amount,
      accountClass: "PENDING",
      description: `Hết 48 giờ đối soát: ${title}`,
      idempotencyKey,
      createdAt,
      reversesJournalId: null,
    });
    appendTransaction(userId, {
      id: `tx-release-available-${attempt.attemptId}`,
      journalId,
      amount,
      accountClass: "USER_AVAILABLE",
      description: `Điểm chờ đã chuyển sang Khả dụng sau 48 giờ đối soát: ${title}`,
      idempotencyKey,
      createdAt,
      reversesJournalId: null,
    });

    this.publishNotification(userId, {
      type: "REWARD_RELEASED",
      message: `${amount} điểm chờ từ khảo sát "${title}" đã qua 48 giờ đối soát và được chuyển sang số dư Khả dụng.`,
      dedupeKey: idempotencyKey,
    });
    return amount;
  }

  // --- Reset Demo ---
  async resetDemo(): Promise<void> {
    await this.delay();
    resetStore();
    emitNotificationsChanged();
  }
}

export const mockRepository = new MockRepository();
