import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { API_VERSION } from '@hsdg/contracts';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.module';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const { globalPrefix, serveDocs } = configureApp(app);

  app.enableShutdownHooks();

  const logger = app.get(Logger);
  const port = app.get(AppConfigService).get('PORT');
  await app.listen(port);

  logger.log(
    `Dhvaj API listening on http://localhost:${port}/${globalPrefix}/${API_VERSION}`,
    'Bootstrap',
  );
  if (serveDocs) {
    logger.log(`OpenAPI docs at http://localhost:${port}/${globalPrefix}/docs`, 'Bootstrap');
  }
}

void bootstrap();
