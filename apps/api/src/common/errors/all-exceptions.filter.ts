import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../logging/logger.config';
import { ErrorResponse } from './error-response';

/**
 * Catch-all exception filter producing the uniform {@link ErrorResponse}
 * envelope for every failure.
 *
 * Fail-closed: anything that is not an explicit HttpException is treated as an
 * internal error and its details are NOT leaked to the client (only logged with
 * the correlation id). Business/HTTP exceptions surface their intended message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId =
      (request.headers[CORRELATION_ID_HEADER] as string | undefined) ??
      (response.getHeader(CORRELATION_ID_HEADER) as string | undefined) ??
      'unknown';

    const { status, error, message, details } = this.normalise(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Unexpected: log the full error, return a generic message.
      this.logger.error(
        `Unhandled exception [${correlationId}] ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `Handled ${status} [${correlationId}] ${request.method} ${request.url} — ${message}`,
      );
    }

    const body: ErrorResponse = {
      statusCode: status,
      error,
      message,
      ...(details ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    response.status(status).json(body);
  }

  private normalise(exception: unknown): {
    status: number;
    error: string;
    message: string;
    details?: string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return { status, error: codeFor(status), message: res };
      }

      const obj = res as Record<string, unknown>;
      const rawMessage = obj.message;
      const details = Array.isArray(rawMessage) ? (rawMessage as string[]) : undefined;
      const message = Array.isArray(rawMessage)
        ? 'Validation failed'
        : typeof rawMessage === 'string'
          ? rawMessage
          : exception.message;

      // Always derive the machine-readable `error` code from the HTTP status
      // (e.g. FORBIDDEN, NOT_FOUND) rather than Nest's human string ("Forbidden"),
      // so clients get a stable, uppercase code regardless of exception source.
      return {
        status,
        error: codeFor(status),
        message,
        ...(details ? { details } : {}),
      };
    }

    // Framework/middleware errors (e.g. body-parser's 413 "entity too large" or
    // 400 malformed JSON) arrive as plain Errors carrying an HTTP status rather
    // than as HttpExceptions. Surface genuine 4xx client errors cleanly; anything
    // else stays a fail-closed internal error with no detail leaked.
    const httpish = exception as { status?: unknown; statusCode?: unknown; message?: unknown };
    const rawStatus =
      typeof httpish.status === 'number'
        ? httpish.status
        : typeof httpish.statusCode === 'number'
          ? httpish.statusCode
          : undefined;
    if (rawStatus !== undefined && rawStatus >= 400 && rawStatus < 500) {
      const message =
        rawStatus === HttpStatus.PAYLOAD_TOO_LARGE
          ? 'Request body is too large.'
          : typeof httpish.message === 'string'
            ? httpish.message
            : codeFor(rawStatus);
      return { status: rawStatus, error: codeFor(rawStatus), message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    };
  }
}

function codeFor(status: number): string {
  const name = Object.entries(HttpStatus).find(([, value]) => value === status)?.[0];
  return name ?? 'ERROR';
}
