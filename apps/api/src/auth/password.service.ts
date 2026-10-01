import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Burn equivalent time for unknown users so login timing does not reveal account existence. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', OPTIONS);
    await this.verify(await this.dummyHash, password);
  }
}
