import { COMPLETION_CODE_POLICY_VERSION } from "@rescom/schemas";
import { fraudKindOf, WRONG_CODE_ACTION } from "@/lib/admin/fraud-log-view.ts";
import { createCollection, mockId } from "../db/store";
import { SURVEY_IDS } from "./surveys";

/**
 * FraudLog evidence (Figma 11e 62:2195, overview 62:4070 "Tài khoản cần xem").
 * Mirrors the backend append-only `fraud_logs` rows (`userId`, `type`, `details`,
 * `createdAt`, same `details` keys) plus the survey the entry is about. Seed = Figma,
 * dated relative to now at the drawn clock times, so on 27/09/2026 the rows read
 * exactly 26/09 15:31, 25/09 21:14… (seeded at first use; `?msw-reset=1` re-dates them).
 */

export interface MockFraudLogEntry {
  id: string;
  userId: string;
  type: string;
  survey: { id: string; title: string } | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** Figma seed accounts referenced by code (ids start with the drawn short code). */
export const FRAUD_SEED_USER_IDS = {
  khang: "7f3a0c52-8d14-4e6b-9a21-3c5d7e9f1b01", // #7F3A · Đỗ Khang
  vy: "c9e04a71-2b36-4f58-8c90-1d2e3f4a5b06", // #C9E0 · Hồ Vy
  quan: "a9016d3e-5f72-4a84-b196-2e3f4a5b6c07", // #A901 · Phạm Quân
} as const;

/** ASSUMED policy: ≥ 3 entries in 14 days = repeat offender ("Lặp lại"). The system only flags. */
export const FRAUD_REPEAT_THRESHOLD = 3;
export const FRAUD_REPEAT_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;
const RATE_LIMIT_POLICY = "participation-rate-limit-v1";

/** Backend shape of a wrong completion code (SECURITY_VIOLATION, `prisma-participation.repository.ts`). */
function wrongCode(failureCount: number, isLocked: boolean): Record<string, unknown> {
  return { action: WRONG_CODE_ACTION, failureCount, isLocked, policyVersion: COMPLETION_CODE_POLICY_VERSION };
}

/** Local date `days` ago at `hh:mm`. */
function daysAgoAt(days: number, hours: number, minutes: number): string {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

const READING_HABITS = { id: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e71", title: "Thói quen đọc sách của sinh viên" };
const ONLINE_SHOPPING = { id: SURVEY_IDS.onlineShopping, title: "Hành vi mua sắm online của sinh viên Đà Nẵng" };
const E_SCOOTER = { id: SURVEY_IDS.eScooterIntent, title: "Ý định sử dụng xe điện cá nhân" };
const LIBRARY = { id: SURVEY_IDS.librarySatisfaction, title: "Mức độ hài lòng với thư viện trường" };
const AI_STUDY = { id: SURVEY_IDS.aiStudyHabits, title: "Thói quen dùng AI trong học tập của sinh viên IT" };
const HOUSING = { id: SURVEY_IDS.housingNearCampus, title: "Nhu cầu nhà trọ gần trường" };

function entry(
  seq: number,
  userId: string,
  type: string,
  survey: MockFraudLogEntry["survey"],
  details: Record<string, unknown>,
  createdAt: string,
): MockFraudLogEntry {
  return { id: `fraud-seed-${seq}`, userId, type, survey, details, createdAt };
}

function seed(): MockFraudLogEntry[] {
  const { khang, vy, quan } = FRAUD_SEED_USER_IDS;
  return [
    // #7F3A — the five rows of Figma 11e.
    entry(1, khang, "COMPLAINT_UPHELD", READING_HABITS, { refundedPoints: 10, adminName: "Admin Hùng" }, daysAgoAt(1, 15, 31)),
    entry(2, khang, "TIME_BARRIER", ONLINE_SHOPPING, { elapsedSeconds: 48, requiredSeconds: 150 }, daysAgoAt(2, 21, 14)),
    entry(3, khang, "SECURITY_VIOLATION", E_SCOOTER, wrongCode(3, true), daysAgoAt(3, 10, 2)),
    entry(4, khang, "RATE_LIMIT", null, { policyVersion: RATE_LIMIT_POLICY }, daysAgoAt(4, 22, 40)),
    entry(5, khang, "TIME_BARRIER", LIBRARY, { elapsedSeconds: 31, requiredSeconds: 60 }, daysAgoAt(6, 8, 55)),
    // #A901 — "2 lần trong 14 ngày · vượt giới hạn tần suất" (overview).
    entry(6, quan, "RATE_LIMIT", null, { policyVersion: RATE_LIMIT_POLICY }, daysAgoAt(2, 19, 12)),
    entry(7, quan, "RATE_LIMIT", null, { policyVersion: RATE_LIMIT_POLICY }, daysAgoAt(5, 14, 5)),
    // #C9E0 — 7 in 14 days (11d), already locked.
    entry(8, vy, "TIME_BARRIER", AI_STUDY, { elapsedSeconds: 40, requiredSeconds: 120 }, daysAgoAt(8, 21, 3)),
    entry(9, vy, "SECURITY_VIOLATION", HOUSING, wrongCode(3, true), daysAgoAt(9, 20, 47)),
    entry(10, vy, "SECURITY_VIOLATION", E_SCOOTER, wrongCode(2, false), daysAgoAt(9, 20, 15)),
    entry(11, vy, "TIME_BARRIER", LIBRARY, { elapsedSeconds: 22, requiredSeconds: 60 }, daysAgoAt(10, 9, 30)),
    entry(12, vy, "RATE_LIMIT", null, { policyVersion: RATE_LIMIT_POLICY }, daysAgoAt(11, 23, 5)),
    entry(13, vy, "TIME_BARRIER", ONLINE_SHOPPING, { elapsedSeconds: 55, requiredSeconds: 150 }, daysAgoAt(12, 16, 20)),
    entry(14, vy, "SECURITY_VIOLATION", AI_STUDY, wrongCode(3, true), daysAgoAt(12, 15, 58)),
  ];
}

export const fraudLogEntries = createCollection<MockFraudLogEntry[]>("admin-fraud-log", seed);

function withinDays(iso: string, days: number, now = Date.now()): boolean {
  return now - new Date(iso).getTime() <= days * DAY_MS;
}

/** Every entry of one user, newest first. */
export function fraudEntriesOf(userId: string): MockFraudLogEntry[] {
  return fraudLogEntries
    .get()
    .filter((item) => item.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Entries of the last `days` days (default 14) and the repeat-offender flag. */
export function fraudSummaryOf(userId: string, days = FRAUD_REPEAT_WINDOW_DAYS): { count14d: number; repeated: boolean } {
  const recent = fraudEntriesOf(userId).filter((item) => withinDays(item.createdAt, days));
  return { count14d: recent.length, repeated: isRepeatOffender(userId) };
}

export function isRepeatOffender(userId: string): boolean {
  const recent = fraudEntriesOf(userId).filter((item) => withinDays(item.createdAt, FRAUD_REPEAT_WINDOW_DAYS));
  return recent.length >= FRAUD_REPEAT_THRESHOLD;
}

export interface FraudLogFilter {
  userIds?: readonly string[];
  days: number | null;
  type?: string;
}

/** Entries matching the filter, newest first. */
export function queryFraudLog(filter: FraudLogFilter): MockFraudLogEntry[] {
  const now = Date.now();
  return fraudLogEntries
    .get()
    .filter((item) => !filter.userIds || filter.userIds.includes(item.userId))
    .filter((item) => filter.days === null || withinDays(item.createdAt, filter.days, now))
    .filter((item) => !filter.type || fraudKindOf(item) === filter.type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Append-only evidence, as the backend writes it (TIME_BARRIER on a too-fast
 * submit, RATE_LIMIT on a 429, COMPLAINT_UPHELD when an Admin upholds a dispute…).
 * Other admin mocks may call it; entries are never edited or deleted.
 */
export function recordMockFraudLog(input: Omit<MockFraudLogEntry, "id" | "createdAt">): MockFraudLogEntry {
  const created: MockFraudLogEntry = { ...input, id: mockId(), createdAt: new Date().toISOString() };
  fraudLogEntries.update((all) => {
    all.push(created);
  });
  return created;
}
