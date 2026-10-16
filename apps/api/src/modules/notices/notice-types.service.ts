import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { NoticeStream, NoticeType, UpsertNoticeTypeRequest } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';

interface NoticeTypeRow {
  id: string;
  code: string;
  stream: NoticeStream;
  form: string | null;
  section: string | null;
  title: string;
  default_reply_days: number | null;
  appealable: boolean;
  appeal_rule_code: string | null;
  is_active: boolean;
  version: number;
}

const COLUMNS = `id, code, stream, form, section, title, default_reply_days, appealable,
                 appeal_rule_code, is_active, version`;

function toNoticeType(r: NoticeTypeRow): NoticeType {
  return {
    id: r.id,
    code: r.code,
    stream: r.stream,
    form: r.form,
    section: r.section,
    title: r.title,
    defaultReplyDays: r.default_reply_days,
    appealable: r.appealable,
    appealRuleCode: r.appeal_rule_code,
    isActive: r.is_active,
    version: r.version,
  };
}

/**
 * PS-101 — the notice-type library. Any staff member reads it; workflow.manage
 * (checked by the controller; RLS also limits writes to partners and the
 * firm-wide roles) adds or changes a type, versioned (409 when stale).
 */
@Injectable()
export class NoticeTypesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RlsContext): Promise<NoticeType[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<NoticeTypeRow>(
        `SELECT ${COLUMNS} FROM hsdg.notice_types ORDER BY stream, form NULLS LAST, code`,
      );
      return rows.map(toNoticeType);
    });
  }

  async upsert(ctx: RlsContext, code: string, input: UpsertNoticeTypeRequest): Promise<NoticeType> {
    if (input.appealRuleCode && !input.appealable)
      throw new BadRequestException('Only an appealable type names a limitation rule.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: existing } = await client.query<NoticeTypeRow>(
        `SELECT ${COLUMNS} FROM hsdg.notice_types WHERE code = $1 FOR UPDATE`,
        [code],
      );
      const before = existing[0];
      const values = [
        code,
        input.stream,
        input.form?.trim() || null,
        input.section?.trim() || null,
        input.title.trim(),
        input.defaultReplyDays ?? null,
        input.appealable,
        input.appealable ? (input.appealRuleCode ?? null) : null,
        input.isActive ?? true,
      ];
      let row: NoticeTypeRow;
      try {
        if (before) {
          if (input.version === undefined)
            throw new BadRequestException('Pass the version you read to change a notice type.');
          if (input.version !== before.version)
            throw new ConflictException(
              'This notice type was changed by someone else — reload it and try again.',
            );
          const { rows } = await client.query<NoticeTypeRow>(
            `UPDATE hsdg.notice_types
                SET stream = $2, form = $3, section = $4, title = $5, default_reply_days = $6,
                    appealable = $7, appeal_rule_code = $8, is_active = $9, version = version + 1
              WHERE code = $1
              RETURNING ${COLUMNS}`,
            values,
          );
          row = rows[0]!;
        } else {
          const { rows } = await client.query<NoticeTypeRow>(
            `INSERT INTO hsdg.notice_types
               (code, stream, form, section, title, default_reply_days, appealable,
                appeal_rule_code, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING ${COLUMNS}`,
            values,
          );
          row = rows[0]!;
        }
      } catch (err) {
        throw translatePgError(err, {
          uniqueDefault: `A notice type ${code} already exists.`,
          check: 'A value on the notice type is not allowed.',
          forbidden: 'Only a partner can maintain the notice-type library.',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'notice_type.upserted',
        objectType: 'notice_type',
        objectId: row.id,
        ...(before ? { before: toNoticeType(before) } : {}),
        after: toNoticeType(row),
      });
      return toNoticeType(row);
    });
  }
}
