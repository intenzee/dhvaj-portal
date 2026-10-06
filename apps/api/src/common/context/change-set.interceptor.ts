import { randomUUID } from 'node:crypto';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

/** CLS keys carrying the change set a mutating request writes under. */
export const CLS_CHANGE_SET = 'changeSet';
export const CLS_CHANGE_LABEL = 'changeLabel';

/** Where @nestjs/swagger keeps an endpoint's @ApiOperation options. */
const API_OPERATION_METADATA = 'swagger/apiOperation';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Only clicks inside the audit file are undoable steps. Provisioning the file
 * (adding the service line) and edits elsewhere — e.g. the client master —
 * are not, so undo never takes the file apart from outside it.
 */
const UNDOABLE_PATH = /\/engagements\/[^/]+\/statutory-audit(\/|$)/;

/** Partner sign-off and archiving are final — never an undoable step. */
const FINAL_PATH = /\/statutory-audit\/[^/]+\/(sign-off|archive)$/;

/**
 * Turn an endpoint summary into a short action label for the undo button:
 * "Update a completion / reporting checklist item (§27.07/§27.08)" →
 * "Update a completion / reporting checklist item".
 */
export function changeLabelFromSummary(summary: string | undefined): string | undefined {
  if (!summary) return undefined;
  const label = summary
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .split(/\s+[—–]\s+/)[0]!
    .trim();
  return label.length > 0 ? label.slice(0, 160) : undefined;
}

/**
 * Stamps every mutating audit-file request with a fresh change-set id and a label taken
 * from the endpoint's OpenAPI summary. The database gateway carries both into
 * each transaction, where the audit-file undo trigger groups the rows the
 * request changed under that id — so one click is one undoable step.
 */
@Injectable()
export class ChangeSetInterceptor implements NestInterceptor {
  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http' && this.cls.isActive()) {
      const req = context.switchToHttp().getRequest<Request>();
      if (
        !READ_METHODS.has(req.method.toUpperCase()) &&
        UNDOABLE_PATH.test(req.path) &&
        !FINAL_PATH.test(req.path)
      ) {
        const op = this.reflector.get<{ summary?: string } | undefined>(
          API_OPERATION_METADATA,
          context.getHandler(),
        );
        this.cls.set(CLS_CHANGE_SET, randomUUID());
        this.cls.set(CLS_CHANGE_LABEL, changeLabelFromSummary(op?.summary));
      }
    }
    return next.handle();
  }
}
