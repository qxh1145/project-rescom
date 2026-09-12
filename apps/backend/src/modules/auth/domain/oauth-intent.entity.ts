export type OAuthFlowType = 'LOGIN' | 'LINK';

export interface OAuthIntentProps {
  id: string;
  flowType: OAuthFlowType;
  targetUserId: string | null;
  stateDigest: string;
  nonceDigest: string;
  browserBindingDigest: string;
  pkceVerifierEncrypted: string;
  expiresAt: Date;
  consumedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
}

export class OAuthIntent {
  constructor(private readonly props: OAuthIntentProps) {}

  get id(): string {
    return this.props.id;
  }

  get flowType(): OAuthFlowType {
    return this.props.flowType;
  }

  get targetUserId(): string | null {
    return this.props.targetUserId;
  }

  get stateDigest(): string {
    return this.props.stateDigest;
  }

  get nonceDigest(): string {
    return this.props.nonceDigest;
  }

  get browserBindingDigest(): string {
    return this.props.browserBindingDigest;
  }

  get pkceVerifierEncrypted(): string {
    return this.props.pkceVerifierEncrypted;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get consumedAt(): Date | null {
    return this.props.consumedAt;
  }

  get failedAt(): Date | null {
    return this.props.failedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isConsumed(): boolean {
    return this.props.consumedAt !== null;
  }

  isFailed(): boolean {
    return this.props.failedAt !== null;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.props.expiresAt <= now;
  }

  isValid(now: Date = new Date()): boolean {
    return !this.isConsumed() && !this.isFailed() && !this.isExpired(now);
  }
}
