import type { PushState } from './push';

/**
 * The required-notifications prompt: what it shows for where this browser
 * stands. Pure — tested.
 *
 *  · none        — alerts are on (or this browser can do nothing about them).
 *  · ask         — one click turns them on.
 *  · blocked     — the person said no; only the browser's site settings undo it.
 *  · home-screen — iPhone / iPad Safari: alerts work only from the Home Screen app.
 */
export type GateView = 'none' | 'ask' | 'blocked' | 'home-screen';

export function gateView(
  state: PushState,
  /** Notification.permission, or null where the browser has no notifications. */
  permission: NotificationPermission | null,
  /** iPhone / iPad Safari outside an installed Home Screen app. */
  homeScreen: boolean,
): GateView {
  switch (state) {
    case 'on':
      return 'none';
    case 'ask':
      return 'ask';
    case 'blocked':
      return 'blocked';
    case 'unsupported':
      return homeScreen ? 'home-screen' : 'none';
    case 'off-server':
      // No push keys on the server: the in-page alerts still need the browser's permission.
      if (permission === null || permission === 'granted') return 'none';
      return permission === 'denied' ? 'blocked' : 'ask';
  }
}

/** Where to allow notifications again, for the browser in use. Pure — tested. */
export function unblockSteps(userAgent: string): string[] {
  if (/Firefox\//.test(userAgent)) {
    return [
      'Click the icon at the left of the address bar.',
      'Next to “Send notifications”, clear “Blocked” (or choose Allow).',
      'Reload the portal.',
    ];
  }
  if (/Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent)) {
    return [
      'Open Safari → Settings → Websites → Notifications.',
      'Find this portal and set it to Allow.',
      'Reload the portal.',
    ];
  }
  return [
    'Click the icon at the left of the address bar (the slider or padlock).',
    'Open Site settings, set Notifications to Allow.',
    'Come back here and reload the portal.',
  ];
}
