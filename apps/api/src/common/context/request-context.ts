import { randomUUID } from 'node:crypto';
import type { ClsModuleOptions } from 'nestjs-cls';
import type { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import { CORRELATION_ID_HEADER } from '../logging/logger.config';

/** CLS key under which the request correlation id is stored. */
export const CLS_CORRELATION_ID = 'correlationId';

/** Read the ambient request correlation id, if any (safe outside a request). */
export function resolveAmbientCorrelationId(cls: ClsService): string | undefined {
  return cls.isActive() ? cls.get<string>(CLS_CORRELATION_ID) : undefined;
}

/**
 * ClsModule configuration.
 *
 * Establishes an async-local store per request and seeds the correlation id from
 * the inbound `x-correlation-id` header (or mints one), writing it back onto the
 * header so this value and the logger's request id are always the same,
 * regardless of middleware order. Downstream services (e.g. AuditService) read
 * it ambiently instead of threading it through every call.
 */
export const clsOptions: ClsModuleOptions = {
  global: true,
  middleware: {
    mount: true,
    setup: (cls, req: Request) => {
      const raw = req.headers[CORRELATION_ID_HEADER];
      const correlationId = (Array.isArray(raw) ? raw[0] : raw) ?? randomUUID();
      req.headers[CORRELATION_ID_HEADER] = correlationId;
      cls.set(CLS_CORRELATION_ID, correlationId);
    },
  },
};
