import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  KYC_CHECKLIST_TEMPLATE_CODE,
  KYC_STATUSES,
  ROLE,
  kycCompleteProblems,
  kycEffectiveStatus,
  kycNextReviewOn,
  type BeneficialOwner,
  type ClientKyc,
  type CompleteClientKycInput,
  type KycChecklistItem,
  type KycGate,
  type KycRegisterResponse,
  type KycRiskRating,
  type KycSettings,
  type KycStatus,
  type SaveClientKycInput,
  type UpdateKycSettingsInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { istToday } from '../engagements/time/auto-time';
import { canSwitchChecks } from '../workflow-settings/firm-checks';
import type { KycRegisterQueryDto } from './dto/client-kyc.dto';
import { KYC_STATUS_SQL } from './kyc-gate';

interface KycRow {
  entity_id: string;
  status: 'pending' | 'complete';
  pan_verified: boolean;
  pan_verified_on: string | null;
  address_proof_doc_id: string | null;
  identity_proof_doc_ids: string[];
  beneficial_owners: BeneficialOwner[];
  risk_rating: KycRiskRating | null;
  checklist: Record<string, boolean>;
  notes: string | null;
  reviewed_by_employee_id: string | null;
  reviewed_by_name: string | null;
  reviewed_on: string | null;
  next_review_on: string | null;
  version: number;
}

interface TemplateItem {
  code: string;
  label: string;
  sequence?: number;
  mandatory?: boolean;
}

/** Who marks a KYC complete: the reviewer the firm trusts to accept a client. */
const COMPLETING_ROLES: string[] = [ROLE.partner, ROLE.managingPartner, ROLE.manager];

/**
 * Practice Services PS-404 — client KYC for non-audit clients. One record a
 * client (hsdg.client_kyc), read and written under the caller's RLS: anyone
 * who sees the client sees its KYC, and a manager or partner marks it
 * complete. The checklist is the DOC_CLIENT_KYC document requirement in
 * force; the review date follows the risk rating and the firm's settings.
 */
