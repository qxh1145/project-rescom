import type { UserRole, UserStatus } from "@rescom/schemas";
import { loadStore, updateUser } from "../legacy/store";
import { createCollection } from "../db/store";
import { findMockUserByEmail } from "../db/session";
import { attempts } from "./attempts";
import { toMockUuid } from "./auth";
import { walletOf } from "./economy";
import { FRAUD_SEED_USER_IDS, fraudSummaryOf } from "./admin-fraud-log";

/**
 * Admin · Người dùng (Figma 11d, 63:2212). Two sources, one list:
 * - the real mock accounts of the legacy demo store (`mocks/legacy`, where the auth
 *   mock signs people in) — locking one makes its login fail (`isMockAccountLocked`);
 * - Figma seed users who only exist for the console (no password, cannot sign in).
 * The shape is the VERIFIED `adminUserSchema` + the ASSUMED extensions of
 * `lib/admin/users-service.ts`.
 */

export interface MockProfileSummary {
  age: number | null;
  gender: string | null;
  location: string | null;
  occupation: string | null;
  fieldOfStudy: string | null;
}

export interface MockAdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  name: string | null;
  activated: boolean;
  signInMethod: "PASSWORD" | "GOOGLE";
  balance: { available: number; pending: number };
  attemptCount: number;
  fraudLog: { count14d: number; repeated: boolean };
  profile: MockProfileSummary | null;
  lockReason: string | null;
}

type SeedUser = Omit<MockAdminUser, "fraudLog">;

