/**
 * Story IR.2b review LOW-10: what an error may leave in `last_error`, logs
 * and the Admin dead-letter API — the error class and its stable `code`
 * (domain codes, Prisma `P2034`…), never the message (Prisma messages embed
 * SQL and values; provider errors embed addresses).
 */
export function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_:.-]{1,80}$/.test(code)
    ? `${error.name}:${code}`
    : error.name;
}
