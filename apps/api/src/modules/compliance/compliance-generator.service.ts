import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  STREAM_REGISTRATION_TYPES,
  qrmpCategoryForGstin,
  defaultCompanySubtype,
  resolveCinFacts,
  type CalculationBasis,
  type CinProfileAttributes,
  type GstinProfileAttributes,
  type PanProfileAttributes,
  type RegistrationScope,
  type RuleFrequency,
  type Stream,
  type TanProfileAttributes,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';
import {
  applyVariants,
  conditionHolds,
  dueForPeriod,
  financialYearOf,
  isTriennialDue,
  passesPeriodFilter,
  periodsForFrequency,
  type Period,
  type PeriodRuleVersion,
} from './compliance-periods';
import { eventContext, withAgmExtension } from './compliance-events';

/**
 * Calendar v2 generator (spec Change 4 "Generation"). Walks year → stream →
 * registration → rule → period for a Compliance engagement and creates one
 * compliance_instance per applicable combination, keyed
 * (engagement, rule, registration, period_key) — so it is idempotent and safe
 * to re-run, and every re-run reconciles:
 *
 *   - a new applicable period is inserted;
 *   - a not-started item whose dates changed (a profile change, a new rule
 *     version) is moved; a started one is flagged "Profile changed — check"
 *     (profile_changed_at) instead;
 *   - an item computed from a provisional event date moves to the actual date
 *     once the event (AGM) is recorded, whatever its status short of filed;
 *   - a not-started item that no longer applies becomes not_applicable with
 *     the generator's note (and comes back if it applies again); a started one
 *     is flagged instead of being touched.
 *
 * Runs inside the caller's transaction and RLS context (the engagement lead, or
 * the scheduler's operator context).
 */

/** Marks a not_applicable set by the generator (vs. a person's decision). */
export const GENERATOR_NA_NOTE = 'calendar: no longer applies under the client profile';
/** Marks a not_applicable set when a stream is taken out of a year's scope. */
export const STREAM_ENDED_NOTE = 'calendar: stream taken out of scope for the year';

const PERIODIC: ReadonlySet<RuleFrequency> = new Set([
  'monthly',
  'quarterly',
  'half_yearly',
  'calendar_half_yearly',
  'annual',
  'triennial',
]);

export interface GenerateSummary {
  created: number;
  moved: number;
  flagged: number;
  notApplicable: number;
  /** Ids of newly created instances (checklist seeding, audit). */
  createdIds: string[];
  /** Items moved, with their statutory date before and after. */
  movedItems: { id: string; from: string; to: string }[];
  flaggedIds: string[];
  notApplicableIds: string[];
}

const EMPTY_SUMMARY: GenerateSummary = {
  created: 0,
  moved: 0,
  flagged: 0,
  notApplicable: 0,
  createdIds: [],
  movedItems: [],
  flaggedIds: [],
  notApplicableIds: [],
};

/** Add one summary to another (an event's own items, then the year's regeneration). */
export function mergeSummaries(a: GenerateSummary, b: GenerateSummary): GenerateSummary {
  return {
    created: a.created + b.created,
    moved: a.moved + b.moved,
    flagged: a.flagged + b.flagged,
    notApplicable: a.notApplicable + b.notApplicable,
    createdIds: [...a.createdIds, ...b.createdIds],
    movedItems: [...a.movedItems, ...b.movedItems],
    flaggedIds: [...a.flaggedIds, ...b.flaggedIds],
    notApplicableIds: [...a.notApplicableIds, ...b.notApplicableIds],
  };
}

interface VersionRow {
  id: string;
  compliance_rule_id: string;
  code: string;
  effective_from: string;
  effective_to: string | null;
  calculation_basis: CalculationBasis;
  offset_months: number;
  offset_days: number;
  offset_working_days: boolean;
  fixed_month: number | null;
  fixed_day: number | null;
  working_day_adjustment: WorkingDayAdjustment;
  internal_sla_offset_days: number;
  condition: unknown;
  stream: Stream;
  registration_scope: RegistrationScope | null;
  frequency: RuleFrequency | null;
  form_label: string | null;
  section: string | null;
  schedule: PeriodRuleVersion['schedule'];
  period_overrides: PeriodRuleVersion['periodOverrides'];
  period_filter: string[] | null;
  event_type: string | null;
  provisional_event_rule: PeriodRuleVersion['provisionalEventRule'];
  variants: PeriodRuleVersion['variants'];
  is_optional: boolean;
}

interface Registration {
  id: string;
  registration_type: string;
  registration_number: string;
  state_code: string | null;
}

interface ProfileRow {
  scope: string;
  registration_id: string | null;
  effective_from: string;
  effective_to: string | null;
  gst_scheme: string | null;
  qrmp_category: string | null;
  attributes: Record<string, unknown>;
}

export interface EventRow {
  id: string;
  registration_id: string | null;
  event_type: string;
  financial_year: string;
  event_date: string;
  details?: Record<string, unknown> | null;
}

