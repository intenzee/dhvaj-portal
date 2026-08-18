import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_VERSION } from '@hsdg/contracts';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { setupSwagger } from './bootstrap/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route all framework logs through pino.
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);
  const logger = app.get(Logger);
  const globalPrefix = config.get('API_GLOBAL_PREFIX');

  // Serve API docs only outside production, even if the flag is set — Swagger
  // exposes the full API surface and its inline assets require relaxing CSP.
  const serveDocs = config.get('SWAGGER_ENABLED') && !config.isProduction;
  if (config.get('SWAGGER_ENABLED') && config.isProduction) {
    logger.warn('SWAGGER_ENABLED is ignored in production; API docs are not served.');
  }

  // Security headers. CSP is only relaxed where docs are actually served, so
  // production always runs with helmet's default Content-Security-Policy.
  app.use(
    helmet({
      contentSecurityPolicy: serveDocs ? false : undefined,
    }),
  );

  // /api/v1/... — explicit URI versioning; default version is v1.
  app.setGlobalPrefix(globalPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION.replace(/^v/, ''),
    prefix: 'v',
  });

  // Backend validation is authoritative (frontend validation is UX only).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Uniform error envelope for every failure.
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.enableShutdownHooks();

  if (serveDocs) {
    setupSwagger(app, globalPrefix);
  }

  const port = config.get('PORT');
  await app.listen(port);

  logger.log(
    `HSDG API listening on http://localhost:${port}/${globalPrefix}/${API_VERSION}`,
    'Bootstrap',
  );
  if (serveDocs) {
    logger.log(`OpenAPI docs at http://localhost:${port}/${globalPrefix}/docs`, 'Bootstrap');
  }
}

void bootstrap();
