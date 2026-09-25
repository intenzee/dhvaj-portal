import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './bootstrap/configure-app';

/**
 * Serverless entry (Vercel). The Nest app is created once per warm instance and
 * reused across invocations; every request is handed to its Express adapter.
 *
 * Mirrors scripts/deploy/start.mjs: when DATABASE_URL is not set explicitly it
 * is derived from DATABASE_ADMIN_URL with the least-privilege hsdg_app role
 * swapped in, so the same three secrets configure both hosts. Provisioning,
 * migrations and seeding run once at build time (SETUP_ONLY), never per request.
 */
function deriveDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const admin = process.env.DATABASE_ADMIN_URL;
  const appPw = process.env.DB_APP_PASSWORD;
  if (!admin || !appPw) return; // env validation reports the missing DATABASE_URL
  const u = new URL(admin);
  u.username = 'hsdg_app';
  u.password = appPw;
  process.env.DATABASE_URL = u.toString();
  process.env.DATABASE_SSL ??= 'true';
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Promise<Handler> | undefined;

async function createHandler(): Promise<Handler> {
  deriveDatabaseUrl();
  // Imported lazily so the env derivation above runs before config validation.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  handler ??= createHandler().catch((err: unknown) => {
    handler = undefined; // let the next request retry a failed cold start
    throw err;
  });
  (await handler)(req, res);
}
