
## Phase 5 (email, forgot/reset password, session replaced) — 2026-10-01
- Kind-(b) Outbox handlers run inside the dispatcher's Prisma interactive transaction (default 5 s timeout). The email
  handler therefore commits SENDING and the outcome on the base client, never the ambient tx.
- nodemailer 10 ships its own types (no @types/nodemailer); timeouts all report `command: 'CONN'`, so only
  connect/greeting failures are provably retryable; everything mid-conversation is AMBIGUOUS (never resent).
- Production env fixtures in specs (env.service.spec, cookie-options.helper.spec) need the SMTP block now.
- The backend clears cookies on the first AUTH_SESSION_REPLACED, so the FE remembers it (session-notice mark) instead
  of relying on later 401s.
