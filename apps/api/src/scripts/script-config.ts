import type { AppConfigService } from '../config/app-config.service';
import { envSchema } from '../config/env.validation';

/**
 * Config for the standalone operator scripts (`m365:check`,
 * `storage:migrate-sharepoint`). Validates ONLY the settings those scripts use —
 * with the same schema, defaults and coercions as the API — so they run without
 * the rest of the API's environment, and returns an {@link AppConfigService}
 * look-alike so the real Graph client and storage providers can be reused.
 */
const SCRIPT_KEYS = {
  STORAGE_PROVIDER: true,
  STORAGE_LOCAL_DIR: true,
  STORAGE_AZURE_CONNECTION_STRING: true,
  STORAGE_AZURE_CONTAINER: true,
  STORAGE_SHAREPOINT_ROOT: true,
  DATABASE_SSL: true,
  M365_ENABLED: true,
  M365_TENANT_ID: true,
  M365_CLIENT_ID: true,
  M365_CLIENT_SECRET: true,
  M365_SITE_URL: true,
  M365_SITE_ID: true,
  M365_DRIVE_ID: true,
  M365_LINK_EXPIRY_MINUTES: true,
  M365_ALLOW_ANON_EDIT: true,
  M365_GRAPH_BASE_URL: true,
  M365_LOGIN_BASE_URL: true,
} as const;

export function scriptConfig(overrides: Record<string, string> = {}): AppConfigService {
  const parsed = envSchema.pick(SCRIPT_KEYS).safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`  ✗ ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(2);
  }
  const values = parsed.data as Record<string, unknown>;
  return { get: (key: string) => values[key] } as unknown as AppConfigService;
}

/** `--name=value` / `--flag` command-line arguments. */
export function scriptArgs(): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match?.[1]) args.set(match[1], match[2] ?? true);
  }
  return args;
}
