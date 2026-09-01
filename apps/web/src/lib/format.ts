/** Presentation helpers. UX only — the backend remains authoritative (§18). */

/** Turn a snake_case / kebab enum value into Title Case for display. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format an ISO date (or date-time) as a short calendar date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Whole-number count with thousands separators. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return n.toLocaleString('en-IN');
}

/**
 * Format a decimal-string (or number) amount as money in the given currency.
 * Amounts cross the wire as exact decimal strings; this is presentation only.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency = 'INR',
): string {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  if (Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/**
 * A compact human duration from seconds, e.g. "1h 23m", "45m", "12s". For
 * totals in tables — reads at a glance rather than a running clock.
 */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

/** A ticking clock from seconds, e.g. "1:23:45" / "07:12" — for a live timer. */
export function formatClock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Seconds elapsed since an ISO timestamp (for a running timer). Null-safe. */
export function secondsSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** Days from today until an ISO date (negative ⇒ overdue). Null-safe. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const startOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target - startOfToday) / 86_400_000);
}

/** A human relative-deadline label, e.g. "in 3 days", "today", "5 days overdue". */
export function deadlineLabel(iso: string | null | undefined): string {
  const days = daysUntil(iso);
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  const overdue = -days;
  return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
}
