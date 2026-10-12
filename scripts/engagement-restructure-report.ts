/**
 * The engagement restructure report (spec Change 1, data migration): one CSV
 * row per step logged in hsdg.engagement_restructure_moves — which legacy
 * engagement went into which standing Compliance engagement, what moved with
 * it, and what was left for review. A per-step summary goes to stderr.
 *
 *   DATABASE_URL=postgres://postgres:…@localhost:5433/hsdg \
 *     npx ts-node -P apps/api/tsconfig.json scripts/engagement-restructure-report.ts [out.csv]
 *
 * Read-only. Needs a role that can read the log and every engagement (the
 * superuser or the migrator); the CSV goes to stdout when no path is given.
 */
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';

interface MoveRow {
  id: string;
  created_at: Date;
  step: string;
  action: string;
  object_type: string;
  object_id: string | null;
  from_code: string | null;
  to_code: string | null;
  client: string | null;
  note: string | null;
}

const COLUMNS: Array<[header: string, value: (r: MoveRow) => string | null]> = [
  ['id', (r) => r.id],
  ['logged_at', (r) => r.created_at.toISOString()],
  ['step', (r) => r.step],
  ['action', (r) => r.action],
  ['object_type', (r) => r.object_type],
  ['object_id', (r) => r.object_id],
  ['from_engagement', (r) => r.from_code],
  ['to_engagement', (r) => r.to_code],
  ['client', (r) => r.client],
  ['note', (r) => r.note],
];

/** RFC 4180: quote when needed, double embedded quotes. */
export function csvCell(value: string | null): string {
  if (value === null) return '';
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: MoveRow[]): string {
  const lines = [COLUMNS.map(([h]) => h).join(',')];
  for (const r of rows) lines.push(COLUMNS.map(([, v]) => csvCell(v(r))).join(','));
  return lines.join('\r\n') + '\r\n';
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_SUPERUSER_URL;
  if (!url) throw new Error('Set DATABASE_URL (a role that can read every engagement).');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const { rows } = await db.query<MoveRow>(
      `SELECT m.id::text, m.created_at, m.step, m.action, m.object_type, m.object_id::text,
              f.engagement_code AS from_code, t.engagement_code AS to_code,
              ent.legal_name AS client, m.note
         FROM hsdg.engagement_restructure_moves m
         LEFT JOIN hsdg.engagements f ON f.id = m.from_engagement_id
         LEFT JOIN hsdg.engagements t ON t.id = m.to_engagement_id
         LEFT JOIN hsdg.entities ent ON ent.id = COALESCE(t.entity_id, f.entity_id)
        ORDER BY m.id`,
    );
    const csv = toCsv(rows);
    const out = process.argv[2];
    if (out) writeFileSync(out, csv);
    else process.stdout.write(csv);

    const summary = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.step} · ${r.action}`;
      summary.set(key, (summary.get(key) ?? 0) + 1);
    }
    process.stderr.write(`${rows.length} logged steps${out ? ` → ${out}` : ''}\n`);
    for (const [k, n] of [...summary].sort()) process.stderr.write(`  ${k}: ${n}\n`);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
