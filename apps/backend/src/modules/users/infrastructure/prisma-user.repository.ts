import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  UserRepositoryPort,
  CreateUserData,
  ListUsersParams,
  PaginatedUsersResult,
} from '../application/ports/user.repository.port';
import { User, UserRole, UserStatus } from '../domain/user.entity';
import { EmailAlreadyRegisteredException } from '../../auth/application/exceptions/auth.exceptions';

@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    const raw = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!raw) return null;
    return new User({
      id: raw.id,
      email: raw.email,
      passwordHash: raw.passwordHash,
      role: raw.role as UserRole,
      status: raw.status as UserStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  async findById(id: string): Promise<User | null> {
    if (!id || typeof id !== 'string') return null;
    const raw = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!raw) return null;
    return new User({
      id: raw.id,
      email: raw.email,
      passwordHash: raw.passwordHash,
      role: raw.role as UserRole,
      status: raw.status as UserStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  async create(data: CreateUserData): Promise<User> {
    try {
      const raw = await this.prisma.user.create({
        data: {
          id: data.id,
          email: data.email.trim().toLowerCase(),
          passwordHash: data.passwordHash,
          role: data.role ?? 'RESPONDENT',
          status: data.status ?? 'ACTIVE',
        },
      });
      return new User({
        id: raw.id,
        email: raw.email,
        passwordHash: raw.passwordHash,
        role: raw.role as UserRole,
        status: raw.status as UserStatus,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new EmailAlreadyRegisteredException();
      }
      throw error;
    }
  }

  async findMany(params: ListUsersParams): Promise<PaginatedUsersResult> {
    const { page, limit, search, role, status } = params;
    const skip = (page - 1) * limit;
    const take = limit;

    const where: any = {};
    if (search && search.trim().length > 0) {
      where.email = { contains: search.trim(), mode: 'insensitive' };
    }
    if (role) {
      where.role = role;
    }
    if (status) {
      where.status = status;
    }

    const [rawUsers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.user.count({ where }),
    ]);

    const users = rawUsers.map(
      (raw) =>
        new User({
          id: raw.id,
          email: raw.email,
          passwordHash: raw.passwordHash,
          role: raw.role as UserRole,
          status: raw.status as UserStatus,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        }),
    );

    return { users, total };
  }

  async countByRoleAndStatus(
    role: UserRole,
    status: UserStatus,
  ): Promise<number> {
    return await this.prisma.user.count({
      where: { role, status },
    });
  }
}
