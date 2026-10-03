import { Logger } from '@nestjs/common';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { createConnection } from 'net';
import { EnvService } from '../src/common/config/env.service';
import { StorageCleanupService } from '../src/modules/storage/infrastructure/storage-cleanup.service';
import {
  Actor,
  Harness,
  bootHarness,
  internalDraftBody,
  probeDatabase,
} from './fixtures/financial-pg-harness';

/**
 * Story IR.5 C5: the upload flow against the real stack (docker compose
 * `postgres`, `minio`, `minio-init`, `clamav`) instead of the in-memory
 * doubles: presign, private PUT, ClamAV scan, finalize, owner-bound download,
 * and the fail-closed outage paths with their correlated log events.
 *
 *   docker compose up -d postgres minio minio-init clamav
 *   STORAGE_REAL_TEST=1 npx jest --config ./test/jest-e2e.json --runInBand test/file-storage.real
 *
 * Skipped with a warning unless STORAGE_REAL_TEST=1. When it is set, or in CI,
 * an unreachable stack FAILS the suite (same rule as financial-pg-harness).
 * Uses its own scratch database ending in `_test`, never `rescom_db`.
 */
const storageDbUrl =
  process.env.STORAGE_TEST_DATABASE_URL ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_storage_test?schema=public';
const required =
  process.env.STORAGE_REAL_TEST === '1' || Boolean(process.env.CI);

if (!required) {
  console.warn(
    'STORAGE_REAL_TEST is not set: skipping the real MinIO + ClamAV + Postgres upload suite (IR.5 C5).',
  );
}
const describeReal = required ? describe : describe.skip;

// The same defaults the harness EnvService uses (apps/backend/.env.example).
const stackEnv = new EnvService({
  NODE_ENV: 'test',
  DATABASE_URL: storageDbUrl,
  JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
});
const s3 = new S3Client({
  region: stackEnv.storageRegion,
  endpoint: stackEnv.storageEndpoint,
  forcePathStyle: stackEnv.storageForcePathStyle,
  credentials: {
    accessKeyId: stackEnv.storageAccessKeyId,
    secretAccessKey: stackEnv.storageSecretAccessKey,
  },
});

// Standard antivirus test file; every engine detects it, it is harmless.
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const CLOSED_PORT = 1;

function pdf(size = 2048): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write('%PDF-1.7\n');
  return bytes;
}

async function hasObject(key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: stackEnv.storageBucket, Key: key }),
    );
    return true;
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

function clamdPong(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: stackEnv.malwareScannerHost,
      port: stackEnv.malwareScannerPort,
    });
    let reply = '';
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => (reply += chunk.toString()));
    socket.on('error', () => resolve(false));
    socket.on('close', () => resolve(reply.includes('PONG')));
  });
}

/** Creates the `_test` scratch database on first use (bootHarness then migrates it). */
async function ensureScratchDatabase(url: string): Promise<boolean> {
  if (probeDatabase(url)) return true;
  const target = new URL(url);
  const name = target.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) return false;
  target.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: target.href } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    return probeDatabase(url);
  } catch {
    return false;
  } finally {
    await admin.$disconnect();
  }
}

interface Initiated {
  objectId: string;
  uploadUrl: string;
  storageKey: string;
  headers?: Record<string, string>;
}

/** Captures the structured `storage.*` error events StorageService logs. */
function captureStorageEvents() {
  const spy = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  return () =>
    spy.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('{"event":"storage.'))
      .map((message) => JSON.parse(message));
}

