import { User, UserRole, UserStatus } from '../../domain/user.entity';

export interface CreateUserData {
  id?: string;
  email: string;
  passwordHash: string | null;
  role?: UserRole;
  status?: UserStatus;
}

export interface ListUsersParams {
  page: number;
  limit: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface PaginatedUsersResult {
  users: User[];
  total: number;
}

export interface UserRepositoryPort {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  findMany(params: ListUsersParams): Promise<PaginatedUsersResult>;
  countByRoleAndStatus(role: UserRole, status: UserStatus): Promise<number>;
}

export const USER_REPOSITORY_PORT = Symbol('UserRepositoryPort');
