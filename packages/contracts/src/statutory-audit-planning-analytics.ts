/**
 * Statutory Audit — 03.2 Business Understanding & Preliminary Analytics
 * (DHVAJ Section 03.2 spec; see docs/section-03-planning-build-spec.md §5.2).
 *
 * The portal calculates, compares and relates; the auditor interprets. An
 * analytical exception is a matter for investigation that may become a Planning
 * Signal in the SAME register as 03.1 — never an "analytics risk register",
 * never a misstatement or risk conclusion.
 *
 * v1 has NO trial-balance / ledger import. The Focused Financial Dataset is
 * entered manually against CANONICAL metric ids so a future TB module can fill
 * the same fields without redesigning the analytics.
 */

import type {
  AnalyticsExceptionKind,
  AnalyticsMethodologySummary,
  AnalyticsProfileOption,
  AnalyticsRuleStatus,
  RatioUnit,
} from './statutory-audit-analytics-library';
import type { PlanningAttention } from './statutory-audit-planning-signal';
import type { PlanningCompletionCheck } from './statutory-audit-planning-strategy';
import type {
  IndustryConsiderationDecision,
  RolledForwardInfo,
  UnderstandingAccess,
  UnderstandingChallengeRecord,
  UnderstandingFocusLink,
  UnderstandingRevisionRecord,
  UnderstandingVersionInfo,
} from './statutory-audit-understanding-governance';

// ── 03.2.1–03.2.6 Understanding sections ─────────────────────────────────────

export const UNDERSTANDING_SECTION = {
  businessModel: 'business_model',
  governance: 'governance',
  industry: 'industry',
  systems: 'systems',
  objectives: 'objectives',
  performance: 'performance',
} as const;
export type UnderstandingSectionKey =
  (typeof UNDERSTANDING_SECTION)[keyof typeof UNDERSTANDING_SECTION];
export const UNDERSTANDING_SECTIONS: UnderstandingSectionKey[] = Object.values(UNDERSTANDING_SECTION);

/** How a field is captured. `repeat` is a small table of rows with `columns`. */
export type UnderstandingFieldType = 'text' | 'yes_no' | 'yes_no_unknown' | 'select' | 'multi' | 'repeat';

export interface UnderstandingFieldDef {
  key: string;
  /** Spec code, e.g. `BU-01`, where the spec gives one. */
  code: string | null;
  label: string;
  type: UnderstandingFieldType;
  options?: readonly string[];
  /** Column labels for `repeat` fields. */
  columns?: readonly string[];
  hint?: string;
}

export interface UnderstandingSectionDef {
  key: UnderstandingSectionKey;
  code: string;
  title: string;
  purpose: string;
  fields: readonly UnderstandingFieldDef[];
}

const YNU = ['Yes', 'No', 'Unknown'] as const;

