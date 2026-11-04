import * as webpush from 'web-push';

/**
 * Web Push on, with a fresh VAPID pair. Import this BEFORE create-test-app:
 * the config is validated when the AppModule is imported. The spec removes
 * the keys afterwards so later suites in the same worker run with push off.
 */
const keys = webpush.generateVAPIDKeys();
process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
process.env.WEB_PUSH_SUBJECT = 'mailto:alerts@example.test';

export const TEST_VAPID_PUBLIC_KEY = keys.publicKey;

export function clearPushEnv(): void {
  delete process.env.WEB_PUSH_PUBLIC_KEY;
  delete process.env.WEB_PUSH_PRIVATE_KEY;
  delete process.env.WEB_PUSH_SUBJECT;
}
