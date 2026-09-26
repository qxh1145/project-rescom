export const ADMIN_CAPABILITY_PORT = Symbol('ADMIN_CAPABILITY_PORT');

/** The actor's current Identity role and status (not the JWT claims). */
export interface ActorCapability {
  userId: string;
  role: string;
  status: string;
}

/**
 * Live Identity capability check used by financial Admin commands (AD-16
 * "verifies current Identity capability").
 */
export interface AdminCapabilityPort {
  /**
   * Reads the actor's current role/status inside the ambient Unit of Work and
   * holds a share lock until it ends, so a concurrent demotion or account lock
   * serialises with the financial decision.
   */
  findCurrentCapability(userId: string): Promise<ActorCapability | null>;
}
