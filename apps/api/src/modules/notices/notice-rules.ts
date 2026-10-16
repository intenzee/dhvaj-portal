/**
 * PS-101 — the notice register's pure parts: the list cursor, the default
 * reply date, and how a notice's status and next hearing follow from its
 * events (used when an event is voided). DB-free, unit-tested.
 */
import { BadRequestException } from '@nestjs/common';
import {
  isNoticeOpen,
  noticeEventEffect,
  type NoticeEventKind,
  type NoticeStatus,
} from '@hsdg/contracts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The clock's date in SQL, matching noticeClock() in contracts: the appeal date
 * once an order is in, else the earlier of the reply date (while a reply is
 * still to file) and the next hearing. Lists filter and sort on it.
 */
export const CLOCK_DUE_SQL = `CASE
    WHEN n.status IN ('closed', 'withdrawn', 'appealed') THEN NULL
    WHEN n.status = 'order_received' THEN n.appeal_due_on
    ELSE LEAST(
      CASE WHEN n.status IN ('received', 'in_progress')
           THEN COALESCE(n.internal_due_on, n.reply_due_on) END,
      n.next_hearing_on)
  END`;

/** Opaque list cursor = base64url(JSON [clock due or null, id]). */
export function encodeNoticeCursor(due: string | null, id: string): string {
  return Buffer.from(JSON.stringify([due, id])).toString('base64url');
}

export function decodeNoticeCursor(cursor: string): { due: string | null; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      (v[0] === null || (typeof v[0] === 'string' && ISO_DATE.test(v[0]))) &&
      typeof v[1] === 'string' &&
      UUID.test(v[1])
    ) {
      return { due: v[0] as string | null, id: v[1] };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor.');
}

/** YYYY-MM-DD plus whole days (UTC calendar arithmetic). */
export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The reply date a new notice gets when none is given: issued + the type's default days. */
export function defaultReplyDue(issuedOn: string, defaultReplyDays: number | null): string | null {
  return defaultReplyDays ? addDaysIso(issuedOn, defaultReplyDays) : null;
}

export interface ReplayEvent {
  kind: NoticeEventKind;
  nextDate: string | null;
}

/**
 * Status and next hearing from the events still standing, oldest first (after
 * one is voided). Starts from 'received' — or 'in_progress' when the team had
 * moved it there by hand and nothing since says otherwise.
 */
export function replayNoticeEvents(
  events: readonly ReplayEvent[],
  current: NoticeStatus,
): { status: NoticeStatus; nextHearingOn: string | null } {
  let status: NoticeStatus = 'received';
  let nextHearingOn: string | null = null;
  for (const e of events) {
    const effect = noticeEventEffect(e.kind, status);
    if (effect.status) status = effect.status;
    if (effect.setsHearing && e.nextDate) nextHearingOn = e.nextDate;
  }
  // Finished, or appealed (the appeal engagement carries it on): the status stays.
  if (!isNoticeOpen(current) || current === 'appealed') return { status: current, nextHearingOn };
  if (status === 'received' && current === 'in_progress') status = 'in_progress';
  return { status, nextHearingOn };
}
