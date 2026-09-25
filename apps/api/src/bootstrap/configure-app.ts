import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_VERSION } from '@hsdg/contracts';
import { buildValidationPipe } from '../common/validation';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { AppConfigService } from '../config/config.module';
import { setupSwagger } from './swagger';

/**
 * Apply the HTTP pipeline (logging, body limits, security headers, prefix +
 * versioning, validation, error envelope, CORS, docs) to a created app. Shared
 * by the long-running server (main.ts) and the serverless entry (serverless.ts)
 * so both expose exactly the same API surface.
 */
export function configureApp(app: NestExpressApplication): {
  globalPrefix: string;
  serveDocs: boolean;
} {
  // Route all framework logs through pino.
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);
  const logger = app.get(Logger);
  const globalPrefix = config.get('API_GLOBAL_PREFIX');

  // Documents are uploaded base64-encoded in JSON, so raise the body ceiling to
  // clear the largest allowed file (default parsers cap JSON at 100 kB).
  app.useBodyParser('json', { limit: config.jsonBodyLimitBytes });
  app.useBodyParser('urlencoded', { limit: config.jsonBodyLimitBytes, extended: true });

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
  app.useGlobalPipes(buildValidationPipe());

  // Uniform error envelope for every failure.
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  if (serveDocs) {
    setupSwagger(app, globalPrefix);
  }

  return { globalPrefix, serveDocs };
}
