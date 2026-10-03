import { currentRequestId } from './request-context';

export interface ApiResponse<T = any> {
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: any;
    /** Story IR.5 C1: correlation id, same as the `X-Request-Id` header. */
    requestId?: string;
  } | null;
  meta: Record<string, any>;
}

export function createSuccessEnvelope<T>(
  data: T,
  meta: Record<string, any> = {},
): ApiResponse<T> {
  return {
    data,
    error: null,
    meta,
  };
}

export function createErrorEnvelope(
  code: string,
  message: string,
  details?: any,
  meta: Record<string, any> = {},
): ApiResponse<null> {
  const requestId = currentRequestId();
  return {
    data: null,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
    meta,
  };
}
