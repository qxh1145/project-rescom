export type UniqueViolation =
  'reference' | 'idempotency' | 'quote' | 'code_issue_open' | 'other';

/**
 * Classifies a unique-constraint violation (Prisma `P2002`, matched by shape so
 * the application layer stays free of ORM imports) by the violated index.
 * Returns null for every other error.
 */
export function uniqueViolationOf(error: unknown): UniqueViolation | null {
  const e = error as { code?: unknown; meta?: { target?: unknown } } | null;
  if (!e || e.code !== 'P2002') return null;
  const t = e.meta?.target;
  const target = Array.isArray(t) ? t.join(',') : String(t ?? '');
  if (target.includes('open_redemption')) return 'code_issue_open';
  if (target.includes('reference')) return 'reference';
  if (target.includes('idempotency')) return 'idempotency';
  if (target.includes('quote')) return 'quote';
  return 'other';
}
