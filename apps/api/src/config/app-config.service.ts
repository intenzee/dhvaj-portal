import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envSchema, type Env } from './env.validation';

/**
 * Typed configuration access across the app.
 *
 * `AppConfigService` is a thin wrapper giving fully-typed, non-optional reads of
 * validated env values — so call sites never re-validate or guess at defaults.
 *
 * Lives apart from `config.module.ts` so importing it has no side effects (the
 * module validates the whole environment as soon as it is loaded).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** Every validated value (for whole-config checks such as the boot warnings). */
  get all(): Env {
    return Object.fromEntries(
      (Object.keys(envSchema.shape) as (keyof Env)[]).map((k) => [k, this.get(k)]),
    ) as Env;
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  /**
   * Whether dev-token sign-in and dev JWTs are accepted alongside the active
   * provider. Only ever true outside production (fail-closed): a local build can
   * then use Entra SSO and the seeded persona logins simultaneously.
   */
  get devFallbackEnabled(): boolean {
    return !this.isProduction && this.get('AUTH_DEV_FALLBACK') === true;
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /**
   * Max JSON request body, in bytes. Documents are uploaded base64-encoded in
   * JSON, so the body ceiling must clear the largest allowed file plus base64
   * overhead (~4/3) and a little envelope headroom.
   */
  get jsonBodyLimitBytes(): number {
    return Math.ceil(this.get('DOCUMENT_MAX_BYTES') * (4 / 3)) + 64 * 1024;
  }

  /** Enabled notification delivery channels (`portal` is always implicitly on). */
  get notificationChannels(): string[] {
    return this.get('NOTIFICATION_CHANNELS')
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * The Switch team-chat channel: the server, the portal's agent identity there
   * and the room ids by key. Null unless the server, agent and key are all set.
   */
  get switchChannel(): {
    url: string;
    agentId: string;
    apiKey: string;
    rooms: Record<string, string>;
    mentions: Record<string, string>;
    webUrl: string;
  } | null {
    const url = this.get('SWITCH_URL');
    const agentId = this.get('SWITCH_AGENT_ID');
    const apiKey = this.get('SWITCH_API_KEY');
    if (!url || !agentId || !apiKey) return null;
    return {
      url: url.replace(/\/$/, ''),
      agentId,
      apiKey,
      rooms: stringMap(this.get('SWITCH_ROOMS')),
      mentions: stringMap(this.get('SWITCH_MENTIONS')),
      webUrl: this.get('WEB_PUBLIC_URL'),
    };
  }
}

/** A JSON object of non-empty strings; anything else reads as {}. */
function stringMap(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}
