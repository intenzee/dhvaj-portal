/**
 * `npm run m365:check --workspace @hsdg/api`
 *
 * Verifies the Microsoft 365 / SharePoint setup end-to-end against the real
 * tenant, one step at a time, and says what to fix when a step fails:
 *
 *   1. settings present        4. write → read back → compare a test file
 *   2. app sign-in (token)     5. anonymous view + edit links (Office editor)
 *   3. site + document library 6. delete the test file
 *
 * Read-only apart from one small test file it creates and removes under
 * `_portal-check/`. Prints the resolved drive id so it can be pinned as
 * M365_DRIVE_ID.
 */
import { randomUUID } from 'node:crypto';
import { GraphClient, GraphRequestError } from '../modules/documents/m365/graph-client';
import { scriptConfig } from './script-config';

const config = scriptConfig();
const graph = new GraphClient(config);
let failed = false;

function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}

function bad(message: string, err: unknown, hint: string): void {
  failed = true;
  const status = err instanceof GraphRequestError ? err.graphStatus : null;
  const detail = err instanceof GraphRequestError && err.detail ? `\n      ${err.detail}` : '';
  console.log(`  ✗ ${message}: ${(err as Error).message}${detail}`);
  console.log(`    → ${hint.replace('{status}', String(status))}`);
}

function statusOf(err: unknown): number | null {
  return err instanceof GraphRequestError ? err.graphStatus : null;
}

async function main(): Promise<void> {
  console.log('Microsoft 365 / SharePoint check\n');

  // 1. Settings
  const missing = ['M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET'].filter(
    (k) => !config.get(k as 'M365_TENANT_ID'),
  );
  if (!config.get('M365_SITE_URL') && !config.get('M365_SITE_ID') && !config.get('M365_DRIVE_ID')) {
    missing.push('M365_SITE_URL');
  }
  if (missing.length > 0) {
    console.log(`  ✗ missing settings: ${missing.join(', ')}`);
    console.log(
      '    → add them to apps/api/.env (see docs/microsoft-365-sharepoint-provisioning.md)',
    );
    process.exit(1);
  }
  ok('settings present');

  // 2 + 3. Token, site, drive
  let driveId: string;
  try {
    if (!config.get('M365_DRIVE_ID')) {
      const site = await graph.resolveSite();
      ok(`site ${site.webUrl ?? ''} → id ${site.id}`);
    }
    driveId = await graph.resolveDriveId();
    ok(`document library drive id ${driveId}`);
    if (!config.get('M365_DRIVE_ID')) {
      console.log(`    (optional) pin it to skip this lookup: M365_DRIVE_ID=${driveId}`);
    }
  } catch (err) {
    const status = statusOf(err);
    const hint =
      status === 400 || status === 401
        ? 'sign-in rejected — check M365_TENANT_ID, M365_CLIENT_ID and that M365_CLIENT_SECRET is the secret VALUE (not its id) and has not expired'
        : status === 403
          ? 'the app is not allowed into this site — add the Sites.Selected permission with admin consent, then run the site grant (provisioning doc, step 3)'
          : status === 404
            ? 'site not found — check M365_SITE_URL (e.g. https://<tenant>.sharepoint.com/sites/<name>)'
            : 'unexpected Graph error ({status})';
    bad('could not reach the SharePoint site', err, hint);
    process.exit(1);
  }

  // 4. Write / read / compare
  const path = `_portal-check/${randomUUID()}.txt`;
  const payload = Buffer.from(`DHVAJ portal check ${new Date().toISOString()}\n`);
  let itemId: string | null = null;
  try {
    itemId = (await graph.putByPath(driveId, path, payload, 'text/plain')).id;
    const back = await graph.getByPath(driveId, path);
    if (!back || !back.equals(payload)) throw new Error('read-back did not match what was written');
    ok('write + read back a test file');
  } catch (err) {
    bad(
      'file write/read failed',
      err,
      statusOf(err) === 403
        ? 'the site grant is read-only — re-run the grant with role "write"'
        : 'unexpected Graph error ({status})',
    );
  }

  // 5. Anonymous links (only matters for the Office editor, M365_ENABLED)
  if (itemId) {
    const expiryMinutes = config.get('M365_LINK_EXPIRY_MINUTES');
    for (const canEdit of [false, true]) {
      try {
        await graph.createShareLink(driveId, itemId, { canEdit, expiryMinutes });
        ok(`anonymous ${canEdit ? 'EDIT' : 'VIEW'} link`);
      } catch (err) {
        bad(
          `anonymous ${canEdit ? 'EDIT' : 'VIEW'} link refused`,
          err,
          statusOf(err) === 403
            ? 'either sharing is not set to "Anyone" (SharePoint admin center → Policies → Sharing AND the site\'s own sharing), or the grant needs role "fullcontrol" — see provisioning doc step 4'
            : canEdit
              ? 'anonymous EDIT may be disabled: SharePoint admin center → Policies → Sharing → "Anyone" links → Files: View and edit'
              : 'unexpected Graph error ({status})',
        );
      }
    }
  }

  // 6. Clean up
  try {
    await graph.deleteByPath(driveId, path);
    ok('deleted the test file');
  } catch (err) {
    bad('could not delete the test file', err, `remove /${path} from the site manually`);
  }

  console.log(failed ? '\nSome checks FAILED — see the hints above.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