/** Field catalogue for 03.2.1–03.2.6 (spec §5–§10). */
export const UNDERSTANDING_SECTION_DEFS: readonly UnderstandingSectionDef[] = [
  {
    key: 'business_model',
    code: '03.2.1',
    title: 'Business & Operating Model',
    purpose: 'How the entity operates and earns revenue.',
    fields: [
      {
        key: 'activities',
        code: 'BU-01',
        label: 'Principal business activities',
        type: 'multi',
        options: ['Manufacturing', 'Trading / distribution', 'Services', 'Construction / projects', 'Financial services', 'Not-for-profit', 'Holding / investment', 'Other'],
      },
      { key: 'activities_note', code: 'BU-01', label: 'Activities — concise description', type: 'text' },
      {
        key: 'revenue_streams',
        code: 'BU-02',
        label: 'Revenue streams',
        type: 'repeat',
        columns: ['Stream', 'Product / service', 'Geography', 'Customer type', 'Recurring?', 'Approx. share'],
      },
      { key: 'products', code: 'BU-03', label: 'Major products / services', type: 'repeat', columns: ['Product / service', 'Revenue stream'] },
      {
        key: 'customer_types',
        code: 'BU-04',
        label: 'Customer profile',
        type: 'multi',
        options: ['B2B', 'B2C', 'Government', 'Related party', 'Export', 'Other'],
      },
      { key: 'customer_concentration', code: 'BU-04', label: 'Major customer concentration known?', type: 'yes_no_unknown', options: YNU, hint: 'Names are not needed at planning stage.' },
      { key: 'supplier_profile', code: 'BU-05', label: 'Key inputs / suppliers, dependency, imports', type: 'text' },
      { key: 'locations', code: 'BU-06', label: 'Operating locations — operating context', type: 'text', hint: 'Known locations come from 02.6; add operating context only.' },
      {
        key: 'channels',
        code: 'BU-07',
        label: 'Sales / procurement channels',
        type: 'multi',
        options: ['Direct', 'Dealer / distributor', 'Marketplace', 'Tender', 'Subscription', 'Long-term contract', 'Other'],
      },
      { key: 'seasonality', code: 'BU-08', label: 'Seasonality / cyclicality?', type: 'yes_no', options: ['Yes', 'No'] },
      { key: 'seasonality_note', code: 'BU-08', label: 'Seasonality — period / reason', type: 'text' },
      { key: 'significant_contracts', code: 'BU-09', label: 'Significant contracts / arrangements?', type: 'yes_no', options: ['Yes', 'No'] },
      { key: 'significant_contracts_note', code: 'BU-09', label: 'Nature and financial-reporting relevance', type: 'text' },
    ],
  },
  {
    key: 'governance',
    code: '03.2.2',
    title: 'Ownership, Governance & Management',
    purpose: 'Decision-makers, governance and ownership context.',
    fields: [
      { key: 'ownership_changes', code: null, label: 'Ownership / control — changes during the year', type: 'text', hint: 'Structure comes from the client master / 02.6; record changes only.' },
      { key: 'promoters', code: null, label: 'Promoters / controlling parties', type: 'repeat', columns: ['Party', 'Relationship / holding', 'Source'] },
      { key: 'tcwg', code: null, label: 'Board / TCWG structure', type: 'text', hint: 'Key governance bodies; Audit Committee where applicable.' },
      { key: 'key_management', code: null, label: 'Key management / finance leadership', type: 'repeat', columns: ['Role', 'Name', 'Changed during year?', 'Effective date'] },
      { key: 'related_party_env', code: null, label: 'Related-party environment', type: 'select', options: ['Simple / stable', 'Complex', 'Changed during year'] },
      { key: 'management_observation', code: null, label: 'Management competence / turnover — factual observation', type: 'text', hint: 'Facts only; avoid unsupported character judgments.' },
    ],
  },
  {
    key: 'industry',
    code: '03.2.3',
    title: 'Industry, Market & Regulatory Environment',
    purpose: 'External factors relevant to the entity.',
    fields: [
      { key: 'sub_industry', code: null, label: 'Sub-industry', type: 'text', hint: 'The industry profile (above) drives which analytics apply.' },
      { key: 'competition', code: null, label: 'Competitive environment', type: 'select', options: ['Stable', 'Changing', 'Highly changing'] },
      { key: 'competition_note', code: null, label: 'Competitive environment — concise fact', type: 'text' },
      { key: 'demand_pricing', code: null, label: 'Demand / pricing trend', type: 'text' },
      { key: 'sensitivities', code: null, label: 'Input / commodity / FX sensitivity', type: 'multi', options: ['Commodity prices', 'Foreign exchange', 'Energy', 'Labour cost', 'Import dependency', 'None significant'] },
      { key: 'economic_sensitivity', code: null, label: 'Economic / financing sensitivity', type: 'multi', options: ['Interest rates', 'Liquidity', 'Customer credit', 'None significant'] },
      { key: 'regulators', code: null, label: 'Key laws / operational regulators', type: 'text', hint: 'Framework law comes from 02.1; add operational regulators only.' },
      { key: 'regulatory_change', code: null, label: 'Material regulatory change during the year?', type: 'yes_no_unknown', options: YNU },
      { key: 'regulatory_change_note', code: null, label: 'Regulatory change — description and source', type: 'text' },
      { key: 'industry_considerations_confirmed', code: null, label: 'Industry-specific considerations confirmed as relevant', type: 'text', hint: 'Confirm or reject the system-suggested industry considerations.' },
    ],
  },
  {
    key: 'systems',
    code: '03.2.4',
    title: 'Accounting, Systems & Process Environment',
    purpose: 'Finance organisation, systems and key process landscape (no controls testing — that is Section 05).',
    fields: [
      { key: 'finance_org', code: null, label: 'Finance organisation', type: 'select', options: ['Centralised', 'Decentralised', 'Shared service'] },
      { key: 'erp', code: null, label: 'Accounting system / ERP — name and relevant modules', type: 'text' },
      { key: 'erp_change', code: null, label: 'Major system change / migration during the year?', type: 'yes_no', options: ['Yes', 'No'] },
      { key: 'other_systems', code: null, label: 'Other financially relevant systems', type: 'multi', options: ['Payroll', 'Inventory', 'Billing', 'CRM', 'Treasury', 'Fixed assets', 'Other'] },
      { key: 'interfaces', code: null, label: 'Significant interfaces / manual uploads?', type: 'yes_no_unknown', options: YNU },
      { key: 'service_org_context', code: null, label: 'Service organisation — service / process context', type: 'text', hint: 'Whether a service organisation exists comes from Section 02.' },
      { key: 'cycles', code: null, label: 'Key transaction cycles', type: 'multi', options: ['Revenue', 'Procurement', 'Payroll', 'Inventory', 'Treasury', 'Fixed assets', 'Close / reporting'] },
      { key: 'close_process', code: null, label: 'Month / year-end close — timing and complexity', type: 'text' },
      { key: 'spreadsheets', code: null, label: 'Significant spreadsheets / manual processes?', type: 'yes_no_unknown', options: YNU },
      { key: 'spreadsheets_note', code: null, label: 'Manual process context', type: 'text' },
    ],
  },
  {
    key: 'objectives',
    code: '03.2.5',
    title: 'Objectives, Strategy & Business Risks',
    purpose: 'Only to the extent relevant to potential financial-reporting implications.',
    fields: [
      { key: 'objectives', code: null, label: 'Key current-year objectives', type: 'multi', options: ['Growth', 'Margin', 'Expansion', 'Funding', 'Acquisition', 'Cost reduction', 'Launch', 'Restructuring', 'Other'] },
      { key: 'strategy', code: null, label: 'How management intends to achieve them', type: 'text' },
      { key: 'management_risks', code: null, label: 'Business risks identified by management', type: 'repeat', columns: ['Risk', 'Management response', 'FR implication known?'] },
      { key: 'auditor_risks', code: null, label: 'Auditor-observed business risk considerations', type: 'text' },
      { key: 'fr_effect', code: null, label: 'Potential financial-reporting effect', type: 'text', hint: 'A significant effect can be raised as a Planning Signal.' },
    ],
  },
  {
    key: 'performance',
    code: '03.2.6',
    title: 'Performance Measures & Management Monitoring',
    purpose: 'KPIs, budgets and the information management uses.',
    fields: [
      { key: 'budget', code: null, label: 'Budget / forecast prepared?', type: 'yes_no', options: ['Yes', 'No'] },
      { key: 'budget_note', code: null, label: 'Budget period and latest revision', type: 'text' },
      { key: 'kpis', code: null, label: 'Management KPIs', type: 'repeat', columns: ['KPI', 'Target', 'Actual', 'Source'] },
      { key: 'reporting', code: null, label: 'Board / management reporting frequency', type: 'select', options: ['Monthly', 'Quarterly', 'Half-yearly', 'Other'] },
      { key: 'remuneration_targets', code: null, label: 'Performance-linked remuneration / targets?', type: 'yes_no_unknown', options: YNU },
      { key: 'covenants', code: null, label: 'External measures / covenants', type: 'text', hint: 'Debt covenants, lender / investor / regulatory metrics.' },
      { key: 'under_over_performance', code: null, label: 'Significant under / over-performance', type: 'text' },
    ],
  },
];

