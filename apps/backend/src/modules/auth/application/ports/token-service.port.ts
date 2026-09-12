export interface AccessTokenClaims {
  sub: string;
  sessionId: string;
  sessionVersion: number;
  iat?: number;
  exp?: number;
}

export interface TokenServicePort {
  signToken(payload: AccessTokenClaims): Promise<string>;
  verifyToken(token: string): Promise<AccessTokenClaims>;
}

export const TOKEN_SERVICE_PORT = Symbol('TokenServicePort');
