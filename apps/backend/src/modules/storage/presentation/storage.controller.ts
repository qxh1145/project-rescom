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
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  initiateUploadInputSchema,
  InitiateUploadInput,
  finalizeUploadInputSchema,
} from '@rescom/schemas';
import { StorageService } from '../application/storage.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { Public } from '../../../common/security/public.decorator';
import { StorageInvalidFileException } from '../application/exceptions/storage.exceptions';

@Controller(['storage', 'api/storage'])
@UseGuards(SessionAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Initiates direct upload to private storage, returning a presigned URL (AD-22).
   */
  @Public()
  @Post('uploads/initiate')
  @HttpCode(HttpStatus.CREATED)
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
  async finalizeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const parsed = finalizeUploadInputSchema.safeParse({
      objectId: id,
      checksum: body?.checksum,
    });
    if (!parsed.success) {
      throw new StorageInvalidFileException(
        parsed.error.issues[0]?.message || 'Invalid finalize payload.',
      );
    }
    const checksum = parsed.data.checksum;

    const result = await this.storageService.finalizeUpload(
      id,
      user?.id ?? null,
      checksum,
      capability,
    );
    return createSuccessEnvelope(result);
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
  async deleteObject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | null,
    @Headers('x-storage-capability') capability?: string,
  ) {
    await this.storageService.deleteObject(id, user?.id ?? null, capability);
  }
}
