import { User } from '../../domain/user.entity';

export interface CreateUserData {
  id?: string;
  email: string;
  passwordHash: string | null;
  role?: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT';
  status?: 'ACTIVE' | 'LOCKED';
}

export interface UserRepositoryPort {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
}

export const USER_REPOSITORY_PORT = Symbol('UserRepositoryPort');
