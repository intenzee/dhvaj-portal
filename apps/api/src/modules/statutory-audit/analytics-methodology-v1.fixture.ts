import type {
  AnalyticsMetricDef,
  AnalyticsProfileDef,
  AnalyticsRuleDef,
  AnalyticsRuleDefinition,
  AttentionParameterType,
  PlanningAttention,
} from '@hsdg/contracts';

/**
 * The v1 Analytics Methodology Library (DHVAJ 03.2 §12–§17) exactly as
 * migration 1768500000000 seeds it. NOT used at runtime — the API reads the
 * library from the database. This copy exists so the pure engine can be unit
 * tested on the real methodology, and the e2e suite asserts the seed still
 * equals it (so the two cannot drift).
 */

export const V1 = 'dhvaj-analytics-2026.1';
const base = {
  version: 1,
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  methodologyVersion: V1,
} as const;

// ── Metrics ──────────────────────────────────────────────────────────────────

type M = [
  key: string,
  label: string,
  valueType: AnalyticsMetricDef['valueType'],
  core: boolean,
  note: string,
  appliesTo?: string[],
];
const METRICS: M[] = [
  ['revenue', 'Revenue from operations', 'amount', true, 'Core'],
  ['other_income', 'Other income', 'amount', true, 'Core'],
  [
    'cost_of_sales',
    'Cost of sales / materials consumed',
    'amount',
    false,
    'Needed for inventory days',
  ],
  ['purchases', 'Purchases', 'amount', false, 'Preferred base for payable days'],
  ['gross_profit', 'Gross profit', 'amount', false, 'Where meaningful'],
  ['ebitda', 'EBITDA / operating profit', 'amount', false, 'Where meaningful'],
  ['pbt', 'Profit before tax', 'amount', true, 'Core'],
  ['pat', 'Profit after tax', 'amount', true, 'Core'],
  ['total_assets', 'Total assets', 'amount', true, 'Core'],
  ['net_worth', 'Net worth / total equity', 'amount', true, 'Core'],
  ['cash_bank', 'Cash & bank', 'amount', true, 'Core'],
  ['trade_receivables', 'Trade receivables', 'amount', false, 'Where applicable'],
  ['inventory', 'Inventory', 'amount', false, 'Where applicable'],
  ['trade_payables', 'Trade payables', 'amount', false, 'Where applicable'],
  ['total_borrowings', 'Total borrowings', 'amount', false, 'Core if financed'],
  [
    'lease_liabilities',
    'Lease liabilities',
    'amount',
    false,
    'Where applicable — part of debt only if the profile says so',
  ],
  ['current_assets', 'Current assets', 'amount', false, 'For liquidity analytics'],
  ['current_liabilities', 'Current liabilities', 'amount', false, 'For liquidity analytics'],
  ['ppe', 'Property, plant & equipment', 'amount', false, 'Where applicable'],
  ['investments', 'Investments', 'amount', false, 'Where applicable'],
  ['employee_cost', 'Employee benefit expense', 'amount', false, 'Where applicable'],
  ['finance_cost', 'Finance cost', 'amount', false, 'Where applicable'],
  [
    'related_party',
    'Related-party balances / transactions',
    'amount',
    false,
    'Optional, if readily available',
  ],
  // Sector metrics (§17) — offered only for the profiles that use them.
  [
    'inventory_raw_materials',
    'Inventory — raw materials',
    'amount',
    false,
    'If available',
    ['manufacturing'],
  ],
  [
    'inventory_finished_goods',
    'Inventory — finished goods',
    'amount',
    false,
    'If available',
    ['manufacturing'],
  ],
  [
    'headcount',
    'Employee headcount (period end)',
    'count',
    false,
    'For revenue per employee',
    ['services'],
  ],
  [
    'unbilled_revenue',
    'Unbilled / accrued revenue',
    'amount',
    false,
    'If relevant',
    ['services', 'construction'],
  ],
  [
    'order_book',
    'Order book (unexecuted orders)',
    'amount',
    false,
    'Project / order backlog',
    ['construction'],
  ],
  ['contract_assets', 'Contract assets', 'amount', false, 'Ind AS 115 / AS 7', ['construction']],
  [
    'contract_liabilities',
    'Contract liabilities (incl. advances)',
    'amount',
    false,
    'Ind AS 115 / AS 7',
    ['construction'],
  ],
  [
    'retention_receivables',
    'Retention money receivable',
    'amount',
    false,
    'Where applicable',
    ['construction'],
  ],
  ['loan_book', 'Loans & advances (loan book)', 'amount', false, 'NBFC core', ['nbfc']],
  ['interest_income', 'Interest income', 'amount', false, 'NBFC core', ['nbfc']],
  ['gross_npa', 'Gross NPA / Stage 3 assets', 'amount', false, 'NBFC asset quality', ['nbfc']],
  ['net_npa', 'Net NPA', 'amount', false, 'NBFC asset quality', ['nbfc']],
  [
    'capital_adequacy',
    'Capital adequacy ratio (CRAR %)',
    'percent',
    false,
    'Regulatory metric',
    ['nbfc'],
  ],
  [
    'grants_received',
    'Grants / donations received',
    'amount',
    false,
    'Section 8 / NPO',
    ['section8'],
  ],
  [
    'restricted_funds',
    'Restricted / earmarked funds',
    'amount',
    false,
    'Section 8 / NPO',
    ['section8'],
  ],
  [
    'programme_expenditure',
    'Programme (objects) expenditure',
    'amount',
    false,
    'Section 8 / NPO',
    ['section8'],
  ],
];

