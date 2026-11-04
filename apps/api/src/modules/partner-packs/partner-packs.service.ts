import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  PARTNER_PACK_RISK_ITEMS,
  RISK_TILE_LABEL,
  SYSTEM_ROLE,
  formatInr,
  monthBounds,
  partnerPackMonthLabel,
  type PartnerPackFigures,
  type PartnerPackSummary,
  type RoleSlug,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { workLinkJoin } from '../../common/work-links';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskService } from '../dashboard/risk.service';
import { pickEffectiveRole } from '../auth/auth.service';
import { partnerMonthProfitability } from '../reports/profitability.service';
import { renderPartnerPackPdf } from './partner-pack-pdf';

/** Who a pack is for: the partner, as the database sees them. */
export interface PackPartner {
  ctx: RlsContext;
  employeeId: string;
  name: string;
  officeCode: string | null;
}

/** The roles that get a pack each month. */
const PACK_ROLES: RoleSlug[] = ['managing_partner', 'partner'];
const FIRM_WIDE = ['managing_partner', 'admin'];

interface PackRow {
  id: string;
  month: string;
  partner_employee_id: string;
  partner_name: string;
  generated_at: string;
  figures: PartnerPackFigures;
}

const PACK_SELECT = `SELECT pp.id, pp.month, pp.partner_employee_id, e.full_name AS partner_name,
         pp.generated_at, pp.figures
    FROM hsdg.partner_packs pp
    JOIN hsdg.employee_names e ON e.id = pp.partner_employee_id`;

/** "Risk 12 · Filed 86 · Collected ₹4,20,000". */
export function packHeadline(f: PartnerPackFigures): string {
  const risk = f.risk.filter((t) => t.available).reduce((n, t) => n + t.count, 0);
  return `Risk ${risk} · Filed ${f.filingsDone.total} · Collected ₹${formatInr(f.collected.amount)}`;
}

function summaryOf(r: PackRow): PartnerPackSummary {
  return {
    id: r.id,
    month: r.month,
    partnerEmployeeId: r.partner_employee_id,
    partnerName: r.partner_name,
    generatedAt: new Date(r.generated_at).toISOString(),
    headline: packHeadline(r.figures),
  };
}

/**
 * PS-303 · the partner's monthly pack: built as the partner (so each figure is
 * scoped as their screens are), kept as figures, drawn as a PDF on download.
 */
@Injectable()
export class PartnerPacksService {
  private readonly logger = new Logger(PartnerPacksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly risk: RiskService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Last month's figures, read as `partner` (the screens' figures, at this moment). */
  async figures(partner: PackPartner, month: string): Promise<PartnerPackFigures> {
    const { from, to } = monthBounds(month);
    const board = await this.risk.dashboard(partner.ctx, PARTNER_PACK_RISK_ITEMS);
    const scope = FIRM_WIDE.includes(partner.ctx.role) ? 'firm' : 'own';
    const { month$, profitability } = await this.db.withRlsContext(partner.ctx, async (client) => ({
      month$: await this.monthFigures(client, from, to),
      // PS-302: the firm's (MP) or the partner's own engagements; null without practice.finance.
      profitability: await partnerMonthProfitability(client, partner.ctx, {
        from,
        to,
        ...(scope === 'own' ? { partnerId: partner.employeeId } : {}),
      }),
    }));
    return {
      month,
      from,
      to,
      asOf: board.asOf,
      partner: {
        employeeId: partner.employeeId,
        name: partner.name,
        officeCode: partner.officeCode,
      },
      scope,
      risk: board.tiles.map((t) => ({
        key: t.key,
        label: RISK_TILE_LABEL[t.key],
        count: t.count,
        amount: t.amount ?? null,
        available: t.available,
        items: t.items.map((i) => ({ title: i.title, detail: i.detail, dueOn: i.dueOn })),
      })),
      ...month$,
      profitability,
    };
  }