/** The live event of a type for a year and registration (a CIN-less event applies to all). */
function findEvent(
  events: readonly EventRow[],
  eventType: string,
  financialYear: string,
  regId: string | null,
): EventRow | undefined {
  return events.find(
    (ev) =>
      ev.event_type === eventType &&
      ev.financial_year === financialYear &&
      (ev.registration_id === null || ev.registration_id === regId),
  );
}

interface ExistingRow {
  id: string;
  compliance_rule_id: string;
  registration_id: string | null;
  period_key: string;
  financial_year: string | null;
  workflow_status: string;
  reference_date: string;
  statutory_deadline: string;
  internal_sla_date: string;
  compliance_rule_version_id: string;
  is_provisional: boolean;
  compliance_event_id: string | null;
  notes: string | null;
  profile_changed_at: Date | null;
  form_label: string | null;
}

interface Desired {
  ruleId: string;
  versionId: string;
  registrationId: string | null;
  engagementServiceId: string | null;
  periodKey: string;
  financialYear: string;
  periodStart: string;
  periodEnd: string;
  section: string | null;
  referenceDate: string;
  statutoryDeadline: string;
  internalSlaDate: string;
  isProvisional: boolean;
  isOptional: boolean;
  complianceEventId: string | null;
  /** The form a variant files it on (MGT-7A for an OPC); null = the version's form. */
  formLabel: string | null;
}

/** The engagement + entity facts that feed rule conditions. */
export interface EntityFacts {
  turnover: number;
  /** The client's turnover is on record (G12 needs a real figure, not the 0 default). */
  turnoverKnown?: boolean;
  entityCategory: string | null;
  entityTypeSlug: string | null;
}

/** Build the condition context for one registration in one period (pure; exported for tests). */
export function buildRuleContext(
  facts: EntityFacts,
  scope: RegistrationScope,
  registration: Pick<Registration, 'registration_number' | 'state_code'> | null,
  profile: Pick<ProfileRow, 'gst_scheme' | 'qrmp_category' | 'attributes'> | null,
  panProfile: Pick<ProfileRow, 'attributes'> | null,
): Record<string, unknown> {
  const isCompany = facts.entityCategory === 'company';
  const attrs = (profile?.attributes ?? {}) as Record<string, unknown>;
  const pan = (panProfile?.attributes ?? {}) as PanProfileAttributes;
  const taxAudit = pan.taxAudit ?? facts.turnover > 10_000_000;
  const ctx: Record<string, unknown> = {
    turnover: facts.turnover,
    is_company: isCompany,
    is_llp: facts.entityCategory === 'llp',
    // Income-tax facts come from the PAN profile wherever they are tested.
    // s.44AB tax audit turns on turnover (> ₹1 cr by default); an "audit case"
    // for the ITR date is any assessee whose accounts are audited under a law —
    // a company always, anyone else when under tax audit.
    tax_audit: taxAudit,
    audit_case: pan.auditCase ?? (isCompany || taxAudit),
    tp_transactions: pan.tpTransactions ?? false,
    advance_tax_liable: pan.advanceTaxLiable ?? (isCompany || facts.entityCategory === 'llp'),
    trust:
      pan.trustOrInstitution ??
      (facts.entityCategory === 'trust' || facts.entityCategory === 'society'),
  };
  if (scope === 'gstin') {
    const g = attrs as GstinProfileAttributes;
    const stateCode = registration?.state_code ?? registration?.registration_number ?? '';
    Object.assign(ctx, {
      gst_scheme: profile?.gst_scheme ?? 'regular',
      qrmp_category: profile?.qrmp_category ?? qrmpCategoryForGstin(stateCode),
      einvoicing: g.eInvoicing ?? false,
      exporter: g.exporter ?? false,
      job_work: g.jobWork ?? false,
      importer: g.importer ?? false,
      gst_turnover: g.annualTurnover ?? facts.turnover,
      opting_composition_next_fy: g.optingCompositionNextFy ?? false,
    });
  }
  if (scope === 'tan') {
    const t = attrs as TanProfileAttributes;
    Object.assign(ctx, {
      employer: t.employer ?? false,
      pays_non_residents: t.paysNonResidents ?? false,
      tcs_collector: t.tcsCollector ?? false,
      property_rent_deductor: t.propertyOrRentDeductor ?? false,
    });
  }
  if (scope === 'cin' || scope === 'din') {
    const c = attrs as CinProfileAttributes;
    const defaultSubtype = defaultCompanySubtype(facts.entityTypeSlug);
    const f = resolveCinFacts(c, {
      subtype: defaultSubtype,
      turnover: facts.turnoverKnown === false ? null : facts.turnover,
    });
    Object.assign(ctx, {
      // G12: a private company within the small-company limits is small.
      company_subtype: f.companySubtype ?? defaultSubtype,
      msme_dues_45: c.msmeDuesOver45Days ?? false,
      // G7: null when unknown, so DPT-3 stays; only false drops it.
      deposits: c.depositsOrExemptedLoans ?? null,
      xbrl_required: f.xbrlRequired,
      has_subsidiaries: f.hasSubsidiaries,
      mgt8_required: f.mgt8Required,
      csr_applicable: f.csrApplicable,
      secretarial_audit_required: f.secretarialAuditRequired,
      paid_up_capital: f.paidUpCapital,
      authorised_capital: f.authorisedCapital,
    });
  }
  return ctx;
}

