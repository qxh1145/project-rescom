import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  FinalizeUploadBody,
  finalizeUploadBodySchema,
  initiateUploadInputSchema,
  InitiateUploadInput,
  ListUploadsQuery,
  listUploadsQuerySchema,
} from '@rescom/schemas';
import { StorageService } from '../application/storage.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { OptionalSessionCsrfGuard } from '../../auth/presentation/guards/optional-session-csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { Public } from '../../../common/security/public.decorator';

/** Strict finalize body: only an optional SHA-256 checksum (review P12). */
export const finalizeUploadBodyPipe = new ZodValidationPipe(
  finalizeUploadBodySchema,
);

@Controller(['storage', 'api/storage'])
@UseGuards(SessionAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Initiates direct upload to private storage, returning a presigned URL (AD-22).
   * Guests are admitted; AD-20 CSRF applies (synchronizer token with a
   * session, allowed Origin/Referer without one).
   */
  @Public()
  @Post('uploads/initiate')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalSessionCsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(initiateUploadInputSchema))
  async initiateUpload(
    @Body() input: InitiateUploadInput,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const result = await this.storageService.initiateUpload(
      input,
      user?.id ?? null,
      capability,
    );
    return createSuccessEnvelope(result);
  }

  /**
   * Finalizes direct upload, triggers quarantine and automated malware scanning (AD-22).
   */
  @Public()
  @Post('uploads/:id/finalize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalSessionCsrfGuard, JsonOnlyGuard)
  async finalizeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(finalizeUploadBodyPipe) body: FinalizeUploadBody,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const result = await this.storageService.finalizeUpload(
      id,
      user?.id ?? null,
      body.checksum,
      capability,
    );
    return createSuccessEnvelope(result);
  }

  /**
   * The caller's live uploads of one owner record (optionally one question):
   * lets a runner that lost its local state re-adopt CLEAN files or delete
   * stale ones instead of hitting `STORAGE_QUESTION_FULL` (Phase 7). Same
   * read authorization as status/download.
   */
  @Public()
  @Get('uploads')
  async listUploads(
    @Query(
      new ZodValidationPipe(
        listUploadsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListUploadsQuery,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const objects = await this.storageService.listUploads(
      query,
      user?.id ?? null,
      capability,
    );
    return createSuccessEnvelope({ objects });
  }

  /**
   * Issues a short-lived presigned GET URL for a verified CLEAN object (AD-22).
   */
  @Public()
  @Get('objects/:id/download-url')
  async getDownloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const result = await this.storageService.getDownloadUrl(
      id,
      user?.id ?? null,
      capability,
    );
    return createSuccessEnvelope(result);
  }

  /**
   * Retrieves object technical metadata and scan/quarantine status.
   */
  @Public()
  @Get('objects/:id/status')
  async getObjectStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const result = await this.storageService.getObjectStatus(
      id,
      user?.id ?? null,
      capability,
    );
    return createSuccessEnvelope(result);
  }

  @Public()
  @Delete('objects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OptionalSessionCsrfGuard)
  async deleteObject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    await this.storageService.deleteObject(id, user?.id ?? null, capability);
  }
}
