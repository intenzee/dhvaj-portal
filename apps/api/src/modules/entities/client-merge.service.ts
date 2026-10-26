import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  MERGE_TAKE_FIELDS,
  type DuplicatePair,
  type MergeClientSide,
  type MergeClientsResult,
  type MergeEngagementPlan,
  type MergeFieldChoice,
  type MergePreview,
  type MergeTakeField,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { legalStatusLabel } from '../credentials/client-master';
import {
  cleanGstin,
  parseClientName,
  officesOfOneBusiness,
  sameClient,
  type ClientIdentity,
} from './client-names';

/** Engagements no longer in progress: they move, but are not "work in hand". */
const OPEN_EXCLUDED = ['closed', 'merged', 'cancelled', 'declined', 'withdrawn'];

const FIELD_LABEL: Record<MergeTakeField, string> = {
  legal_name: 'Legal name',
  display_name: 'Display name',
  trade_name: 'Trade name',
  short_name: 'Short name',
  entity_type_id: 'Entity type',
  incorporation_date: 'Date of incorporation',
  legal_status: 'Legal status',
  home_office_id: 'Home office',
};

interface SideRow {
  id: string;
  entity_code: string;
  legal_name: string;
  display_name: string | null;
  trade_name: string | null;
  short_name: string | null;
  entity_type_id: string;
  type_name: string;
  incorporation_date: string | null;
  legal_status: string | null;
  home_office_id: string;
  office_code: string;
  pan: string | null;
  status: string;
  merged_into_id: string | null;
  created_at: string;
}

interface Side {
  row: SideRow;
  regs: { registration_type: string; registration_number: string }[];
  counts: Record<string, number>;
}

/**
 * Merging two clients that are one legal entity: the preview the popup shows
 * (which to keep, what differs, what happens to each engagement), the merge
 * itself (hsdg.merge_entities, run as the owner once the caller is shown to
 * see both), the firm's list of likely duplicates and "these two are not one".
 */
