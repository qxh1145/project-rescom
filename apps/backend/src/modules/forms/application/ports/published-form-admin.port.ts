import type { FormStatusEnum } from '@rescom/schemas';

/**
 * Forms-owned access for the admin "Đã đăng" tab (AD-16): list PUBLISHED
 * surveys and set `forms.is_pinned` (Marketplace lists pinned surveys first).
 */
export const PUBLISHED_FORM_ADMIN_PORT = Symbol('PUBLISHED_FORM_ADMIN_PORT');

export interface PublishedFormSummary {
  formId: string;
  title: string;
  publisherId: string;
  updatedAt: Date;
  isPinned: boolean;
}

export interface PublishedFormAdminPort {
  /** PUBLISHED surveys, pinned first, then most recently updated. */
  listPublished(params: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<{ items: PublishedFormSummary[]; total: number }>;
  findStatus(formId: string): Promise<FormStatusEnum | null>;
  setPinned(formId: string, pinned: boolean): Promise<void>;
}