describeReal('File storage on the real stack (Story IR.5 C5)', () => {
  beforeAll(async () => {
    const problems: string[] = [];
    if (!(await ensureScratchDatabase(storageDbUrl))) {
      problems.push(`Postgres ${storageDbUrl}`);
    }
    try {
      const health = await fetch(
        `${stackEnv.storageEndpoint}/minio/health/live`,
      );
      if (!health.ok) problems.push('MinIO health');
    } catch {
      problems.push(`MinIO ${stackEnv.storageEndpoint}`);
    }
    if (!(await clamdPong())) {
      problems.push(
        `ClamAV ${stackEnv.malwareScannerHost}:${stackEnv.malwareScannerPort}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `STORAGE_REAL_TEST is set (or CI) but the real stack is unreachable: ${problems.join(', ')}. Run: docker compose up -d postgres minio minio-init clamav`,
      );
    }
  }, 60_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function newForm(h: Harness, owner: Actor): Promise<string> {
    const res = await h.send(
      'post',
      '/forms',
      owner,
      internalDraftBody('IR5 storage'),
    );
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  async function initiate(
    h: Harness,
    owner: Actor,
    formId: string,
    file: { fileName: string; mimeType: string; size: number },
  ): Promise<Initiated> {
    const res = await h.send('post', '/storage/uploads/initiate', owner, {
      fileName: file.fileName,
      fileSize: file.size,
      mimeType: file.mimeType,
      ownerContext: 'forms',
      ownerRecordId: formId,
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  async function putBytes(upload: Initiated, bytes: Buffer): Promise<void> {
    const res = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: new Uint8Array(bytes),
    });
    expect(res.status).toBe(200);
  }

  const finalize = (h: Harness, owner: Actor, objectId: string) =>
    h.send('post', `/storage/uploads/${objectId}/finalize`, owner, {});

  describe('with the real scanner and object store', () => {
    let h: Harness;
    let owner: Actor;
    let other: Actor;

    beforeAll(async () => {
      h = await bootHarness({ databaseUrl: storageDbUrl });
      owner = await h.user('PUBLISHER');
      other = await h.user('PUBLISHER');
    }, 180_000);

    afterAll(async () => {
      if (h) await h.close();
    });

    async function uploadClean(bytes = pdf()) {
      const formId = await newForm(h, owner);
      const upload = await initiate(h, owner, formId, {
        fileName: 'consent.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
      });
      await putBytes(upload, bytes);
      const res = await finalize(h, owner, upload.objectId);
      expect(res.status).toBe(200);
      return { upload, bytes, dto: res.body.data };
    }

    it('C5.1: presign -> PUT -> finalize -> CLEAN, verified/ copy, owner-only download', async () => {
      const { upload, bytes, dto } = await uploadClean();

      expect(dto).toMatchObject({ status: 'CLEAN', scanStatus: 'CLEAN' });
      expect(dto.storageKey.startsWith('verified/')).toBe(true);
      expect(await hasObject(dto.storageKey)).toBe(true);
      // The upload key is not trusted after inspection: it is gone.
      expect(await hasObject(upload.storageKey)).toBe(false);

      const download = await h.get(
        `/storage/objects/${upload.objectId}/download-url`,
        owner,
      );
      expect(download.status).toBe(200);
      const fetched = await fetch(download.body.data.downloadUrl);
      expect(fetched.status).toBe(200);
      expect(Buffer.from(await fetched.arrayBuffer()).equals(bytes)).toBe(true);

      const stranger = await h.get(
        `/storage/objects/${upload.objectId}/download-url`,
        other,
      );
      expect(stranger.status).toBe(403);
      expect(stranger.body.error.code).toBe('STORAGE_UNAUTHORIZED');
    });

    it('C5.2: the EICAR test string is REJECTED and its bytes are deleted', async () => {
      const bytes = Buffer.from(EICAR);
      const formId = await newForm(h, owner);
      const upload = await initiate(h, owner, formId, {
        fileName: 'eicar.txt',
        mimeType: 'text/plain',
        size: bytes.length,
      });
      await putBytes(upload, bytes);

      const res = await finalize(h, owner, upload.objectId);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'REJECTED',
        scanStatus: 'INFECTED',
      });
      expect(await hasObject(upload.storageKey)).toBe(false);
      const download = await h.get(
        `/storage/objects/${upload.objectId}/download-url`,
        owner,
      );
      expect(download.status).toBe(403);
      expect(download.body.error.code).toBe('STORAGE_OBJECT_NOT_CLEAN');
    });

    it('C5.3: the bucket is private (anonymous GET is 403)', async () => {
      const { dto } = await uploadClean();
      const url = `${stackEnv.storageEndpoint}/${stackEnv.storageBucket}/${dto.storageKey}`;

      const anonymous = await fetch(url);

      expect(anonymous.status).toBe(403);
    });

    it('C5.6: storage-cleanup removes an expired INITIATED upload and its bytes', async () => {
      const bytes = pdf();
      const formId = await newForm(h, owner);
      const upload = await initiate(h, owner, formId, {
        fileName: 'abandoned.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
      });
      await putBytes(upload, bytes);
      expect(await hasObject(upload.storageKey)).toBe(true);
      await h.prisma.storedObject.update({
        where: { id: upload.objectId },
        data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const counts = await h.app
        .get(StorageCleanupService, { strict: false })
        .runCleanup();

      expect(counts.failedCount).toBe(0);
      expect(counts.expiredCount).toBeGreaterThanOrEqual(1);
      const row = await h.prisma.storedObject.findUnique({
        where: { id: upload.objectId },
      });
      expect(row?.status).toBe('EXPIRED');
      expect(await hasObject(upload.storageKey)).toBe(false);
    });
  });

  describe('C5.4: scanner outage (config points at a closed port)', () => {
    let h: Harness;
    let owner: Actor;

    beforeAll(async () => {
      h = await bootHarness({
        databaseUrl: storageDbUrl,
        env: { MALWARE_SCANNER_PORT: CLOSED_PORT },
      });
      owner = await h.user('PUBLISHER');
    }, 180_000);

    afterAll(async () => {
      if (h) await h.close();
    });

    it('fails closed: 503, QUARANTINED/OUTAGE, no download, one correlated log event', async () => {
      const events = captureStorageEvents();
      const bytes = pdf();
      const formId = await newForm(h, owner);
      const upload = await initiate(h, owner, formId, {
        fileName: 'scanner-down.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
      });
      await putBytes(upload, bytes);

      const res = await finalize(h, owner, upload.objectId);

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('STORAGE_SCANNER_OUTAGE');
      const requestId = res.headers['x-request-id'];
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.error.requestId).toBe(requestId);
      const row = await h.prisma.storedObject.findUnique({
        where: { id: upload.objectId },
      });
      expect(row).toMatchObject({
        status: 'QUARANTINED',
        scanStatus: 'OUTAGE',
      });
      const download = await h.get(
        `/storage/objects/${upload.objectId}/download-url`,
        owner,
      );
      expect(download.status).toBe(403);
      expect(events()).toEqual([
        {
          event: 'storage.scan_outage',
          objectId: upload.objectId,
          requestId,
          reason: expect.any(String),
        },
      ]);
      expect(JSON.stringify(events())).not.toContain(upload.storageKey);

      // The alertable counter is visible to admins on /system/metrics.
      const admin = await h.user('ADMIN');
      const metrics = await h.get('/system/metrics', admin);
      expect(metrics.status).toBe(200);
      expect(metrics.body.data.storage.outagesSinceBoot).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe('C5.5: storage outage (S3 endpoint is a closed port)', () => {
    let h: Harness;
    let owner: Actor;

    beforeAll(async () => {
      h = await bootHarness({
        databaseUrl: storageDbUrl,
        env: { STORAGE_ENDPOINT: `http://127.0.0.1:${CLOSED_PORT}` },
      });
      owner = await h.user('PUBLISHER');
    }, 180_000);

    afterAll(async () => {
      if (h) await h.close();
    });

    it('fails closed: 503 STORAGE_UNAVAILABLE, row stays INITIATED, correlated log event', async () => {
      const events = captureStorageEvents();
      const formId = await newForm(h, owner);
      // Presigning is local, so initiate works while the store is down.
      const upload = await initiate(h, owner, formId, {
        fileName: 'store-down.pdf',
        mimeType: 'application/pdf',
        size: 2048,
      });

      const res = await finalize(h, owner, upload.objectId);

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
      const requestId = res.headers['x-request-id'];
      expect(res.body.error.requestId).toBe(requestId);
      const row = await h.prisma.storedObject.findUnique({
        where: { id: upload.objectId },
      });
      expect(row).toMatchObject({ status: 'INITIATED', scanStatus: 'PENDING' });
      expect(events()).toEqual([
        {
          event: 'storage.unavailable',
          objectId: upload.objectId,
          requestId,
          reason: expect.any(String),
        },
      ]);
      expect(JSON.stringify(events())).not.toContain(upload.storageKey);
    }, 60_000);
  });
});
