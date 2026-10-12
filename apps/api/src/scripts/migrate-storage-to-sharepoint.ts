/**
 * `npm run storage:migrate-sharepoint --workspace @hsdg/api -- [flags]`
 *
 * One-time copy of every stored document version and template version from the
 * current storage (local disk or Azure Blob) into the SharePoint site, so the
 * API can switch to STORAGE_PROVIDER=sharepoint without losing a file.
 *
 *   --from=local|azure_blob   source provider (default: STORAGE_PROVIDER, or
 *                             `local` when that is already `sharepoint`)
 *   --dry-run                 list what would be copied; write nothing
 *   --verify                  re-download each copy and re-check its SHA-256
 *                             (also re-checks files already in SharePoint)
 *   --concurrency=N           parallel copies (default 4)
 *   --db-url=postgres://...   database to read references from (default:
 *                             DATABASE_MIGRATE_URL — the owner role, so RLS
 *                             does not hide rows)
 *
 * Safe to re-run: files already in SharePoint with the right size are skipped
 * (fully re-hashed with --verify). The source is never modified or deleted.
 * References are kept identical, so no database rows change — after the copy,
 * switching STORAGE_PROVIDER is the whole cutover. Every source file is checked
 * against the checksum recorded at upload before it is copied.
 *
 * Cutover: run once while the portal is live, stop the API, run again to pick
 * up files uploaded in between, set STORAGE_PROVIDER=sharepoint, start the API.
 */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createStorageProvider } from '../modules/documents/storage/storage-provider.factory';
import { SharePointStorageProvider } from '../modules/documents/storage/sharepoint-storage.provider';
import { GraphClient } from '../modules/documents/m365/graph-client';
import { scriptArgs, scriptConfig } from './script-config';

interface StoredFile {
  kind: 'document' | 'template';
  id: string;
  storage_reference: string;
  checksum_sha256: string;
  size_bytes: string;
  content_type: string | null;
}

type Outcome = 'copied' | 'skipped' | 'verified' | 'would_copy' | 'missing' | 'corrupt' | 'failed';

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function main(): Promise<void> {
  const args = scriptArgs();
  const dryRun = args.has('dry-run');
  const verify = args.has('verify');
  const concurrency = Math.max(1, Number(args.get('concurrency') ?? 4) || 4);

  const config = scriptConfig();
  const current = config.get('STORAGE_PROVIDER');
  const from = String(args.get('from') ?? (current === 'sharepoint' ? 'local' : current));
  if (from !== 'local' && from !== 'azure_blob') {
    console.error(`--from must be local or azure_blob (got "${from}").`);
    process.exit(2);
  }
  const source = createStorageProvider(scriptConfig({ STORAGE_PROVIDER: from }));
  const target = new SharePointStorageProvider(
    new GraphClient(config),
    config.get('STORAGE_SHAREPOINT_ROOT'),
  );

  const dbUrl = String(args.get('db-url') ?? process.env.DATABASE_MIGRATE_URL ?? '');
  if (!dbUrl) {
    console.error('Set DATABASE_MIGRATE_URL (or pass --db-url=...) to read the file references.');
    process.exit(2);
  }
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: config.get('DATABASE_SSL') ? { rejectUnauthorized: true } : undefined,
  });

  const { rows } = await pool.query<StoredFile>(
    `SELECT 'document' AS kind, v.id, v.storage_reference, v.checksum_sha256,
            v.size_bytes::text AS size_bytes, v.content_type
       FROM hsdg.document_versions v
     UNION ALL
     SELECT 'template' AS kind, t.id, t.storage_reference, t.checksum_sha256,
            t.size_bytes::text AS size_bytes, t.content_type
       FROM hsdg.document_template_versions t
     ORDER BY 1, 2`,
  );
  await pool.end();

  const totalBytes = rows.reduce((sum, r) => sum + Number(r.size_bytes), 0);
  console.log(
    `${rows.length} stored files (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) — ` +
      `${source.name} → sharepoint${dryRun ? ' [dry run]' : ''}${verify ? ' [verify]' : ''}\n`,
  );

  const counts: Record<Outcome, number> = {
    copied: 0,
    skipped: 0,
    verified: 0,
    would_copy: 0,
    missing: 0,
    corrupt: 0,
    failed: 0,
  };
  const problems: string[] = [];

  async function migrate(file: StoredFile): Promise<Outcome> {
    const label = `${file.kind} ${file.id} (${file.storage_reference})`;
    try {
      const existing = await target.stat(file.storage_reference);
      if (existing && existing.size === Number(file.size_bytes)) {
        if (!verify) return 'skipped';
        const copy = await target.read(file.storage_reference);
        if (sha256(copy) === file.checksum_sha256) return 'verified';
        // A same-size copy with the wrong content: fall through and re-copy.
      }
      if (dryRun) return 'would_copy';

      let bytes: Buffer;
      try {
        bytes = await source.read(file.storage_reference);
      } catch {
        problems.push(`missing in ${source.name}: ${label}`);
        return 'missing';
      }
      if (sha256(bytes) !== file.checksum_sha256) {
        problems.push(`checksum mismatch in ${source.name} (not copied): ${label}`);
        return 'corrupt';
      }
      await target.write(
        file.storage_reference,
        bytes,
        file.content_type ?? 'application/octet-stream',
      );
      if (verify) {
        const copy = await target.read(file.storage_reference);
        if (sha256(copy) !== file.checksum_sha256) {
          problems.push(`SharePoint copy failed verification: ${label}`);
          return 'failed';
        }
      }
      return 'copied';
    } catch (err) {
      problems.push(`${label}: ${(err as Error).message}`);
      return 'failed';
    }
  }

  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const file = rows[next++];
      if (!file) break;
      counts[await migrate(file)]++;
      done++;
      if (done % 25 === 0 || done === rows.length) {
        process.stdout.write(`  ${done}/${rows.length}\r`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

  console.log('\n');
  for (const [outcome, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${outcome.padEnd(10)} ${n}`);
  }
  if (problems.length > 0) {
    console.log('\nProblems:');
    for (const p of problems) console.log(`  - ${p}`);
  }
  const ok = counts.missing + counts.corrupt + counts.failed === 0;
  console.log(
    ok
      ? dryRun
        ? '\nDry run complete — nothing was written.'
        : '\nAll files are in SharePoint. Safe to set STORAGE_PROVIDER=sharepoint.'
      : '\nSome files did NOT migrate — fix the problems above and re-run before switching.',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
