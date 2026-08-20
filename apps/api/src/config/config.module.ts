import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv, type Env } from './env.validation';

/**
 * Typed configuration access across the app.
 *
 * `AppConfigService` is a thin wrapper giving fully-typed, non-optional reads of
 * validated env values — so call sites never re-validate or guess at defaults.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
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
}

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Load .env only outside production; in prod, config comes from the
      // environment / Azure Key Vault-backed app settings.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