/** One connection runs one query at a time (pg 9 rejects overlapping ones). */
export async function inSequence<T extends readonly unknown[]>(
  steps: readonly [...{ [K in keyof T]: () => Promise<T[K]> }],
): Promise<T> {
  const out: unknown[] = [];
  for (const step of steps) out.push(await step());
  return out as unknown as T;
}

function toVersion(v: VersionRow): PeriodRuleVersion {
  return {
    calculationBasis: v.calculation_basis,
    frequency: v.frequency,
    offsetMonths: v.offset_months,
    offsetDays: v.offset_days,
    offsetWorkingDays: v.offset_working_days,
    fixedMonth: v.fixed_month,
    fixedDay: v.fixed_day,
    workingDayAdjustment: v.working_day_adjustment,
    internalSlaOffsetDays: v.internal_sla_offset_days,
    schedule: v.schedule,
    periodOverrides: v.period_overrides,
    periodFilter: v.period_filter,
    provisionalEventRule: v.provisional_event_rule,
    eventType: v.event_type,
    formLabel: v.form_label,
    section: v.section,
    isOptional: v.is_optional,
    condition: v.condition,
    variants: v.variants,
  };
}

/**
 * The periods a rule can run on in one year: its own frequency's, plus those
 * of any frequency a variant switches to. desiredFor keeps the ones matching
 * the frequency in force for the target.
 */
function rulePeriods(
  versions: readonly VersionRow[],
  financialYear: string,
): Array<Period & { frequency: RuleFrequency | null }> {
  const frequencies = new Set<RuleFrequency | null>();
  for (const v of versions) {
    frequencies.add(v.frequency);
    for (const variant of v.variants ?? []) {
      const f = variant.set?.['frequency'];
      if (typeof f === 'string' && PERIODIC.has(f as RuleFrequency)) {
        frequencies.add(f as RuleFrequency);
      }
    }
  }
  return [...frequencies].flatMap((f) =>
    periodsForFrequency(f, financialYear).map((p) => ({ ...p, frequency: f })),
  );
}

/** The profile in force on `date` for (scope, registration), if any. */
function profileOn(
  profiles: readonly ProfileRow[],
  scope: string,
  registrationId: string | null,
  date: string,
): ProfileRow | null {
  let best: ProfileRow | null = null;
  for (const p of profiles) {
    if (p.scope !== scope || p.registration_id !== registrationId) continue;
    if (p.effective_from > date || (p.effective_to !== null && p.effective_to < date)) continue;
    if (!best || p.effective_from > best.effective_from) best = p;
  }
  return best;
}

/** The version of a rule in force at `date` (versions sorted by effective_from). */
function versionOn(versions: readonly VersionRow[], date: string): VersionRow | null {
  let best: VersionRow | null = null;
  for (const v of versions) {
    if (v.effective_from > date || (v.effective_to !== null && v.effective_to < date)) continue;
    best = v;
  }
  return best;
}

/** Runs on the generator's transaction for every batch of new instances. */
export type InstancesCreatedHook = (
  client: PoolClient,
  instanceIds: readonly string[],
) => Promise<void>;

@Injectable()
export class ComplianceGeneratorService {
  private readonly createdHooks: InstancesCreatedHook[] = [];

  /** Register work for new instances (checklist seeding) without a module cycle. */
  onInstancesCreated(hook: InstancesCreatedHook): void {
    this.createdHooks.push(hook);
  }

