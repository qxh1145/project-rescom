import type {
  MockStoreState,
  MockUser,
  MockSurvey,
  MockSurveyAttempt,
  MockOnboardingDraft,
  MockNotification,
  MockSurveyFeedback,
  MockTopUpRequest,
} from "./types.ts";
import { createInitialStoreState } from "./fixtures.ts";
import type {
  DemographicProfileDto,
  WalletBalanceDto,
  WalletTransactionItemDto,
} from "@rescom/schemas";

const STORAGE_KEY = "rescom_demo_v1_store";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let customStorage: StorageLike | null = null;
let memoryStore: MockStoreState | null = null;

export function setMockStorage(storage: StorageLike | null): void {
  customStorage = storage;
  memoryStore = null;
}

function getStorage(): StorageLike | null {
  if (customStorage) return customStorage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function loadStore(): MockStoreState {
  const storage = getStorage();
  if (!storage) {
    if (!memoryStore) {
      memoryStore = createInitialStoreState();
    }
    return memoryStore;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialStoreState();
      storage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.users || !parsed.surveys) {
      // Corrupt structure -> reset
      const initial = createInitialStoreState();
      storage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return parsed as MockStoreState;
  } catch {
    // JSON parse error or access exception -> reset safely
    const initial = createInitialStoreState();
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    } catch {
      // ignore quota or security error
    }
    return initial;
  }
}

export function saveStore(state: MockStoreState): void {
  const storage = getStorage();
  if (!storage) {
    memoryStore = state;
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to persist mock store state:", err);
  }
}

export function resetStore(): MockStoreState {
  const initial = createInitialStoreState();
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    } catch (err) {
      console.error("Failed to reset mock store:", err);
    }
  }
  memoryStore = initial;
  return initial;
}

// Store helpers
export function getCurrentUser(): MockUser | null {
  const state = loadStore();
  if (!state.currentUserId) return null;
  return state.users[state.currentUserId] || null;
}

export function setCurrentUserId(userId: string | null): void {
  const state = loadStore();
  state.currentUserId = userId;
  saveStore(state);
}

export function updateUser(userId: string, updater: (u: MockUser) => MockUser): MockUser {
  const state = loadStore();
  const current = state.users[userId];
  if (!current) {
    throw new Error(`User not found: ${userId}`);
  }
  const updated = updater({ ...current });
  state.users[userId] = updated;
  saveStore(state);
  return updated;
}

export function getDemographicProfile(userId: string): DemographicProfileDto | null {
  const state = loadStore();
  return state.demographics[userId] || null;
}

export function saveDemographicProfile(userId: string, profile: DemographicProfileDto): void {
  const state = loadStore();
  state.demographics[userId] = profile;
  saveStore(state);
}

export function getOnboardingDraft(userId: string): MockOnboardingDraft | null {
  const state = loadStore();
  return state.onboardingDrafts[userId] || null;
}

export function saveOnboardingDraft(userId: string, draft: MockOnboardingDraft): void {
  const state = loadStore();
  state.onboardingDrafts[userId] = draft;
  saveStore(state);
}

export function clearOnboardingDraft(userId: string): void {
  const state = loadStore();
  delete state.onboardingDrafts[userId];
  saveStore(state);
}

export function getAllSurveys(): Record<string, MockSurvey> {
  const state = loadStore();
  return state.surveys;
}

export function getSurvey(id: string): MockSurvey | null {
  const state = loadStore();
  return state.surveys[id] || null;
}

export function saveAttempt(attempt: MockSurveyAttempt): void {
  const state = loadStore();
  state.attempts[attempt.attemptId] = attempt;
  saveStore(state);
}

export function getAttempt(attemptId: string): MockSurveyAttempt | null {
  const state = loadStore();
  return state.attempts[attemptId] || null;
}

export function getWallet(userId: string): WalletBalanceDto {
  const state = loadStore();
  return (
    state.wallets[userId] || {
      available: 0,
      pending: 0,
      escrow: 0,
      frozen: 0,
      integrityHold: 0,
      total: 0,
    }
  );
}

export function saveWallet(userId: string, balance: WalletBalanceDto): void {
  const state = loadStore();
  state.wallets[userId] = balance;
  saveStore(state);
}

export function getTransactions(userId: string): WalletTransactionItemDto[] {
  const state = loadStore();
  return state.transactions[userId] || [];
}

export function appendTransaction(
  userId: string,
  tx: WalletTransactionItemDto,
): void {
  const state = loadStore();
  if (!state.transactions[userId]) {
    state.transactions[userId] = [];
  }
  state.transactions[userId].unshift(tx);
  saveStore(state);
}

export function getNotifications(userId: string): MockNotification[] {
  const state = loadStore();
  return state.notifications?.[userId] ?? [];
}

export function saveNotifications(
  userId: string,
  notifications: MockNotification[],
): void {
  const state = loadStore();
  state.notifications = { ...(state.notifications ?? {}), [userId]: notifications };
  saveStore(state);
}

export function getTopUpRequests(userId: string): MockTopUpRequest[] {
  const state = loadStore();
  return state.topUpRequests?.[userId] ?? [];
}

export function saveTopUpRequests(
  userId: string,
  requests: MockTopUpRequest[],
): void {
  const state = loadStore();
  state.topUpRequests = { ...(state.topUpRequests ?? {}), [userId]: requests };
  saveStore(state);
}

export function getSurveyFeedback(attemptId: string): MockSurveyFeedback | null {
  const state = loadStore();
  return state.surveyFeedback?.[attemptId] ?? null;
}

export function saveSurveyFeedback(feedback: MockSurveyFeedback): void {
  const state = loadStore();
  state.surveyFeedback = {
    ...(state.surveyFeedback ?? {}),
    [feedback.attemptId]: feedback,
  };
  saveStore(state);
}

/** Every transfer reference in the demo store (they are globally unique). */
export function getAllTopUpReferences(): Set<string> {
  const state = loadStore();
  return new Set(
    Object.values(state.topUpRequests ?? {})
      .flat()
      .map((request) => request.transferReference),
  );
}
