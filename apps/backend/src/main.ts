import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { EnvService } from './common/config/env.service';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { createHelmetMiddleware } from './common/security/helmet.config';
import { createCorsOptions } from './common/security/cors.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const envService = app.get(EnvService);

  if (envService.trustProxyHops > 0) {
    app.set('trust proxy', envService.trustProxyHops);
  }

  app.enableShutdownHooks();
  app.use(createHelmetMiddleware(envService.isProduction));
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors(createCorsOptions(envService));

  await app.listen(envService.port);
}
bootstrap();
