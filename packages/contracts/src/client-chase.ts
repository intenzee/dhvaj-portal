/**
 * Staff Workflow WF-302 — client chasing on the filing: what the filing is
 * waiting on from the client, and a reminder that goes by e-mail when the
 * firm's channel and the client's address allow, else as text to copy.
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
  /** Ready-to-paste reminder (WhatsApp / e-mail), without upload links. */
  reminderText: string;
}

export const CLIENT_REMINDER_CHANNEL = { email: 'email', copy: 'copy' } as const;
export type ClientReminderChannel =
  (typeof CLIENT_REMINDER_CHANNEL)[keyof typeof CLIENT_REMINDER_CHANNEL];

/** POST /compliance-instances/:id/client-chase/remind */
export interface ClientReminderResult {
  instanceId: string;
  channel: ClientReminderChannel;
  /** The reminder as sent (e-mail) or to paste (copy), with upload links when minted. */
  text: string;
  waitingOn: string[];
  /** Requests raised by this reminder for slots nobody had asked for yet. */
  raised: number;
}
