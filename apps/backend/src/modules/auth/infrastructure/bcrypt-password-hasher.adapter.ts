import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PasswordHasherPort } from '../application/ports/password-hasher.port';
import { EnvService } from '../../../common/config/env.service';

@Injectable()
export class BcryptPasswordHasherAdapter implements PasswordHasherPort {
  private static readonly DUMMY_PASSWORD = 'dummy-password-for-timing-only';
  private readonly dummyHash: string;

  constructor(private readonly envService: EnvService) {
    this.dummyHash = bcrypt.hashSync(
      BcryptPasswordHasherAdapter.DUMMY_PASSWORD,
      this.envService.bcryptRounds,
    );
  }

  async hash(password: string): Promise<string> {
    const rounds = this.envService.bcryptRounds;
    return bcrypt.hash(password, rounds);
  }

  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async compareDummy(password: string): Promise<boolean> {
    await bcrypt.compare(password, this.dummyHash);
    return false;
  }
}
