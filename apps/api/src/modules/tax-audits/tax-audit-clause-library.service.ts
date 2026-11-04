import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  compareClauseNo,
  conditionProblems,
  type CreateTaxAuditLibraryDraftInput,
  type TaxAuditAct,
  type TaxAuditCondition,
  type TaxAuditDraftSource,
  type TaxAuditGrade,
  type TaxAuditLibraryClause,
  type TaxAuditLibraryClauseInput,
  type TaxAuditLibraryStatus,
  type TaxAuditLibraryVersion,
  type TaxAuditLibraryView,
  type TaxAuditPackage,
  type TaxAuditSubItem,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface VersionRow {
  id: string;
  version_no: number;
  label: string;
  act: TaxAuditAct;
  form: string;
  applies_from_fy: string;
  status: TaxAuditLibraryStatus;
  notes: string | null;
  based_on_version_no: number | null;
  clause_count: number;
  published_at: Date | null;
  published_by_name: string | null;
  version: number;
}

interface ClauseRow {
  id: string;
  clause_no: string;
  part: 'A' | 'B';
  title: string;
  sub_items: TaxAuditSubItem[];
  applies_when: TaxAuditCondition | null;
  not_applicable_reason: string | null;
  default_package: TaxAuditPackage;
  default_grade: TaxAuditGrade;
  evidence: string[];
  draft_source: TaxAuditDraftSource | null;
  partner_review: boolean;
  sort_order: number;
}

const VERSION_SELECT = `
  SELECT v.id, v.version_no, v.label, v.act, v.form, v.applies_from_fy, v.status, v.notes,
         b.version_no AS based_on_version_no,
         (SELECT count(*)::int FROM hsdg.tax_audit_clause_library c
           WHERE c.library_version_id = v.id) AS clause_count,
         v.published_at, pub.full_name AS published_by_name, v.version
    FROM hsdg.tax_audit_clause_library_versions v
    LEFT JOIN hsdg.tax_audit_clause_library_versions b ON b.id = v.based_on_version_id
    LEFT JOIN hsdg.employees pub ON pub.id = v.published_by_employee_id`;

const CLAUSE_COLUMNS = `id, clause_no, part, title, sub_items, applies_when, not_applicable_reason,
  default_package, default_grade, evidence, draft_source, partner_review, sort_order`;

export function toVersion(r: VersionRow): TaxAuditLibraryVersion {
  return {
    id: r.id,
    versionNo: r.version_no,
    label: r.label,
    act: r.act,
    form: r.form,
    appliesFromFy: r.applies_from_fy,
    status: r.status,
    notes: r.notes,
    basedOnVersionNo: r.based_on_version_no,
    clauseCount: r.clause_count,
    publishedAt: r.published_at ? r.published_at.toISOString() : null,
    publishedByName: r.published_by_name,
    version: r.version,
  };
}

export function toClause(r: ClauseRow): TaxAuditLibraryClause {
  return {
    id: r.id,
    clauseNo: r.clause_no,
    part: r.part,
    title: r.title,
    subItems: r.sub_items,
    appliesWhen: r.applies_when,
    notApplicableReason: r.not_applicable_reason,
    defaultPackage: r.default_package,
    defaultGrade: r.default_grade,
    evidence: r.evidence,
    draftSource: r.draft_source,
    partnerReview: r.partner_review,
    sortOrder: r.sort_order,
  };
}

/**
 * The problems with one clause, beyond what the DTO checks: a sound condition
 * over known audit facts, a Not applicable reason whenever the clause can fall
 * away, and sub-item keys unique within the clause.
 */
export function clauseProblems(c: TaxAuditLibraryClauseInput): string[] {
  const out = conditionProblems(c.appliesWhen).map((p) => `Clause ${c.clauseNo}: ${p}`);
  if (c.appliesWhen && !c.notApplicableReason?.trim()) {
    out.push(`Clause ${c.clauseNo}: say why it is Not applicable when its condition fails.`);
  }
  const keys = c.subItems.map((s) => s.key);
  if (new Set(keys).size !== keys.length) {
    out.push(`Clause ${c.clauseNo}: two sub-items share a key.`);
  }
  return out;
}

