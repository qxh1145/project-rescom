import { shortCodePrefixOf } from '@rescom/schemas';
import {
  AdminUserDirectoryPort,
  AdminUserLabel,
} from '../application/ports/admin-user-directory.port';
import { UserRepositoryPort } from '../application/ports/user.repository.port';
import { UserProfileRepositoryPort } from '../application/ports/user-profile.repository.port';
import { User, UserStatus } from '../domain/user.entity';

/** Test double of `PrismaAdminUserDirectory` over the user and profile repositories. */
export class InMemoryAdminUserDirectory implements AdminUserDirectoryPort {
  calls = 0;

  constructor(
    private readonly users: UserRepositoryPort,
    private readonly profiles?: Pick<
      UserProfileRepositoryPort,
      'findDisplayLabels'
    >,
  ) {}

  private async usersOf(userIds: readonly string[]): Promise<User[]> {
    const found = await Promise.all(
      [...new Set(userIds)].map((id) => this.users.findById(id)),
    );
    return found.filter((user): user is User => user !== null);
  }

  async findStatuses(
    userIds: readonly string[],
  ): Promise<Map<string, UserStatus>> {
    this.calls += 1;
    return new Map(
      (await this.usersOf(userIds)).map((user) => [user.id, user.status]),
    );
  }

  async findLabels(
    userIds: readonly string[],
  ): Promise<Map<string, AdminUserLabel>> {
    this.calls += 1;
    const users = await this.usersOf(userIds);
    const names =
      (await this.profiles?.findDisplayLabels(users.map((user) => user.id))) ??
      new Map<string, string | null>();
    return new Map(
      users.map((user) => [
        user.id,
        { email: user.email, displayName: names.get(user.id) ?? null },
      ]),
    );
  }

  async filterMatching(
    term: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    this.calls += 1;
    const needle = term.trim().toLowerCase();
    const code = shortCodePrefixOf(term);
    const labels = await this.findLabels(userIds);
    return [...new Set(userIds)].filter((id) => {
      const label = labels.get(id);
      if (!label) return false;
      return (
        label.email.toLowerCase().includes(needle) ||
        (label.displayName?.toLowerCase().includes(needle) ?? false) ||
        (code !== null && id.replace(/-/g, '').startsWith(code))
      );
    });
  }
}
