import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfigService } from '../../config/config.module';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Path segments that ARE a credential (client upload links): `/client-upload/<token>`. */
const SECRET_PATH = /(\/client-upload\/)[^/?#]+/g;

/**
 * A request URL safe to log: the token in a client upload link is masked and
 * every query value is dropped (queries carry PANs, names, search text and the
 * occasional token), keeping only the parameter names. Pure — tested.
 */
export function loggableUrl(url: string | undefined): string {
  if (!url) return '';
  const q = url.indexOf('?');
  const path = (q === -1 ? url : url.slice(0, q)).replace(SECRET_PATH, '$1[redacted]');
  if (q === -1) return path;
  const keys = [...new URLSearchParams(url.slice(q + 1)).keys()];
  return keys.length ? `${path}?${keys.map((k) => `${k}=[redacted]`).join('&')}` : path;
}

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
      // Log what a request was, never what it carried: no bodies, no query
      // values, no headers beyond the user agent (bearer tokens and cookies
      // live there).
      serializers: {
        req: (req: {
          id?: unknown;
          method?: string;
          url?: string;
          headers?: Record<string, unknown>;
          remoteAddress?: string;
        }) => ({
          id: req.id,
          method: req.method,
          url: loggableUrl(req.url),
          userAgent: req.headers?.['user-agent'],
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      // Belt and braces should a serializer above ever be widened.
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