@Injectable()
export class ClientKycService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(ctx: RlsContext, entityId: string): Promise<ClientKyc> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, ctx, entityId));
  }

  save(ctx: RlsContext, entityId: string, input: SaveClientKycInput): Promise<ClientKyc> {
    return this.db.withRlsContext(ctx, async (client) => {
      const entityName = await this.entityName(client, entityId);
      const before = await this.row(client, entityId);
      if ((before?.version ?? 0) !== input.version) this.conflict();
      const items = await this.checklistItems(client, istToday());
      const known = new Set(items.map((i) => i.code));
      for (const code of Object.keys(input.checklist ?? {})) {
        if (!known.has(code)) throw new BadRequestException(`${code} is not on the KYC checklist.`);
      }
      const docIds = [
        ...(input.addressProofDocumentId ? [input.addressProofDocumentId] : []),
        ...(input.identityProofDocumentIds ?? []),
      ];
      await this.checkDocuments(client, entityId, docIds);

      const owners = (input.beneficialOwners ?? before?.beneficial_owners ?? []).map((o) => ({
        name: o.name.trim(),
        pan: o.pan ? o.pan.toUpperCase() : null,
        holdingPercent: o.holdingPercent ?? null,
        role: o.role?.trim() || null,
      }));
      if (owners.some((o) => !o.name)) {
        throw new BadRequestException('Each beneficial owner needs a name.');
      }
      if (owners.some((o) => o.holdingPercent !== null && Number(o.holdingPercent) > 100)) {
        throw new BadRequestException('A holding cannot be more than 100%.');
      }
      const panVerified = input.panVerified ?? before?.pan_verified ?? false;
      const next = {
        panVerified,
        panVerifiedOn: panVerified
          ? (input.panVerifiedOn ?? before?.pan_verified_on ?? istToday())
          : null,
        address:
          input.addressProofDocumentId !== undefined
            ? input.addressProofDocumentId
            : (before?.address_proof_doc_id ?? null),
        identity: input.identityProofDocumentIds ?? before?.identity_proof_doc_ids ?? [],
        owners,
        risk: input.riskRating !== undefined ? input.riskRating : (before?.risk_rating ?? null),
        checklist: { ...(before?.checklist ?? {}), ...(input.checklist ?? {}) },
        notes: input.notes !== undefined ? input.notes?.trim() || null : (before?.notes ?? null),
      };
      // A change to a complete KYC reopens it: the next reviewer signs off on what is now on file.
      await client.query(
        `INSERT INTO hsdg.client_kyc AS k
           (entity_id, status, pan_verified, pan_verified_on, address_proof_doc_id,
            identity_proof_doc_ids, beneficial_owners, risk_rating, checklist, notes)
         VALUES ($1, 'pending', $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
         ON CONFLICT (entity_id) DO UPDATE
            SET status = 'pending', pan_verified = $2, pan_verified_on = $3,
                address_proof_doc_id = $4, identity_proof_doc_ids = $5,
                beneficial_owners = $6::jsonb, risk_rating = $7, checklist = $8::jsonb,
                notes = $9, reviewed_by_employee_id = NULL, reviewed_on = NULL,
                next_review_on = NULL, version = k.version + 1, updated_at = now()`,
        [
          entityId,
          next.panVerified,
          next.panVerifiedOn,
          next.address,
          next.identity,
          JSON.stringify(next.owners),
          next.risk,
          JSON.stringify(next.checklist),
          next.notes,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'client_kyc.saved',
        objectType: 'entity',
        objectId: entityId,
        before: before ? { status: before.status, riskRating: before.risk_rating } : null,
        after: {
          entity: entityName,
          panVerified: next.panVerified,
          riskRating: next.risk,
          beneficialOwners: next.owners.length,
          reopened: before?.status === 'complete',
        },
      });
      return this.view(client, ctx, entityId);
    });
  }

  complete(ctx: RlsContext, entityId: string, input: CompleteClientKycInput): Promise<ClientKyc> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.entityName(client, entityId);
      if (!this.canComplete(ctx)) {
        throw new ForbiddenException('A manager or partner marks a client’s KYC complete.');
      }
      const row = await this.row(client, entityId);
      if (!row) throw new BadRequestException('Save the KYC before marking it complete.');
      if (row.version !== input.version) this.conflict();
      const today = istToday();
      const reviewedOn = input.reviewedOn ?? today;
      if (reviewedOn > today)
        throw new BadRequestException('The review date cannot be in the future.');
      const items = this.checklistWith(await this.checklistItems(client, today), row.checklist);
      const problems = kycCompleteProblems({
        panVerified: row.pan_verified,
        riskRating: row.risk_rating,
        checklist: items,
      });
      if (problems.length) throw new BadRequestException({ message: problems.join(' '), problems });
      const settings = await this.readSettings(client);
      const nextReviewOn = kycNextReviewOn(reviewedOn, row.risk_rating!, settings);
      await client.query(
        `UPDATE hsdg.client_kyc
            SET status = 'complete', reviewed_by_employee_id = $2, reviewed_on = $3,
                next_review_on = $4, version = version + 1, updated_at = now()
          WHERE entity_id = $1`,
        [entityId, ctx.employeeId, reviewedOn, nextReviewOn],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'client_kyc.completed',
        objectType: 'entity',
        objectId: entityId,
        before: { status: row.status },
        after: { status: 'complete', riskRating: row.risk_rating, reviewedOn, nextReviewOn },
      });
      return this.view(client, ctx, entityId);
    });
  }

  register(ctx: RlsContext, q: KycRegisterQueryDto): Promise<KycRegisterResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      const today = istToday();
      const params: unknown[] = [today];
      const where: string[] = [`ent.status = 'active'`, `ent.merged_into_id IS NULL`];
      if (q.risk) {
        params.push(q.risk);
        where.push(`k.risk_rating = $${params.length}`);
      }
      if (q.search?.trim()) {
        params.push(`%${q.search.trim()}%`);
        where.push(
          `(ent.legal_name ILIKE $${params.length} OR ent.display_name ILIKE $${params.length}
            OR ent.entity_code ILIKE $${params.length})`,
        );
      }
      const base = `FROM hsdg.entities ent
                    LEFT JOIN hsdg.client_kyc k ON k.entity_id = ent.id
                    LEFT JOIN hsdg.offices o ON o.id = ent.home_office_id
                   WHERE ${where.join(' AND ')}`;
      const counted = await client.query<{ status: KycStatus; n: string }>(
        `SELECT ${KYC_STATUS_SQL('$1::date')} AS status, count(*)::text AS n ${base} GROUP BY 1`,
        params,
      );
      const counts = Object.fromEntries(KYC_STATUSES.map((s) => [s, 0])) as Record<
        KycStatus,
        number
      >;
      for (const r of counted.rows) counts[r.status] = Number(r.n);
      let statusFilter = '';
      if (q.status === 'open') statusFilter = ` AND ${KYC_STATUS_SQL('$1::date')} <> 'complete'`;
      else if (q.status) {
        params.push(q.status);
        statusFilter = ` AND ${KYC_STATUS_SQL('$1::date')} = $${params.length}`;
      }
      const limit = q.limit ?? 200;
      const offset = q.offset ?? 0;
      const { rows } = await client.query<KycRegisterResponse['items'][number] & { total: string }>(
        `SELECT ent.id AS "entityId", ent.entity_code AS "entityCode",
                coalesce(ent.display_name, ent.legal_name) AS "entityName",
                o.name AS "officeName", ${KYC_STATUS_SQL('$1::date')} AS status,
                k.risk_rating AS "riskRating", k.reviewed_on::text AS "reviewedOn",
                k.next_review_on::text AS "nextReviewOn", count(*) OVER ()::text AS total
           ${base}${statusFilter}
          ORDER BY CASE ${KYC_STATUS_SQL('$1::date')} WHEN 'expired' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                   k.next_review_on NULLS FIRST, ent.legal_name
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return {
        items: rows.map(({ total: _total, ...r }) => r),
        total: Number(rows[0]?.total ?? 0),
        counts,
      };
    });
  }

  settings(ctx: RlsContext): Promise<KycSettings> {
    return this.db.withRlsContext(ctx, (client) => this.readSettings(client));
  }

  updateSettings(ctx: RlsContext, input: UpdateKycSettingsInput): Promise<KycSettings> {
    if (!canSwitchChecks(ctx)) {
      throw new ForbiddenException(
        'Only the managing partner or the administrator sets the KYC rules.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.readSettings(client);
      const sets: string[] = [];
      const values: unknown[] = [input.version];
      const columns: [keyof UpdateKycSettingsInput, string][] = [
        ['gate', 'kyc_gate'],
        ['reviewYearsHigh', 'kyc_review_years_high'],
        ['reviewYearsOther', 'kyc_review_years_other'],
      ];
      for (const [key, column] of columns) {
        if (input[key] === undefined) continue;
        values.push(input[key]);
        sets.push(`${column} = $${values.length}`);
      }
      if (!sets.length) return before;
      values.push(ctx.employeeId ?? null);
      const res = await client.query(
        `UPDATE hsdg.firm_settings
            SET ${[...sets, 'version = version + 1', `updated_by_employee_id = $${values.length}`].join(', ')}
          WHERE version = $1`,
        values,
      );
      if ((res.rowCount ?? 0) === 0) this.conflict();
      const after = await this.readSettings(client);
      await this.audit.recordWith(client, ctx, {
        action: 'client_kyc.settings_updated',
        objectType: 'firm_settings',
        objectId: null,
        before: { ...before, version: undefined },
        after: { ...after, version: undefined },
      });
      return after;
    });
  }

  // ---------------------------------------------------------------------------

  private async view(client: PoolClient, ctx: RlsContext, entityId: string): Promise<ClientKyc> {
    const entityName = await this.entityName(client, entityId);
    const today = istToday();
    // One client, one query at a time.
    const row = await this.row(client, entityId);
    const items = await this.checklistItems(client, today);
    const settings = await this.readSettings(client);
    return {
      entityId,
      entityName,
      status: kycEffectiveStatus(row?.status ?? null, row?.next_review_on ?? null, today),
      onFile: !!row,
      panVerified: row?.pan_verified ?? false,
      panVerifiedOn: row?.pan_verified_on ?? null,
      addressProofDocumentId: row?.address_proof_doc_id ?? null,
      identityProofDocumentIds: row?.identity_proof_doc_ids ?? [],
      beneficialOwners: row?.beneficial_owners ?? [],
      riskRating: row?.risk_rating ?? null,
      checklist: this.checklistWith(items, row?.checklist ?? {}),
      notes: row?.notes ?? null,
      reviewedBy:
        row?.reviewed_by_employee_id && row.reviewed_by_name
          ? { id: row.reviewed_by_employee_id, name: row.reviewed_by_name }
          : null,
      reviewedOn: row?.reviewed_on ?? null,
      nextReviewOn: row?.next_review_on ?? null,
      version: row?.version ?? 0,
      settings: {
        gate: settings.gate,
        reviewYearsHigh: settings.reviewYearsHigh,
        reviewYearsOther: settings.reviewYearsOther,
      },
      // RLS has the final word on the write; the flag only shapes the screen.
      can: { edit: true, complete: this.canComplete(ctx) },
    };
  }

  private canComplete(ctx: RlsContext): boolean {
    return !!ctx.employeeId && COMPLETING_ROLES.includes(ctx.role);
  }

  private async entityName(client: PoolClient, entityId: string): Promise<string> {
    const { rows } = await client.query<{ name: string }>(
      `SELECT coalesce(display_name, legal_name) AS name FROM hsdg.entities WHERE id = $1`,
      [entityId],
    );
    if (!rows[0]) throw new NotFoundException('Client not found.');
    return rows[0].name;
  }

  private async row(client: PoolClient, entityId: string): Promise<KycRow | null> {
    const { rows } = await client.query<KycRow>(
      `SELECT k.entity_id, k.status, k.pan_verified, k.pan_verified_on::text AS pan_verified_on,
              k.address_proof_doc_id, k.identity_proof_doc_ids, k.beneficial_owners,
              k.risk_rating, k.checklist, k.notes, k.reviewed_by_employee_id,
              emp.full_name AS reviewed_by_name, k.reviewed_on::text AS reviewed_on,
              k.next_review_on::text AS next_review_on, k.version
         FROM hsdg.client_kyc k
         LEFT JOIN hsdg.employees emp ON emp.id = k.reviewed_by_employee_id
        WHERE k.entity_id = $1`,
      [entityId],
    );
    return rows[0] ?? null;
  }

  /** The DOC_CLIENT_KYC items in force today, in order. */
  private async checklistItems(client: PoolClient, today: string): Promise<TemplateItem[]> {
    const { rows } = await client.query<{ body: { items?: TemplateItem[] } }>(
      `SELECT v.body
         FROM hsdg.catalogue_templates t
         JOIN hsdg.catalogue_template_versions v ON v.catalogue_template_id = t.id
        WHERE t.code = $1 AND v.effective_from <= $2::date
        ORDER BY v.effective_from DESC, v.version DESC
        LIMIT 1`,
      [KYC_CHECKLIST_TEMPLATE_CODE, today],
    );
    return [...(rows[0]?.body.items ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }

  private checklistWith(items: TemplateItem[], done: Record<string, boolean>): KycChecklistItem[] {
    return items.map((i) => ({
      code: i.code,
      label: i.label,
      mandatory: i.mandatory === true,
      done: done[i.code] === true,
    }));
  }

  /** A proof must be a document on one of the client's own engagements. */
  private async checkDocuments(client: PoolClient, entityId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(DISTINCT d.id)::text AS n
         FROM hsdg.documents d JOIN hsdg.engagements e ON e.id = d.engagement_id
        WHERE d.id = ANY($1::uuid[]) AND e.entity_id = $2`,
      [ids, entityId],
    );
    if (Number(rows[0]?.n ?? 0) !== new Set(ids).size) {
      throw new BadRequestException(
        'A proof must be a document on one of this client’s engagements.',
      );
    }
  }

  private async readSettings(client: PoolClient): Promise<KycSettings> {
    const { rows } = await client.query<{
      gate: KycGate;
      high: number;
      other: number;
      version: number;
    }>(
      `SELECT kyc_gate AS gate, kyc_review_years_high AS high, kyc_review_years_other AS other, version
         FROM hsdg.firm_settings LIMIT 1`,
    );
    const r = rows[0];
    return {
      gate: r?.gate ?? 'warn',
      reviewYearsHigh: r?.high ?? 1,
      reviewYearsOther: r?.other ?? 3,
      version: r?.version ?? 1,
    };
  }

  private conflict(): never {
    throw new ConflictException('Someone else changed this meanwhile. Reload and try again.');
  }
}
