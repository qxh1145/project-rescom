/**
 * Plan 5.6: why a session was revoked. Mirrors the Prisma
 * `SessionRevokeReason` enum (parity spec). `REPLACED` (a newer login of the
 * same account) is answered with `AUTH_SESSION_REPLACED`.
 */
export const SESSION_REVOKE_REASONS = [
  'LOGOUT',
  'REPLACED',
  'REFRESH_REUSE',
  'ADMIN_LOCK',
  'ROLE_CHANGED',
  'PASSWORD_RESET',
] as const;

export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export interface SessionProps {
  id: string;
  userId: string;
  sessionVersion: number;
  csrfDigest: string;
  revoked: boolean;
  /** Null while active and on rows revoked before plan 5.6. */
  revokedAt?: Date | null;
  revokedReason?: SessionRevokeReason | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class Session {
  constructor(private readonly props: SessionProps) {}

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get sessionVersion(): number {
    return this.props.sessionVersion;
  }

  get csrfDigest(): string {
    return this.props.csrfDigest;
  }

  get revoked(): boolean {
    return this.props.revoked;
  }

  get revokedReason(): SessionRevokeReason | null {
    return this.props.revokedReason ?? null;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.props.expiresAt <= now;
  }

  isValid(now: Date = new Date()): boolean {
    return !this.props.revoked && !this.isExpired(now);
  }
}

export interface RefreshCredentialProps {
  id: string;
  sessionId: string;
  secretDigest: string;
  isUsed: boolean;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export class RefreshCredential {
  constructor(private readonly props: RefreshCredentialProps) {}

  get id(): string {
    return this.props.id;
  }

  get sessionId(): string {
    return this.props.sessionId;
  }

  get secretDigest(): string {
    return this.props.secretDigest;
  }

  get isUsed(): boolean {
    return this.props.isUsed;
  }

  get usedAt(): Date | null {
    return this.props.usedAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.props.expiresAt <= now;
  }
}
