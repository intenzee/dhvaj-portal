import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfigService } from '../../config/config.module';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Builds the nestjs-pino configuration.
 *
 * Every request carries a correlation id: honoured from an inbound
 * `x-correlation-id` header (so ids flow across service hops) or minted per
 * request. It is attached to every log line and echoed back on the response so
 * clients and audit records can be tied to the exact request.
 */
export function buildLoggerConfig(config: AppConfigService): Params {
  const pretty = config.get('LOG_PRETTY');

  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const incoming = req.headers[CORRELATION_ID_HEADER];
        const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
        res.setHeader(CORRELATION_ID_HEADER, id);
        return id;
      },
      customProps: (req: IncomingMessage) => ({
        correlationId: (req as IncomingMessage & { id?: string }).id,
      }),
      // Never log secrets or bearer tokens.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      autoLogging: true,
      transport: pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
