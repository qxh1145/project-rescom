import { createHmac } from 'crypto';
import {
  AUDIENCE_ESTIMATE_MIN_REPORTABLE,
  AudienceEstimateDto,
  DemographicProfileDto,
  getMissingDemographicFields,
  isSurveyTargetingMatch,
  normalizeTargetingText,
  SurveyTargetingCriteria,
  toAudienceEstimate,
} from '@rescom/schemas';
import { RateLimitCounterStorePort } from '../../../common/security/rate-limit-counter-store.port';
import { AudienceProfileSourcePort } from './ports/audience-profile-source.port';

export const AUDIENCE_SCAN_PAGE_SIZE = 500;
/** Hard cap on profiles read per (uncached) estimate. */
export const AUDIENCE_SCAN_MAX_ROWS = 20_000;
/** Counts are reused for the same normalized targeting this long. */
export const AUDIENCE_CACHE_TTL_MS = 10 * 60 * 1000;
const AUDIENCE_CACHE_MAX_ENTRIES = 500;
/** Dedicated per-user limit, on top of the global `default` throttler. */
export const AUDIENCE_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };
/** Deterministic noise in [-AUDIENCE_NOISE_SPAN, +AUDIENCE_NOISE_SPAN]. */
export const AUDIENCE_NOISE_SPAN = 3;

/** OR-ed categories: each single value is checked against the minimum too. */
const OR_CATEGORIES = [
  'locations',
  'genders',
  'occupations',
  'fieldOfStudy',
] as const;

export class AudienceEstimateRateLimitedError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many audience estimates. Please try again later.');
    this.name = 'AudienceEstimateRateLimitedError';
  }
}

export interface AudienceEstimateLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface AudienceEstimateOptions {
  /** HMAC key of the noise (derived from a server secret). */
  noiseKey: string;
  counterStore?: RateLimitCounterStorePort;
  logger?: AudienceEstimateLogger;
  now?: () => Date;
  pageSize?: number;
  maxRows?: number;
}

interface CachedCounts {
  counts: number[];
  capped: boolean;
  expiresAt: number;
}

/**
 * Plan 5.5 `POST /forms/audience-estimate`: how many respondents could start
 * a survey with this targeting — the same two gates as attempt start
 * (`participation.service.ts`): a complete Mandatory Demographic Survey
 * (`getMissingDemographicFields`, Story 7.1) and `isSurveyTargetingMatch`
 * (Story 4.2). Exact counts never leave this service:
 *
 * - suppression: null when the whole group, or any single value of an OR-ed
 *   list (e.g. one of two cities), has fewer than k = 10 matches, so a list
 *   cannot be used to read a small group as the difference of two answers;
 * - noise: a deterministic offset in [-3, 3] from HMAC(server secret,
 *   normalized targeting, UTC day) — repeating a query does not average it
 *   away, and it changes daily;
 * - then `toAudienceEstimate` rounding (10 / 100).
 * This makes small-group disclosure harder; it is not a formal privacy
 * guarantee (differencing across days or across other criteria remains
 * possible in principle). Each request is rate-limited per user (30/hour),
 * cached per normalized targeting (10 min) and logged without values.
 */
export class AudienceEstimateService {
  private readonly cache = new Map<string, CachedCounts>();
  private readonly now: () => Date;
  private readonly pageSize: number;
  private readonly maxRows: number;

  constructor(
    private readonly source: AudienceProfileSourcePort,
    private readonly options: AudienceEstimateOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.pageSize = options.pageSize ?? AUDIENCE_SCAN_PAGE_SIZE;
    this.maxRows = options.maxRows ?? AUDIENCE_SCAN_MAX_ROWS;
  }

  async estimate(
    userId: string,
    rawTargeting: SurveyTargetingCriteria,
  ): Promise<AudienceEstimateDto> {
    await this.assertWithinRateLimit(userId);
    const targeting = normalizeAudienceTargeting(rawTargeting);
    const key = JSON.stringify(targeting);
    const variants = audienceVariants(targeting);

    let cached = true;
    let entry = this.cache.get(key);
    const nowMs = this.now().getTime();
    if (!entry || entry.expiresAt <= nowMs) {
      cached = false;
      entry = {
        ...(await this.scan(variants)),
        expiresAt: nowMs + AUDIENCE_CACHE_TTL_MS,
      };
      this.remember(key, entry);
    }

    // The caller is never counted (they cannot take their own survey).
    const counts = [...entry.counts];
    const self = await this.source.findCandidate(userId);
    if (self && isEligible(self.profile)) {
      variants.forEach((variant, index) => {
        if (isSurveyTargetingMatch(variant, self.profile)) counts[index] -= 1;
      });
    }

    const k = AUDIENCE_ESTIMATE_MIN_REPORTABLE;
    const suppressed = counts.some((count) => count < k);
    const result = suppressed
      ? toAudienceEstimate(0)
      : toAudienceEstimate(Math.max(k, counts[0] + this.noise(key, nowMs)));

    this.options.logger?.log(
      `AUDIENCE_ESTIMATE ${JSON.stringify({
        userId,
        criteria: Object.keys(targeting),
        components: variants.length,
        suppressed,
        cached,
        capped: entry.capped,
      })}`,
    );
    return result;
  }

