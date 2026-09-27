import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { EnvService } from '../config/env.service';

export function createCorsOptions(envService: EnvService): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (!origin || envService.frontendOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-csrf-token',
      'Cookie',
      'Accept',
      'Origin',
    ],
    exposedHeaders: [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    maxAge: 86400,
  };
}
