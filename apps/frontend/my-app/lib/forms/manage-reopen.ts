import { escrowDrawPerCompletion, MAX_EXPECTED_COMPLETIONS, type FormTypeEnum } from "@rescom/schemas";

/**
 * Figma 10b "Mở lại khảo sát" (63:1392 / 63:1843). Reopening keeps the
 * reward per response and locks new Escrow for the added quota (FR-33,
 * `POST /forms/:id/reopen`). The backend draws `escrowDrawPerCompletion` per
 * slot — the Form Builder 20% discount included — so the dialog shows that
 * amount, not `reward × added` (Figma draws 8 × 12 = 96 for a Form Builder
 * survey; the backend locks 8 × 10 = 80).
 */

/**
 * Story IR.2b Q3: reopening a survey whose deadline passed needs a new
 * deadline (or none), else the deadline job closes it again. `null` = no
 * deadline, otherwise days from now (same choices as the create wizard).
 */
export const REOPEN_DEADLINE_CHOICES: readonly { value: number | null; label: string }[] = [
  { value: 7, label: "7 ngày nữa" },
  { value: 14, label: "14 ngày nữa" },
  { value: 30, label: "30 ngày nữa" },
  { value: null, label: "Không giới hạn thời gian" },
];
export const REOPEN_DEFAULT_DEADLINE_DAYS = 14;

/** True when the survey's deadline is set and already passed. */
export function reopenNeedsNewDeadline(deadlineAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!deadlineAt) return false;
  const time = Date.parse(deadlineAt);
  return Number.isFinite(time) && time <= now.getTime();
}

/** `deadlineAt` of the reopen request: `days` from now, or null for none. */
export function reopenDeadlineAt(days: number | null, now: Date = new Date()): string | null {
  return days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Figma 10b default of "Thêm người trả lời". */
export const REOPEN_DEFAULT_COMPLETIONS = 8;

export interface ReopenCostInput {
  type: FormTypeEnum;
  rewardPerResponse: number;
  expectedCompletions: number;
  additionalCompletions: number;
  /** Available balance; null while unknown (the server still checks it). */
  available: number | null;
}

export interface ReopenCost {
  /** Escrow drawn per added response. */
  perCompletion: number;
  /** Points locked by this reopen. */
  total: number;
  /** Available − total; null while the balance is unknown. */
  remaining: number | null;
  /** Form Builder 20% escrow discount applies. */
  discounted: boolean;
  /** Largest quota the backend accepts on top of the current one. */
  maxAdditional: number;
  /** Quota is a whole number in 1…maxAdditional. */
  validQuantity: boolean;
  /** Balance covers the lock (true while unknown). */
  affordable: boolean;
}

export function reopenCost(input: ReopenCostInput): ReopenCost {
  const perCompletion = escrowDrawPerCompletion({ type: input.type, rewardPerResponse: input.rewardPerResponse });
  const maxAdditional = Math.max(0, MAX_EXPECTED_COMPLETIONS - input.expectedCompletions);
  const quantity = input.additionalCompletions;
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= maxAdditional;
  const total = validQuantity ? quantity * perCompletion : 0;
  const remaining = input.available === null ? null : input.available - total;
  return {
    perCompletion,
    total,
    remaining,
    discounted: perCompletion < input.rewardPerResponse,
    maxAdditional,
    validQuantity,
    affordable: remaining === null || remaining >= 0,
  };
}

/** −/+ steppers and typing: keeps the value a whole number in 1…max. */
export function clampAdditional(value: number, maxAdditional: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, Math.trunc(value)), Math.max(1, maxAdditional));
}