@Injectable()
export class ClientMergeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async preview(ctx: RlsContext, keepId: string, dropId: string): Promise<MergePreview> {
    if (keepId === dropId) throw new BadRequestException('Choose two different clients.');
    return this.db.withRlsContext(ctx, async (client) => {
      const keep = await this.side(client, keepId);
      const drop = await this.side(client, dropId);
      const { verdict, reasons } = sameClient(identity(keep), identity(drop));

      const blockers: string[] = [];
      if (keep.row.pan && drop.row.pan && keep.row.pan !== drop.row.pan)
        blockers.push(
          `Different PANs (${keep.row.pan} and ${drop.row.pan}) are two legal entities; they cannot be merged.`,
        );
      for (const s of [keep, drop])
        if (s.row.merged_into_id)
          blockers.push(`${s.row.entity_code} was already merged into another client.`);

      const engagements = await this.engagementPlan(client, keepId, dropId);
      const warnings: string[] = [];
      if (verdict === 'possible' || verdict === 'different')
        warnings.push(
          'Nothing the portal holds proves these are one client: check the PAN and GSTINs before merging.',
        );
      const stays = engagements.filter((e) => e.action === 'stay').length;
      if (stays)
        warnings.push(
          `${stays} engagement${stays === 1 ? '' : 's'} stay on ${drop.row.entity_code}: the kept client already has the same service for the same year.`,
        );
      if ((drop.counts.invoices ?? 0) > 0)
        warnings.push(
          'Invoices, receipts and credit notes go with their engagements; one tied to an engagement that stays, stays with it.',
        );
      warnings.push(
        `${drop.row.entity_code} is archived and points to the kept client; its code keeps working in the client import.`,
      );

      return {
        keep: toSide(keep),
        drop: toSide(drop),
        verdict,
        reasons,
        recommendedKeepId: weight(drop) > weight(keep) ? dropId : keepId,
        fields: fieldChoices(keep.row, drop.row),
        engagements,
        warnings,
        blockers,
      };
    });
  }

  async merge(
    ctx: RlsContext,
    keepId: string,
    dropId: string,
    take: MergeTakeField[] = [],
  ): Promise<MergeClientsResult> {
    if (keepId === dropId) throw new BadRequestException('Choose two different clients.');
    const unknown = take.filter((f) => !(MERGE_TAKE_FIELDS as readonly string[]).includes(f));
    if (unknown.length) throw new BadRequestException(`Cannot take ${unknown.join(', ')}.`);
    return this.db.withRlsContext(ctx, (client) =>
      this.mergeWith(client, ctx, keepId, dropId, take),
    );
  }

  /** merge inside the caller's transaction (combining offices, CM-6). */
  async mergeWith(
    client: PoolClient,
    ctx: RlsContext,
    keepId: string,
    dropId: string,
    take: MergeTakeField[] = [],
  ): Promise<MergeClientsResult> {
    // The merge runs as the owner; the caller must see both clients and be
    // able to write them (office scope). FOR UPDATE is checked against the
    // UPDATE policies, and locking in id order keeps two merges from deadlocking.
    const keep = await this.side(client, keepId);
    const drop = await this.side(client, dropId);
    const writable = await client.query(
      `SELECT id FROM hsdg.entities WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[keepId, dropId]],
    );
    if ((writable.rowCount ?? 0) < 2)
      throw new ForbiddenException('You can merge only clients of your own office.');

    let out: {
      keptId: string;
      archivedId: string;
      movedEngagements: number;
      folded: MergeClientsResult['folded'];
      counts: Record<string, number>;
      stayed: MergeClientsResult['stayed'];
    };
    try {
      const { rows } = await client.query<{ r: typeof out }>(
        `SELECT hsdg.merge_entities($1, $2, $3::jsonb) AS r`,
        [keepId, dropId, JSON.stringify(Object.fromEntries(take.map((f) => [f, true])))],
      );
      out = rows[0]!.r;
    } catch (err) {
      throw mergeError(err);
    }
    const result: MergeClientsResult = {
      ...out,
      keptCode: keep.row.entity_code,
      archivedCode: drop.row.entity_code,
    };
    await this.audit.recordWith(client, ctx, {
      action: 'entity.merged',
      objectType: 'entity',
      objectId: keepId,
      before: {
        kept: { code: keep.row.entity_code, legalName: keep.row.legal_name, pan: keep.row.pan },
        archived: {
          code: drop.row.entity_code,
          legalName: drop.row.legal_name,
          pan: drop.row.pan,
        },
      },
      after: { take, ...result },
    });
    // The archived client's own history says where it went.
    await this.audit.recordWith(client, ctx, {
      action: 'entity.merged_into',
      objectType: 'entity',
      objectId: dropId,
      before: { code: drop.row.entity_code, legalName: drop.row.legal_name },
      after: { keptId: keepId, keptCode: keep.row.entity_code },
    });
    return result;
  }

  /**
   * Pairs of live clients the caller sees that look like one: a shared PAN,
   * GSTIN, TAN or CIN, or names that agree once form and place are set aside.
   * Pairs someone marked "not the same client" are left out.
   */
  async duplicates(ctx: RlsContext): Promise<DuplicatePair[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        entity_code: string;
        legal_name: string;
        pan: string | null;
        office_code: string;
        regs: { t: string; n: string }[] | null;
      }>(
        `SELECT e.id, e.entity_code, e.legal_name, e.pan, o.code AS office_code,
                (SELECT json_agg(json_build_object('t', r.registration_type, 'n', r.registration_number))
                   FROM hsdg.entity_registrations r
                  WHERE r.entity_id = e.id AND r.registration_type IN ('gstin', 'tan', 'cin', 'llpin'))
                  AS regs
           FROM hsdg.entities e JOIN hsdg.offices o ON o.id = e.home_office_id
          WHERE e.merged_into_id IS NULL AND e.status <> 'archived'
          ORDER BY e.entity_code`,
      );
      const dismissed = await client.query<{ a: string; b: string }>(
        `SELECT entity_a_id AS a, entity_b_id AS b FROM hsdg.entity_duplicate_dismissals
          WHERE kind = 'duplicate'`,
      );
      const skip = new Set(dismissed.rows.map((d) => `${d.a}|${d.b}`));

      // Compare only clients that share a key: a PAN (a GSTIN's included) or
      // the first word of the name. Everything else cannot match.
      const buckets = new Map<string, number[]>();
      const idents: ClientIdentity[] = rows.map((r, i) => {
        const regs = r.regs ?? [];
        const gstins = regs.filter((x) => x.t === 'gstin').map((x) => x.n);
        const keys = new Set<string>();
        if (r.pan) keys.add(`pan:${r.pan}`);
        for (const g of gstins) {
          const c = cleanGstin(g);
          if (c) keys.add(`pan:${c.slice(2, 12)}`);
        }
        for (const x of regs) if (x.t !== 'gstin') keys.add(`${x.t}:${x.n}`);
        const first = parseClientName(r.legal_name).words[0];
        if (first) keys.add(`w:${first}`);
        for (const k of keys) buckets.set(k, [...(buckets.get(k) ?? []), i]);
        return {
          name: r.legal_name,
          pan: r.pan,
          gstins,
          tan: regs.find((x) => x.t === 'tan')?.n ?? null,
          cin: regs.find((x) => x.t === 'cin' || x.t === 'llpin')?.n ?? null,
        };
      });

      const seen = new Set<string>();
      const pairs: DuplicatePair[] = [];
      const brief = (i: number) => ({
        id: rows[i]!.id,
        entityCode: rows[i]!.entity_code,
        legalName: rows[i]!.legal_name,
        pan: rows[i]!.pan,
        officeCode: rows[i]!.office_code,
      });
      for (const members of buckets.values()) {
        if (members.length < 2 || members.length > 200) continue;
        for (let x = 0; x < members.length; x++)
          for (let y = x + 1; y < members.length; y++) {
            const [i, j] = [members[x]!, members[y]!];
            const [a, b] = rows[i]!.id < rows[j]!.id ? [i, j] : [j, i];
            const key = `${rows[a]!.id}|${rows[b]!.id}`;
            if (seen.has(key) || skip.has(key)) continue;
            seen.add(key);
            // Offices of one business go to "Offices to combine", not here.
            if (officesOfOneBusiness(idents[a]!, idents[b]!)) continue;
            const { verdict, reasons } = sameClient(idents[a]!, idents[b]!);
            if (verdict === 'different') continue;
            pairs.push({ a: brief(a), b: brief(b), verdict, reasons });
          }
      }
      const rank = { same: 0, probable: 1, possible: 2 } as const;
      return pairs
        .sort(
          (p, q) => rank[p.verdict] - rank[q.verdict] || p.a.legalName.localeCompare(q.a.legalName),
        )
        .slice(0, 500);
    });
  }

  async dismiss(
    ctx: RlsContext,
    aId: string,
    bId: string,
    note?: string,
    kind: 'duplicate' | 'branch' = 'duplicate',
  ): Promise<void> {
    if (aId === bId) throw new BadRequestException('Choose two different clients.');
    const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
    await this.db.withRlsContext(ctx, async (client) => {
      await this.side(client, a);
      await this.side(client, b);
      await client.query(
        `INSERT INTO hsdg.entity_duplicate_dismissals
           (entity_a_id, entity_b_id, dismissed_by_user_id, note, kind)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entity_a_id, entity_b_id, kind) DO NOTHING`,
        [a, b, ctx.userId, note?.trim() || null, kind],
      );
      await this.audit.recordWith(client, ctx, {
        action: kind === 'branch' ? 'entity.branches_dismissed' : 'entity.duplicate_dismissed',
        objectType: 'entity',
        objectId: a,
        after: { otherEntityId: b, note: note?.trim() || null },
      });
    });
  }

  /** One client as the caller sees it (404 when RLS hides it), with what it holds. */
  private async side(client: PoolClient, id: string): Promise<Side> {
    const { rows } = await client.query<SideRow>(
      `SELECT e.id, e.entity_code, e.legal_name, e.display_name, e.trade_name, e.short_name,
              e.entity_type_id, et.name AS type_name, e.incorporation_date::text AS incorporation_date,
              e.legal_status, e.home_office_id, o.code AS office_code, e.pan, e.status,
              e.merged_into_id, e.created_at
         FROM hsdg.entities e
         JOIN hsdg.entity_types et ON et.id = e.entity_type_id
         JOIN hsdg.offices o ON o.id = e.home_office_id
        WHERE e.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Client not found.');
    const regs = await client.query<Side['regs'][number]>(
      `SELECT registration_type, registration_number FROM hsdg.entity_registrations
        WHERE entity_id = $1 ORDER BY is_principal DESC, created_at`,
      [id],
    );
    const { rows: c } = await client.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM hsdg.engagements WHERE entity_id = $1) AS engagements,
         (SELECT count(*) FROM hsdg.entity_registrations WHERE entity_id = $1) AS registrations,
         (SELECT count(*) FROM hsdg.entity_contacts WHERE entity_id = $1) AS contacts,
         (SELECT count(*) FROM hsdg.client_credentials WHERE entity_id = $1) AS logins,
         (SELECT count(*) FROM hsdg.invoices WHERE client_entity_id = $1) AS invoices,
         (SELECT count(*) FROM hsdg.receipts WHERE client_entity_id = $1) AS receipts,
         (SELECT count(*) FROM hsdg.notices WHERE entity_id = $1) AS notices`,
      [id],
    );
    const counts = Object.fromEntries(Object.entries(c[0]!).map(([k, v]) => [k, Number(v)]));
    return { row: rows[0], regs: regs.rows, counts };
  }

  /** What merge_entities will do with each of the archived client's engagements. */
  private async engagementPlan(
    client: PoolClient,
    keepId: string,
    dropId: string,
  ): Promise<MergeEngagementPlan[]> {
    const { rows } = await client.query<{
      id: string;
      engagement_code: string;
      kind: string;
      label: string;
      status: string;
      open_compliance: boolean;
      keeper_compliance: string | null;
      clashes: boolean;
    }>(
      `SELECT e.id, e.engagement_code, e.kind, e.status,
              concat_ws(' · ', s.name, e.financial_year) AS label,
              (e.kind = 'compliance' AND e.status <> ALL($3::text[])) AS open_compliance,
              (SELECT k.engagement_code FROM hsdg.engagements k
                WHERE k.entity_id = $2 AND k.kind = 'compliance' AND k.status <> ALL($3::text[])
                LIMIT 1) AS keeper_compliance,
              hsdg.merge_line_clashes(e.id, $2) AS clashes
         FROM hsdg.engagements e
         LEFT JOIN hsdg.services s ON s.id = e.service_id
        WHERE e.entity_id = $1
        ORDER BY e.created_at`,
      [dropId, keepId, OPEN_EXCLUDED],
    );
    return rows.map((r) => {
      const base = {
        id: r.id,
        code: r.engagement_code,
        kind: r.kind,
        label: r.label || r.engagement_code,
        status: r.status,
      };
      if (r.open_compliance && r.keeper_compliance)
        return {
          ...base,
          action: 'fold' as const,
          reason: `Its filings, tasks and documents join ${r.keeper_compliance}; a filing ${r.keeper_compliance} already has stays behind.`,
        };
      if (r.clashes)
        return {
          ...base,
          action: 'stay' as const,
          reason: 'The kept client already has the same service for the same year.',
        };
      return { ...base, action: 'move' as const, reason: null };
    });
  }
}

function identity(s: Side): ClientIdentity {
  const of = (t: string) => s.regs.filter((r) => r.registration_type === t);
  return {
    name: s.row.legal_name,
    pan: s.row.pan,
    gstins: of('gstin').map((r) => r.registration_number),
    tan: of('tan')[0]?.registration_number ?? null,
    cin: (of('cin')[0] ?? of('llpin')[0])?.registration_number ?? null,
  };
}

function toSide(s: Side): MergeClientSide {
  return {
    id: s.row.id,
    entityCode: s.row.entity_code,
    legalName: s.row.legal_name,
    pan: s.row.pan,
    typeName: s.row.type_name,
    officeCode: s.row.office_code,
    status: s.row.status,
    gstins: s.regs.filter((r) => r.registration_type === 'gstin').map((r) => r.registration_number),
    counts: s.counts,
  };
}

/**
 * Which to keep: the one with a PAN, then the one with more history (work,
 * billing, registrations), then the older. Merged or archived ones last.
 */
function weight(s: Side): number {
  const c = s.counts;
  return (
    (s.row.merged_into_id || s.row.status === 'archived' ? -1e6 : 0) +
    (s.row.pan ? 1e5 : 0) +
    (c.engagements ?? 0) * 100 +
    (c.invoices ?? 0) * 50 +
    (c.receipts ?? 0) * 50 +
    (c.registrations ?? 0) * 10 +
    (c.logins ?? 0) * 5 +
    (c.contacts ?? 0) -
    // Older first on a tie: a smaller fraction for a later creation.
    new Date(s.row.created_at).getTime() / 1e15
  );
}

/** The fields both clients fill in differently; an empty one on the keeper is filled anyway. */
function fieldChoices(k: SideRow, d: SideRow): MergeFieldChoice[] {
  const shown = (f: MergeTakeField, r: SideRow): string | null => {
    switch (f) {
      case 'entity_type_id':
        return r.type_name;
      case 'home_office_id':
        return r.office_code;
      case 'legal_status':
        return r.legal_status ? legalStatusLabel(r.legal_status) : null;
      default:
        return r[f];
    }
  };
  return MERGE_TAKE_FIELDS.filter((f) => {
    const a = k[f];
    const b = d[f];
    return a != null && b != null && a !== '' && b !== '' && a !== b;
  }).map((f) => ({ field: f, label: FIELD_LABEL[f], keep: shown(f, k), drop: shown(f, d) }));
}

function mergeError(err: unknown): Error {
  const e = err as { code?: string; message?: string };
  if (e.code === '22023') return new BadRequestException(e.message);
  if (e.code === 'P0002') return new NotFoundException('Client not found.');
  if (e.code === '42501') return new ForbiddenException('Not permitted to merge these clients.');
  // A unique key the merge did not foresee (two of one thing on the kept client).
  if (e.code === '23505')
    return new ConflictException(
      'The two clients hold something that cannot be on one client twice; nothing was merged. Remove the duplicate from one of them and try again.',
    );
  return err as Error;
}
