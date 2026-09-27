import { createHmac, timingSafeEqual } from 'crypto';

export function createStorageCapability(
  secret: string,
  attemptId: string,
): string {
  return createHmac('sha256', secret)
    .update(`storage-capability:${attemptId}`)
    .digest('base64url');
}

export function verifyStorageCapability(
  secret: string,
  attemptId: string,
  provided: string | null | undefined,
): boolean {
  if (!provided) return false;
  const expected = createStorageCapability(secret, attemptId);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.byteLength === providedBuffer.byteLength &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
