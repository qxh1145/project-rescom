import { randomUUID } from 'crypto';

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
    if (props.amount === 0) {
      throw new Error('Ledger entry amount cannot be zero');
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
