import {
  ActorCapability,
  AdminCapabilityPort,
} from '../application/ports/admin-capability.port';

export interface CapabilitySourceUser {
  id: string;
  role: string;
  status: string;
}

/**
 * In-memory capability lookup for unit tests and e2e overrides. It resolves
 * the actor through a user lookup (for example `InMemoryUserRepository`), so
 * a demotion or lock made there is visible to the next review immediately.
 */
export class InMemoryAdminCapabilityRepository implements AdminCapabilityPort {
  constructor(
    private readonly findUser: (
      userId: string,
    ) => Promise<CapabilitySourceUser | null>,
  ) {}

  async findCurrentCapability(userId: string): Promise<ActorCapability | null> {
    const user = await this.findUser(userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, role: user.role, status: user.status };
  }
}
