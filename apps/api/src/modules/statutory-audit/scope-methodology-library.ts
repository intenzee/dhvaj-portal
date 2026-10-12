import { BadRequestException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DECISION_DEFS,
  SCOPE_METHODOLOGY_KINDS,
  SCOPE_METHODOLOGY_STATUSES,
  SCOPE_METHODOLOGY_VERSION,
  type CreateScopeMethodologyItemVersionInput,
  type DecisionItemDef,
  type ScopeDecisionKind,
  type ScopeMethodologyItemRecord,
  type ScopeMethodologyLibrary,
  type ScopeMethodologyRef,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { checkDates, uniq } from './planning-analytics-library';

interface ItemRow {
  id: string;
  item_code: string;
  version: number;
  kind: ScopeDecisionKind;
  item_key: string;
  label: string;
  options: string[];
  hint: string | null;
  guidance: string | null;
  sort_order: number;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  methodology_version: string;
  change_note: string | null;
  created_by_name: string | null;
  created_at: Date;
}

// Only the admin listing joins hsdg.employees; resolving a file's lists never needs names.
const itemSelect = (creators = true) => `
  SELECT t.id, t.item_code, t.version, t.kind, t.item_key, t.label, t.options, t.hint, t.guidance,
         t.sort_order, t.effective_from::text, t.effective_to::text, t.active,
         t.methodology_version, t.change_note,
         ${creators ? 'e.full_name' : 'NULL::text'} AS created_by_name, t.created_at
    FROM hsdg.scope_methodology_item t
    ${creators ? 'LEFT JOIN hsdg.employees e ON e.id = t.created_by_employee_id' : ''}`;
const ITEM_SELECT = itemSelect();

function toItem(r: ItemRow): ScopeMethodologyItemRecord {
  return {
    id: r.id,
    itemCode: r.item_code,
    version: r.version,
    kind: r.kind,
    itemKey: r.item_key,
    label: r.label,
    options: r.options ?? [],
    hint: r.hint,
    guidance: r.guidance,
    sortOrder: r.sort_order,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    active: r.active,
    methodologyVersion: r.methodology_version,
    changeNote: r.change_note,
    createdByName: r.created_by_name,
    createdAt: r.created_at.toISOString(),
  };
}

/** Every version of every 03.4 methodology item (any authenticated role may read it). */
export async function readScopeMethodologyLibrary(
  client: PoolClient,
  { creators = true }: { creators?: boolean } = {},
): Promise<ScopeMethodologyItemRecord[]> {
  const { rows } = await client.query<ItemRow>(
    `${itemSelect(creators)} ORDER BY t.item_code, t.version DESC`,
  );
  return rows.map(toItem);
}

export interface ScopeDecisionDefs {
  defs: Record<ScopeDecisionKind, DecisionItemDef[]>;
  /** Retired items keyed `kind:item_key` — kept so a saved decision on one stays visible. */
  retired: Map<string, DecisionItemDef>;
  methodology: ScopeMethodologyRef;
}

const toDef = (r: ScopeMethodologyItemRecord): DecisionItemDef => ({
  key: r.itemKey,
  label: r.label,
  options: r.options,
  ...(r.hint ? { hint: r.hint } : {}),
  itemCode: r.itemCode,
  itemVersion: r.version,
  guidance: r.guidance,
});

/**
 * Pure — the 03.4 decision lists in force on `asOf` (YYYY-MM-DD): per item
 * code, the latest version effective on that date; inactive versions retire
 * the item. An empty library falls back to the built-in lists.
 */
export function resolveDecisionDefs(
  items: readonly ScopeMethodologyItemRecord[],
  asOf: string,
): ScopeDecisionDefs {
  if (!items.length) {
    return {
      defs: DECISION_DEFS,
      retired: new Map(),
      methodology: { version: SCOPE_METHODOLOGY_VERSION, source: 'built_in' },
    };
  }
  const byCode = new Map<string, ScopeMethodologyItemRecord>();
  const latestAny = new Map<string, ScopeMethodologyItemRecord>();
  for (const it of [...items].sort((a, b) => b.version - a.version)) {
    if (!latestAny.has(it.itemCode)) latestAny.set(it.itemCode, it);
    if (byCode.has(it.itemCode)) continue;
    if (it.effectiveFrom > asOf || (it.effectiveTo !== null && it.effectiveTo < asOf)) continue;
    byCode.set(it.itemCode, it);
  }
  const defs = Object.fromEntries(
    SCOPE_METHODOLOGY_KINDS.map((k) => [k, [] as DecisionItemDef[]]),
  ) as Record<ScopeDecisionKind, DecisionItemDef[]>;
  const inForce = [...byCode.values()]
    .filter((x) => x.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.itemCode.localeCompare(b.itemCode));
  for (const it of inForce) defs[it.kind].push(toDef(it));
  const live = new Set(inForce.map((x) => `${x.kind}:${x.itemKey}`));
  const retired = new Map<string, DecisionItemDef>();
  for (const it of latestAny.values()) {
    const key = `${it.kind}:${it.itemKey}`;
    if (!live.has(key)) retired.set(key, toDef(it));
  }
  const versions = [...new Set(inForce.map((x) => x.methodologyVersion))].sort();
  return {
    defs,
    retired,
    methodology: {
      version: versions[versions.length - 1] ?? SCOPE_METHODOLOGY_VERSION,
      source: 'library',
    },
  };
}

/** The 03.4 decision lists in force today (library, else built-in). */
export async function readScopeDecisionDefs(client: PoolClient): Promise<ScopeDecisionDefs> {
  const items = await readScopeMethodologyLibrary(client, { creators: false });
  return resolveDecisionDefs(items, new Date().toISOString().slice(0, 10));
}

const ITEM_CODE = /^SMI-[0-9]{3}$/;
const ITEM_KEY = /^[a-z][a-z0-9_]{1,59}$/;
const STATUSES = new Set(SCOPE_METHODOLOGY_STATUSES);

/**
 * 03.4 Methodology Library administration (DHVAJ 03.4 §31). The Methodology
 * Admin (service.manage) maintains the controls cycles, timing areas, evidence
 * channels and technology uses — their labels, answer vocabularies, hints and
 * guidance — without a deployment. Insert-only: every change appends a version
 * effective from a date. A code governs one item (kind + key) for life. Never
 * reads client data and cannot conclude an engagement's scope.
 */
@Injectable()
export class ScopeMethodologyLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RlsContext): Promise<ScopeMethodologyLibrary> {
    return this.db.withRlsContext(ctx, async (client) => ({
      items: await readScopeMethodologyLibrary(client),
    }));
  }

  addItemVersion(
    ctx: RlsContext,
    input: CreateScopeMethodologyItemVersionInput,
  ): Promise<ScopeMethodologyItemRecord> {
    if (!ITEM_CODE.test(input.itemCode ?? '')) {
      throw new BadRequestException('itemCode must look like SMI-001.');
    }
    if (!SCOPE_METHODOLOGY_KINDS.includes(input.kind)) {
      throw new BadRequestException('Unknown item kind.');
    }
    if (!ITEM_KEY.test(input.itemKey ?? '')) {
      throw new BadRequestException('itemKey must be lower_snake_case (2–60 characters).');
    }
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('An item needs a label.');
    if (!input.changeNote?.trim()) throw new BadRequestException('A change note is required.');
    const options = uniq(input.options);
    if (options.length < 2 || options.length > 8) {
      throw new BadRequestException('An item offers between 2 and 8 answers.');
    }
    const bad = options.find((o) => !STATUSES.has(o));
    if (bad) throw new BadRequestException(`"${bad}" is not a 03.4 answer the portal knows.`);
    checkDates(input);

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('scope_methodology_item'))`);
      const { rows: latestRows } = await client.query<ItemRow>(
        `${ITEM_SELECT} WHERE t.item_code = $1 ORDER BY t.version DESC LIMIT 1`,
        [input.itemCode],
      );
      const latest = latestRows[0];
      if (latest && (latest.kind !== input.kind || latest.item_key !== input.itemKey)) {
        throw new BadRequestException(
          `${input.itemCode} governs ${latest.kind} "${latest.item_key}" — add a new item for another one.`,
        );
      }
      if (!latest) {
        // One live code per kind + key, so a file's saved decisions stay unambiguous.
        const { rows } = await client.query<{ item_code: string }>(
          `SELECT DISTINCT item_code FROM hsdg.scope_methodology_item WHERE kind = $1 AND item_key = $2`,
          [input.kind, input.itemKey],
        );
        if (rows[0]) {
          throw new BadRequestException(
            `${rows[0].item_code} already governs ${input.kind} "${input.itemKey}" — add a version of it.`,
          );
        }
      }
      const version = (latest?.version ?? 0) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.scope_methodology_item
           (item_code, version, kind, item_key, label, options, hint, guidance, sort_order,
            effective_from, effective_to, active, methodology_version, change_note,
            created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::date, DATE '2000-01-01'),
                 $11::date, $12, $13, $14, $15)
         RETURNING id`,
        [
          input.itemCode,
          version,
          input.kind,
          input.itemKey,
          label,
          options,
          input.hint !== undefined ? input.hint?.trim() || null : (latest?.hint ?? null),
          input.guidance !== undefined
            ? input.guidance?.trim() || null
            : (latest?.guidance ?? null),
          input.sortOrder ?? latest?.sort_order ?? 0,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          input.active ?? true,
          input.methodologyVersion?.trim() ||
            latest?.methodology_version ||
            SCOPE_METHODOLOGY_VERSION,
          input.changeNote.trim(),
          ctx.employeeId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'scope_methodology_item.version_added',
        objectType: 'scope_methodology_item',
        objectId: id,
        after: {
          itemCode: input.itemCode,
          kind: input.kind,
          version,
          active: input.active ?? true,
        },
      });
      return toItem((await client.query<ItemRow>(`${ITEM_SELECT} WHERE t.id = $1`, [id])).rows[0]!);
    });
  }
}
