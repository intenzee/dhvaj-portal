/**
 * Staff Workflow WF-302 — client chasing on the filing: what the filing is
 * waiting on from the client, and a reminder by the firm's channel: e-mail,
 * a WhatsApp link, or text to copy when the client cannot be reached on it.
 */

/** One open client request on the filing (one per upload slot). */
export interface ClientChaseItem {
  dependencyId: string;
  slotCode: string | null;
  /** The slot's checklist label ("Sales register received"), else the request text. */
  label: string;
  requestDate: string;
  reminderDate: string | null;
  escalationDate: string | null;
  /** Past its escalation date. */
  overdue: boolean;
}

/** GET /compliance-instances/:id/client-chase */
export interface ClientChase {
  instanceId: string;
  waitingOn: ClientChaseItem[];
  /** Required client-data slots still empty with no request raised yet. */
  notRequested: { slotCode: string; label: string }[];
  /** The client contact a reminder would go to (null ⇒ copy the text). */
  clientEmail: string | null;
  /** The firm's e-mail channel is on and the client has an address. */
  canEmail: boolean;
  /** The client contact's phone, for a WhatsApp reminder. */
  clientPhone: string | null;
  /** The phone is usable on WhatsApp, so a reminder can go that way whatever the firm's channel. */
  canWhatsapp: boolean;
  /** What "remind" will do now, under the firm's setting (see `reminderChannelFor`). */
  channel: ClientReminderChannel;
  fallback: ClientReminderFallback | null;
  /** Ready-to-paste reminder (WhatsApp / e-mail), without upload links. */
  reminderText: string;
}

/**
 * How a reminder went. The firm's `client_reminder_channel` picks it; a
 * channel the client cannot be reached on falls back to text to copy.
 */
export const CLIENT_REMINDER_CHANNEL = {
  email: 'email',
  whatsapp: 'whatsapp',
  copy: 'copy',
} as const;
export type ClientReminderChannel =
  (typeof CLIENT_REMINDER_CHANNEL)[keyof typeof CLIENT_REMINDER_CHANNEL];

/** Why a reminder came back as text to copy instead of the firm's channel. */
export const CLIENT_REMINDER_FALLBACK = {
  /** E-mail is the channel, but the client has no address or e-mail is off. */
  noEmail: 'no_email',
  /** WhatsApp is the channel, but the client has no usable phone number. */
  noPhone: 'no_phone',
} as const;
export type ClientReminderFallback =
  (typeof CLIENT_REMINDER_FALLBACK)[keyof typeof CLIENT_REMINDER_FALLBACK];

/**
 * A phone number as wa.me wants it: digits only, with the country code. A
 * ten-digit number (or one with a leading 0) is taken as Indian. Null when it
 * cannot be a phone number. Pure — tested.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** `https://wa.me/<digits>?text=<encoded>`, or null without a usable number. Pure — tested. */
export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** Whether the client can be reached on a channel (copy always can). Pure — tested. */
export function canRemindBy(
  channel: ClientReminderChannel,
  client: { canEmail: boolean; phone: string | null },
): boolean {
  if (channel === CLIENT_REMINDER_CHANNEL.email) return client.canEmail;
  if (channel === CLIENT_REMINDER_CHANNEL.whatsapp) return whatsappNumber(client.phone) !== null;
  return true;
}

/**
 * The channel a reminder takes under the firm's setting, and the fallback
 * reason when it cannot. Pure — tested.
 */
export function reminderChannelFor(
  setting: ClientReminderChannel,
  client: { canEmail: boolean; phone: string | null },
): { channel: ClientReminderChannel; fallback: ClientReminderFallback | null } {
  if (canRemindBy(setting, client)) return { channel: setting, fallback: null };
  return {
    channel: CLIENT_REMINDER_CHANNEL.copy,
    fallback:
      setting === CLIENT_REMINDER_CHANNEL.email
        ? CLIENT_REMINDER_FALLBACK.noEmail
        : CLIENT_REMINDER_FALLBACK.noPhone,
  };
}

/**
 * POST /compliance-instances/:id/client-chase/remind body (PS-001). Omit
 * `channel` for the firm's channel; name one to send that way instead (say
 * WhatsApp from the phone when the firm e-mails). A channel the client cannot
 * be reached on is refused (400), not swapped for copy.
 */
export interface ClientReminderRequest {
  channel?: ClientReminderChannel;
}

interface ClientReminderBase {
  instanceId: string;
  /** The client (entity) reminded, for a list of reminders. */
  client: string;
  /** The reminder as e-mailed, or to send / paste, with upload links when minted. */
  text: string;
  waitingOn: string[];
  /** Requests raised by this reminder for slots nobody had asked for yet. */
  raised: number;
}

/** POST /compliance-instances/:id/client-chase/remind — switch on `channel`. */
export type ClientReminderResult = ClientReminderBase &
  (
    | { channel: typeof CLIENT_REMINDER_CHANNEL.email; to: string }
    /** Open `waUrl` (wa.me with the text filled in); nothing was sent yet. */
    | { channel: typeof CLIENT_REMINDER_CHANNEL.whatsapp; waUrl: string }
    /** Copy `text` to the client; `fallback` says why when the firm's channel could not be used. */
    | { channel: typeof CLIENT_REMINDER_CHANNEL.copy; fallback: ClientReminderFallback | null }
  );
