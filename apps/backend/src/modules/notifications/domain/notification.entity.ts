import { randomUUID } from 'crypto';
import { NotificationDto, NotificationType } from '@rescom/schemas';

export interface NotificationProps {
  id?: string;
  userId: string;
  type: NotificationType;
  message: string;
  isRead?: boolean;
  readAt?: Date | null;
  dedupeKey?: string | null;
  createdAt?: Date;
}

/**
 * In-app notification owned by the Notifications context (FR-57).
 * Read state is the only mutable part; content is fixed at creation.
 */
export class NotificationEntity {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly message: string;
  readonly isRead: boolean;
  readonly readAt: Date | null;
  readonly dedupeKey: string | null;
  readonly createdAt: Date;

  constructor(props: NotificationProps) {
    this.id = props.id ?? randomUUID();
    this.userId = props.userId;
    this.type = props.type;
    this.message = props.message;
    this.isRead = props.isRead ?? false;
    this.readAt = props.readAt ?? null;
    this.dedupeKey = props.dedupeKey ?? null;
    this.createdAt = props.createdAt ?? new Date();
  }

  /** Returns a read copy; an already-read notification keeps its original readAt. */
  markRead(readAt: Date): NotificationEntity {
    if (this.isRead) {
      return this;
    }
    return new NotificationEntity({ ...this, isRead: true, readAt });
  }

  toDto(): NotificationDto {
    return {
      id: this.id,
      type: this.type,
      message: this.message,
      isRead: this.isRead,
      createdAt: this.createdAt.toISOString(),
      readAt: this.readAt ? this.readAt.toISOString() : null,
    };
  }
}
