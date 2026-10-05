import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestId } from './request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Story IR.5 C1: every request carries a correlation id, echoed in the
 * `X-Request-Id` response header and the error envelope. A caller-supplied id
 * is honoured only when it is a well-formed UUID (it ends up in logs), else a
 * fresh one is generated.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && UUID_PATTERN.test(inbound)
      ? inbound.toLowerCase()
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestId(requestId, next);
}
