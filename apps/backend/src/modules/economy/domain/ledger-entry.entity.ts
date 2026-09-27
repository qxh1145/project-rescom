import { randomUUID } from 'crypto';
import {
  POSTGRES_INTEGER_MAX,
  REVERSIBLE_LEDGER_AMOUNT_MIN,
} from '@rescom/schemas';

export interface LedgerEntryProps {
  id?: string;
  journalId: string;
  accountId: string;
  amount: number;
  createdAt?: Date;
}

export class LedgerEntryEntity {
  readonly id: string;
  readonly journalId: string;
  readonly accountId: string;
  readonly amount: number;
  readonly createdAt: Date;

  constructor(props: LedgerEntryProps) {
    if (
      !Number.isInteger(props.amount) ||
      props.amount === 0 ||
      props.amount < REVERSIBLE_LEDGER_AMOUNT_MIN ||
      props.amount > POSTGRES_INTEGER_MAX
    ) {
      throw new Error(
        `Ledger entry amount must be a non-zero reversible PostgreSQL integer (${REVERSIBLE_LEDGER_AMOUNT_MIN}..${POSTGRES_INTEGER_MAX})`,
      );
    }
    this.id = props.id ?? randomUUID();
    this.journalId = props.journalId;
    this.accountId = props.accountId;
    this.amount = props.amount;
    this.createdAt = props.createdAt ?? new Date();
  }

  static create(props: LedgerEntryProps): LedgerEntryEntity {
    return new LedgerEntryEntity(props);
  }
}