const DAY_MS = 86_400_000;
function daysAgoAt(days: number, hours: number, minutes: number): string {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function seedUser(input: Omit<SeedUser, "updatedAt" | "lockReason"> & { lockReason?: string }): SeedUser {
  return { ...input, updatedAt: input.createdAt, lockReason: input.lockReason ?? null };
}

/** Figma 11d rows in drawn order (+ #A901 from the overview). Joined dates relative to now (Figma dates on 27/09/2026). */
function seed(): SeedUser[] {
  return [
    seedUser({
      id: FRAUD_SEED_USER_IDS.khang,
      email: "khang.do@gmail.com",
      name: "Đỗ Khang",
      role: "RESPONDENT",
      status: "ACTIVE",
      activated: true,
      signInMethod: "GOOGLE",
      balance: { available: 46, pending: 10 },
      attemptCount: 14,
      profile: { age: 21, gender: "MALE", location: "Đà Nẵng", occupation: "Sinh viên", fieldOfStudy: "Công nghệ thông tin" },
      createdAt: daysAgoAt(7, 9, 12),
    }),
    seedUser({
      id: "5b21e8a4-3c6d-4f7e-8a9b-0c1d2e3f4a02",
      email: "linh.nt@fpt.edu.vn",
      name: "Linh N.",
      role: "PUBLISHER",
      status: "ACTIVE",
      activated: true,
      signInMethod: "PASSWORD",
      balance: { available: 12, pending: 0 },
      attemptCount: 6,
      profile: { age: 20, gender: "FEMALE", location: "Hà Nội", occupation: "Sinh viên", fieldOfStudy: "Marketing" },
      createdAt: daysAgoAt(3, 14, 20),
    }),
    seedUser({
      id: "3e8d4b15-6a7c-4d8e-9f01-2a3b4c5d6e03",
      email: "minh.tran@fpt.edu.vn",
      name: "Trần Minh",
      role: "PUBLISHER",
      status: "ACTIVE",
      activated: true,
      signInMethod: "PASSWORD",
      balance: { available: 134, pending: 0 },
      attemptCount: 22,
      profile: { age: 22, gender: "MALE", location: "TP. Hồ Chí Minh", occupation: "Sinh viên", fieldOfStudy: "Kinh tế" },
      createdAt: daysAgoAt(15, 8, 45),
    }),
    seedUser({
      id: "6c40f2d7-8e9a-4b1c-9d2e-3f4a5b6c7d04",
      email: "tu.bui@fpt.edu.vn",
      name: "Bùi Tú",
      role: "RESPONDENT",
      status: "ACTIVE",
      activated: false,
      signInMethod: "PASSWORD",
      balance: { available: 0, pending: 0 },
      attemptCount: 0,
      profile: null,
      createdAt: daysAgoAt(1, 11, 5),
    }),
    seedUser({
      id: FRAUD_SEED_USER_IDS.vy,
      email: "vy.ho@gmail.com",
      name: "Hồ Vy",
      role: "RESPONDENT",
      status: "LOCKED",
      activated: true,
      signInMethod: "GOOGLE",
      balance: { available: 0, pending: 0 },
      attemptCount: 9,
      profile: { age: 19, gender: "FEMALE", location: "Huế", occupation: "Sinh viên", fieldOfStudy: "Ngôn ngữ Anh" },
      createdAt: daysAgoAt(13, 19, 40),
      lockReason: "Vi phạm lặp lại: nộp quá nhanh, sai mã hoàn thành nhiều lần.",
    }),
    seedUser({
      id: FRAUD_SEED_USER_IDS.quan,
      email: "quan.pham@fpt.edu.vn",
      name: "Phạm Quân",
      role: "RESPONDENT",
      status: "ACTIVE",
      activated: true,
      signInMethod: "PASSWORD",
      balance: { available: 58, pending: 0 },
      attemptCount: 11,
      profile: { age: 20, gender: "MALE", location: "Đà Nẵng", occupation: "Sinh viên", fieldOfStudy: "Quản trị kinh doanh" },
      createdAt: daysAgoAt(11, 16, 30),
    }),
  ];
}

const seedUsers = createCollection<SeedUser[]>("admin-seed-users", seed);

/** Lock state of the real (legacy store) accounts, by API UUID. */
interface AccountOverride {
  status: UserStatus;
  lockReason: string | null;
  updatedAt: string;
}
const accountOverrides = createCollection<Record<string, AccountOverride>>("admin-account-status", () => ({}));

function realAccounts(): MockAdminUser[] {
  const store = loadStore();
  const overrides = accountOverrides.get();
  return Object.values(store.users).map((user) => {
    const id = toMockUuid(user.id);
    const override = overrides[id];
    const sessionUser = findMockUserByEmail(user.email);
    const wallet = sessionUser ? walletOf(sessionUser) : null;
    const profile = store.demographics[user.id];
    return {
      id,
      email: user.email,
      role: user.role,
      status: override?.status ?? "ACTIVE",
      createdAt: user.createdAt,
      updatedAt: override?.updatedAt ?? user.createdAt,
      name: user.name,
      activated: user.isActivated,
      signInMethod: "PASSWORD",
      balance: { available: wallet?.available ?? 0, pending: wallet?.pending ?? 0 },
      attemptCount: attempts.get().filter((attempt) => attempt.userId === id).length,
      fraudLog: fraudSummaryOf(id),
      profile: profile
        ? {
            age: profile.age ?? null,
            gender: profile.gender ?? null,
            location: profile.location ?? null,
            occupation: profile.occupation ?? null,
            fieldOfStudy: profile.fieldOfStudy ?? null,
          }
        : null,
      lockReason: override?.lockReason ?? null,
    };
  });
}

/** Figma seed users first (drawn order), then the real mock accounts. */
export function listMockAdminUsers(): MockAdminUser[] {
  const seeded = seedUsers.get().map((user) => ({ ...user, fraudLog: fraudSummaryOf(user.id) }));
  return [...seeded, ...realAccounts()];
}

export function findMockAdminUser(id: string): MockAdminUser | undefined {
  return listMockAdminUsers().find((user) => user.id === id);
}

/** `GET /admin/users?search=` as the VERIFIED backend does: a case-insensitive substring of the email only. */
export function matchesUserEmail(user: Pick<MockAdminUser, "email">, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return user.email.toLowerCase().includes(needle);
}

/** FraudLog's ASSUMED user search: name, email or short code (`#7F3A`, `7f3a`). */
export function matchesUserSearch(user: Pick<MockAdminUser, "id" | "email" | "name">, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const code = needle.replace(/^#/, "");
  return (
    user.email.toLowerCase().includes(needle) ||
    (user.name?.toLowerCase().includes(needle) ?? false) ||
    (code.length > 0 && user.id.replace(/-/g, "").toLowerCase().startsWith(code))
  );
}

export function activeAdminCount(): number {
  return listMockAdminUsers().filter((user) => user.role === "ADMIN" && user.status === "ACTIVE").length;
}

function legacyIdOf(id: string): string | undefined {
  return Object.keys(loadStore().users).find((legacyId) => toMockUuid(legacyId) === id);
}

/** Lock / unlock. Seed users change in their collection, real accounts in the override map. */
export function setMockAdminUserStatus(id: string, status: UserStatus, reason: string | null): MockAdminUser | undefined {
  const updatedAt = new Date().toISOString();
  const lockReason = status === "LOCKED" ? reason : null;
  if (seedUsers.get().some((user) => user.id === id)) {
    seedUsers.update((all) => {
      const user = all.find((candidate) => candidate.id === id);
      if (user) Object.assign(user, { status, lockReason, updatedAt });
    });
  } else if (legacyIdOf(id)) {
    accountOverrides.update((all) => {
      all[id] = { status, lockReason, updatedAt };
    });
  }
  return findMockAdminUser(id);
}

/** Role change. A real account's role is written to the legacy store, so its next `/auth/me` sees it. */
export function setMockAdminUserRole(id: string, role: UserRole): MockAdminUser | undefined {
  const updatedAt = new Date().toISOString();
  if (seedUsers.get().some((user) => user.id === id)) {
    seedUsers.update((all) => {
      const user = all.find((candidate) => candidate.id === id);
      if (user) Object.assign(user, { role, updatedAt });
    });
  } else {
    const legacyId = legacyIdOf(id);
    if (legacyId) updateUser(legacyId, (user) => ({ ...user, role }));
  }
  return findMockAdminUser(id);
}

/**
 * Auth mock hook: a real account locked by an Admin cannot sign in
 * (`POST /auth/login` → 403 `AUTH_USER_LOCKED`, as the backend does).
 */
export function isMockAccountLocked(email: string): boolean {
  const user = Object.values(loadStore().users).find(
    (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!user) return false;
  return accountOverrides.get()[toMockUuid(user.id)]?.status === "LOCKED";
}