/** One field value: text, a single choice, several choices, or table rows. */
export type UnderstandingAnswer = string | string[] | string[][] | null;

/** Read-only context consumed from Section 02 / 03.1 (never re-entered). */
export interface UnderstandingContextItem {
  label: string;
  value: string;
  source: string;
}

export interface UnderstandingSectionRecord {
  key: UnderstandingSectionKey;
  /** "Has anything changed?" asked before the detail (spec §5). */
  anythingChanged: 'yes' | 'no' | null;
  answers: Record<string, UnderstandingAnswer>;
  reviewed: boolean;
  reviewedAt: string | null;
  context: UnderstandingContextItem[];
  /** 0 when not yet saved. */
  version: number;
}

export interface UpdateUnderstandingSectionInput {
  anythingChanged?: 'yes' | 'no' | null;
  answers?: Record<string, UnderstandingAnswer>;
  reviewed?: boolean;
  version: number;
}

// ── Industry Analytics Profiles (§17) ────────────────────────────────────────

/**
 * The profiles seeded in the Analytics Methodology Library. Profiles are
 * versioned library data (statutory-audit-analytics-library.ts): the
 * Methodology Admin may add more, so a profile key is any library key.
 */
export const INDUSTRY_PROFILE = {
  generic: 'generic',
  manufacturing: 'manufacturing',
  trading: 'trading',
  services: 'services',
  construction: 'construction',
  nbfc: 'nbfc',
  section8: 'section8',
} as const;
/** An Analytics Methodology Library profile key (seeded keys above, or admin-added). */
export type IndustryProfile = string;
export const INDUSTRY_PROFILE_KEY_PATTERN = /^[a-z0-9_]{2,40}$/;
/** The seeded profile keys. The live list is `BusinessUnderstandingSummary.industryProfiles`. */
export const INDUSTRY_PROFILES: IndustryProfile[] = Object.values(INDUSTRY_PROFILE);