export const V1_METRICS: AnalyticsMetricDef[] = METRICS.map(
  ([metricKey, label, valueType, core, note, appliesTo], i) => ({
    ...base,
    metricKey,
    label,
    valueType,
    core,
    note,
    appliesTo: appliesTo ?? [],
    sortOrder: (i + 1) * 10,
  }),
);

// ── Industry profiles ────────────────────────────────────────────────────────

const profileDefaults = {
  averageBalances: false,
  debtMetrics: ['total_borrowings'],
  financeCostBasis: 'closing' as const,
  inventoryCostBases: ['cost_of_sales', 'purchases'],
  payableCostBases: ['purchases', 'cost_of_sales'],
  inventoryTrendFallback: 'revenue',
};

export const V1_PROFILES: AnalyticsProfileDef[] = [
  {
    ...base,
    ...profileDefaults,
    profileKey: 'generic',
    label: 'Generic corporate',
    description: 'Generic planning analytics for a commercial entity.',
    subIndustries: [],
    considerations: [],
  },
  {
    ...base,
    ...profileDefaults,
    profileKey: 'manufacturing',
    label: 'Manufacturing',
    description:
      'Gross margin, inventory days and inventory mix; capacity and input-cost sensitivity.',
    subIndustries: [
      'Automotive & components',
      'Chemicals',
      'Pharmaceuticals',
      'Textiles & apparel',
      'FMCG / food processing',
      'Engineering & capital goods',
      'Metals & mining',
      'Electronics',
    ],
    considerations: [
      'Inventory existence and valuation (raw material / WIP / finished goods mix)',
      'Capacity utilisation and production KPIs',
      'Commodity / input-price sensitivity',
      'Standard costing and overhead absorption',
    ],
  },
  {
    ...base,
    ...profileDefaults,
    profileKey: 'trading',
    label: 'Trading / distribution',
    description: 'Gross margin, inventory, receivable and payable days; concentration and returns.',
    subIndustries: [
      'Wholesale distribution',
      'Retail',
      'E-commerce / marketplace seller',
      'Import / export trading',
      'Commodity trading',
    ],
    considerations: [
      'Customer and supplier concentration',
      'Returns, discounts and rebates',
      'Inventory ageing and slow-moving stock',
    ],
  },
  {
    ...base,
    ...profileDefaults,
    profileKey: 'services',
    label: 'Services',
    description:
      'Revenue per employee, employee-cost ratio and unbilled revenue; no inventory analytics.',
    subIndustries: [
      'IT / software services',
      'Professional services',
      'Healthcare',
      'Education',
      'Hospitality',
      'Logistics',
      'Media & entertainment',
      'BPO / ITeS',
    ],
    considerations: [
      'Unbilled / accrued revenue and contract cut-off',
      'Revenue per employee / utilisation metrics',
      'Contract and customer concentration',
    ],
  },
  {
    ...base,
    ...profileDefaults,
    profileKey: 'construction',
    label: 'Construction / project-based',
    description: 'Order book, contract assets / liabilities, retention and unbilled revenue.',
    subIndustries: [
      'Infrastructure / EPC',
      'Real estate development',
      'Civil contracting',
      'Engineering projects',
    ],
    considerations: [
      'Order book and stage-of-completion measurement',
      'Contract assets / liabilities, retentions and advances',
      'Onerous contracts and cost-to-complete estimates',
    ],
  },
  {
    ...base,
    ...profileDefaults,
    profileKey: 'nbfc',
    label: 'NBFC / financial services',
    description:
      'Sector methodology: asset quality, net interest margin and capital adequacy. Generic working-capital ratios do not apply.',
    subIndustries: [
      'Investment & credit company (NBFC-ICC)',
      'Housing finance company (HFC)',
      'Microfinance (NBFC-MFI)',
      'Core investment company (CIC)',
      'Asset reconstruction company (ARC)',
      'Infrastructure finance (NBFC-IFC)',
    ],
    considerations: [
      'Sector-specific RBI regulatory metrics (capital adequacy, NPA / ECL staging)',
      'Generic working-capital ratios do not apply — use the sector methodology',
      'Asset-liability maturity profile and liquidity coverage',
    ],
    averageBalances: true,
    financeCostBasis: 'average',
    inventoryTrendFallback: null,
  },
  {
    ...base,
    ...profileDefaults,
    profileKey: 'section8',
    label: 'Section 8 / not-for-profit',
    description:
      'Grants, restricted funds and programme expenditure; no margin or inventory analytics.',
    subIndustries: [
      'Charitable activities',
      'Education',
      'Healthcare',
      'Skill development',
      'CSR implementation agency',
    ],
    considerations: [
      'Grants, donations and restricted funds',
      'Programme / utilisation metrics and application of income',
      'Compliance with registration conditions',
    ],
    inventoryTrendFallback: null,
  },
];

