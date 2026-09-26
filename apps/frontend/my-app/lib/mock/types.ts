import type {
  StarterActivationState,
  StarterPointsStatusDto,
  DemographicOnboardingNextStep,
  DemographicProfileDto,
  DemographicProfileField,
  SurveyTargetingCriteria,
  FormBlock,
  FormSettings,
  FormIntegrityMetadata,
  MarketplaceSurveyCardDto,
  MarketplaceSortOption,
  NotificationType,
  SurveyFeedbackIssueTag,
  SurveyFeedbackValidationStatus,
  TopUpPaymentInstructionsDto,
  TopUpRequestDto,
  WalletBalanceDto,
  WalletTransactionItemDto,
} from "@rescom/schemas";

export interface MockUser {
  id: string;
  email: string;
  name: string;
  role: "RESPONDENT" | "PUBLISHER" | "ADMIN";
  isOnboarded: boolean;
  isActivated: boolean;
  hasUnlockedFrozenPoints: boolean;
  /** Story 7.2: when the starter points were unlocked ("Verified Member"). */
  activatedAt?: string | null;
  /** Story 7.2: when the 30-day window voided the starter points (FR-5). */
  starterPointsExpiredAt?: string | null;
  streak: number;
  completedSurveyIds: string[];
  createdAt: string;
}

export interface MockSession {
  token: string;
  user: MockUser;
  expiresAt: string;
}

export interface MockSurvey {
  id: string;
  publisherId: string;
  publisherName: string;
  title: string;
  description: string | null;
  type: "INTERNAL" | "EXTERNAL";
  status: "PUBLISHED";
  rewardPerResponse: number;
  expectedCompletions: number;
  completedCompletions: number;
  estimatedEffortSeconds: number;
  minTimeBarrierSeconds: number;
  versionNumber: number;
  currentVersionId: string;
  publishedAt: string;
  targetingJson: SurveyTargetingCriteria | null;
  hasTargeting: boolean;
  // External surveys
  externalUrl?: string | null;
  completionCode?: string | null;
  // Internal surveys
  blocks?: FormBlock[];
  settings?: FormSettings;
  metadata?: FormIntegrityMetadata;
}

export interface MockSurveyAttempt {
  attemptId: string;
  surveyId: string;
  formVersionId: string;
  userId: string;
  type: "INTERNAL" | "EXTERNAL";
  status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED" | "LOCKED";
  startedAt: string;
  completedAt?: string | null;
  expiresAt: string;
  rewardPerResponse: number;
  /** Story 8.2: effective barrier (Internal: max(questions × 2 s, publisher minimum)). */
  minTimeBarrierSeconds: number;
  /** Story 8.2: answerable questions the barrier was computed from (null for External). */
  questionCount?: number | null;
  responseId?: string | null;
  externalUrl?: string | null;
  submittedCode?: string | null;
  /** Wrong completion codes entered so far; 3 locks the attempt (FR-22). */
  failedCodeAttempts?: number;
  /**
   * External only, DEMO: when "Mô phỏng hết 48 giờ đối soát" closed this
   * completion's review window early (decision E7-DN1). `completedAt` is never
   * rewritten, so the 30-day window and the rate limits stay truthful.
   */
  reviewClosedAt?: string | null;
  reportedMissingCode?: {
    reportedAt: string;
    reason: string;
  } | null;
}

/** Story 8.2: mock equivalent of the attempt's server-side Time Barrier state. */
export interface MockTimeBarrierStatus {
  requiredSeconds: number;
  questionCount: number | null;
  secondsPerQuestion: number | null;
  publisherMinimumSeconds: number | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  earliestSubmitAt: string;
  passed: boolean;
}

export interface MockSubmissionResult {
  success: boolean;
  attemptId: string;
  rewardEarned: number;
  rewardType: "AVAILABLE" | "PENDING";
  pendingHours?: number;
  unlockedStarterPoints: boolean;
  /** Story 7.2: activation step after this completion (e.g. External under 48 h review). */
  activation?: {
    state: StarterActivationState;
    confirmsAt: string | null;
    /** End of the 30-day activation window (code review P7/P10). */
    expiresAt: string | null;
  };
  newBalance: WalletBalanceDto;
  message: string;
}

