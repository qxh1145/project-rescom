import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import { PublisherDirectoryPort } from '../application/ports/publisher-directory.port';

/**
 * Publisher lookup backed by Identity's exposed user repository port
 * (read-only). The queue page is small (≤ 50 items), so one lookup per
 * distinct publisher is acceptable.
 */
export class UserPublisherDirectory implements PublisherDirectoryPort {
  constructor(private readonly users: UserRepositoryPort) {}

  async findEmails(userIds: readonly string[]): Promise<Map<string, string>> {
    const emails = new Map<string, string>();
    for (const userId of new Set(userIds)) {
      const user = await this.users.findById(userId);
      if (user) {
        emails.set(user.id, user.email);
      }
    }
    return emails;
  }
}