/** Labels of the seeded profiles (the live label comes from the library). */
export const INDUSTRY_PROFILE_LABEL: Record<IndustryProfile, string> = {
  generic: 'Generic corporate',
  manufacturing: 'Manufacturing',
  trading: 'Trading / distribution',
  services: 'Services',
  construction: 'Construction / project-based',
  nbfc: 'NBFC / financial services',
  section8: 'Section 8 / not-for-profit',
};

// ── 03.2.7 Focused Financial Dataset ─────────────────────────────────────────

/** Canonical metric ids — a future TB module populates these same ids. */
export const FINANCIAL_METRIC = {
  revenue: 'revenue',
  otherIncome: 'other_income',
  costOfSales: 'cost_of_sales',
  purchases: 'purchases',
  grossProfit: 'gross_profit',
  ebitda: 'ebitda',
  pbt: 'pbt',
  pat: 'pat',
  totalAssets: 'total_assets',
  netWorth: 'net_worth',
  cashBank: 'cash_bank',
  tradeReceivables: 'trade_receivables',
  inventory: 'inventory',
  tradePayables: 'trade_payables',
  totalBorrowings: 'total_borrowings',
  currentAssets: 'current_assets',
  currentLiabilities: 'current_liabilities',
  ppe: 'ppe',
  investments: 'investments',
  employeeCost: 'employee_cost',
  financeCost: 'finance_cost',
  relatedParty: 'related_party',
} as const;
export type CanonicalMetricKey = (typeof FINANCIAL_METRIC)[keyof typeof FINANCIAL_METRIC];

/**
 * @deprecated The v1 seed of the canonical metric definitions. The Analytics
 * Methodology Library (`analytics_metric_definition`) is the source of truth —
 * read `BusinessUnderstandingSummary.analyticsMethodology.metrics`.
 */
export interface FinancialMetricDef {
  key: CanonicalMetricKey;
  label: string;
  /** Core = expected for every entity; otherwise where applicable. */
  core: boolean;
  note: string;
}

/** @deprecated See {@link FinancialMetricDef}; kept as the v1 seed for reference. */
export const FINANCIAL_METRIC_DEFS: readonly FinancialMetricDef[] = [
  { key: 'revenue', label: 'Revenue from operations', core: true, note: 'Core' },
  { key: 'other_income', label: 'Other income', core: true, note: 'Core' },
  { key: 'cost_of_sales', label: 'Cost of sales / materials consumed', core: false, note: 'Needed for inventory days' },
  { key: 'purchases', label: 'Purchases', core: false, note: 'Preferred base for payable days' },
  { key: 'gross_profit', label: 'Gross profit', core: false, note: 'Where meaningful' },
  { key: 'ebitda', label: 'EBITDA / operating profit', core: false, note: 'Where meaningful' },
  { key: 'pbt', label: 'Profit before tax', core: true, note: 'Core' },
  { key: 'pat', label: 'Profit after tax', core: true, note: 'Core' },
  { key: 'total_assets', label: 'Total assets', core: true, note: 'Core' },
  { key: 'net_worth', label: 'Net worth / total equity', core: true, note: 'Core' },
  { key: 'cash_bank', label: 'Cash & bank', core: true, note: 'Core' },
  { key: 'trade_receivables', label: 'Trade receivables', core: false, note: 'Where applicable' },
  { key: 'inventory', label: 'Inventory', core: false, note: 'Where applicable' },
  { key: 'trade_payables', label: 'Trade payables', core: false, note: 'Where applicable' },
  { key: 'total_borrowings', label: 'Total borrowings', core: false, note: 'Core if financed' },
  { key: 'current_assets', label: 'Current assets', core: false, note: 'For liquidity analytics' },
  { key: 'current_liabilities', label: 'Current liabilities', core: false, note: 'For liquidity analytics' },
  { key: 'ppe', label: 'Property, plant & equipment', core: false, note: 'Where applicable' },
  { key: 'investments', label: 'Investments', core: false, note: 'Where applicable' },
  { key: 'employee_cost', label: 'Employee benefit expense', core: false, note: 'Where applicable' },
  { key: 'finance_cost', label: 'Finance cost', core: false, note: 'Where applicable' },
  { key: 'related_party', label: 'Related-party balances / transactions', core: false, note: 'Optional, if readily available' },
];

