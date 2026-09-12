import {
  OAuthIntent,
  OAuthIntentProps,
} from '../../domain/oauth-intent.entity';

export interface CreateOAuthIntentParams extends OAuthIntentProps {}

export interface OAuthIntentRepositoryPort {
  createIntent(intent: CreateOAuthIntentParams): Promise<void>;
  findById(id: string): Promise<OAuthIntent | null>;
  consumeIntent(id: string, now?: Date): Promise<OAuthIntent | null>;
  markFailed(id: string, now?: Date): Promise<void>;
  invalidatePriorIntents(params: {
    browserBindingDigest?: string;
    targetUserId?: string;
  }): Promise<void>;
  deleteExpired(now?: Date): Promise<number>;
}

export const OAUTH_INTENT_REPOSITORY_PORT = Symbol('OAuthIntentRepositoryPort');
