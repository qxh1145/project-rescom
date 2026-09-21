import { Injectable } from '@nestjs/common';
import { InitiateUploadInput } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import { EnvService } from '../../../common/config/env.service';
import { verifyStorageCapability } from '../../../common/security/storage-capability';
import {
  FileUploadPolicy,
  StorageOwnerAuthorizationPort,
} from '../application/ports/storage-owner-authorization.port';
import {
  StorageInvalidFileException,
  StorageUnauthorizedAccessException,
} from '../application/exceptions/storage.exceptions';

@Injectable()
export class PrismaStorageOwnerAuthorizationService
  implements StorageOwnerAuthorizationPort
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {}

  async authorize(
    ownerContext: string,
    ownerRecordId: string,
    callerUserId: string | null,
    ownerCapability?: string | null,
  ): Promise<void> {
    if (ownerContext === 'participation') {
      const attempt = await this.prisma.surveyAttempt.findUnique({
        where: { id: ownerRecordId },
        select: { respondentId: true, isGuest: true, status: true },
      });
      if (!attempt || attempt.status !== 'IN_PROGRESS') {
        throw new StorageUnauthorizedAccessException();
      }
      const ownsAuthenticatedAttempt =
        Boolean(callerUserId) && attempt.respondentId === callerUserId;
      const ownsGuestAttempt =
        attempt.isGuest &&
        verifyStorageCapability(
          this.envService.jwtSecret,
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
    await this.authorize(
      input.ownerContext,
      input.ownerRecordId,
      callerUserId,
      ownerCapability,
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
    const block = blocks.find((candidate: any) => candidate?.id === input.questionId);
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
}
