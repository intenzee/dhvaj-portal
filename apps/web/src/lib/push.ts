import type { PushConfig, PushSubscribeInput } from '@hsdg/contracts';
import { API_BASE, apiFetch, getToken } from './api';

/**
 * Web Push in the browser: quick-task alerts that reach this device even when
 * the portal (or the whole browser window) is closed. The service worker in
 * /sw.js shows them. Turning it on needs one click (the browser asks for
 * permission); after that every page load quietly re-checks it.
 */

export type PushState =
  /** This browser cannot (or, on iPhone, not until the portal is added to the Home Screen). */
  | 'unsupported'
  /** The portal has no push keys set up. */
  | 'off-server'
  /** The person said no in the browser: only the browser's site settings can undo it. */
  | 'blocked'
  | 'ask'
  | 'on';

/** VAPID public key (base64url) → the bytes pushManager.subscribe wants. Pure — tested. */
export function vapidKeyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether a subscription was made with this key (the key can be changed on the server). Pure — tested. */
export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

let config: Promise<PushConfig> | null = null;
function serverConfig(): Promise<PushConfig> {
  config ??= apiFetch<PushConfig>('/push/config').catch((err) => {
    config = null;
    throw err;
  });
  return config;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

/** Where this device stands, without asking anything. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const cfg = await serverConfig();
  if (!cfg.enabled || !cfg.publicKey) return 'off-server';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'ask';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'ask';
}

/**
 * Makes sure this device gets alerts for the signed-in person: subscribes (or
 * re-subscribes after a key change) and tells the API. Asks for permission
 * only when `ask` is set — call it so from a click.
 */
export async function syncPush(ask = false): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const cfg = await serverConfig();
  if (!cfg.enabled || !cfg.publicKey) return 'off-server';
  let permission = Notification.permission;
  if (permission === 'default' && ask) permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'ask';

  const key = vapidKeyBytes(cfg.publicKey);
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as unknown as BufferSource,
  });
  await apiFetch<void>('/push/subscriptions', {
    method: 'POST',
    body: sub.toJSON() as PushSubscribeInput,
  });
  return 'on';
}

/**
 * Stops alerts to this device (turned off here, or signing out). Never
 * throws. The token is taken at once: signing out clears it straight after.
 */
export async function stopPush(): Promise<void> {
  const token = getToken();
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (token) {
      await fetch(`${API_BASE}/push/subscriptions`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
    }
    // Even if the API missed it, the push service now answers "gone" and the
    // API forgets the device on the next alert.
    await sub.unsubscribe().catch(() => undefined);
  } catch {
    /* nothing to stop */
  }
}

/** iPhone/iPad Safari outside an installed Home Screen app has no push. */
export function needsHomeScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}
