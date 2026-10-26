import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  GST_STATES,
  officeLabel,
  readGstin,
  stateCodeFromName,
  withCompanySuffix,
  type AddBranchInput,
  type BranchCandidate,
  type BranchCandidateClient,
  type BranchCandidateOffice,
  type CombineBranchesInput,
  type UpdateBranchInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { ClientMergeService } from './client-merge.service';
import { EntitiesService } from './entities.service';
import {
  officesOfOneBusiness,
  parseClientName,
  splitPlaceFromName,
  type ClientIdentity,
} from './client-names';
import type { EntityDetail } from './entities.types';

interface ClientRow {
  id: string;
  entity_code: string;
  legal_name: string;
  pan: string | null;
  type_slug: string;
  office_code: string;
  created_at: string;
  address_state: string | null;
  branch_count: number;
  gstins: { id: string; n: string; p: boolean }[] | null;
}

interface Member {
  row: ClientRow;
  gstins: { id: string; gstin: string; stateCode: string | null; principal: boolean }[];
  place: { text: string; state: string | null } | null;
  identity: ClientIdentity;
}

const ENDED = ['completed', 'closed', 'declined', 'withdrawn', 'cancelled', 'merged'];

/**
 * One client, several offices (CM-6): the clients that should be one client
 * with offices ("GRIID" and "GRIID - Chandigarh"; two clients of one PAN in
 * two states), combining them, and the offices of a client.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly merges: ClientMergeService,
    private readonly entities: EntitiesService,
  ) {}

  /**
   * "Offices to combine": live clients that are offices of one business
   * (`officesOfOneBusiness` — the same name but for a place, or one PAN in
   * different states), PAN or no PAN; and single clients with two or more
   * GSTINs but no offices yet. Never two PANs; never a dismissed pair.
   */
  async candidates(ctx: RlsContext): Promise<BranchCandidate[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ClientRow>(
        `SELECT e.id, e.entity_code, e.legal_name, e.pan, et.slug AS type_slug, o.code AS office_code,
                e.created_at::text AS created_at,
                (SELECT a.state FROM hsdg.entity_addresses a
                  WHERE a.entity_id = e.id AND a.address_type = 'registered'
                  ORDER BY a.is_primary DESC LIMIT 1) AS address_state,
                (SELECT count(*)::int FROM hsdg.entity_branches b
                  WHERE b.entity_id = e.id AND b.archived_at IS NULL) AS branch_count,
                (SELECT json_agg(json_build_object('id', r.id, 'n', r.registration_number, 'p', r.is_principal)
                                 ORDER BY r.is_principal DESC, r.created_at)
                   FROM hsdg.entity_registrations r
                  WHERE r.entity_id = e.id AND r.registration_type = 'gstin' AND r.status = 'active') AS gstins
           FROM hsdg.entities e
           JOIN hsdg.entity_types et ON et.id = e.entity_type_id
           JOIN hsdg.offices o ON o.id = e.home_office_id
          WHERE e.merged_into_id IS NULL AND e.status <> 'archived'
          ORDER BY e.created_at`,
      );
      const dismissed = await client.query<{ a: string; b: string }>(
        `SELECT entity_a_id AS a, entity_b_id AS b FROM hsdg.entity_duplicate_dismissals
          WHERE kind = 'branch'`,
      );
      const skip = new Set(dismissed.rows.map((d) => `${d.a}|${d.b}`));
      const isDismissed = (x: string, y: string): boolean =>
        skip.has(x < y ? `${x}|${y}` : `${y}|${x}`);

      const members: Member[] = rows.map((row) => {
        const gstins = (row.gstins ?? []).map((g) => {
          const read = readGstin(g.n);
          return { id: g.id, gstin: read.gstin, stateCode: read.stateCode, principal: g.p };
        });
        return {
          row,
          gstins,
          place: parseClientName(row.legal_name).place,
          identity: { name: row.legal_name, pan: row.pan, gstins: gstins.map((g) => g.gstin) },
        };
      });

      // Compare only clients sharing a PAN or the first word of the name.
      const buckets = new Map<string, number[]>();
      members.forEach((m, i) => {
        const keys = new Set<string>();
        if (m.row.pan) keys.add(`pan:${m.row.pan}`);
        for (const g of m.gstins)
          if (g.gstin.length === 15) keys.add(`pan:${g.gstin.slice(2, 12)}`);
        const first = parseClientName(m.row.legal_name).words[0];
        if (first) keys.add(`w:${first}`);
        for (const k of keys) buckets.set(k, [...(buckets.get(k) ?? []), i]);
      });
      // Offices of one business join one card (union–find).
      const parent = members.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      const why = new Map<number, string[]>();
      for (const idx of buckets.values()) {
        if (idx.length < 2 || idx.length > 200) continue;
        for (let x = 0; x < idx.length; x++)
          for (let y = x + 1; y < idx.length; y++) {
            const [i, j] = [idx[x]!, idx[y]!];
            if (find(i) === find(j) || isDismissed(members[i]!.row.id, members[j]!.row.id))
              continue;
            const reasons = officesOfOneBusiness(members[i]!.identity, members[j]!.identity);
            if (!reasons) continue;
            const [ri, rj] = [find(i), find(j)];
            parent[rj] = ri;
            why.set(ri, [...(why.get(ri) ?? []), ...(why.get(rj) ?? []), ...reasons]);
          }
      }
      const groups = new Map<number, Member[]>();
      members.forEach((m, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), m]));

      const cards: { kind: BranchCandidate['kind']; members: Member[]; reasons: string[] }[] = [];
      for (const [root, group] of groups) {
        if (group.length > 1) {
          const keeper = pickKeeper(group);
          cards.push({
            kind: 'combine',
            members: [keeper, ...group.filter((m) => m !== keeper)],
            reasons: [...new Set(why.get(root) ?? [])],
          });
        } else {
          const m = group[0]!;
          if (m.gstins.length >= 2 && m.row.branch_count === 0)
            cards.push({
              kind: 'setup',
              members: [m],
              reasons: [`${m.gstins.length} GSTINs and no offices set up yet.`],
            });
        }
      }
      const counts = await this.counts(
        client,
        cards.flatMap((c) => c.members.map((m) => m.row.id)),
      );
      return cards
        .map((c) => this.card(c.kind, c.members, c.reasons, counts))
        .sort((a, b) =>
          a.kind === b.kind
            ? a.proposedName.localeCompare(b.proposedName)
            : a.kind === 'combine'
              ? -1
              : 1,
        )
        .slice(0, 300);
    });
  }

  /** Registrations, logins, open engagements and unpaid invoices that move with each client. */
  private async counts(
    client: PoolClient,
    ids: string[],
  ): Promise<Map<string, BranchCandidateClient['counts']>> {
    if (ids.length === 0) return new Map();
    const { rows } = await client.query<{ id: string } & BranchCandidateClient['counts']>(
      `SELECT e.id,
              (SELECT count(*)::int FROM hsdg.entity_registrations WHERE entity_id = e.id) AS registrations,
              (SELECT count(*)::int FROM hsdg.client_credentials WHERE entity_id = e.id) AS logins,
              (SELECT count(*)::int FROM hsdg.engagements
                WHERE entity_id = e.id AND status <> ALL($2::text[])) AS "openEngagements",
              (SELECT count(*)::int FROM hsdg.invoices
                WHERE client_entity_id = e.id AND status = 'issued') AS "unpaidInvoices"
         FROM hsdg.entities e WHERE e.id = ANY($1::uuid[])`,
      [ids, ENDED],
    );
    return new Map(rows.map(({ id, ...c }) => [id, c]));
  }

  private card(
    kind: BranchCandidate['kind'],
    members: Member[],
    reasons: string[],
    counts: Map<string, BranchCandidateClient['counts']>,
  ): BranchCandidate {
    const keeper = members[0]!;
    const base = splitPlaceFromName(keeper.row.legal_name).name;
    const offices: BranchCandidateOffice[] = [];
    const used = new Set<string>();
    const unique = (label: string, fallback: string): string => {
      let out = label;
      for (let n = 2; used.has(out.toLowerCase()); n += 1) out = `${fallback} ${n}`;
      used.add(out.toLowerCase());
      return out;
    };
    // The head office: the kept client's principal GSTIN, else the one in its
    // address's state, else its first; a kept client without a GSTIN is itself it.
    const headReg =
      keeper.gstins.find((g) => g.principal)?.id ??
      keeper.gstins.find((g) => g.stateCode === stateCodeFromName(keeper.row.address_state ?? ''))
        ?.id ??
      keeper.gstins[0]?.id ??
      null;
    for (const m of members) {
      for (const g of m.gstins) {
        const state = g.stateCode ? (GST_STATES[g.stateCode] ?? null) : null;
        const head = g.id === headReg;
        offices.push({
          registrationId: g.id,
          gstin: g.gstin,
          stateCode: g.stateCode,
          entityId: m.row.id,
          label: unique(
            head
              ? 'Head office'
              : officeLabel(m.gstins.length === 1 ? (m.place?.text ?? null) : null, state),
            officeLabel(null, state),
          ),
          isHeadOffice: head,
        });
      }
      // A client without a GSTIN is an office by itself, named for its place.
      if (m.gstins.length === 0) {
        const head = m === keeper && !headReg;
        const stateCode = m.place?.state ?? null;
        const state = stateCode ? (GST_STATES[stateCode] ?? null) : null;
        offices.push({
          registrationId: null,
          gstin: null,
          stateCode,
          entityId: m.row.id,
          label: unique(
            head ? 'Head office' : officeLabel(m.place?.text ?? null, state),
            officeLabel(null, state),
          ),
          isHeadOffice: head,
        });
      }
    }
    const clients: BranchCandidateClient[] = members.map((m) => ({
      id: m.row.id,
      entityCode: m.row.entity_code,
      legalName: m.row.legal_name,
      pan: m.row.pan,
      officeCode: m.row.office_code,
      counts: counts.get(m.row.id) ?? {
        registrations: 0,
        logins: 0,
        openEngagements: 0,
        unpaidInvoices: 0,
      },
    }));
    const pan =
      members.map((m) => m.row.pan).find(Boolean) ??
      members
        .flatMap((m) => m.gstins)
        .map((g) => readGstin(g.gstin).pan)
        .find(Boolean) ??
      null;
    return {
      kind,
      pan,
      clients,
      keepId: keeper.row.id,
      proposedName: withCompanySuffix(base, keeper.row.type_slug),
      offices,
      reasons,
    };
  }

  async dismiss(ctx: RlsContext, aId: string, bId: string): Promise<void> {
    await this.merges.dismiss(ctx, aId, bId, undefined, 'branch');
  }

  /**
   * Combine offices of one business into the kept client, in one
   * transaction: each other client is merged in (merge_entities), an office is
   * made per GSTIN (or per client without one), the other clients' addresses
   * and contacts go under their office, and the kept client takes the name
   * without the place.
   */
  async combine(
    ctx: RlsContext,
    keepId: string,
    input: CombineBranchesInput,
  ): Promise<EntityDetail> {
    if (input.offices.length === 0) throw new BadRequestException('Name at least one office.');
    const heads = input.offices.filter((o) => o.isHeadOffice).length;
    if (heads > 1) throw new BadRequestException('Only one office can be the head office.');
    const labels = input.offices.map((o) => o.label.trim().toLowerCase());
    if (labels.some((l) => !l)) throw new BadRequestException('Every office needs a name.');
    if (new Set(labels).size !== labels.length)
      throw new BadRequestException('Two offices have the same name; make them differ.');
    const otherIds = [...new Set(input.others.map((o) => o.entityId))].filter(
      (id) => id !== keepId,
    );

    for (const o of input.offices)
      if (!o.registrationId && !o.entityId)
        throw new BadRequestException('Each office needs a GSTIN or the client it was.');

    return this.db.withRlsContext(ctx, async (client) => {
      // What each client holds before the merge moves it: GSTINs, addresses
      // and contacts not yet under an office, and the place in its name.
      const held = new Map<
        string,
        { regs: string[]; addresses: string[]; contacts: string[]; place: string | null }
      >();
      for (const id of [keepId, ...otherIds]) {
        const { rows } = await client.query<{
          legal_name: string;
          regs: string[] | null;
          addresses: string[] | null;
          contacts: string[] | null;
        }>(
          `SELECT e.legal_name,
                  (SELECT array_agg(id) FROM hsdg.entity_registrations
                    WHERE entity_id = $1 AND registration_type = 'gstin' AND status = 'active') AS regs,
                  (SELECT array_agg(id) FROM hsdg.entity_addresses
                    WHERE entity_id = $1 AND branch_id IS NULL) AS addresses,
                  (SELECT array_agg(id) FROM hsdg.entity_contacts
                    WHERE entity_id = $1 AND branch_id IS NULL) AS contacts
             FROM hsdg.entities e WHERE e.id = $1`,
          [id],
        );
        if (!rows[0]) throw new NotFoundException('Client not found.');
        held.set(id, {
          regs: rows[0].regs ?? [],
          addresses: rows[0].addresses ?? [],
          contacts: rows[0].contacts ?? [],
          place: splitPlaceFromName(rows[0].legal_name).state,
        });
      }

      const before = await this.entities.detailWith(client, keepId);
      if (!before) throw new NotFoundException('Client not found.');
      for (const id of otherIds) await this.merges.mergeWith(client, ctx, keepId, id, []);

      if (heads === 1)
        await client.query(
          `UPDATE hsdg.entity_branches SET is_head_office = false
            WHERE entity_id = $1 AND is_head_office AND archived_at IS NULL`,
          [keepId],
        );
      const officeOfReg = new Map<string, string>();
      const officeOfClient = new Map<string, string>();
      for (const o of input.offices) {
        let stateCode: string | null = null;
        if (o.registrationId) {
          const reg = await client.query<{ registration_number: string }>(
            `SELECT registration_number FROM hsdg.entity_registrations WHERE id = $1 AND entity_id = $2`,
            [o.registrationId, keepId],
          );
          if (!reg.rows[0])
            throw new BadRequestException('A GSTIN in the offices is not this client’s.');
          stateCode = readGstin(reg.rows[0].registration_number).stateCode;
        } else {
          if (!held.has(o.entityId!))
            throw new BadRequestException('An office names a client not being combined.');
          stateCode = held.get(o.entityId!)!.place;
        }
        const branchId = await this.insertBranch(client, ctx, keepId, {
          label: o.label.trim(),
          stateCode,
          isHeadOffice: o.isHeadOffice,
        });
        if (o.registrationId) {
          await client.query(`UPDATE hsdg.entity_registrations SET branch_id = $1 WHERE id = $2`, [
            branchId,
            o.registrationId,
          ]);
          officeOfReg.set(o.registrationId, branchId);
        } else officeOfClient.set(o.entityId!, branchId);
      }
      // A client that was one office brings its addresses and contacts to it.
      // The kept client's stay with the whole client unless it was such an office.
      for (const [id, h] of held) {
        const viaRegs = [...new Set(h.regs.map((r) => officeOfReg.get(r)).filter(Boolean))];
        const office =
          officeOfClient.get(id) ?? (id !== keepId && viaRegs.length === 1 ? viaRegs[0] : null);
        if (!office) continue;
        if (h.addresses.length)
          await client.query(
            `UPDATE hsdg.entity_addresses SET branch_id = $1 WHERE id = ANY($2::uuid[])`,
            [office, h.addresses],
          );
        if (h.contacts.length)
          await client.query(
            `UPDATE hsdg.entity_contacts SET branch_id = $1 WHERE id = ANY($2::uuid[])`,
            [office, h.contacts],
          );
      }
      const name = input.legalName?.trim();
      if (name && name !== before.legalName)
        await client.query(
          `UPDATE hsdg.entities SET legal_name = $2, version = version + 1 WHERE id = $1`,
          [keepId, name],
        );

      const after = await this.entities.detailWith(client, keepId);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.branches_combined',
        objectType: 'entity',
        objectId: keepId,
        before: { legalName: before.legalName, others: otherIds },
        after: { legalName: after!.legalName, offices: after!.branches },
      });
      return after!;
    });
  }

  async add(ctx: RlsContext, entityId: string, input: AddBranchInput): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.entities.detailWith(client, entityId);
      if (!before) throw new NotFoundException('Client not found.');
      let stateCode = input.stateCode ?? null;
      if (input.registrationId) {
        const reg = before.registrations.find((r) => r.id === input.registrationId);
        if (!reg) throw new BadRequestException('That registration is not this client’s.');
        stateCode ??= readGstin(reg.registrationNumber).stateCode;
      }
      if (input.isHeadOffice)
        await client.query(
          `UPDATE hsdg.entity_branches SET is_head_office = false
            WHERE entity_id = $1 AND is_head_office AND archived_at IS NULL`,
          [entityId],
        );
      const branchId = await this.insertBranch(client, ctx, entityId, {
        label: input.label.trim(),
        stateCode,
        isHeadOffice: input.isHeadOffice ?? false,
      });
      if (input.registrationId)
        await client.query(`UPDATE hsdg.entity_registrations SET branch_id = $1 WHERE id = $2`, [
          branchId,
          input.registrationId,
        ]);
      const after = await this.entities.detailWith(client, entityId);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.branch_added',
        objectType: 'entity',
        objectId: entityId,
        after: after!.branches.find((b) => b.id === branchId),
      });
      return after!;
    });
  }

  async update(
    ctx: RlsContext,
    entityId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.entities.detailWith(client, entityId);
      const branch = before?.branches.find((b) => b.id === branchId);
      if (!before || !branch) throw new NotFoundException('Office not found.');
      if (input.version !== undefined && input.version !== branch.version)
        throw new ConflictException('The office was changed by someone else. Refresh and retry.');
      if (input.isHeadOffice)
        await client.query(
          `UPDATE hsdg.entity_branches SET is_head_office = false
            WHERE entity_id = $1 AND is_head_office AND archived_at IS NULL AND id <> $2`,
          [entityId, branchId],
        );
      try {
        await client.query(
          `UPDATE hsdg.entity_branches
              SET label = COALESCE($3, label),
                  is_head_office = CASE WHEN $5::boolean THEN false ELSE COALESCE($4, is_head_office) END,
                  archived_at = CASE WHEN $5::boolean THEN now()
                                     WHEN $5::boolean IS FALSE THEN NULL ELSE archived_at END,
                  version = version + 1
            WHERE id = $1 AND entity_id = $2`,
          [
            branchId,
            entityId,
            input.label?.trim() || null,
            input.isHeadOffice ?? null,
            input.archived ?? null,
          ],
        );
      } catch (err) {
        throw branchError(err);
      }
      const after = await this.entities.detailWith(client, entityId);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.branch_updated',
        objectType: 'entity',
        objectId: entityId,
        before: branch,
        after: after!.branches.find((b) => b.id === branchId),
      });
      return after!;
    });
  }

  private async insertBranch(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    b: { label: string; stateCode: string | null; isHeadOffice: boolean },
  ): Promise<string> {
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.entity_branches (entity_id, label, state_code, is_head_office, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [entityId, b.label, b.stateCode, b.isHeadOffice, ctx.userId],
      );
      return rows[0]!.id;
    } catch (err) {
      throw branchError(err);
    }
  }
}

function branchError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'entity_branches_label_unique')
    return new ConflictException('The client already has an office of that name.');
  if (e.code === '23505' && e.constraint === 'entity_branches_one_head_office')
    return new ConflictException('The client already has a head office.');
  return err as Error;
}

/** The keeper: the name without a place; else the one whose GSTIN state is its address's; else the oldest. */
function pickKeeper(members: Member[]): Member {
  const score = (m: Member): number => {
    if (!m.place) return 0;
    const addr = stateCodeFromName(m.row.address_state ?? '');
    return addr && m.gstins.some((g) => g.stateCode === addr) ? 1 : 2;
  };
  return [...members].sort(
    (a, b) => score(a) - score(b) || a.row.created_at.localeCompare(b.row.created_at),
  )[0]!;
}