/** Custom metric keys are `custom_<slug>`. */
export const CUSTOM_METRIC_PREFIX = 'custom_';

export const FINANCIAL_PERIOD = { cy: 'cy', py: 'py' } as const;
export type FinancialPeriod = (typeof FINANCIAL_PERIOD)[keyof typeof FINANCIAL_PERIOD];

export const FINANCIAL_UNIT = {
  inr: 'inr',
  thousand: 'inr_thousand',
  lakh: 'inr_lakh',
  crore: 'inr_crore',
  other: 'other',
} as const;
export type FinancialUnit = (typeof FINANCIAL_UNIT)[keyof typeof FINANCIAL_UNIT];
export const FINANCIAL_UNITS: FinancialUnit[] = Object.values(FINANCIAL_UNIT);
export const FINANCIAL_UNIT_LABEL: Record<FinancialUnit, string> = {
  inr: '₹',
  inr_thousand: '₹ thousand',
  inr_lakh: '₹ lakh',
  inr_crore: '₹ crore',
  other: 'Other',
};
/** Multiplier to rupees; `other` cannot be converted. */
export const FINANCIAL_UNIT_FACTOR: Record<FinancialUnit, number | null> = {
  inr: 1,
  inr_thousand: 1_000,
  inr_lakh: 100_000,
  inr_crore: 10_000_000,
  other: null,
};

export const DATASET_STATUS = {
  draft: 'draft',
  final: 'final',
  managementAccounts: 'management_accounts',
} as const;
export type DatasetStatus = (typeof DATASET_STATUS)[keyof typeof DATASET_STATUS];
export const DATASET_STATUSES: DatasetStatus[] = Object.values(DATASET_STATUS);

/** Source of a figure (§20: required). */
export const METRIC_SOURCE_TYPE = {
  managementAccounts: 'management_accounts',
  draftFs: 'draft_fs',
  auditedPyFs: 'audited_py_fs',
  other: 'other',
} as const;
export type MetricSourceType = (typeof METRIC_SOURCE_TYPE)[keyof typeof METRIC_SOURCE_TYPE];
export const METRIC_SOURCE_TYPES: MetricSourceType[] = Object.values(METRIC_SOURCE_TYPE);
export const METRIC_SOURCE_TYPE_LABEL: Record<MetricSourceType, string> = {
  management_accounts: 'Management accounts',
  draft_fs: 'Draft financial statements',
  audited_py_fs: 'Audited PY financial statements',
  other: 'Other identified source',
};

export interface FinancialDatasetHeader {
  periodEnd: string | null;
  pyPeriodEnd: string | null;
  currency: string | null;
  units: FinancialUnit | null;
  /** PY units when different from CY (the engine converts; `other` blocks comparison). */
  pyUnits: FinancialUnit | null;
  cySource: string | null;
  pySource: string | null;
  dataStatus: DatasetStatus | null;
  sourceDate: string | null;
  preparedByName: string | null;
  /** 0 when the header has not been saved. */
  version: number;
}

export interface UpdateFinancialDatasetInput {
  periodEnd?: string | null;
  pyPeriodEnd?: string | null;
  currency?: string | null;
  units?: FinancialUnit | null;
  pyUnits?: FinancialUnit | null;
  cySource?: string | null;
  pySource?: string | null;
  dataStatus?: DatasetStatus | null;
  sourceDate?: string | null;
  version: number;
}

