import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import {
  finalizeUploadBodyPipe,
  StorageController,
} from './storage.controller';
import { StorageService } from '../application/storage.service';
import { InMemoryObjectStorageService } from '../infrastructure/in-memory-object-storage.service';
import { InMemoryStorageRepository } from '../infrastructure/in-memory-storage.repository';
import { StubMalwareScannerService } from '../infrastructure/stub-malware-scanner.service';
import { STORAGE_REPOSITORY_PORT } from '../application/ports/storage-repository.port';
import { OBJECT_STORAGE_PORT } from '../application/ports/object-storage.port';
import { MALWARE_SCANNER_PORT } from '../application/ports/malware-scanner.port';
import { SessionService } from '../../auth/application/session.service';
import { EnvService } from '../../../common/config/env.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { OptionalSessionCsrfGuard } from '../../auth/presentation/guards/optional-session-csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import {
  ForbiddenOriginException,
  InvalidCsrfTokenException,
} from '../../auth/application/exceptions/auth.exceptions';

describe('StorageController', () => {
  let controller: StorageController;
  let service: StorageService;
  let s3Service: InMemoryObjectStorageService;

  const validRecordId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    const repository = new InMemoryStorageRepository();
    s3Service = new InMemoryObjectStorageService();
    const malwareScanner = new StubMalwareScannerService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: STORAGE_REPOSITORY_PORT,
          useValue: repository,
        },
        {
          provide: OBJECT_STORAGE_PORT,
          useValue: s3Service,
        },
        {
          provide: MALWARE_SCANNER_PORT,
          useValue: malwareScanner,
        },
        {
          provide: SessionService,
          useValue: {
            validateSession: jest.fn(),
          },
        },
        {
          provide: EnvService,
          useValue: {
            jwtSecret: 'test-secret',
          },
        },
        {
          provide: StorageService,
          useFactory: () =>
            new StorageService(repository, s3Service, malwareScanner),
        },
      ],
    })
      .overrideGuard(OptionalSessionCsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StorageController>(StorageController);
    service = module.get<StorageService>(StorageService);
  });

  function putObject(
    storageKey: string,
    size: number,
    mimeType: 'application/pdf' | 'image/png',
  ): void {
    const bytes = Buffer.alloc(size);
    if (mimeType === 'application/pdf') bytes.write('%PDF-1.7');
    else Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bytes);
    s3Service.putObject('rescom-private-storage', storageKey, bytes, mimeType);
  }

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should initiate upload and wrap in standard success envelope', async () => {
    const res = await controller.initiateUpload(
      {
        fileName: 'passport.jpg',
        fileSize: 1024 * 300,
        mimeType: 'image/jpeg',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
        questionId: 'upload-1',
      },
      null,
    );

    expect(res.data).toBeDefined();
    expect(res.data!.objectId).toBeDefined();
    expect(res.data!.uploadUrl).toBeDefined();
    expect(res.data!.storageKey).toContain(validRecordId);
  });

  it('should finalize upload and return verified clean object DTO', async () => {
    const init = await service.initiateUpload({
      fileName: 'answers_sheet.pdf',
      fileSize: 1024 * 150,
      mimeType: 'application/pdf',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
      questionId: 'upload-1',
    });
    putObject(init.storageKey, 1024 * 150, 'application/pdf');

    const res = await controller.finalizeUpload(init.objectId, {}, null);
    expect(res.data).toBeDefined();
    expect(res.data!.status).toBe('CLEAN');
    expect(res.data!.scanStatus).toBe('CLEAN');
  });

  it('should return download URL for clean object', async () => {
    const init = await service.initiateUpload({
      fileName: 'verified.png',
      fileSize: 1024 * 50,
      mimeType: 'image/png',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
      questionId: 'upload-1',
    });
    putObject(init.storageKey, 1024 * 50, 'image/png');

    await service.finalizeUpload(init.objectId);

    const res = await controller.getDownloadUrl(init.objectId, null);
    expect(res.data).toBeDefined();
    expect(res.data!.downloadUrl).toBeDefined();
    expect(res.data!.fileName).toBe('verified.png');
  });

  it('should get object status metadata', async () => {
    const init = await service.initiateUpload({
      fileName: 'status_check.pdf',
      fileSize: 1024 * 50,
      mimeType: 'application/pdf',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
      questionId: 'upload-1',
    });

    const res = await controller.getObjectStatus(init.objectId, null);
    expect(res.data).toBeDefined();
    expect(res.data!.id).toBe(init.objectId);
    expect(res.data!.status).toBe('INITIATED');
  });

  describe('AD-20 CSRF wiring (review P12)', () => {
    const guardsOf = (method: keyof StorageController) =>
      Reflect.getMetadata(GUARDS_METADATA, StorageController.prototype[method]);

    it('guards every mutation and leaves the reads alone', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, StorageController)).toEqual([
        SessionAuthGuard,
      ]);
      expect(guardsOf('initiateUpload')).toEqual([
        OptionalSessionCsrfGuard,
        JsonOnlyGuard,
      ]);
      expect(guardsOf('finalizeUpload')).toEqual([
        OptionalSessionCsrfGuard,
        JsonOnlyGuard,
      ]);
      expect(guardsOf('deleteObject')).toEqual([OptionalSessionCsrfGuard]);
      expect(guardsOf('getDownloadUrl')).toBeUndefined();
      expect(guardsOf('getObjectStatus')).toBeUndefined();
    });

    function httpContext(request: Record<string, unknown>): ExecutionContext {
      return {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
    }

    function realGuard(tokenIsValid: boolean): OptionalSessionCsrfGuard {
      return new OptionalSessionCsrfGuard(
        { frontendOrigins: ['http://localhost:3000'] } as EnvService,
        { verifyCsrfToken: jest.fn().mockReturnValue(tokenIsValid) } as any,
      );
    }

    it('rejects a session request without the synchronizer token (403)', () => {
      const request = {
        headers: { origin: 'http://localhost:3000' },
        session: { csrfDigest: 'digest' },
      };
      expect(() => realGuard(false).canActivate(httpContext(request))).toThrow(
        InvalidCsrfTokenException,
      );
      expect(
        realGuard(true).canActivate(
          httpContext({
            ...request,
            headers: { ...request.headers, 'x-csrf-token': 'token' },
          }),
        ),
      ).toBe(true);
    });

    it('rejects a guest request without an allowed Origin (403)', () => {
      expect(() =>
        realGuard(true).canActivate(httpContext({ headers: {} })),
      ).toThrow(ForbiddenOriginException);
      expect(() =>
        realGuard(true).canActivate(
          httpContext({ headers: { origin: 'https://evil.example' } }),
        ),
      ).toThrow(ForbiddenOriginException);
      expect(
        realGuard(true).canActivate(
          httpContext({ headers: { origin: 'http://localhost:3000' } }),
        ),
      ).toBe(true);
    });
  });

  describe('finalize body validation (review P12)', () => {
    it('binds the strict body pipe to the finalize body only', () => {
      const routeArgs = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        StorageController,
        'finalizeUpload',
      ) as Record<string, { index: number; pipes?: unknown[] }>;
      const withBodyPipe = Object.values(routeArgs).filter((arg) =>
        arg.pipes?.includes(finalizeUploadBodyPipe),
      );
      expect(withBodyPipe.map((arg) => arg.index)).toEqual([1]);
    });

    it.each([{ status: 'CLEAN' }, { checksum: 'not-a-sha256' }, undefined])(
      'rejects %p with a 400 VALIDATION_ERROR',
      (body) => {
        let caught: unknown;
        try {
          finalizeUploadBodyPipe.transform(body, { type: 'body' });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(BadRequestException);
        expect((caught as BadRequestException).getResponse()).toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      },
    );

    it('accepts an empty body or a SHA-256 checksum', () => {
      expect(finalizeUploadBodyPipe.transform({}, { type: 'body' })).toEqual(
        {},
      );
      const checksum = 'a'.repeat(64);
      expect(
        finalizeUploadBodyPipe.transform({ checksum }, { type: 'body' }),
      ).toEqual({ checksum });
    });
  });
});
