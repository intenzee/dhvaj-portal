/**
 * Getting someone's attention for a quick task: a chime (once, or over and
 * over), a desktop notification while the tab is in the background, and the
 * tab's title flashing. Browsers allow sound only after the person has
 * clicked or typed on the page once; `unlockSound` listens for that.
 */

/** Ring over and over until answered: an urgent task, or the tab is out of sight. Pure — tested. */
export function shouldKeepRinging(p: { urgent: boolean; hidden: boolean; touched: boolean }): boolean {
  return !p.touched && (p.urgent || p.hidden);
}

/** "🔔 Urgent task from Partner A" — what the tab title flashes. Pure — tested. */
export function alertTitle(p: {
  kind: 'assigned' | 'reply';
  urgent: boolean;
  fromName: string | null;
}): string {
  const who = p.fromName ?? 'someone';
  if (p.kind === 'reply') return `💬 ${who} answered`;
  return `🔔 ${p.urgent ? 'Urgent task' : 'New task'} from ${who}`;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      ctx = new Ctx();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Lets later chimes play: browsers start audio muted until a click or key press. */
export function unlockSound(): () => void {
  const unlock = (): void => {
    void audio()
      ?.resume()
      .catch(() => undefined);
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  return () => {
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
  };
}

/** A two-note bell ("ding-dong"), about a second long. */
export function chime(urgent = false): void {
  const a = audio();
  if (!a) return;
  if (a.state === 'suspended') void a.resume().catch(() => undefined);
  const notes = urgent ? [1175, 880, 1175, 880] : [988, 784];
  notes.forEach((freq, i) => {
    const t = a.currentTime + i * 0.28;
    for (const [mult, vol] of [
      [1, 0.18],
      [2.01, 0.05],
    ] as const) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.95);
    }
  });
}

/** The chime every `everyMs` until stopped (the first one at once). */
export function startRinging(urgent: boolean, everyMs = 2_500): () => void {
  chime(urgent);
  const id = window.setInterval(() => chime(urgent), everyMs);
  return () => window.clearInterval(id);
}

/** Flashes the tab title between `text` and the page's own title until stopped. */
export function flashTitle(text: string): () => void {
  const original = document.title;
  let on = false;
  const id = window.setInterval(() => {
    on = !on;
    document.title = on ? text : original;
  }, 1_000);
  return () => {
    window.clearInterval(id);
    document.title = original;
  };
}

export function desktopAlertsState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Asks once (from a click) to show alerts outside the browser. */
export async function askDesktopAlerts(): Promise<NotificationPermission | 'unsupported'> {
  if (desktopAlertsState() === 'unsupported') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** A system notification while the tab is out of sight; a click brings the tab back. */
export function desktopAlert(title: string, body: string, tag: string, sticky: boolean): void {
  if (desktopAlertsState() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, requireInteraction: sticky });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers allow notifications only from a service worker */
  }
}