  async generateForEngagement(
    client: PoolClient,
    engagementId: string,
    opts: { financialYears?: string[] } = {},
  ): Promise<GenerateSummary> {
    const eng = await client.query<{
      kind: string;
      entity_id: string;
      annual_turnover: string | null;
      category: string | null;
      slug: string | null;
    }>(
      `SELECT e.kind, e.entity_id, ent.annual_turnover, et.category, et.slug
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const e = eng.rows[0];
    if (!e) throw new NotFoundException('Engagement not found.');
    if (e.kind !== 'compliance') {
      throw new BadRequestException('Only a Compliance engagement has a compliance calendar.');
    }
    const facts: EntityFacts = {
      turnover: Number(e.annual_turnover ?? 0),
      turnoverKnown: e.annual_turnover !== null,
      entityCategory: e.category,
      entityTypeSlug: e.slug,
    };

    const years = await client.query<{
      financial_year: string;
      streams: Stream[];
      stream_registrations: Partial<Record<Stream, string[]>>;
    }>(
      `SELECT financial_year, streams, stream_registrations
         FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 AND status = 'open'
          AND ($2::text[] IS NULL OR financial_year = ANY($2::text[]))
        ORDER BY financial_year`,
      [engagementId, opts.financialYears ?? null],
    );
    if (years.rows.length === 0) return { ...EMPTY_SUMMARY };

    const allStreams = [...new Set(years.rows.flatMap((y) => y.streams))];
    const [lines, regs, profiles, versionRows, holidayRows, events, existing] = await inSequence([
      () =>
        client.query<{ id: string; stream: Stream }>(
          `SELECT DISTINCT ON (s.stream) es.id, s.stream
           FROM hsdg.engagement_services es
           JOIN hsdg.services s ON s.id = es.service_id
          WHERE es.engagement_id = $1 AND s.stream IS NOT NULL AND es.status <> 'cancelled'
          ORDER BY s.stream, es.created_at`,
          [engagementId],
        ),
      () =>
        client.query<Registration & { status: string }>(
          `SELECT id, registration_type, registration_number, state_code, status
           FROM hsdg.entity_compliance_registrations($1)`,
          [e.entity_id],
        ),
      () =>
        client.query<ProfileRow>(
          `SELECT scope, registration_id, effective_from::text, effective_to::text, gst_scheme,
                qrmp_category, attributes
           FROM hsdg.registration_compliance_profiles WHERE entity_id = $1`,
          [e.entity_id],
        ),
      () =>
        client.query<VersionRow>(
          `SELECT v.id, v.compliance_rule_id, r.code, v.effective_from::text, v.effective_to::text,
                v.calculation_basis, v.offset_months, v.offset_days, v.offset_working_days,
                v.fixed_month, v.fixed_day, v.working_day_adjustment,
                hsdg.internal_due_days(v.compliance_rule_id, v.internal_sla_offset_days) AS internal_sla_offset_days,
                v.condition, v.stream, v.registration_scope, v.frequency, v.form_label, v.section,
                v.schedule, v.period_overrides, v.period_filter, v.event_type,
                v.provisional_event_rule, v.variants, v.is_optional
           FROM hsdg.compliance_rule_versions v
           JOIN hsdg.compliance_rules r ON r.id = v.compliance_rule_id
          WHERE r.is_active AND v.stream = ANY($1::text[])
          ORDER BY r.code, v.effective_from`,
          [allStreams],
        ),
      () =>
        client.query<{ d: string }>(`SELECT holiday_date::text AS d FROM hsdg.compliance_holidays`),
      () =>
        client.query<EventRow>(
          `SELECT id, registration_id, event_type, financial_year, event_date::text, details
           FROM hsdg.compliance_events WHERE engagement_id = $1 AND voided_at IS NULL
          ORDER BY event_date DESC, created_at DESC`,
          [engagementId],
        ),
      () =>
        client.query<ExistingRow>(
          `SELECT id, compliance_rule_id, registration_id, period_key, financial_year, workflow_status,
                reference_date::text, statutory_deadline::text, internal_sla_date::text,
                compliance_rule_version_id,
                is_provisional, compliance_event_id, notes, profile_changed_at, form_label
           FROM hsdg.compliance_instances
          WHERE engagement_id = $1 AND period_key IS NOT NULL AND period_key NOT LIKE 'EVT:%'`,
          [engagementId],
        ),
    ]);

    const lineByStream = new Map(lines.rows.map((l) => [l.stream, l.id]));
    const activeRegs = regs.rows.filter((r) => r.status === 'active');
    const holidays = new Set(holidayRows.rows.map((h) => h.d));
    const rules = new Map<string, VersionRow[]>();
    for (const v of versionRows.rows) {
      if (!v.frequency || !PERIODIC.has(v.frequency)) continue;
      const list = rules.get(v.compliance_rule_id) ?? [];
      list.push(v);
      rules.set(v.compliance_rule_id, list);
    }

    const desired: Desired[] = [];
    for (const year of years.rows) {
      for (const stream of year.streams) {
        const chosen = year.stream_registrations?.[stream];
        const types = STREAM_REGISTRATION_TYPES[stream];
        const streamRegs = activeRegs.filter(
          (r) => types.includes(r.registration_type) && (!chosen || chosen.includes(r.id)),
        );
        for (const [ruleId, versions] of rules) {
          if (versions[0]!.stream !== stream) continue;
          for (const target of this.targets(
            versions[0]!,
            streamRegs,
            profiles.rows,
            year.financial_year,
          )) {
            for (const period of rulePeriods(versions, year.financial_year)) {
              const d = this.desiredFor({
                ruleId,
                versions,
                target,
                period,
                facts,
                profiles: profiles.rows,
                events: events.rows,
                holidays,
                engagementServiceId: lineByStream.get(stream) ?? null,
              });
              if (d) desired.push(d);
            }
          }
        }
      }
    }

    return this.reconcile(client, engagementId, desired, existing.rows, {
      years: new Set(years.rows.map((y) => y.financial_year)),
      ruleIds: new Set(rules.keys()),
    });
  }

  /** Who a rule runs on in one year: registrations, the PAN / entity, or directors. */
  private targets(
    v: VersionRow,
    streamRegs: readonly Registration[],
    profiles: readonly ProfileRow[],
    financialYear: string,
  ): Array<{
    registration: Registration | null;
    periodSuffix: string | null;
    scope: RegistrationScope;
  }> {
    const scope = v.registration_scope ?? 'entity';
    if (scope === 'pan' || scope === 'entity')
      return [{ registration: null, periodSuffix: null, scope }];
    if (scope === 'din') {
      const fyStart = `${financialYear.slice(0, 4)}-04-01`;
      return streamRegs
        .filter((r) => r.registration_type === 'cin')
        .flatMap((r) => {
          const p = profileOn(profiles, 'cin', r.id, fyStart);
          const directors = (p?.attributes as CinProfileAttributes | undefined)?.directors ?? [];
          return directors
            .filter(
              (d) => d.din && d.kycCycleStartFy && isTriennialDue(d.kycCycleStartFy, financialYear),
            )
            .map((d) => ({ registration: r, periodSuffix: `:DIN:${d.din}`, scope }));
        });
    }
    return streamRegs
      .filter((r) => r.registration_type === scope)
      .map((r) => ({ registration: r, periodSuffix: null, scope }));
  }

  private desiredFor(a: {
    ruleId: string;
    versions: readonly VersionRow[];
    target: {
      registration: Registration | null;
      periodSuffix: string | null;
      scope: RegistrationScope;
    };
    period: Period & { frequency: RuleFrequency | null };
    facts: EntityFacts;
    profiles: readonly ProfileRow[];
    events: readonly EventRow[];
    holidays: ReadonlySet<string>;
    engagementServiceId: string | null;
  }): Desired | null {
    // The version in force at the period end picks the form (26Q for Q4
    // FY 2025-26, Form 140 from Q1 FY 2026-27).
    const row = versionOn(a.versions, a.period.end);
    if (!row) return null;
    const regId = a.target.registration?.id ?? null;
    const profileScope = a.target.scope === 'din' ? 'cin' : a.target.scope;
    const profile =
      profileScope === 'entity' ? null : profileOn(a.profiles, profileScope, regId, a.period.start);
    const panProfile = profileOn(a.profiles, 'pan', null, a.period.start);
    // Event facts (auditor appointed at this AGM …) join the client's facts;
    // the event read is the one the rule runs from.
    const ruleEvent = row.event_type
      ? findEvent(a.events, row.event_type, a.period.financialYear, regId)
      : undefined;
    const ctx = {
      ...buildRuleContext(a.facts, a.target.scope, a.target.registration, profile, panProfile),
      ...eventContext(ruleEvent),
    };
    let version = applyVariants(toVersion(row), ctx);
    const extension = findEvent(a.events, 'agm_extension', a.period.financialYear, regId);
    if (extension) {
      version = withAgmExtension(version, row.code, Number(extension.details?.months ?? 0));
    }
    // A variant may run the rule on other periods (a small company's board
    // meetings on calendar halves); only periods of its own frequency apply.
    if (a.period.frequency !== version.frequency) return null;
    if (!passesPeriodFilter(version.periodFilter, a.period)) return null;
    if (!conditionHolds(version.condition, ctx)) return null;

    const event =
      version.calculationBasis === 'event_date' && version.eventType
        ? findEvent(a.events, version.eventType, a.period.financialYear, regId)
        : undefined;
    const due = dueForPeriod(version, a.period, a.holidays, event?.event_date ?? null);
    if (!due) return null;
    return {
      ruleId: a.ruleId,
      versionId: row.id,
      registrationId: regId,
      engagementServiceId: a.engagementServiceId,
      periodKey: a.period.key + (a.target.periodSuffix ?? ''),
      financialYear: a.period.financialYear,
      periodStart: a.period.start,
      periodEnd: a.period.end,
      section: version.section,
      referenceDate: due.referenceDate,
      statutoryDeadline: due.statutoryDeadline,
      internalSlaDate: due.internalSlaDate,
      isProvisional: due.isProvisional,
      isOptional: version.isOptional,
      complianceEventId: event?.id ?? null,
      formLabel: version.formLabel !== row.form_label ? version.formLabel : null,
    };
  }

  private async reconcile(
    client: PoolClient,
    engagementId: string,
    desired: readonly Desired[],
    existing: readonly ExistingRow[],
    scope: { years: ReadonlySet<string>; ruleIds: ReadonlySet<string> },
  ): Promise<GenerateSummary> {
    const keyOf = (ruleId: string, regId: string | null, periodKey: string) =>
      `${ruleId}|${regId ?? ''}|${periodKey}`;
    const byKey = new Map(
      existing.map((x) => [keyOf(x.compliance_rule_id, x.registration_id, x.period_key), x]),
    );
    const toInsert: Desired[] = [];
    const toMove: Array<{ id: string; d: Desired; reopen: boolean }> = [];
    const toFlag: string[] = [];
    const toRelabel: Array<{ id: string; formLabel: string | null }> = [];
    const seen = new Set<string>();

    for (const d of desired) {
      const key = keyOf(d.ruleId, d.registrationId, d.periodKey);
      seen.add(key);
      const x = byKey.get(key);
      if (!x) {
        toInsert.push(d);
        continue;
      }
      // The form's name follows the client's facts at any stage, filed included.
      if (x.form_label !== d.formLabel) toRelabel.push({ id: x.id, formLabel: d.formLabel });
      if (x.workflow_status === 'filed') continue;
      const generatorNa =
        x.workflow_status === 'not_applicable' &&
        (x.notes === GENERATOR_NA_NOTE || x.notes === STREAM_ENDED_NOTE);
      if (x.workflow_status === 'not_applicable' && !generatorNa) continue;
      const changed =
        x.statutory_deadline !== d.statutoryDeadline ||
        x.internal_sla_date !== d.internalSlaDate ||
        x.compliance_rule_version_id !== d.versionId ||
        x.is_provisional !== d.isProvisional ||
        x.compliance_event_id !== d.complianceEventId;
      if (generatorNa) {
        toMove.push({ id: x.id, d, reopen: true });
      } else if (!changed) {
        continue;
      } else if (
        x.workflow_status === 'not_started' ||
        x.is_provisional !== d.isProvisional ||
        x.compliance_event_id !== d.complianceEventId
      ) {
        // Not started, or the real event date replaced a provisional one.
        toMove.push({ id: x.id, d, reopen: false });
      } else if (!x.profile_changed_at) {
        toFlag.push(x.id);
      }
    }

    // A period that replaces another on the same date (a small company's Jul–Dec
    // board meeting ends 31 Dec, as Q3 did) takes over the row it replaces:
    // one row per rule and reference date (compliance_instances_unique).
    const pending = toInsert.splice(0);
    for (const d of pending) {
      const x = existing.find(
        (e) =>
          e.compliance_rule_id === d.ruleId &&
          e.reference_date === d.referenceDate &&
          !seen.has(keyOf(e.compliance_rule_id, e.registration_id, e.period_key)),
      );
      if (!x) {
        toInsert.push(d);
        continue;
      }
      seen.add(keyOf(x.compliance_rule_id, x.registration_id, x.period_key));
      // A meeting already held on that date answers for the new period too.
      if (x.workflow_status === 'filed') continue;
      const generatorNa =
        x.workflow_status === 'not_applicable' &&
        (x.notes === GENERATOR_NA_NOTE || x.notes === STREAM_ENDED_NOTE);
      toMove.push({ id: x.id, d, reopen: generatorNa });
      if (x.form_label !== d.formLabel) toRelabel.push({ id: x.id, formLabel: d.formLabel });
      if (x.workflow_status !== 'not_started' && !generatorNa && !x.profile_changed_at) {
        toFlag.push(x.id);
      }
    }

    const toRetire: string[] = [];
    for (const x of existing) {
      if (!x.financial_year || !scope.years.has(x.financial_year)) continue;
      if (!scope.ruleIds.has(x.compliance_rule_id)) continue;
      if (seen.has(keyOf(x.compliance_rule_id, x.registration_id, x.period_key))) continue;
      if (x.workflow_status === 'not_started') toRetire.push(x.id);
      else if (
        x.workflow_status !== 'filed' &&
        x.workflow_status !== 'not_applicable' &&
        !x.profile_changed_at
      ) {
        toFlag.push(x.id);
      }
    }

    let createdIds: string[] = [];
    if (toInsert.length > 0) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.compliance_instances
           (engagement_id, compliance_rule_id, compliance_rule_version_id, registration_id,
            engagement_service_id, financial_year, period_key, period_start, period_end, section,
            reference_date, statutory_deadline, internal_sla_date, is_provisional, is_optional,
            compliance_event_id, form_label, government_extension_id)
         SELECT $1, d."ruleId", d."versionId", d."registrationId", d."engagementServiceId",
                d."financialYear", d."periodKey", d."periodStart", d."periodEnd", d.section,
                d."referenceDate", d."statutoryDeadline", d."internalSlaDate", d."isProvisional",
                d."isOptional", d."complianceEventId", d."formLabel",
                (SELECT ge.id FROM hsdg.government_extensions ge
                  WHERE ge.compliance_rule_id = d."ruleId"
                    AND ge.original_due_date = d."statutoryDeadline"
                  ORDER BY ge.revised_due_date DESC LIMIT 1)
           FROM jsonb_to_recordset($2::jsonb) AS d(
                "ruleId" uuid, "versionId" uuid, "registrationId" uuid, "engagementServiceId" uuid,
                "financialYear" text, "periodKey" text, "periodStart" date, "periodEnd" date,
                section text, "referenceDate" date, "statutoryDeadline" date,
                "internalSlaDate" date, "isProvisional" boolean, "isOptional" boolean,
                "complianceEventId" uuid, "formLabel" text)
         ON CONFLICT (engagement_id, compliance_rule_id, registration_id, period_key)
            WHERE period_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [engagementId, JSON.stringify(toInsert)],
      );
      createdIds = rows.map((r) => r.id);
      for (const hook of this.createdHooks) await hook(client, createdIds);
    }

    if (toMove.length > 0) {
      await client.query(
        `UPDATE hsdg.compliance_instances ci
            SET compliance_rule_version_id = m."versionId",
                registration_id = m."registrationId",
                financial_year = m."financialYear",
                period_key = m."periodKey",
                period_start = m."periodStart",
                period_end = m."periodEnd",
                reference_date = m."referenceDate",
                statutory_deadline = m."statutoryDeadline",
                internal_sla_date = m."internalSlaDate",
                is_provisional = m."isProvisional",
                is_optional = m."isOptional",
                section = m.section,
                compliance_event_id = m."complianceEventId",
                workflow_status = CASE WHEN m.reopen THEN 'not_started' ELSE ci.workflow_status END,
                notes = CASE WHEN m.reopen THEN NULL ELSE ci.notes END,
                government_extension_id = COALESCE(
                  (SELECT ge.id FROM hsdg.government_extensions ge
                    WHERE ge.compliance_rule_id = ci.compliance_rule_id
                      AND ge.original_due_date = m."statutoryDeadline"
                    ORDER BY ge.revised_due_date DESC LIMIT 1),
                  CASE WHEN ci.statutory_deadline = m."statutoryDeadline"
                       THEN ci.government_extension_id END),
                version = ci.version + 1,
                updated_at = now()
           FROM jsonb_to_recordset($1::jsonb) AS m(
                id uuid, reopen boolean, "versionId" uuid, "registrationId" uuid,
                "financialYear" text, "periodKey" text, "periodStart" date, "periodEnd" date,
                "referenceDate" date,
                "statutoryDeadline" date, "internalSlaDate" date, "isProvisional" boolean,
                "isOptional" boolean, section text, "complianceEventId" uuid)
          WHERE ci.id = m.id`,
        [JSON.stringify(toMove.map((m) => ({ id: m.id, reopen: m.reopen, ...m.d })))],
      );
    }

    if (toRelabel.length > 0) {
      await client.query(
        `UPDATE hsdg.compliance_instances ci
            SET form_label = r."formLabel", version = ci.version + 1, updated_at = now()
           FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, "formLabel" text)
          WHERE ci.id = r.id`,
        [JSON.stringify(toRelabel)],
      );
    }

    if (toRetire.length > 0) {
      await client.query(
        `UPDATE hsdg.compliance_instances
            SET workflow_status = 'not_applicable', notes = $2,
                version = version + 1, updated_at = now()
          WHERE id = ANY($1::uuid[]) AND workflow_status = 'not_started'`,
        [toRetire, GENERATOR_NA_NOTE],
      );
    }

    if (toFlag.length > 0) {
      await client.query(
        `UPDATE hsdg.compliance_instances
            SET profile_changed_at = now(), version = version + 1, updated_at = now()
          WHERE id = ANY($1::uuid[]) AND profile_changed_at IS NULL`,
        [toFlag],
      );
    }

    const before = new Map(existing.map((x) => [x.id, x.statutory_deadline]));
    return {
      created: createdIds.length,
      moved: toMove.length,
      flagged: toFlag.length,
      notApplicable: toRetire.length,
      createdIds,
      movedItems: toMove.map((m) => ({
        id: m.id,
        from: before.get(m.id) ?? m.d.statutoryDeadline,
        to: m.d.statutoryDeadline,
      })),
      flaggedIds: toFlag,
      notApplicableIds: toRetire,
    };
  }

  /**
   * Bring the items an event triggers in line with it: every event-frequency
   * rule of a stream in scope with this event type (REG-01, DIR-12, PAS-3, …),
   * its variants and conditions read against the event's details (PAS-3 in 15
   * days for a private placement). Keyed 'EVT:<event id>', so recording,
   * correcting and voiding all run through here: new items are created,
   * not-started ones move with the event's date or fall away when it is voided,
   * started ones are flagged. Annual rules that run from an event (AOC-4,
   * MGT-7, ADT-1 from the AGM) move with the next generateForEngagement instead.
   */
  async syncEventInstances(
    client: PoolClient,
    engagementId: string,
    event: EventRow,
    opts: { voided?: boolean } = {},
  ): Promise<GenerateSummary> {
    const periodKey = `EVT:${event.id}`;
    const { rows: existing } = await client.query<ExistingRow>(
      `SELECT id, compliance_rule_id, registration_id, period_key, financial_year, workflow_status,
              statutory_deadline::text, internal_sla_date::text, compliance_rule_version_id,
              is_provisional, compliance_event_id, notes, profile_changed_at, form_label
         FROM hsdg.compliance_instances
        WHERE engagement_id = $1 AND period_key = $2`,
      [engagementId, periodKey],
    );
    const streams = await client.query<{ stream: Stream }>(
      `SELECT DISTINCT unnest(streams) AS stream FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 AND status = 'open'`,
      [engagementId],
    );
    const inScope = opts.voided ? [] : streams.rows.map((s) => s.stream);
    const { rows: versions } =
      inScope.length === 0
        ? { rows: [] as Array<VersionRow & { line_id: string | null }> }
        : await client.query<VersionRow & { line_id: string | null }>(
            `SELECT DISTINCT ON (r.id) v.id, v.compliance_rule_id, r.code, v.effective_from::text,
              v.effective_to::text, v.calculation_basis, v.offset_months, v.offset_days,
              v.offset_working_days, v.fixed_month, v.fixed_day, v.working_day_adjustment,
              hsdg.internal_due_days(v.compliance_rule_id, v.internal_sla_offset_days) AS internal_sla_offset_days,
              v.condition, v.stream, v.registration_scope, v.frequency,
              v.form_label, v.section, v.schedule, v.period_overrides, v.period_filter,
              v.event_type, v.provisional_event_rule, v.variants, v.is_optional,
              (SELECT es.id FROM hsdg.engagement_services es JOIN hsdg.services s ON s.id = es.service_id
                WHERE es.engagement_id = $1 AND s.stream = v.stream AND es.status <> 'cancelled'
                ORDER BY es.created_at LIMIT 1) AS line_id
         FROM hsdg.compliance_rule_versions v
         JOIN hsdg.compliance_rules r ON r.id = v.compliance_rule_id
        WHERE r.is_active AND v.frequency = 'event' AND v.event_type = $2
          AND v.stream = ANY($3::text[]) AND v.effective_from <= $4::date
          AND (v.effective_to IS NULL OR v.effective_to >= $4::date)
        ORDER BY r.id, v.effective_from DESC`,
            [engagementId, event.event_type, inScope, event.event_date],
          );
    if (versions.length === 0 && existing.length === 0) return { ...EMPTY_SUMMARY };
    const holidays = new Set(
      versions.length === 0
        ? []
        : (
            await client.query<{ d: string }>(
              `SELECT holiday_date::text AS d FROM hsdg.compliance_holidays`,
            )
          ).rows.map((h) => h.d),
    );
    const ctx = eventContext(event);
    const desired: Desired[] = [];
    for (const v of versions) {
      // PS-103 — an order on a notice starts only the limitation rule its type names.
      if (event.event_type === 'notice_order' && v.code !== event.details?.appealRuleCode) continue;
      const scope = v.registration_scope ?? 'entity';
      const needsRegistration = scope !== 'entity' && scope !== 'pan';
      if (needsRegistration && !event.registration_id) continue;
      const version = applyVariants(toVersion(v), ctx);
      if (!conditionHolds(version.condition, ctx)) continue;
      const period: Period = {
        key: periodKey,
        financialYear: event.financial_year,
        start: event.event_date,
        end: event.event_date,
        tags: [],
        label: event.event_type,
      };
      const due = dueForPeriod(version, period, holidays, event.event_date);
      if (!due) continue;
      desired.push({
        ruleId: v.compliance_rule_id,
        versionId: v.id,
        registrationId: needsRegistration ? event.registration_id : null,
        engagementServiceId: v.line_id,
        periodKey,
        financialYear: event.financial_year,
        periodStart: event.event_date,
        periodEnd: event.event_date,
        section: version.section,
        referenceDate: due.referenceDate,
        statutoryDeadline: due.statutoryDeadline,
        internalSlaDate: due.internalSlaDate,
        isProvisional: false,
        isOptional: version.isOptional,
        complianceEventId: event.id,
        formLabel: version.formLabel !== v.form_label ? version.formLabel : null,
      });
    }
    return this.reconcile(client, engagementId, desired, existing, {
      years: new Set([event.financial_year, ...existing.map((x) => x.financial_year ?? '')]),
      ruleIds: new Set([
        ...versions.map((v) => v.compliance_rule_id),
        ...existing.map((x) => x.compliance_rule_id),
      ]),
    });
  }

  /**
   * Streams taken out of a year's scope: their not-started, unassigned items
   * come off the calendar (not_applicable, and back again if the stream is
   * re-added); items assigned or worked on stay and are flagged "Profile
   * changed — check" for the lead to decide.
   */
  async endStreams(
    client: PoolClient,
    engagementId: string,
    financialYear: string,
    streams: readonly Stream[],
  ): Promise<{ notApplicable: number; flagged: number }> {
    if (streams.length === 0) return { notApplicable: 0, flagged: 0 };
    const inStreams = `ci.engagement_id = $1 AND ci.financial_year = $2
          AND ci.compliance_rule_version_id IN (
            SELECT v.id FROM hsdg.compliance_rule_versions v WHERE v.stream = ANY($3::text[]))`;
    const retired = await client.query(
      `UPDATE hsdg.compliance_instances ci
          SET workflow_status = 'not_applicable', notes = $4,
              version = ci.version + 1, updated_at = now()
        WHERE ${inStreams} AND ci.workflow_status = 'not_started'
          AND NOT EXISTS (SELECT 1 FROM hsdg.tasks tk
                           WHERE tk.source_compliance_instance_id = ci.id
                             AND tk.status <> 'cancelled')`,
      [engagementId, financialYear, streams, STREAM_ENDED_NOTE],
    );
    const flagged = await client.query(
      `UPDATE hsdg.compliance_instances ci
          SET profile_changed_at = now(), version = ci.version + 1, updated_at = now()
        WHERE ${inStreams} AND ci.workflow_status NOT IN ('filed', 'not_applicable')
          AND ci.profile_changed_at IS NULL`,
      [engagementId, financialYear, streams],
    );
    return { notApplicable: retired.rowCount ?? 0, flagged: flagged.rowCount ?? 0 };
  }
}

/**
 * The FY whose accounts an event belongs to: an AGM adopts the previous FY's
 * accounts, and an AGM extension extends that AGM.
 */
export function eventFinancialYear(eventType: string, eventDate: string): string {
  const fy = financialYearOf(eventDate);
  if (eventType !== 'agm' && eventType !== 'agm_extension') return fy;
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${((start + 1) % 100).toString().padStart(2, '0')}`;
}
