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
/**
 * Bump when seed shapes change so stale browser state is discarded.
 * 2: attempts use the backend `AttemptStatus` values (Phase 3 review).
 * 3: survey response analytics seed (321-response and empty publisher surveys).
 * 4: the empty analytics survey is also a respondent survey (surveys + survey-content).
 */
const SCHEMA_VERSION = 4;

interface Persisted<T> {
  version: number;
  value: T;
}

/** The stored JSON of a collection; `undefined` when storage is blocked. */
function readRaw(key: string): string | null | undefined {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return undefined;
  }
}

function parse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Persisted<T>;
    return parsed.version === SCHEMA_VERSION ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

/** Writes and returns the stored JSON (`undefined` when storage is blocked or full). */
function write<T>(key: string, value: T): string | undefined {
  try {
    const raw = JSON.stringify({ version: SCHEMA_VERSION, value } satisfies Persisted<T>);
    window.localStorage.setItem(PREFIX + key, raw);
    return raw;
  } catch {
    // Storage full or blocked: state then lives for this page load only.
    return undefined;
  }
}

export interface Collection<T> {
  get(): T;
  set(value: T): void;
  update(mutator: (draft: T) => T | void): T;
}

/**
 * Parsed value per collection, tagged with the JSON it came from. Every
 * `get()` re-reads localStorage (a cheap string read) and parses again only
 * when the JSON changed — so a write from another tab is seen before this
 * tab updates the same collection (no lost updates between tabs).
 */
const memory = new Map<string, { raw: string | null | undefined; value: unknown }>();

export function createCollection<T>(key: string, seed: () => T): Collection<T> {
  const get = (): T => {
    const raw = readRaw(key);
    const cached = memory.get(key);
    // Blocked storage (`undefined`): the in-memory copy is the only state.
    if (cached && (raw === undefined || raw === cached.raw)) return cached.value as T;
    const value = parse<T>(raw ?? null) ?? seed();
    memory.set(key, { raw, value });
    return value;
  };
  const set = (value: T) => {
    // A failed write keeps the stored JSON as the tag, so this tab's copy still wins.
    memory.set(key, { raw: write(key, value) ?? readRaw(key), value });
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