export interface CustomMetricRecord {
  key: string;
  label: string;
}

export interface FinancialValueRecord {
  /** Brought forward from last year's file (§21); null when entered here. */
  rolledForward: RolledForwardInfo | null;
  /** Why an approved roll-forward was changed. */
  overrideReason: string | null;
  metricKey: string;
  period: FinancialPeriod;
  amount: number;
  sourceType: MetricSourceType;
  sourceRef: string | null;
  note: string | null;
  enteredByName: string | null;
  enteredAt: string;
  version: number;
}

/** One cell of the dataset grid. `amount: null` clears the value. */
export interface FinancialValueInput {
  /** Required to change (or clear) a figure rolled forward from an approved prior file (§21). */
  overrideReason?: string | null;
  metricKey: string;
  period: FinancialPeriod;
  amount: number | null;
  sourceType?: MetricSourceType;
  sourceRef?: string | null;
  note?: string | null;
  /** 0 for a new value. */
  version: number;
}

export interface SaveFinancialValuesInput {
  values: FinancialValueInput[];
}

// ── 03.2.8 Preliminary Analytical Review ─────────────────────────────────────

export interface MetricMovement {
  metricKey: string;
  label: string;
  cy: number | null;
  py: number | null;
  /** CY − PY in CY units. */
  absolute: number | null;
  /** (CY − PY) / |PY| × 100; null when PY is 0 or missing. */
  percent: number | null;
  /** Display text: e.g. `+51.9%`, `N/M` (PY = 0), or `—`. */
  percentLabel: string;
}

export type AnalyticsResultStatus = 'calculated' | 'insufficient_data' | 'not_meaningful' | 'not_applicable';

export interface RatioResult {
  key: string;
  label: string;
  /** Human formula including the basis, e.g. `Inventory / Cost of sales × 365`. */
  formula: string;
  unit: RatioUnit;
  cy: number | null;
  py: number | null;
  status: AnalyticsResultStatus;
  /** Why it was not calculated, when it wasn't. */
  reason: string | null;
  /** Analytics Methodology Library rule the ratio comes from. */
  ruleCode: string;
  ruleVersion: number;
  /** Balance / base disclosure (average vs closing, cost base, debt definition). */
  basisNote: string | null;
  /** Underlying values used (CY/PY), for transparency. */
  inputs: { metricKey: string; label: string; cy: number | null; py: number | null }[];
}

/** An exception the engine surfaces (becomes / refreshes an Investigation Card). */
export interface DerivedAnalyticsException {
  ruleKey: string;
  /** Library rule code + version it fired under (kept on the card). */
  ruleCode: string;
  ruleVersion: number;
  methodologyVersion: string;
  kind: AnalyticsExceptionKind;
  observation: string;
  /** The configured attention rule that flagged it. */
  whyFlagged: string;
  /** Methodology explanation of why it may matter. */
  whyMayMatter: string;
  suggestedAttention: PlanningAttention;
  affectedAreas: string[];
  /** Snapshot of the values behind the exception (drives reassessment on change). */
  values: Record<string, number | null>;
}

export interface AnalyticsWarning {
  code: string;
  message: string;
}

export interface AnalyticsResult {
  /** Methodology version of the industry profile in force. */
  methodologyVersion: string;
  profile: IndustryProfile;
  profileLabel: string;
  /** Every rule in force for the profile and how it fared (formula + parameter shown). */
  rules: AnalyticsRuleStatus[];
  /** True once the header is complete enough to calculate. */
  ready: boolean;
  warnings: AnalyticsWarning[];
  movements: MetricMovement[];
  ratios: RatioResult[];
  exceptions: DerivedAnalyticsException[];
}

// ── 03.2.9 Investigation Cards ───────────────────────────────────────────────

export const INVESTIGATION_ASSESSMENT = {
  reasonable: 'reasonable',
  partiallySupported: 'partially_supported',
  notSupported: 'not_supported',
  furtherInformation: 'further_information_required',
  notRelevant: 'not_relevant',
} as const;
export type InvestigationAssessment =
  (typeof INVESTIGATION_ASSESSMENT)[keyof typeof INVESTIGATION_ASSESSMENT];
