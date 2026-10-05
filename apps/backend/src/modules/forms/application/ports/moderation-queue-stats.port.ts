/**
 * Forms-owned counters for the Admin overview (Story IR.4b part C, AD-16):
 * the Admin context reads the moderation queue through this port, never
 * through the Forms repository (which loads every version per form).
 */
export const MODERATION_QUEUE_STATS_PORT = Symbol(
  'MODERATION_QUEUE_STATS_PORT',
);

export interface QueuedFormSummary {
  formId: string;
  title: string;
  type: 'INTERNAL' | 'EXTERNAL';
  publisherId: string;
  /** When the survey entered the queue (`forms.updated_at`, the queue order). */
  submittedAt: Date;
}

export interface ModerationQueueStatsPort {
  /** Forms in `MODERATION_QUEUE` and in `PUBLISHED`, in one grouped count. */
  countByStatus(): Promise<{ queued: number; published: number }>;
  /** Oldest form of the moderation queue (same order as the queue list). */
  oldestQueued(): Promise<QueuedFormSummary | null>;
}