/** Every problem with a whole version's clauses (an import), clause numbers included. */
export function versionProblems(clauses: readonly TaxAuditLibraryClauseInput[]): string[] {
  const out: string[] = [];
  if (clauses.length === 0) out.push('A version needs at least one clause.');
  const seen = new Set<string>();
  for (const c of clauses) {
    if (seen.has(c.clauseNo)) out.push(`Clause ${c.clauseNo} is listed twice.`);
    seen.add(c.clauseNo);
    out.push(...clauseProblems(c));
  }
  return out;
}

/**
 * Form 3CD clause library (Phase 4, F-4). Everyone reads it; Admin and the
 * Managing Partner change it — on one draft at a time, copied from a published
 * version or imported whole as data, then published as the next version. A
 * published version never changes (the database refuses it too), so each tax
 * audit keeps the clauses it started with.
 */
@Injectable()
export class TaxAuditClauseLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async view(ctx: RlsContext, versionNo?: number): Promise<TaxAuditLibraryView> {
    return this.db.withRlsContext(ctx, (client) => this.viewWith(client, versionNo));
  }

  async createDraft(
    ctx: RlsContext,
    input: CreateTaxAuditLibraryDraftInput,
  ): Promise<TaxAuditLibraryView> {
    if (input.clauses) {
      const problems = versionProblems(input.clauses);
      if (problems.length) throw new BadRequestException(problems.join(' '));
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const draft = await client.query(
        `SELECT version_no FROM hsdg.tax_audit_clause_library_versions WHERE status = 'draft'`,
      );
      if (draft.rowCount) {
        throw new ConflictException(
          `Version ${draft.rows[0].version_no} is already a draft. Publish or discard it first.`,
        );
      }
      // An import starts from nothing; a copy starts from a published version.
      let base: { id: string; version_no: number } | undefined;
      if (!input.clauses) {
        const b = await client.query<{ id: string; version_no: number }>(
          `SELECT id, version_no FROM hsdg.tax_audit_clause_library_versions
            WHERE status = 'published' AND ($1::int IS NULL OR version_no = $1)
            ORDER BY version_no DESC LIMIT 1`,
          [input.basedOnVersionNo ?? null],
        );
        base = b.rows[0];
        if (!base) {
          throw new NotFoundException(
            input.basedOnVersionNo
              ? `Version ${input.basedOnVersionNo} is not a published version.`
              : 'There is no published version to copy.',
          );
        }
      }
      const created = await client.query<{ id: string; version_no: number }>(
        `INSERT INTO hsdg.tax_audit_clause_library_versions
           (version_no, label, act, form, applies_from_fy, notes, based_on_version_id,
            created_by_employee_id)
         SELECT COALESCE(max(version_no), 0) + 1, $1, $2, '3CD', $3, $4, $5, $6
           FROM hsdg.tax_audit_clause_library_versions
         RETURNING id, version_no`,
        [
          input.label.trim(),
          input.act,
          input.appliesFromFy,
          input.notes?.trim() || null,
          base?.id ?? null,
          ctx.employeeId ?? null,
        ],
      );
      const draftId = created.rows[0]!.id;
      if (base) {
        await client.query(
          `INSERT INTO hsdg.tax_audit_clause_library
             (library_version_id, clause_no, part, title, sub_items, applies_when,
              not_applicable_reason, default_package, default_grade, evidence, draft_source,
              partner_review, sort_order)
           SELECT $1, clause_no, part, title, sub_items, applies_when, not_applicable_reason,
                  default_package, default_grade, evidence, draft_source, partner_review, sort_order
             FROM hsdg.tax_audit_clause_library WHERE library_version_id = $2`,
          [draftId, base.id],
        );
      } else {
        const sorted = [...input.clauses!].sort(
          (a, b) => a.sortOrder - b.sortOrder || compareClauseNo(a.clauseNo, b.clauseNo),
        );
        for (const c of sorted) await this.insertClause(client, draftId, c);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_library.draft_created',
        objectType: 'tax_audit_clause_library_version',
        objectId: draftId,
        after: {
          versionNo: created.rows[0]!.version_no,
          label: input.label.trim(),
          act: input.act,
          appliesFromFy: input.appliesFromFy,
          basedOnVersionNo: base?.version_no ?? null,
          imported: input.clauses ? input.clauses.length : null,
        },
      });
      return this.viewWith(client, created.rows[0]!.version_no);
    });
  }

  async updateDraft(
    ctx: RlsContext,
    versionNo: number,
    input: {
      label: string;
      act: TaxAuditAct;
      appliesFromFy: string;
      notes?: string | null;
      version: number;
    },
  ): Promise<TaxAuditLibraryView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const draft = await this.draftOf(client, versionNo);
      if (draft.version !== input.version) {
        throw new ConflictException('Someone changed this draft since you opened it. Reload it.');
      }
      await client.query(
        `UPDATE hsdg.tax_audit_clause_library_versions
            SET label = $2, act = $3, applies_from_fy = $4, notes = $5, version = version + 1
          WHERE id = $1`,
        [draft.id, input.label.trim(), input.act, input.appliesFromFy, input.notes?.trim() || null],
      );
      return this.viewWith(client, versionNo);
    });
  }

  /** Add (clauseId null) or change a clause of the draft. */
  async upsertClause(
    ctx: RlsContext,
    versionNo: number,
    clauseId: string | null,
    input: TaxAuditLibraryClauseInput,
  ): Promise<TaxAuditLibraryView> {
    const problems = clauseProblems(input);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    return this.db.withRlsContext(ctx, async (client) => {
      const draft = await this.draftOf(client, versionNo);
      try {
        if (clauseId === null) {
          await this.insertClause(client, draft.id, input);
        } else {
          const res = await client.query(
            `UPDATE hsdg.tax_audit_clause_library
                SET clause_no = $3, part = $4, title = $5, sub_items = $6::jsonb,
                    applies_when = $7::jsonb, not_applicable_reason = $8, default_package = $9,
                    default_grade = $10, evidence = $11::jsonb, draft_source = $12,
                    partner_review = $13, sort_order = $14
              WHERE id = $1 AND library_version_id = $2`,
            [clauseId, draft.id, ...this.clauseValues(input)],
          );
          if (!res.rowCount) throw new NotFoundException('That clause is not on this draft.');
        }
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(`Clause ${input.clauseNo} is already on this draft.`);
        }
        throw err;
      }
      await this.touch(client, draft.id);
      return this.viewWith(client, versionNo);
    });
  }

  async removeClause(
    ctx: RlsContext,
    versionNo: number,
    clauseId: string,
  ): Promise<TaxAuditLibraryView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const draft = await this.draftOf(client, versionNo);
      const res = await client.query(
        `DELETE FROM hsdg.tax_audit_clause_library WHERE id = $1 AND library_version_id = $2`,
        [clauseId, draft.id],
      );
      if (!res.rowCount) throw new NotFoundException('That clause is not on this draft.');
      await this.touch(client, draft.id);
      return this.viewWith(client, versionNo);
    });
  }

  async publish(ctx: RlsContext, versionNo: number): Promise<TaxAuditLibraryView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const draft = await this.draftOf(client, versionNo);
      const clauses = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.tax_audit_clause_library WHERE library_version_id = $1`,
        [draft.id],
      );
      if (!clauses.rows[0]?.n) {
        throw new BadRequestException(
          'A version needs at least one clause before it is published.',
        );
      }
      await client.query(
        `UPDATE hsdg.tax_audit_clause_library_versions
            SET status = 'published', published_at = now(), published_by_employee_id = $2,
                version = version + 1
          WHERE id = $1`,
        [draft.id, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_library.published',
        objectType: 'tax_audit_clause_library_version',
        objectId: draft.id,
        after: { versionNo, clauses: clauses.rows[0].n },
      });
      return this.viewWith(client, versionNo);
    });
  }

  async discardDraft(ctx: RlsContext, versionNo: number): Promise<TaxAuditLibraryView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const draft = await this.draftOf(client, versionNo);
      await client.query(`DELETE FROM hsdg.tax_audit_clause_library_versions WHERE id = $1`, [
        draft.id,
      ]);
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_library.draft_discarded',
        objectType: 'tax_audit_clause_library_version',
        objectId: draft.id,
        before: { versionNo },
      });
      return this.viewWith(client);
    });
  }

  private async viewWith(client: PoolClient, versionNo?: number): Promise<TaxAuditLibraryView> {
    const { rows } = await client.query<VersionRow>(`${VERSION_SELECT} ORDER BY v.version_no DESC`);
    const versions = rows.map(toVersion);
    const selected =
      versionNo !== undefined
        ? versions.find((v) => v.versionNo === versionNo)
        : (versions.find((v) => v.status === 'draft') ??
          versions.find((v) => v.status === 'published'));
    if (versionNo !== undefined && !selected) {
      throw new NotFoundException(`There is no version ${versionNo} of the Form 3CD library.`);
    }
    if (!selected) return { versions, selected: null, clauses: [] };
    const clauses = await client.query<ClauseRow>(
      `SELECT ${CLAUSE_COLUMNS} FROM hsdg.tax_audit_clause_library
        WHERE library_version_id = $1`,
      [selected.id],
    );
    return {
      versions,
      selected,
      clauses: clauses.rows
        .map(toClause)
        .sort((a, b) => a.sortOrder - b.sortOrder || compareClauseNo(a.clauseNo, b.clauseNo)),
    };
  }

  private async draftOf(
    client: PoolClient,
    versionNo: number,
  ): Promise<{ id: string; version: number }> {
    const { rows } = await client.query<{ id: string; status: string; version: number }>(
      `SELECT id, status, version FROM hsdg.tax_audit_clause_library_versions WHERE version_no = $1`,
      [versionNo],
    );
    const v = rows[0];
    if (!v)
      throw new NotFoundException(`There is no version ${versionNo} of the Form 3CD library.`);
    if (v.status !== 'draft') {
      throw new ConflictException(
        `Version ${versionNo} is published and cannot change. Start a new draft from it.`,
      );
    }
    return v;
  }

  private clauseValues(c: TaxAuditLibraryClauseInput): unknown[] {
    return [
      c.clauseNo,
      c.part,
      c.title.trim(),
      JSON.stringify(c.subItems),
      c.appliesWhen ? JSON.stringify(c.appliesWhen) : null,
      c.notApplicableReason?.trim() || null,
      c.defaultPackage,
      c.defaultGrade,
      JSON.stringify(c.evidence.map((e) => e.trim()).filter(Boolean)),
      c.draftSource,
      c.partnerReview,
      c.sortOrder,
    ];
  }

  private async insertClause(
    client: PoolClient,
    versionId: string,
    c: TaxAuditLibraryClauseInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.tax_audit_clause_library
         (library_version_id, clause_no, part, title, sub_items, applies_when,
          not_applicable_reason, default_package, default_grade, evidence, draft_source,
          partner_review, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
      [versionId, ...this.clauseValues(c)],
    );
  }

  private async touch(client: PoolClient, versionId: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.tax_audit_clause_library_versions SET version = version + 1 WHERE id = $1`,
      [versionId],
    );
  }
}

/**
 * The library version an audit of `financialYear` runs on: the newest
 * published version whose first year is on or before it (F-5 stores it on the
 * audit when its clause work starts, so later versions never move it).
 */
export async function libraryVersionForYear(
  client: PoolClient,
  financialYear: string,
): Promise<{ id: string; versionNo: number } | null> {
  const { rows } = await client.query<{ id: string; version_no: number }>(
    `SELECT id, version_no FROM hsdg.tax_audit_clause_library_versions
      WHERE status = 'published' AND applies_from_fy <= $1
      ORDER BY applies_from_fy DESC, version_no DESC LIMIT 1`,
    [financialYear],
  );
  return rows[0] ? { id: rows[0].id, versionNo: rows[0].version_no } : null;
}
