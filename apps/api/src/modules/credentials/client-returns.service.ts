import { Injectable } from '@nestjs/common';
import {
  RETURN_FORMS,
  returnPeriodEnd,
  type ClientReturnLine,
  type ClientReturns,
  type ReturnForm,
  type ReturnMark,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';

/** More marks than this is not one firm's sheet. */
const MAX_MARKS = 50_000;

interface MarkRow {
  entity_id: string;
  entity_code: string;
  legal_name: string;
  registration_id: string | null;
  gstin: string | null;
  state_code: string | null;
  return_form: ReturnForm;
  period_key: string;
  mark: ReturnMark;
  updated_at: Date;
}

/** Months before quarters ending the same month; then the key. */
export function comparePeriods(a: string, b: string): number {
  return returnPeriodEnd(a).localeCompare(returnPeriodEnd(b)) || a.length - b.length;
}

/**
 * ADR-0035 — the clients' GST return history as the firm's sheet marks it
 * (client_return_marks): one line per GSTIN, or per state / client while the
 * sheet has no GSTIN. Only the clients the caller can see.
 */
@Injectable()
export class ClientReturnsService {
  constructor(private readonly db: DatabaseService) {}

  async list(ctx: RlsContext, entityId?: string): Promise<ClientReturns> {
    const rows = await this.db.withRlsContext(ctx, async (client) => {
      const res = await client.query<MarkRow>(
        // A mark kept by state shows under the client's GSTIN of that state, once
        // there is one; where both have a mark, the GSTIN's own (ordered last) wins.
        `SELECT m.entity_id, e.entity_code, e.legal_name, r.id AS registration_id,
                r.registration_number AS gstin, m.state_code, m.return_form, m.period_key,
                m.mark, m.updated_at
           FROM hsdg.client_return_marks m
           JOIN hsdg.entities e ON e.id = m.entity_id
           LEFT JOIN LATERAL (
             SELECT g.id FROM hsdg.entity_registrations g
              WHERE m.registration_id IS NULL AND g.entity_id = m.entity_id
                AND g.registration_type = 'gstin' AND left(g.registration_number, 2) = m.state_code
              ORDER BY g.created_at LIMIT 1) s ON true
           LEFT JOIN hsdg.entity_registrations r ON r.id = COALESCE(m.registration_id, s.id)
          WHERE ($1::uuid IS NULL OR m.entity_id = $1)
          ORDER BY lower(e.legal_name), e.id, r.registration_number NULLS LAST, m.state_code,
                   m.registration_id IS NOT NULL
          LIMIT ${MAX_MARKS}`,
        [entityId ?? null],
      );
      return res.rows;
    });

    const lines = new Map<string, ClientReturnLine>();
    const periods = new Set<string>();
    const forms = new Set<ReturnForm>();
    for (const r of rows) {
      const key = `${r.entity_id}|${r.registration_id ?? r.state_code ?? ''}`;
      let line = lines.get(key);
      if (!line) {
        line = {
          entityId: r.entity_id,
          entityCode: r.entity_code,
          entityName: r.legal_name,
          registrationId: r.registration_id,
          gstin: r.gstin,
          stateCode: r.state_code,
          marks: {},
          updatedAt: r.updated_at.toISOString(),
        };
        lines.set(key, line);
      }
      (line.marks[r.period_key] ??= {})[r.return_form] = r.mark;
      if (r.updated_at.toISOString() > line.updatedAt) line.updatedAt = r.updated_at.toISOString();
      periods.add(r.period_key);
      forms.add(r.return_form);
    }
    return {
      periods: [...periods].sort(comparePeriods),
      forms: RETURN_FORMS.filter((f) => forms.has(f)),
      lines: [...lines.values()],
    };
  }
}