// ── Rules ────────────────────────────────────────────────────────────────────

interface RuleSpec {
  key: string;
  name: string;
  formula: string;
  definition: AnalyticsRuleDefinition;
  required: string[];
  appliesTo?: string[];
  excludedFor?: string[];
  parameterType?: AttentionParameterType;
  parameterValue?: number;
  enhancedAt?: number;
  immediateAt?: number;
  wording?: string;
  why?: string;
  areas?: string[];
  attention?: PlanningAttention;
}

const WC_EXCLUDED = ['nbfc'];
const MARGIN_EXCLUDED = ['nbfc', 'section8'];

const ratio = (
  key: string,
  name: string,
  formula: string,
  definition: Omit<Extract<AnalyticsRuleDefinition, { kind: 'ratio' }>, 'kind'>,
  required: string[],
  scope: { appliesTo?: string[]; excludedFor?: string[] } = {},
): RuleSpec => ({
  key,
  name,
  formula,
  definition: { kind: 'ratio', ...definition },
  required,
  ...scope,
});

const MOVEMENT_WHY: Record<string, [why: string, areas: string[]]> = {
  revenue: [
    'A significant change in revenue may indicate changes in the business, cut-off or recognition practices that the audit plan should reflect.',
    ['Revenue'],
  ],
  gross_profit: [
    'A significant change in gross profit may reflect pricing, cost or classification changes.',
    ['Revenue', 'Cost of sales'],
  ],
  pbt: [
    'A significant change in profit may reflect changes in operations, estimates or one-off items.',
    ['Profit & loss'],
  ],
  pat: [
    'A significant change in profit after tax may reflect operating, tax or one-off changes.',
    ['Profit & loss', 'Taxation'],
  ],
  cash_bank: [
    'A significant change in cash may reflect financing, collection or liquidity changes.',
    ['Cash & bank'],
  ],
  trade_receivables: [
    'A significant change in receivables may reflect credit terms, collections or revenue cut-off.',
    ['Trade receivables', 'Revenue'],
  ],
  inventory: [
    'A significant change in inventory may reflect build-up, obsolescence or valuation matters.',
    ['Inventory', 'Cost of sales'],
  ],
  trade_payables: [
    'A significant change in payables may reflect purchasing, payment terms or cut-off.',
    ['Trade payables', 'Purchases'],
  ],
  total_borrowings: [
    'A significant change in borrowings may bring new terms, covenants or classification matters.',
    ['Borrowings'],
  ],
  employee_cost: [
    'A significant change in employee cost may reflect headcount, pay or benefit-plan changes.',
    ['Employee benefits'],
  ],
  finance_cost: [
    'A significant change in finance cost may reflect new borrowings, rates or capitalisation.',
    ['Finance cost', 'Borrowings'],
  ],
  related_party: [
    'A significant or new related-party relationship may need identification, approval and disclosure work (SA 550).',
    ['Related parties'],
  ],
  order_book: [
    'A significant change in the order book may affect revenue trends and the assessment of onerous contracts.',
    ['Revenue', 'Contract assets / liabilities'],
  ],
  retention_receivables: [
    'A significant change in retention money may reflect contract terms, disputes or recoverability matters.',
    ['Trade receivables', 'Contract assets / liabilities'],
  ],
  restricted_funds: [
    'A significant change in restricted funds may affect fund accounting and compliance with donor conditions.',
    ['Funds / reserves', 'Grants'],
  ],
  grants_received: [
    'A significant change in grants may affect income recognition and compliance with grant conditions.',
    ['Grants', 'Revenue'],
  ],
};

