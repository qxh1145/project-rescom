import { User } from '../../../users/domain/user.entity';
import { CreateIdentityAuditRecord } from './identity-audit.port';

export interface ResolveGoogleLoginParams {
  sub: string;
  email: string;
}

export interface ResolveGoogleLoginResult {
  user: User;
  isNewUser: boolean;
}

export interface LinkGoogleIdentityParams {
  userId: string;
  sub: string;
  auditRecord?: CreateIdentityAuditRecord;
}

export interface UnlinkGoogleIdentityParams {
  userId: string;
  auditRecord?: CreateIdentityAuditRecord;
}

export interface OAuthPersistencePort {
  resolveGoogleUser(
    params: ResolveGoogleLoginParams,
  ): Promise<ResolveGoogleLoginResult>;
  linkGoogleIdentity(params: LinkGoogleIdentityParams): Promise<void>;
  unlinkGoogleIdentity(params: UnlinkGoogleIdentityParams): Promise<void>;
  countUserLoginMethods(
    userId: string,
  ): Promise<{ hasPassword: boolean; identityCount: number }>;
}

export const OAUTH_PERSISTENCE_PORT = Symbol('OAuthPersistencePort');
