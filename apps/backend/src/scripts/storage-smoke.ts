/**
 * Story 11.1 AC 7: presigned upload + download round trip through the real
 * storage adapter, against whatever S3 endpoint the STORAGE_* env names
 * (local MinIO, Google Cloud Storage interop, later FPT/R2 in Story 11.6).
 * Only env changes between providers, never code.
 *
 *   npx ts-node src/scripts/storage-smoke.ts                    # from apps/backend
 *   node dist/apps/backend/src/scripts/storage-smoke.js         # inside the image
 *
 * Writes, reads and deletes one small object under `smoke/`. Exit code 0 = pass.
 * CORS is not exercised (browser-only); check it from the frontend origin.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { createHash, randomUUID } from 'crypto';
import { EnvService } from '../common/config/env.service';
import { S3ObjectStorageService } from '../modules/storage/infrastructure/s3-object-storage.service';

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

async function main(): Promise<void> {
  const env = new EnvService();
  const storage = new S3ObjectStorageService(env);
  const bucket = env.storageBucket;
  const key = `smoke/${randomUUID()}.txt`;
  const body = new TextEncoder().encode(
    `rescom storage smoke ${new Date().toISOString()}`,
  );

  const { uploadUrl, headers } = await storage.generateUploadUrl(
    bucket,
    key,
    'text/plain',
    300,
  );
  const checksumParams = [...new URL(uploadUrl).searchParams.keys()].filter(
    (name) => name.toLowerCase().includes('checksum'),
  );
  console.log(`endpoint=${env.storageEndpoint} bucket=${bucket} key=${key}`);
  console.log(
    `presigned PUT checksum params: ${checksumParams.length ? checksumParams.join(',') : 'none'}`,
  );

  try {
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body });
    console.log(`PUT ${put.status}`);
    if (!put.ok)
      throw new Error(`upload failed: ${put.status} ${await put.text()}`);

    const downloadUrl = await storage.generateDownloadUrl(
      bucket,
      key,
      'smoke.txt',
      300,
    );
    const get = await fetch(downloadUrl);
    const downloaded = new Uint8Array(await get.arrayBuffer());
    console.log(
      `GET ${get.status} sha256 match=${sha256(downloaded) === sha256(body)}`,
    );
    if (!get.ok || sha256(downloaded) !== sha256(body))
      throw new Error('download mismatch');
    if (checksumParams.length)
      throw new Error('presigned PUT carries an SDK checksum');
  } finally {
    await storage.deleteObject(bucket, key).catch(() => undefined);
  }
  console.log('STORAGE SMOKE PASS');
}

main().catch((error) => {
  console.error(
    `STORAGE SMOKE FAIL: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
