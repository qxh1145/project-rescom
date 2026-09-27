import { randomUUID } from 'crypto';
import { LedgerEntryEntity } from './ledger-entry.entity';

export interface LedgerJournalProps {
  id?: string;
  idempotencyKey: string;
  description?: string | null;
  reversesJournalId?: string | null;
  createdAt?: Date;
  entries?: LedgerEntryEntity[];
}

export class LedgerJournalEntity {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly description: string | null;
  readonly reversesJournalId: string | null;
  readonly createdAt: Date;
  private _entries: LedgerEntryEntity[];

  constructor(props: LedgerJournalProps) {
    this.id = props.id ?? randomUUID();
    this.idempotencyKey = props.idempotencyKey;
    this.description = props.description ?? null;
    this.reversesJournalId = props.reversesJournalId ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this._entries = props.entries ? [...props.entries] : [];
  }

  get entries(): readonly LedgerEntryEntity[] {
    return this._entries;
  }

  setEntries(entries: LedgerEntryEntity[]): void {
    this._entries = [...entries];
  }

  isBalanced(): boolean {
    if (this._entries.length < 2) {
      return false;
    }
    const sum = this._entries.reduce((acc, entry) => acc + entry.amount, 0);
    return sum === 0;
  }

  isReversal(): boolean {
    return this.reversesJournalId !== null;
  }

  /**
   * Generates exact opposite negation entries for reversing this journal.
   */
  createNegationEntries(newJournalId: string): LedgerEntryEntity[] {
    return this._entries.map((entry) =>
      LedgerEntryEntity.create({
        journalId: newJournalId,
        accountId: entry.accountId,
        amount: -entry.amount,
      }),
    );
  }

  static create(props: LedgerJournalProps): LedgerJournalEntity {
    return new LedgerJournalEntity(props);
  }
}
