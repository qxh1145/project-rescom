import { ConflictException } from '@nestjs/common';
import {
  ListPublishedSurveysQuery,
  PublishedSurveyPage,
  SurveyPinResult,
} from '@rescom/schemas';
import type { PublishedFormAdminPort } from '../../forms/application/ports/published-form-admin.port';
import type { AdminUserDirectoryPort } from '../../users/application/ports/admin-user-directory.port';
import type { AuditLogRepositoryPort } from './ports/audit-log-repository.port';
import { FormNotFoundException } from '../../forms/application/exceptions/form.exceptions';

export interface AdminPublishedSurveysDependencies {
  forms: PublishedFormAdminPort;
  directory: Pick<AdminUserDirectoryPort, 'findLabels'>;
  audit: Pick<AuditLogRepositoryPort, 'append'>;
}

/**
 * Admin "Đã đăng" tab: PUBLISHED surveys and the Marketplace pin toggle.
 * Pinning needs a PUBLISHED survey; unpinning works in any status so a closed
 * survey can still be cleared. Each change is written to the audit log.
 */
export class AdminPublishedSurveysService {
  constructor(private readonly deps: AdminPublishedSurveysDependencies) {}

  async list(query: ListPublishedSurveysQuery): Promise<PublishedSurveyPage> {
    const page = await this.deps.forms.listPublished({
      limit: query.limit,
      offset: query.offset,
      search: query.search || undefined,
    });
    const labels =
      page.items.length > 0
        ? await this.deps.directory.findLabels([
            ...new Set(page.items.map((item) => item.publisherId)),
          ])
        : new Map();
    return {
      items: page.items.map((item) => ({
        formId: item.formId,
        title: item.title,
        publisherEmail: labels.get(item.publisherId)?.email ?? null,
        updatedAt: item.updatedAt.toISOString(),
        isPinned: item.isPinned,
      })),
      total: page.total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + page.items.length < page.total,
    };
  }

  async setPinned(
    adminId: string,
    formId: string,
    pinned: boolean,
  ): Promise<SurveyPinResult> {
    const status = await this.deps.forms.findStatus(formId);
    if (!status) throw new FormNotFoundException(formId);
    if (pinned && status !== 'PUBLISHED') {
      throw new ConflictException({
        code: 'SURVEY_NOT_PUBLISHED',
        message: `Only a PUBLISHED survey can be pinned (status ${status}).`,
      });
    }
    await this.deps.forms.setPinned(formId, pinned);
    await this.deps.audit.append({
      action: pinned ? 'SURVEY_PINNED' : 'SURVEY_UNPINNED',
      userId: adminId,
      outcome: 'SUCCESS',
      metadata: { formId },
    });
    return { formId, isPinned: pinned };
  }
}