  private async monthFigures(
    client: PoolClient,
    from: string,
    to: string,
  ): Promise<Pick<PartnerPackFigures, 'filingsDone' | 'noticesClosed' | 'invoiced' | 'collected'>> {
    const { rows: filed } = await client.query<{ stream: string | null; n: number }>(
      `SELECT wl.stream, count(*)::int AS n
         FROM hsdg.compliance_instances ci
         ${workLinkJoin('ci.id')}
        WHERE ci.workflow_status = 'filed'
          AND timezone('Asia/Kolkata', ci.completed_at)::date BETWEEN $1::date AND $2::date
        GROUP BY wl.stream ORDER BY count(*) DESC, wl.stream`,
      [from, to],
    );
    const { rows: closed } = await client.query<{ outcome: string | null; n: number }>(
      `SELECT n.outcome, count(*)::int AS n
         FROM hsdg.notices n
        WHERE n.status = 'closed' AND n.closed_on BETWEEN $1::date AND $2::date
        GROUP BY n.outcome ORDER BY count(*) DESC, n.outcome`,
      [from, to],
    );
    const { rows: inv } = await client.query<{ n: number; amount: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(i.total), 0)::numeric(14, 2)::text AS amount
         FROM hsdg.invoices i
        WHERE i.status IN ('issued', 'partially_paid', 'paid')
          AND i.issue_date BETWEEN $1::date AND $2::date`,
      [from, to],
    );
    const { rows: rec } = await client.query<{ n: number; amount: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(r.gross_amount), 0)::numeric(14, 2)::text AS amount
         FROM hsdg.receipts r
        WHERE r.status = 'posted' AND r.received_on BETWEEN $1::date AND $2::date`,
      [from, to],
    );
    return {
      filingsDone: {
        total: filed.reduce((s, r) => s + r.n, 0),
        byStream: filed.map((r) => ({ stream: r.stream ?? 'other', count: r.n })),
      },
      noticesClosed: {
        total: closed.reduce((s, r) => s + r.n, 0),
        byOutcome: closed.map((r) => ({ outcome: r.outcome ?? 'closed', count: r.n })),
      },
      invoiced: { count: inv[0]!.n, amount: inv[0]!.amount },
      collected: { count: rec[0]!.n, amount: rec[0]!.amount },
    };
  }

  /**
   * Build (or build again) `partner`'s pack for `month`, as them. `notify`
   * sends the "pack ready" notice the first time only.
   */
  async build(partner: PackPartner, month: string, notify: boolean): Promise<PartnerPackSummary> {
    const figures = await this.figures(partner, month);
    return this.db.withRlsContext(partner.ctx, async (client) => {
      const { rows } = await client.query<{ id: string; notified_at: string | null }>(
        `INSERT INTO hsdg.partner_packs (partner_employee_id, month, figures, generated_by_user_id)
         VALUES ($1, $2, $3, NULLIF($4, '')::uuid)
         ON CONFLICT (partner_employee_id, month) DO UPDATE
           SET figures = EXCLUDED.figures, generated_at = now(),
               generated_by_user_id = EXCLUDED.generated_by_user_id
         RETURNING id, notified_at`,
        [partner.employeeId, month, JSON.stringify(figures), partner.ctx.userId],
      );
      const pack = rows[0]!;
      if (notify && !pack.notified_at) {
        await this.notifications.emitWith(client, partner.ctx, {
          type: NOTIFICATION_TYPE.partnerPackReady,
          recipientEmployeeIds: [partner.employeeId],
          title: `Your partner pack for ${partnerPackMonthLabel(month)} is ready`,
          body: `${packHeadline(figures)}. Download it from Reports → Partner packs.`,
          objectType: 'partner_pack',
          objectId: pack.id,
          dedupKey: `partner_pack:${pack.id}`,
          link: null,
        });
        await client.query(`UPDATE hsdg.partner_packs SET notified_at = now() WHERE id = $1`, [
          pack.id,
        ]);
      }
      const { rows: out } = await client.query<PackRow>(`${PACK_SELECT} WHERE pp.id = $1`, [
        pack.id,
      ]);
      return summaryOf(out[0]!);
    });
  }

  list(ctx: RlsContext): Promise<PartnerPackSummary[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<PackRow>(
        `${PACK_SELECT} ORDER BY pp.month DESC, e.full_name LIMIT 240`,
      );
      return rows.map(summaryOf);
    });
  }

  async get(ctx: RlsContext, id: string): Promise<PartnerPackFigures & { id: string }> {
    const row = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<PackRow>(`${PACK_SELECT} WHERE pp.id = $1`, [id]);
      return rows[0];
    });
    if (!row) throw new NotFoundException('No such pack.');
    return { id: row.id, ...row.figures };
  }

  async pdf(ctx: RlsContext, id: string): Promise<{ filename: string; body: Buffer }> {
    const pack = await this.get(ctx, id);
    const firm = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ firm_name: string | null }>(
        `SELECT firm_name FROM hsdg.firm_settings LIMIT 1`,
      );
      return rows[0]?.firm_name ?? null;
    });
    const who = pack.partner.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      filename: `partner-pack-${pack.month}-${who}.pdf`,
      body: renderPartnerPackPdf(pack, firm),
    };
  }

  /** Everyone who gets a pack: partners and the Managing Partner with a working login. */
  async recipients(): Promise<PackPartner[]> {
    const system: RlsContext = { userId: '', role: SYSTEM_ROLE, officeId: '' };
    const emails = await this.db.withRlsContext(system, async (client) => {
      const { rows } = await client.query<{ email: string }>(
        `SELECT DISTINCT u.email
           FROM hsdg.users u
           JOIN hsdg.user_roles ur ON ur.user_id = u.id
           JOIN hsdg.roles r ON r.id = ur.role_id
           JOIN hsdg.employees e ON e.user_id = u.id
          WHERE u.is_active AND r.slug = ANY($1::text[])
            AND e.deleted_at IS NULL AND e.employment_status <> 'exited'
          ORDER BY u.email`,
        [PACK_ROLES],
      );
      return rows.map((r) => r.email);
    });
    const out: PackPartner[] = [];
    for (const email of emails) {
      const p = await this.identity.loadPrincipalByEmail(email);
      if (!p?.employeeId || !p.isActive) continue;
      out.push(this.partnerOf({ ...p, employeeId: p.employeeId, displayName: p.displayName }));
    }
    return out;
  }

  partnerOf(p: {
    userId: string;
    displayName: string;
    officeId: string;
    officeCode: string | null;
    employeeId: string;
    roles: RoleSlug[];
  }): PackPartner {
    return {
      ctx: {
        userId: p.userId,
        role: pickEffectiveRole(p.roles) ?? '',
        roles: p.roles,
        officeId: p.officeId,
        employeeId: p.employeeId,
      },
      employeeId: p.employeeId,
      name: p.displayName,
      officeCode: p.officeCode,
    };
  }

  /** The month's run: every partner's pack, each built as them. Idempotent. */
  async runMonthly(
    month: string,
    include: (p: PackPartner) => boolean = () => true,
  ): Promise<{ built: number; failed: number }> {
    let built = 0;
    let failed = 0;
    for (const partner of (await this.recipients()).filter(include)) {
      try {
        await this.build(partner, month, true);
        built += 1;
      } catch (err) {
        failed += 1;
        const e = err as Error;
        this.logger.error(
          `Partner pack ${month} for ${partner.name} failed: ${e.message}`,
          e.stack,
        );
      }
    }
    return { built, failed };
  }
}