export interface MockFeedParams {
  search?: string;
  sortBy?: MarketplaceSortOption;
  type?: "ALL" | "INTERNAL" | "EXTERNAL";
  hideCompleted?: boolean;
}

export interface MockFeedResult {
  surveys: MarketplaceSurveyCardDto[];
  total: number;
  profileCompleted: boolean;
}

/** Mock equivalent of the onboarding state the backend derives (Story 7.1). */
export interface MockOnboardingStatus {
  isAuthenticated: boolean;
  isProfileComplete: boolean;
  missingFields: DemographicProfileField[];
  isActivated: boolean;
  hasCompletedMarketplaceSurvey: boolean;
}

/**
 * Mock equivalent of `GET /economy/starter-points/status` (Story 7.2) plus the
 * eligible surveys the activation card recommends (Internal first — they
 * unlock the starter points instantly).
 */
export interface MockActivationStatus {
  status: StarterPointsStatusDto;
  recommendedSurveys: MarketplaceSurveyCardDto[];
}

/** Result of the demo-only "Mô phỏng hết 48 giờ đối soát" control (decision E7-DN1). */
export interface MockReviewSimulationResult {
  /** External completions matured by this call (review closed and/or Pending released). */
  maturedCount: number;
  /** Pending points moved to Available. */
  releasedPoints: number;
  /** The simulation completed the activation step (100 starter points unlocked). */
  unlockedStarterPoints: boolean;
  message: string;
}

/** Mock equivalent of `POST /demographics/survey` plus the page to open next. */
export interface MockDemographicSurveyResult {
  profile: DemographicProfileDto;
  isComplete: boolean;
  missingFields: DemographicProfileField[];
  nextStep: DemographicOnboardingNextStep;
  redirectUrl: string;
}

export interface MockOnboardingDraft {
  step: number;
  answers: Partial<DemographicProfileDto>;
  updatedAt: string;
}

/**
 * Stored in-app notification (Story 9.6). The repository exposes only the
 * live-API `NotificationDto` shape; `userId` and `dedupeKey` stay internal.
 */
export interface MockNotification {
  id: string;
  userId: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
  /** Source-event identity, mirrors the backend keys (e.g. `starter-unlock:{userId}`). */
  dedupeKey: string;
}

export interface MockNotificationListParams {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

/**
 * Stored post-completion feedback (Story 9.2, FR-43), one per attempt. The
 * repository exposes only the live-API `SurveyFeedbackDto`; `userId` stays internal.
 */
export interface MockSurveyFeedback {
  id: string;
  attemptId: string;
  userId: string;
  surveyId: string;
  formVersionId: string;
  formType: "INTERNAL" | "EXTERNAL";
  rating: number;
  comment: string | null;
  issueTags: SurveyFeedbackIssueTag[];
  validationStatus: SurveyFeedbackValidationStatus;
  submittedAt: string;
}

/**
 * Stored manual top-up request (Story 6.6). The repository exposes only the
 * live-API `TopUpRequestDto` shape; `userId` stays internal.
 */
export interface MockTopUpRequest extends TopUpRequestDto {
  userId: string;
}

/** Mock equivalent of `GET` top-up configuration (bank account + limits). */
export interface MockTopUpOptions {
  pointVndRate: number;
  minPoints: number;
  maxPoints: number;
  maxPendingRequests: number;
  presetAmounts: number[];
  bank: Omit<TopUpPaymentInstructionsDto, "amountVnd" | "transferContent" | "qrPayload">;
}

export interface MockStoreState {
  currentUserId: string | null;
  users: Record<string, MockUser>;
  demographics: Record<string, DemographicProfileDto>;
  surveys: Record<string, MockSurvey>;
  attempts: Record<string, MockSurveyAttempt>;
  wallets: Record<string, WalletBalanceDto>;
  transactions: Record<string, WalletTransactionItemDto[]>;
  onboardingDrafts: Record<string, MockOnboardingDraft>;
  /** Per-user notifications, oldest first. Absent in stores persisted before Story 9.6. */
  notifications?: Record<string, MockNotification[]>;
  /** Per-user top-up requests, oldest first. Absent in stores persisted before Story 6.6. */
  topUpRequests?: Record<string, MockTopUpRequest[]>;
  /** Feedback keyed by attemptId. Absent in stores persisted before Story 9.2. */
  surveyFeedback?: Record<string, MockSurveyFeedback>;
}
