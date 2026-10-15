export type ReminderWindow = '1D' | '7D';

export interface ReminderTicketFacts {
  status: string; // 'SUCCEEDED'
  used: boolean;
  refunded: boolean;
  redeemedAt: string | Date | number;
  expiresAt: string | Date | number;
}

const ONE_DAY_MS = 24 * 3_600_000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

/**
 * Calculates due reminder window:
 * - ticket SUCCEEDED, not used, not refunded, now < expiresAt
 * - window = '1D' if expiresAt - now <= 24 h
 * - else '7D' if expiresAt - now <= 7 d
 * - else null
 *
 * Boundary rule: skip a window whose boundary (expiresAt - W) is earlier than redeemedAt
 * (i.e. user redeemed inside the window and already sees "Expiring").
 * Catch-up after downtime never sends both: only the most urgent due window.
 */
export function dueReminderWindow(
  ticket: ReminderTicketFacts,
  now: number,
): ReminderWindow | null {
  if (ticket.status !== 'SUCCEEDED') return null;
  if (ticket.used || ticket.refunded) return null;

  const expiresAtMs = +new Date(ticket.expiresAt);
  const redeemedAtMs = +new Date(ticket.redeemedAt);

  if (now >= expiresAtMs) return null;

  const remainingMs = expiresAtMs - now;

  // Check 1D window first (more urgent)
  if (remainingMs <= ONE_DAY_MS) {
    const boundary1D = expiresAtMs - ONE_DAY_MS;
    if (redeemedAtMs > boundary1D) {
      // Redeemed inside 1D window
      return null;
    }
    return '1D';
  }

  // Check 7D window
  if (remainingMs <= SEVEN_DAYS_MS) {
    const boundary7D = expiresAtMs - SEVEN_DAYS_MS;
    if (redeemedAtMs > boundary7D) {
      // Redeemed inside 7D window
      return null;
    }
    return '7D';
  }

  return null;
}
