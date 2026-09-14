export interface ApiResponse<T = any> {
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: any;
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
  return {
    data: null,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    meta,
  };
}
