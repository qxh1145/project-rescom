export const PUBLISHER_DIRECTORY_PORT = Symbol('PUBLISHER_DIRECTORY_PORT');

/**
 * Read-only Identity projection the moderation queue needs to show who
 * submitted a survey. Moderation never writes Identity records (AD-16).
 */
export interface PublisherDirectoryPort {
  /** Email per known user id; unknown ids are simply absent from the map. */
  findEmails(userIds: readonly string[]): Promise<Map<string, string>>;
}
