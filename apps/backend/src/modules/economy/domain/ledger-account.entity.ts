import { randomUUID } from 'crypto';
import {
  canAccountClassOverdraft,
  LedgerAccountClass,
  NON_OVERDRAFTABLE_ACCOUNT_CLASSES,
} from '@rescom/schemas';

export interface LedgerAccountProps {
  id?: string;
  userId?: string | null;
  accountClass: LedgerAccountClass;
  currency?: string;
  balance?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export class LedgerAccountEntity {
  readonly id: string;
  readonly userId: string | null;
  readonly accountClass: LedgerAccountClass;
  readonly currency: string;
  private _balance: number;
  readonly createdAt: Date;
  private _updatedAt: Date;

  constructor(props: LedgerAccountProps) {
    const userId = props.userId ?? null;
    const isSystemAccount = canAccountClassOverdraft(props.accountClass);
    if (isSystemAccount && userId !== null) {
      throw new Error('System ledger accounts cannot belong to a user');
    }
    if (!isSystemAccount && userId === null) {
      throw new Error('User ledger accounts require a userId');
    }
    if (!props.currency?.trim() && props.currency !== undefined) {
      throw new Error('Ledger account currency cannot be empty');
    }

    this.id = props.id ?? randomUUID();
    this.userId = userId;
    this.accountClass = props.accountClass;
    this.currency = props.currency ?? 'POINTS';
    this._balance = props.balance ?? 0;
    this.createdAt = props.createdAt ?? new Date();
    this._updatedAt = props.updatedAt ?? new Date();
  }

  get balance(): number {
    return this._balance;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  canOverdraft(): boolean {
    return canAccountClassOverdraft(this.accountClass);
  }

  isNonOverdraftable(): boolean {
    return (NON_OVERDRAFTABLE_ACCOUNT_CLASSES as readonly string[]).includes(
      this.accountClass,
    );
  }

  wouldOverdraft(delta: number): boolean {
    if (this.canOverdraft()) {
      return false;
    }
    return this._balance + delta < 0;
  }

  applyDelta(delta: number): void {
    if (this.wouldOverdraft(delta)) {
      throw new Error(
        `Account ${this.id} (${this.accountClass}) cannot overdraft. Current balance: ${this._balance}, delta: ${delta}`,
      );
    }
    this._balance += delta;
    this._updatedAt = new Date();
  }

  static create(props: LedgerAccountProps): LedgerAccountEntity {
    return new LedgerAccountEntity(props);
  }
}
