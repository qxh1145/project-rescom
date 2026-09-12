import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  UserRepositoryPort,
  CreateUserData,
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

  clear() {
    this.users.clear();
  }
}
