export type UserRole = 'ADMIN' | 'PUBLISHER' | 'RESPONDENT';
export type UserStatus = 'ACTIVE' | 'LOCKED';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export class User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.role = props.role;
    this.status = props.status;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  isLocked(): boolean {
    return this.status === 'LOCKED';
  }

  hasPassword(): boolean {
    return this.passwordHash !== null && this.passwordHash.length > 0;
  }
}