  private async assertWithinRateLimit(userId: string): Promise<void> {
    const store = this.options.counterStore;
    if (!store) return;
    const now = this.now();
    const hit = await store.increment(
      `audience-estimate:${userId}`,
      AUDIENCE_RATE_LIMIT.windowMs,
      now,
    );
    if (hit.hits > AUDIENCE_RATE_LIMIT.max) {
      throw new AudienceEstimateRateLimitedError(
        Math.max(1, Math.ceil((hit.resetAt.getTime() - now.getTime()) / 1000)),
      );
    }
  }

  /** One pass over the candidates, counting every variant at once. */
  private async scan(
    variants: SurveyTargetingCriteria[],
  ): Promise<{ counts: number[]; capped: boolean }> {
    const counts = variants.map(() => 0);
    let scanned = 0;
    let capped = false;
    let afterUserId: string | null = null;
    for (;;) {
      const limit = Math.min(this.pageSize, this.maxRows - scanned);
      const page = await this.source.listCandidates({
        afterUserId,
        limit,
        ageRange: variants[0].ageRange,
      });
      for (const candidate of page) {
        if (!isEligible(candidate.profile)) continue;
        variants.forEach((variant, index) => {
          if (isSurveyTargetingMatch(variant, candidate.profile)) {
            counts[index] += 1;
          }
        });
      }
      scanned += page.length;
      if (page.length < limit) break;
      if (scanned >= this.maxRows) {
        capped = true;
        this.options.logger?.warn(
          `AUDIENCE_ESTIMATE scan capped at ${this.maxRows} profiles`,
        );
        break;
      }
      afterUserId = page[page.length - 1].userId;
    }
    return { counts, capped };
  }

  private remember(key: string, entry: CachedCounts): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > AUDIENCE_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private noise(key: string, nowMs: number): number {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const digest = createHmac('sha256', this.options.noiseKey)
      .update(`${key}|${day}`)
      .digest();
    return (
      (digest.readUInt32BE(0) % (2 * AUDIENCE_NOISE_SPAN + 1)) -
      AUDIENCE_NOISE_SPAN
    );
  }
}

function isEligible(profile: DemographicProfileDto): boolean {
  return getMissingDemographicFields(profile).length === 0;
}

/**
 * Canonical targeting (cache key and noise input): text values folded like
 * the matcher folds them, lists de-duplicated and sorted, empty lists
 * dropped, keys in a fixed order.
 */
export function normalizeAudienceTargeting(
  targeting: SurveyTargetingCriteria,
): SurveyTargetingCriteria {
  const list = (values: readonly string[] | undefined, fold: boolean) => {
    const cleaned = [
      ...new Set(
        (values ?? []).map((value) =>
          fold ? normalizeTargetingText(value) : value,
        ),
      ),
    ]
      .filter((value) => value.length > 0)
      .sort();
    return cleaned.length > 0 ? cleaned : undefined;
  };
  const normalized: SurveyTargetingCriteria = {};
  if (targeting.ageRange) {
    normalized.ageRange = {
      min: targeting.ageRange.min,
      max: targeting.ageRange.max,
    };
  }
  const genders = list(targeting.genders, false);
  if (genders)
    normalized.genders = genders as SurveyTargetingCriteria['genders'];
  const locations = list(targeting.locations, true);
  if (locations) normalized.locations = locations;
  const occupations = list(targeting.occupations, true);
  if (occupations) normalized.occupations = occupations;
  const fieldOfStudy = list(targeting.fieldOfStudy, true);
  if (fieldOfStudy) normalized.fieldOfStudy = fieldOfStudy;
  return normalized;
}

/** [the whole targeting, then one variant per single value of each OR-ed list]. */
export function audienceVariants(
  targeting: SurveyTargetingCriteria,
): SurveyTargetingCriteria[] {
  const variants: SurveyTargetingCriteria[] = [targeting];
  for (const category of OR_CATEGORIES) {
    const values = targeting[category] as string[] | undefined;
    if (!values || values.length < 2) continue;
    for (const value of values) {
      variants.push({ ...targeting, [category]: [value] });
    }
  }
  return variants;
}
