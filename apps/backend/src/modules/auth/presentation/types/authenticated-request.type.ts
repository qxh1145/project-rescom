import { Request } from 'express';
import { UserRole, UserStatus } from '../../../users/domain/user.entity';
import { Session } from '../../domain/session.entity';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  session: Session;
}
