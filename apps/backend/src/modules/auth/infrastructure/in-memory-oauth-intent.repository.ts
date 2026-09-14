import {
  OAuthIntentRepositoryPort,
  CreateOAuthIntentParams,
} from '../application/ports/oauth-intent-repository.port';
import { OAuthIntent, OAuthIntentProps } from '../domain/oauth-intent.entity';

export class InMemoryOAuthIntentRepository implements OAuthIntentRepositoryPort {
  private intents = new Map<string, OAuthIntentProps>();

  async createIntent(intent: CreateOAuthIntentParams): Promise<void> {
    this.intents.set(intent.id, { ...intent });
  }

  async findById(id: string): Promise<OAuthIntent | null> {
    const found = this.intents.get(id);
    return found ? new OAuthIntent(found) : null;
  }

  async consumeIntent(
    id: string,
    now: Date = new Date(),
  ): Promise<OAuthIntent | null> {
    const found = this.intents.get(id);
    if (!found) return null;
    if (
      found.consumedAt !== null ||
      found.failedAt !== null ||
      found.expiresAt <= now
    ) {
      return null;
    }

    const updated: OAuthIntentProps = {
      ...found,
      consumedAt: now,
    };
    this.intents.set(id, updated);
    return new OAuthIntent(updated);
  }

  async markFailed(id: string, now: Date = new Date()): Promise<void> {
    const found = this.intents.get(id);
    if (found) {
      this.intents.set(id, { ...found, failedAt: now });
    }
  }

  async invalidatePriorIntents(params: {
    browserBindingDigest?: string;
    targetUserId?: string;
  }): Promise<void> {
    for (const [id, intent] of this.intents.entries()) {
      if (intent.consumedAt === null && intent.failedAt === null) {
        if (
          (params.browserBindingDigest &&
            intent.browserBindingDigest === params.browserBindingDigest) ||
          (params.targetUserId && intent.targetUserId === params.targetUserId)
        ) {
          this.intents.set(id, { ...intent, failedAt: new Date() });
        }
      }
    }
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    let count = 0;
    for (const [id, intent] of this.intents.entries()) {
      if (intent.expiresAt <= now) {
        this.intents.delete(id);
        count += 1;
      }
    }
    return count;
  }

  clear(): void {
    this.intents.clear();
  }
}
