import { Injectable } from '@nestjs/common';
import { InitiateUploadInput, RESERVATION_EXPIRY_MS } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import { EnvService } from '../../../common/config/env.service';
import { verifyStorageCapability } from '../../../common/security/storage-capability';
import {
  FileUploadPolicy,
  StorageAccess,
  StorageOwnerAuthorizationPort,
} from '../application/ports/storage-owner-authorization.port';
import {
  StorageInvalidFileException,
  StorageUnauthorizedAccessException,
} from '../application/exceptions/storage.exceptions';

@Injectable()
export class PrismaStorageOwnerAuthorizationService implements StorageOwnerAuthorizationPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {}

  async authorize(
    ownerContext: string,
    ownerRecordId: string,
    callerUserId: string | null,
    ownerCapability: string | null | undefined,
    access: StorageAccess,
  ): Promise<void> {
    if (ownerContext === 'participation') {
      const attempt = await this.prisma.surveyAttempt.findUnique({
        where: { id: ownerRecordId },
        select: {
          respondentId: true,
          isGuest: true,
          status: true,
          startedAt: true,
        },
      });
      if (!attempt || !this.attemptAllows(attempt, access)) {
        throw new StorageUnauthorizedAccessException();
      }
      const ownsAuthenticatedAttempt =
        Boolean(callerUserId) && attempt.respondentId === callerUserId;
      const ownsGuestAttempt =
        attempt.isGuest &&
        verifyStorageCapability(
          this.envService.storageCapabilitySecret,
          ownerRecordId,
          ownerCapability,
        );
      if (!ownsAuthenticatedAttempt && !ownsGuestAttempt) {
        throw new StorageUnauthorizedAccessException();
      }
      return;
    }

    if (!callerUserId) throw new StorageUnauthorizedAccessException();
    const form = await this.prisma.form.findUnique({
      where: { id: ownerRecordId },
      select: { publisherId: true },
    });
    if (!form || form.publisherId !== callerUserId) {
      throw new StorageUnauthorizedAccessException();
    }
  }

  async resolveUploadPolicy(
    input: InitiateUploadInput,
    callerUserId: string | null,
    ownerCapability?: string | null,
  ): Promise<FileUploadPolicy> {
    // Defence in depth for the schema rule: a participation upload must name
    // the file-upload question whose policy it is bound to (Epic 5 review P4).
    if (input.ownerContext === 'participation' && !input.questionId) {
      throw new StorageInvalidFileException('questionId is required');
    }
    await this.authorize(
      input.ownerContext,
      input.ownerRecordId,
      callerUserId,
      ownerCapability,
      'write',
    );

    if (!input.questionId) {
      return {
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedMimeTypes: [],
        maxFiles: 1,
      };
    }

    let schemaJson: unknown;
    if (input.ownerContext === 'participation') {
      const attempt = await this.prisma.surveyAttempt.findUnique({
        where: { id: input.ownerRecordId },
        select: { version: { select: { schemaJson: true } } },
      });
      schemaJson = attempt?.version?.schemaJson;
    } else {
      const form = await this.prisma.form.findUnique({
        where: { id: input.ownerRecordId },
        select: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: { schemaJson: true },
          },
        },
      });
      schemaJson = form?.versions?.[0]?.schemaJson;
    }

    const blocks =
      schemaJson &&
      typeof schemaJson === 'object' &&
      Array.isArray((schemaJson as any).blocks)
        ? (schemaJson as any).blocks
        : [];
    const block = blocks.find(
      (candidate: any) => candidate?.id === input.questionId,
    );
    if (!block || block.type !== 'file_upload') {
      throw new StorageInvalidFileException(
        'The requested question is not a file-upload block in the pinned form version.',
      );
    }

    return {
      maxFileSizeBytes: Math.min(block.maxFileSizeMb ?? 10, 50) * 1024 * 1024,
      allowedMimeTypes: Array.isArray(block.allowedMimeTypes)
        ? block.allowedMimeTypes
        : [],
      maxFiles: block.maxFiles ?? 1,
    };
  }

  /**
   * Writes need a live reservation (IN_PROGRESS and not past the reservation
   * window, even before the expiry sweep abandons it); reads also admit the
   * COMPLETED attempt so its owner can still see an ATTACHED file.
   */
  private attemptAllows(
    attempt: { status: string; startedAt: Date },
    access: StorageAccess,
  ): boolean {
    if (access === 'read') {
      return attempt.status === 'IN_PROGRESS' || attempt.status === 'COMPLETED';
    }
    return (
      attempt.status === 'IN_PROGRESS' &&
      attempt.startedAt.getTime() >= Date.now() - RESERVATION_EXPIRY_MS
    );
  }
}