const movement = (metric: string, label: string, extra: Partial<RuleSpec> = {}): RuleSpec => ({
  key: `movement_${metric}`,
  name: `${label} — movement`,
  formula: `(CY − PY) / |PY| × 100 for ${label}`,
  definition: { kind: 'movement', metric },
  required: [metric],
  parameterType: 'percent',
  parameterValue: 25,
  enhancedAt: 50,
  wording: '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
  why: MOVEMENT_WHY[metric]![0],
  areas: MOVEMENT_WHY[metric]![1],
  ...extra,
});

const SPECS: RuleSpec[] = [
  // ── §12 ratios ──
  ratio(
    'gross_margin',
    'Gross margin',
    'Gross profit / Revenue × 100',
    { num: { metric: 'gross_profit' }, den: { metric: 'revenue' }, scale: 100, unit: '%' },
    ['gross_profit', 'revenue'],
    { excludedFor: MARGIN_EXCLUDED },
  ),
  ratio(
    'pbt_margin',
    'PBT margin',
    'Profit before tax / Revenue × 100',
    { num: { metric: 'pbt' }, den: { metric: 'revenue' }, scale: 100, unit: '%' },
    ['pbt', 'revenue'],
  ),
  ratio(
    'pat_margin',
    'PAT margin',
    'Profit after tax / Revenue × 100',
    { num: { metric: 'pat' }, den: { metric: 'revenue' }, scale: 100, unit: '%' },
    ['pat', 'revenue'],
  ),
  ratio(
    'receivable_days',
    'Receivable days',
    'Trade receivables / Revenue × 365',
    {
      num: { metric: 'trade_receivables', balance: 'average' },
      den: { metric: 'revenue' },
      scale: 365,
      unit: 'days',
    },
    ['trade_receivables', 'revenue'],
    { excludedFor: WC_EXCLUDED },
  ),
  ratio(
    'inventory_days',
    'Inventory days',
    'Inventory / Cost base × 365 (cost base per profile; never Revenue)',
    {
      num: { metric: 'inventory', balance: 'average' },
      den: { base: 'inventory_cost' },
      scale: 365,
      unit: 'days',
    },
    ['inventory'],
    { excludedFor: ['nbfc', 'services', 'section8'] },
  ),
  ratio(
    'payable_days',
    'Payable days',
    'Trade payables / Purchases or cost base × 365 (never Revenue)',
    {
      num: { metric: 'trade_payables', balance: 'average' },
      den: { base: 'payable_cost' },
      scale: 365,
      unit: 'days',
    },
    ['trade_payables'],
    { excludedFor: WC_EXCLUDED },
  ),
  ratio(
    'current_ratio',
    'Current ratio',
    'Current assets / Current liabilities',
    {
      num: { metric: 'current_assets' },
      den: { metric: 'current_liabilities' },
      scale: 1,
      unit: 'x',
    },
    ['current_assets', 'current_liabilities'],
    { excludedFor: WC_EXCLUDED },
  ),
  ratio(
    'debt_equity',
    'Debt to equity',
    'Debt (profile definition) / Net worth',
    { num: { debt: true }, den: { metric: 'net_worth' }, scale: 1, unit: 'x' },
    ['net_worth'],
  ),
  ratio(
    'finance_cost_rate',
    'Finance cost to borrowings',
    'Finance cost / Debt (average or closing per profile) × 100',
    {
      num: { metric: 'finance_cost' },
      den: { debt: true, balance: 'finance_cost_basis' },
      scale: 100,
      unit: '%',
    },
    ['finance_cost'],
  ),
  ratio(
    'employee_cost_ratio',
    'Employee-cost ratio',
    'Employee cost / Revenue × 100',
    { num: { metric: 'employee_cost' }, den: { metric: 'revenue' }, scale: 100, unit: '%' },
    ['employee_cost', 'revenue'],
  ),
  ratio(
    'working_capital',
    'Trade working capital',
    'Trade receivables + Inventory − Trade payables',
    {
      value: {
        sum: [{ metric: 'trade_receivables' }, { metric: 'inventory' }],
        less: [{ metric: 'trade_payables' }],
      },
      unit: 'amount',
    },
    ['trade_receivables', 'inventory', 'trade_payables'],
    { excludedFor: WC_EXCLUDED },
  ),
  ratio(
    'working_capital_days',
    'Working-capital days',
    '(Trade receivables + Inventory − Trade payables) / Revenue × 365',
    {
      num: {
        sum: [{ metric: 'trade_receivables' }, { metric: 'inventory' }],
        less: [{ metric: 'trade_payables' }],
      },
      den: { metric: 'revenue' },
      scale: 365,
      unit: 'days',
    },
    ['revenue'],
    { excludedFor: WC_EXCLUDED },
  ),
  // ── §17 sector ratios ──
  ratio(
    'revenue_per_employee',
    'Revenue per employee',
    'Revenue / Headcount',
    { num: { metric: 'revenue' }, den: { metric: 'headcount' }, scale: 1, unit: 'per_unit' },
    ['revenue', 'headcount'],
    { appliesTo: ['services'] },
  ),
  ratio(
    'unbilled_revenue_days',
    'Unbilled revenue days',
    'Unbilled revenue / Revenue × 365',
    { num: { metric: 'unbilled_revenue' }, den: { metric: 'revenue' }, scale: 365, unit: 'days' },
    ['unbilled_revenue', 'revenue'],
    { appliesTo: ['services', 'construction'] },
  ),
  ratio(
    'order_book_cover',
    'Order-book cover',
    'Order book / Revenue',
    { num: { metric: 'order_book' }, den: { metric: 'revenue' }, scale: 1, unit: 'x' },
    ['order_book', 'revenue'],
    { appliesTo: ['construction'] },
  ),
  ratio(
    'contract_assets_days',
    'Contract-asset days',
    'Contract assets / Revenue × 365',
    { num: { metric: 'contract_assets' }, den: { metric: 'revenue' }, scale: 365, unit: 'days' },
    ['contract_assets', 'revenue'],
    { appliesTo: ['construction'] },
  ),
  ratio(
    'contract_liabilities_ratio',
    'Contract liabilities to revenue',
    'Contract liabilities / Revenue × 100',
    { num: { metric: 'contract_liabilities' }, den: { metric: 'revenue' }, scale: 100, unit: '%' },
    ['contract_liabilities', 'revenue'],
    { appliesTo: ['construction'] },
  ),
  ratio(
    'retention_ratio',
    'Retention to revenue',
    'Retention receivable / Revenue × 100',
    { num: { metric: 'retention_receivables' }, den: { metric: 'revenue' }, scale: 100, unit: '%' },
    ['retention_receivables', 'revenue'],
    { appliesTo: ['construction'] },
  ),
  ratio(
    'finished_goods_share',
    'Finished goods share of inventory',
    'Finished goods / Inventory × 100',
    {
      num: { metric: 'inventory_finished_goods' },
      den: { metric: 'inventory' },
      scale: 100,
      unit: '%',
    },
    ['inventory_finished_goods', 'inventory'],
    { appliesTo: ['manufacturing'] },
  ),
  ratio(
    'gross_npa_ratio',
    'Gross NPA ratio',
    'Gross NPA / Loan book × 100',
    { num: { metric: 'gross_npa' }, den: { metric: 'loan_book' }, scale: 100, unit: '%' },
    ['gross_npa', 'loan_book'],
    { appliesTo: ['nbfc'] },
  ),
  ratio(
    'net_npa_ratio',
    'Net NPA ratio',
    'Net NPA / Loan book × 100',
    { num: { metric: 'net_npa' }, den: { metric: 'loan_book' }, scale: 100, unit: '%' },
    ['net_npa', 'loan_book'],
    { appliesTo: ['nbfc'] },
  ),
  ratio(
    'net_interest_margin',
    'Net interest margin',
    '(Interest income − Finance cost) / Loan book (average per profile) × 100',
    {
      num: { sum: [{ metric: 'interest_income' }], less: [{ metric: 'finance_cost' }] },
      den: { metric: 'loan_book', balance: 'average' },
      scale: 100,
      unit: '%',
    },
    ['interest_income', 'finance_cost', 'loan_book'],
    { appliesTo: ['nbfc'] },
  ),
  ratio(
    'programme_expense_ratio',
    'Programme expenditure ratio',
    'Programme expenditure / (Revenue + Other income + Grants) × 100',
    {
      num: { metric: 'programme_expenditure' },
      den: {
        sum: [{ metric: 'revenue' }, { metric: 'other_income' }, { metric: 'grants_received' }],
      },
      scale: 100,
      unit: '%',
    },
    ['programme_expenditure'],
    { appliesTo: ['section8'] },
  ),
  ratio(
    'restricted_funds_cover',
    'Restricted-fund cover',
    '(Cash & bank + Investments) / Restricted funds',
    {
      num: { sum: [{ metric: 'cash_bank' }, { metric: 'investments' }] },
      den: { metric: 'restricted_funds' },
      scale: 1,
      unit: 'x',
    },
    ['restricted_funds'],
    { appliesTo: ['section8'] },
  ),

  // ── §12 / §13 attention rules: single-line movements ──
  movement('revenue', 'Revenue'),
  movement('gross_profit', 'Gross profit', { excludedFor: MARGIN_EXCLUDED }),
  movement('pbt', 'Profit before tax'),
  movement('pat', 'Profit after tax'),
  movement('cash_bank', 'Cash & bank'),
  movement('trade_receivables', 'Trade receivables', { excludedFor: WC_EXCLUDED }),
  movement('inventory', 'Inventory', { excludedFor: ['services', 'nbfc', 'section8'] }),
  movement('trade_payables', 'Trade payables', { excludedFor: WC_EXCLUDED }),
  movement('total_borrowings', 'Total borrowings'),
  movement('employee_cost', 'Employee cost'),
  movement('finance_cost', 'Finance cost'),
  movement('related_party', 'Related-party balances / transactions', {
    definition: {
      kind: 'movement',
      metric: 'related_party',
      newFromNil: true,
      nilWording: '{{label}} is {{cy}} this year against nil last year (new relationship).',
    },
  }),

  // ── §13 relationships ──
  {
    key: 'rel_revenue_receivables',
    name: 'Revenue vs receivables',
    formula: 'Growth of trade receivables − growth of revenue (percentage points)',
    definition: {
      kind: 'relationship',
      a: { metric: 'trade_receivables' },
      b: { metric: 'revenue' },
    },
    required: ['trade_receivables', 'revenue'],
    excludedFor: WC_EXCLUDED,
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Trade receivables moved {{ga}} while revenue moved {{gb}} — receivables have grown {{fasterSlower}} than revenue.',
    why: 'Receivables growing out of line with revenue may point to changes in credit terms, collection difficulties or revenue cut-off matters to understand.',
    areas: ['Trade receivables', 'Revenue'],
  },
  {
    key: 'rel_revenue_inventory',
    name: 'Revenue / cost vs inventory',
    formula:
      'Growth of inventory − growth of the cost base (cost of sales → purchases → profile fallback)',
    definition: {
      kind: 'relationship',
      a: { metric: 'inventory' },
      b: { base: 'inventory_trend' },
    },
    required: ['inventory'],
    excludedFor: ['services', 'nbfc', 'section8'],
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Inventory moved {{ga}} while {{bLower}} moved {{gb}} — inventory movement is inconsistent with the {{bLower}} trend.',
    why: 'Inventory moving out of line with the cost trend may point to build-up, slow-moving stock or valuation matters to understand.',
    areas: ['Inventory', 'Cost of sales'],
  },
  {
    key: 'rel_borrowings_finance_cost',
    name: 'Borrowings vs finance cost',
    formula: 'Growth of finance cost − growth of debt (percentage points)',
    definition: { kind: 'relationship', a: { metric: 'finance_cost' }, b: { debt: true } },
    required: ['finance_cost'],
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Finance cost moved {{ga}} while borrowings moved {{gb}} — the finance-cost movement appears inconsistent with the debt movement.',
    why: 'Finance cost out of line with debt may reflect new facilities, rate changes, capitalised interest or unrecorded borrowings.',
    areas: ['Finance cost', 'Borrowings'],
  },
  {
    key: 'rel_profit_cash',
    name: 'Profit vs cash',
    formula: 'PAT and cash & bank move in opposite directions; gap in percentage points',
    definition: {
      kind: 'relationship',
      a: { metric: 'pat' },
      b: { metric: 'cash_bank' },
      oppositeDirection: true,
    },
    required: ['pat', 'cash_bank'],
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Profit after tax moved {{ga}} while cash & bank moved {{gb}} — the profit trend is inconsistent with the cash trend.',
    why: 'Profit and cash moving apart may reflect working-capital changes, revenue recognition timing or financing.',
    areas: ['Revenue', 'Trade receivables', 'Cash & bank'],
  },
  // ── ratio shifts / trends ──
  {
    key: 'gross_margin_shift',
    name: 'Gross margin shift',
    formula: 'Gross margin CY − PY (percentage points)',
    definition: { kind: 'ratio_shift', ratio: 'gross_margin' },
    required: ['gross_profit', 'revenue'],
    excludedFor: MARGIN_EXCLUDED,
    parameterType: 'ratio',
    parameterValue: 3,
    enhancedAt: 6,
    wording: '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
    why: 'A change in gross margin may reflect pricing, cost, product-mix or classification changes, or cut-off matters.',
    areas: ['Revenue', 'Cost of sales', 'Inventory'],
  },
  {
    key: 'rel_revenue_employee_cost',
    name: 'Revenue vs employee cost',
    formula: 'Employee-cost ratio CY − PY (percentage points)',
    definition: { kind: 'ratio_shift', ratio: 'employee_cost_ratio' },
    required: ['employee_cost', 'revenue'],
    parameterType: 'ratio',
    parameterValue: 3,
    enhancedAt: 6,
    wording: '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
    why: 'A change in the employee-cost relationship may reflect headcount, pay or benefit-plan changes or classification.',
    areas: ['Employee benefits'],
  },
  {
    key: 'working_capital_trend',
    name: 'Working-capital trend',
    formula: 'Working-capital days CY − PY',
    definition: { kind: 'ratio_shift', ratio: 'working_capital_days' },
    required: ['revenue'],
    excludedFor: WC_EXCLUDED,
    parameterType: 'ratio',
    parameterValue: 30,
    enhancedAt: 60,
    wording: 'Trade working capital moved from {{py}} to {{cy}} of revenue ({{delta}}).',
    why: 'A change in the working-capital cycle may reflect credit terms, collection, stock-holding or payment practices, and affects liquidity.',
    areas: ['Trade receivables', 'Inventory', 'Trade payables'],
  },
  {
    key: 'gross_margin_trend_reversal',
    name: 'Gross margin trend reversal',
    formula: 'Gross margin direction PY−1→PY vs PY→CY (needs the prior file’s prior-year figures)',
    definition: { kind: 'trend_reversal', ratio: 'gross_margin' },
    required: ['gross_profit', 'revenue'],
    excludedFor: MARGIN_EXCLUDED,
    parameterType: 'trend',
    parameterValue: 1,
    enhancedAt: 3,
    wording:
      '{{label}} {{dir1}} from {{pp}} to {{py}} last year but {{dir2}} to {{cy}} this year — the margin trend has reversed.',
    why: 'A reversal of the margin trend may reflect pricing, cost or mix changes, or cut-off and classification matters.',
    areas: ['Revenue', 'Cost of sales', 'Inventory'],
  },
  {
    key: 'liquidity_current_ratio',
    name: 'Liquidity — current ratio',
    formula: 'Current ratio % change; or falls below 1',
    definition: {
      kind: 'ratio_change',
      ratio: 'current_ratio',
      crossBelow: 1,
      crossAttention: 'enhanced',
      crossWording: '{{label}} moved from {{py}} to {{cy}} and is now below {{level}}.',
    },
    required: ['current_assets', 'current_liabilities'],
    excludedFor: WC_EXCLUDED,
    parameterType: 'percent',
    parameterValue: 25,
    enhancedAt: 50,
    wording: '{{label}} moved from {{py}} to {{cy}}.',
    why: 'A significant change in liquidity may need explanation and can bear on going-concern considerations (SA 570).',
    areas: ['Going concern / liquidity', 'Borrowings'],
  },
  {
    key: 'negative_net_worth',
    name: 'Negative net worth',
    formula: 'Net worth (CY) < 0',
    definition: { kind: 'threshold', metric: 'net_worth', op: 'lt' },
    required: ['net_worth'],
    parameterType: 'absolute',
    parameterValue: 0,
    wording: 'Net worth is negative at the period end ({{value}}).',
    why: 'Negative equity can bear on going concern (SA 570), borrowing covenants and regulatory matters.',
    areas: ['Going concern / liquidity', 'Equity'],
    attention: 'enhanced',
  },
  // ── §17 sector attention rules ──
  {
    key: 'revenue_per_employee_change',
    name: 'Revenue per employee change',
    formula: 'Revenue per employee % change',
    definition: { kind: 'ratio_change', ratio: 'revenue_per_employee' },
    required: ['revenue', 'headcount'],
    appliesTo: ['services'],
    parameterType: 'percent',
    parameterValue: 20,
    enhancedAt: 40,
    wording: '{{label}} moved {{change}} (from {{py}} to {{cy}}).',
    why: 'A change in revenue per employee may reflect utilisation, pricing or revenue recognition matters in a services business.',
    areas: ['Revenue', 'Employee benefits'],
  },
  {
    key: 'rel_revenue_unbilled',
    name: 'Revenue vs unbilled revenue',
    formula: 'Growth of unbilled revenue − growth of revenue (percentage points)',
    definition: {
      kind: 'relationship',
      a: { metric: 'unbilled_revenue' },
      b: { metric: 'revenue' },
    },
    required: ['unbilled_revenue', 'revenue'],
    appliesTo: ['services', 'construction'],
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Unbilled revenue moved {{ga}} while revenue moved {{gb}} — unbilled revenue has grown {{fasterSlower}} than revenue.',
    why: 'Unbilled revenue growing out of line with revenue may point to cut-off, estimation or billing matters.',
    areas: ['Revenue', 'Contract assets / liabilities'],
  },
  {
    key: 'rel_revenue_contract_assets',
    name: 'Revenue vs contract assets',
    formula: 'Growth of contract assets − growth of revenue (percentage points)',
    definition: {
      kind: 'relationship',
      a: { metric: 'contract_assets' },
      b: { metric: 'revenue' },
    },
    required: ['contract_assets', 'revenue'],
    appliesTo: ['construction'],
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Contract assets moved {{ga}} while revenue moved {{gb}} — contract assets have grown {{fasterSlower}} than revenue.',
    why: 'Contract assets out of line with revenue may point to stage-of-completion estimates, billing delays or recoverability matters.',
    areas: ['Revenue', 'Contract assets / liabilities'],
  },
  movement('order_book', 'Order book', { appliesTo: ['construction'] }),
  movement('retention_receivables', 'Retention money receivable', { appliesTo: ['construction'] }),
  {
    key: 'nbfc_gross_npa_shift',
    name: 'Gross NPA ratio shift',
    formula: 'Gross NPA ratio CY − PY (percentage points)',
    definition: { kind: 'ratio_shift', ratio: 'gross_npa_ratio' },
    required: ['gross_npa', 'loan_book'],
    appliesTo: ['nbfc'],
    parameterType: 'ratio',
    parameterValue: 1,
    enhancedAt: 2,
    immediateAt: 4,
    wording: '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
    why: 'A change in asset quality bears on impairment / ECL measurement, income recognition and RBI prudential reporting.',
    areas: ['Loans & advances', 'Impairment / ECL'],
  },
  {
    key: 'nbfc_crar_below_level',
    name: 'Capital adequacy below configured level',
    formula: 'CRAR % (CY) < configured level',
    definition: { kind: 'threshold', metric: 'capital_adequacy', op: 'lt' },
    required: ['capital_adequacy'],
    appliesTo: ['nbfc'],
    parameterType: 'absolute',
    parameterValue: 15,
    wording:
      'Capital adequacy (CRAR) is {{value}} at the period end, below the configured level of {{threshold}}.',
    why: 'Capital adequacy below the regulatory level for the NBFC’s layer can bring regulatory action and bear on going concern and disclosures (RBI Scale Based Regulation).',
    areas: ['Regulatory compliance', 'Going concern / liquidity'],
    attention: 'immediate_partner',
  },
  {
    key: 'rel_loan_book_interest_income',
    name: 'Loan book vs interest income',
    formula: 'Growth of interest income − growth of loan book (percentage points)',
    definition: {
      kind: 'relationship',
      a: { metric: 'interest_income' },
      b: { metric: 'loan_book' },
    },
    required: ['interest_income', 'loan_book'],
    appliesTo: ['nbfc'],
    parameterType: 'relationship',
    parameterValue: 20,
    enhancedAt: 40,
    wording:
      'Interest income moved {{ga}} while the loan book moved {{gb}} — interest income has grown {{fasterSlower}} than the loan book.',
    why: 'Interest income out of line with the loan book may reflect yield changes, income recognition on stressed assets or classification.',
    areas: ['Interest income', 'Loans & advances'],
  },
  movement('grants_received', 'Grants / donations received', { appliesTo: ['section8'] }),
  movement('restricted_funds', 'Restricted / earmarked funds', { appliesTo: ['section8'] }),
  {
    key: 'section8_programme_ratio_shift',
    name: 'Programme expenditure ratio shift',
    formula: 'Programme expenditure ratio CY − PY (percentage points)',
    definition: { kind: 'ratio_shift', ratio: 'programme_expense_ratio' },
    required: ['programme_expenditure'],
    appliesTo: ['section8'],
    parameterType: 'ratio',
    parameterValue: 10,
    enhancedAt: 20,
    wording: '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
    why: 'A change in the share of income applied to the objects may bear on registration conditions and the application-of-income requirements.',
    areas: ['Programme expenditure', 'Regulatory compliance'],
  },
];

export const V1_RULES: AnalyticsRuleDef[] = SPECS.map((s, i) => ({
  ...base,
  ruleCode: `PAR-${String(i + 1).padStart(3, '0')}`,
  ruleKey: s.key,
  name: s.name,
  kind: s.definition.kind,
  appliesTo: s.appliesTo ?? [],
  excludedFor: s.excludedFor ?? [],
  requiredMetrics: s.required,
  formula: s.formula,
  definition: s.definition,
  parameterType: s.parameterType ?? null,
  parameterValue: s.parameterValue ?? null,
  enhancedAt: s.enhancedAt ?? null,
  immediateAt: s.immediateAt ?? null,
  minDataStatus: [],
  minSourceTypes: [],
  signalWording: s.wording ?? '',
  whyMayMatter: s.why ?? '',
  affectedAreas: s.areas ?? [],
  suggestedAttention: s.attention ?? 'standard',
}));

export const V1_LIBRARY = { metrics: V1_METRICS, profiles: V1_PROFILES, rules: V1_RULES };
