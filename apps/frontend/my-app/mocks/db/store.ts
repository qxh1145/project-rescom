/**
 * Mock-only persistent state for MSW handlers. Each domain owns one
 * collection (`createCollection("wallets", seed)`), stored in localStorage so
 * flows survive reloads (take a survey → wallet → notifications stay in sync).
 *
 * Reset everything with `?msw-reset=1` or `resetMockDb()`: the collections,
 * the legacy demo store (`lib/mock`, which still holds the signed-in user),
 * passwords registered through MSW and the remembered `?msw=` scenario.
 */

import { LEGACY_STORE_KEY } from "@/lib/mock/store.ts";
import { CREDENTIALS_KEY } from "../data/auth";
import { SCENARIO_STORAGE_KEY } from "../scenarios";

const PREFIX = "rescom:mockdb:";
/** Bump when seed shapes change so stale browser state is discarded. */
const SCHEMA_VERSION = 1;

interface Persisted<T> {
  version: number;
  value: T;
}

function read<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Persisted<T>;
    return parsed.version === SCHEMA_VERSION ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

function write<T>(key: string, value: T): void {
  try {
    const payload: Persisted<T> = { version: SCHEMA_VERSION, value };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(payload));
  } catch {
    // Storage full or blocked: state then lives for this page load only.
  }
}

export interface Collection<T> {
  get(): T;
  set(value: T): void;
  update(mutator: (draft: T) => T | void): T;
}

const memory = new Map<string, unknown>();

export function createCollection<T>(key: string, seed: () => T): Collection<T> {
  const get = (): T => {
    if (memory.has(key)) return memory.get(key) as T;
    const value = read<T>(key) ?? seed();
    memory.set(key, value);
    return value;
  };
  const set = (value: T) => {
    memory.set(key, value);
    write(key, value);
  };
  return {
    get,
    set,
    update(mutator) {
      const draft = structuredClone(get());
      const result = mutator(draft);
      const next = (result === undefined ? draft : result) as T;
      set(next);
      return next;
    },
  };
}

const OTHER_MOCK_KEYS = [LEGACY_STORE_KEY, CREDENTIALS_KEY, SCENARIO_STORAGE_KEY];

export function resetMockDb(): void {
  memory.clear();
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX) || OTHER_MOCK_KEYS.includes(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("msw-reset")) {
  resetMockDb();
}

let idCounter = 0;
/** RFC 4122 v4 UUID — shared schemas validate ids as UUIDs. */
export function mockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

export const nowIso = () => new Date().toISOString();

/** ISO timestamp `hours` ago (negative = in the future). */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
