export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
  compareDummy(password: string): Promise<boolean>;
}

export const PASSWORD_HASHER_PORT = Symbol('PasswordHasherPort');
