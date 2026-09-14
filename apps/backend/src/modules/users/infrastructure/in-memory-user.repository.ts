import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  UserRepositoryPort,
  CreateUserData,
  ListUsersParams,
  PaginatedUsersResult,
} from '../application/ports/user.repository.port';
import { User, UserRole, UserStatus } from '../domain/user.entity';

import { EmailAlreadyRegisteredException } from '../../auth/application/exceptions/auth.exceptions';

@Injectable()
export class InMemoryUserRepository implements UserRepositoryPort {
  private users: Map<string, User> = new Map();

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(data: CreateUserData): Promise<User> {
    const normalized = data.email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) {
        throw new EmailAlreadyRegisteredException();
      }
    }

    const id = data.id ?? crypto.randomUUID();
    const newUser = new User({
      id,
      email: normalized,
      passwordHash: data.passwordHash,
      role: (data.role as UserRole) ?? 'RESPONDENT',
      status: (data.status as UserStatus) ?? 'ACTIVE',
    });
    this.users.set(id, newUser);
    return newUser;
  }

  async findMany(params: ListUsersParams): Promise<PaginatedUsersResult> {
    const { page, limit, search, role, status } = params;
    let list = Array.from(this.users.values());

    if (search && search.trim().length > 0) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) => u.email.toLowerCase().includes(q));
    }
    if (role) {
      list = list.filter((u) => u.role === role);
    }
    if (status) {
      list = list.filter((u) => u.status === status);
    }

    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = list.length;
    const skip = (page - 1) * limit;
    const users = list.slice(skip, skip + limit);

    return { users, total };
  }

  async countByRoleAndStatus(
    role: UserRole,
    status: UserStatus,
  ): Promise<number> {
    let count = 0;
    for (const u of this.users.values()) {
      if (u.role === role && u.status === status) {
        count++;
      }
    }
    return count;
  }

  save(user: User): void {
    this.users.set(user.id, user);
  }

  clear() {
    this.users.clear();
  }
}