export const INVESTIGATION_ASSESSMENTS: InvestigationAssessment[] = Object.values(INVESTIGATION_ASSESSMENT);
export const INVESTIGATION_ASSESSMENT_LABEL: Record<InvestigationAssessment, string> = {
  reasonable: 'Explanation reasonable',
  partially_supported: 'Partially supported',
  not_supported: 'Not supported',
  further_information_required: 'Further information required',
  not_relevant: 'Not relevant after investigation',
};

export const INVESTIGATION_SIGNAL_DECISION = {
  create: 'create',
  link: 'link',
  none: 'none',
} as const;
export type InvestigationSignalDecision =
  (typeof INVESTIGATION_SIGNAL_DECISION)[keyof typeof INVESTIGATION_SIGNAL_DECISION];
export const INVESTIGATION_SIGNAL_DECISIONS: InvestigationSignalDecision[] = Object.values(
  INVESTIGATION_SIGNAL_DECISION,
);

export const INVESTIGATION_STATUS = {
  open: 'open',
  awaitingInformation: 'awaiting_information',
  assessed: 'assessed',
} as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUS)[keyof typeof INVESTIGATION_STATUS];

export interface InvestigationCardRecord {
  id: string;
  /** Human code, e.g. `AX-001`. */
  cardCode: string;
  ruleKey: string;
  /** Library rule code + version the card was raised / last refreshed under. */
  ruleCode: string | null;
  ruleVersion: number | null;
  methodologyVersion: string;
  observation: string;
  whyFlagged: string;
  whyMayMatter: string | null;
  suggestedAttention: PlanningAttention;
  values: Record<string, number | null>;
  managementExplanation: string | null;
  explanationBy: string | null;
  explanationDate: string | null;
  evidence: string | null;
  assessment: InvestigationAssessment | null;
  affectedAreas: string[];
  signalDecision: InvestigationSignalDecision | null;
  noSignalRationale: string | null;
  signalId: string | null;
  signalCode: string | null;
  /** Areas of Focus the card's signal is grouped under (§18). */
  focusAreas: UnderstandingFocusLink[];
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: InvestigationStatus;
  /** A source figure changed after assessment — reassess (§21). */
  needsReassessment: boolean;
  /** The rule no longer flags on current figures (kept, never silently deleted). */
  noLongerFlagged: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssessInvestigationInput {
  managementExplanation?: string | null;
  explanationBy?: string | null;
  explanationDate?: string | null;
  evidence?: string | null;
  assessment?: InvestigationAssessment | null;
  affectedAreas?: string[];
  signalDecision?: InvestigationSignalDecision | null;
  /** Required for `link`. */
  linkSignalId?: string | null;
  /** Required for `none` when the suggested attention is Enhanced / Immediate Partner. */
  noSignalRationale?: string | null;
  ownerEmployeeId?: string | null;
  dueDate?: string | null;
  version: number;
}

// ── §14 Expectation vs Actual ────────────────────────────────────────────────

export const EXPECTATION_TYPE = { amount: 'amount', range: 'range', direction: 'direction' } as const;
export type ExpectationType = (typeof EXPECTATION_TYPE)[keyof typeof EXPECTATION_TYPE];
export const EXPECTATION_TYPES: ExpectationType[] = Object.values(EXPECTATION_TYPE);

export const EXPECTATION_DIRECTIONS = ['increase', 'decrease', 'stable'] as const;
export type ExpectationDirection = (typeof EXPECTATION_DIRECTIONS)[number];

export const EXPECTATION_BASES = ['budget', 'prior_trend', 'operational_driver', 'management_forecast', 'other'] as const;
export type ExpectationBasis = (typeof EXPECTATION_BASES)[number];
export const EXPECTATION_BASIS_LABEL: Record<ExpectationBasis, string> = {
  budget: 'Budget',
  prior_trend: 'Prior trend',
  operational_driver: 'Operational driver',
  management_forecast: 'Management forecast',
  other: 'Other',
};

export const EXPECTATION_CONCLUSIONS = ['normal', 'explain', 'planning_signal'] as const;
export type ExpectationConclusion = (typeof EXPECTATION_CONCLUSIONS)[number];
export const EXPECTATION_CONCLUSION_LABEL: Record<ExpectationConclusion, string> = {
  normal: 'Normal',
  explain: 'Explain',
  planning_signal: 'Planning Signal',
};

export interface PlanningExpectationRecord {
  id: string;
  metricKey: string;
  metricLabel: string;
  expectationType: ExpectationType;
  expectedAmount: number | null;
  expectedLow: number | null;
  expectedHigh: number | null;
  expectedDirection: ExpectationDirection | null;
  tolerancePct: number | null;
  basis: ExpectationBasis;
  basisNote: string | null;
  /** System-linked CY actual. */
  actual: number | null;
  /** Actual − expectation (amount) or distance outside the range. */
  variance: number | null;
  /** System suggestion from the tolerance; the auditor confirms. */
  suggestedInvestigation: boolean | null;
  requiresInvestigation: boolean | null;
  conclusion: ExpectationConclusion | null;
  signalId: string | null;
  signalCode: string | null;
  version: number;
}

export interface CreatePlanningExpectationInput {
  metricKey: string;
  expectationType: ExpectationType;
  expectedAmount?: number | null;
  expectedLow?: number | null;
  expectedHigh?: number | null;
  expectedDirection?: ExpectationDirection | null;
  tolerancePct?: number | null;
  basis: ExpectationBasis;
  basisNote?: string | null;
}

export interface UpdatePlanningExpectationInput {
  requiresInvestigation?: boolean | null;
  conclusion?: ExpectationConclusion | null;
  version: number;
}

// ── 03.2 record, BA-01 and summary ───────────────────────────────────────────

export const UNDERSTANDING_STATUS = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  complete: 'complete',
  /** A completed 03.2 whose analytics moved (source figure / methodology) — reassess (§21). */
  reassessmentRequired: 'reassessment_required',
} as const;
export type UnderstandingStatus = (typeof UNDERSTANDING_STATUS)[keyof typeof UNDERSTANDING_STATUS];

/** BA-01 Manager conclusion (§19). */
export const BA01_ANSWER = { yesComplete: 'yes_complete', noFurtherWork: 'no_further_work' } as const;
export type Ba01Answer = (typeof BA01_ANSWER)[keyof typeof BA01_ANSWER];
export const BA01_ANSWERS: Ba01Answer[] = Object.values(BA01_ANSWER);

export interface BusinessUnderstandingRecord {
  status: UnderstandingStatus;
  industryProfile: IndustryProfile;
  ba01: Ba01Answer | null;
  conclusionSummary: string | null;
  version: number;
}

export interface UpdateBusinessUnderstandingInput {
  industryProfile?: IndustryProfile;
  ba01?: Ba01Answer | null;
  conclusionSummary?: string | null;
  version: number;
}

/** Everything the 03.2 screen needs in one read. */
export interface BusinessUnderstandingSummary {
  record: BusinessUnderstandingRecord;
  /** §23 the caller's role / capabilities and the edit lock. */
  access: UnderstandingAccess;
  /** §20 version (v1.0, v1.1…) and completion / reassessment state. */
  versionInfo: UnderstandingVersionInfo;
  revisions: UnderstandingRevisionRecord[];
  /** §23 Engagement Partner comments / challenges. */
  challenges: UnderstandingChallengeRecord[];
  /** Live evidence files per 03.2 record id (§20). */
  evidenceCounts: Record<string, number>;
  /** §25 View Provision anchors for context `03.2` (generic + industry profile). */
  authorityAnchors: string[];
  /** §7 the Manager's decision per suggested industry consideration (keyed by its text). */
  industryConsiderationDecisions: Record<string, IndustryConsiderationDecision>;
  /** Record ids of the six sections / the dataset header (evidence targets; null until saved). */
  recordIds: { sections: Partial<Record<UnderstandingSectionKey, string>>; dataset: string | null };
  sections: UnderstandingSectionRecord[];
  /** System-suggested industry considerations for 03.2.3 (Manager confirms). */
  industryConsiderations: string[];
  /** Industry profiles in force (the 03.2 profile selector). */
  industryProfiles: AnalyticsProfileOption[];
  /** Sub-industry taxonomy of the selected profile ([] = free text only). */
  subIndustryOptions: string[];
  /** The analytics methodology this file runs on. */
  analyticsMethodology: AnalyticsMethodologySummary;
  dataset: FinancialDatasetHeader;
  customMetrics: CustomMetricRecord[];
  values: FinancialValueRecord[];
  analytics: AnalyticsResult;
  openInvestigations: number;
  completion: PlanningCompletionCheck[];
}
