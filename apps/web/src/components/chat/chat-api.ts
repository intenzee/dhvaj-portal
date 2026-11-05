'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_LIVE_EVENT,
  CHAT_TICK,
  CHAT_TYPING_SHOW_MS,
  chatAttachmentAllowed,
  type ChatAttachmentKind,
  type ChatConversation,
  type ChatLiveEvent,
  type ChatMessage,
  type ChatMessagesPage,
  type ChatTick,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';

export const CHAT_KEYS = {
  all: ['chat'] as const,
  people: ['chat', 'people'] as const,
  conversations: ['chat', 'conversations'] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  unread: ['chat', 'unread'] as const,
  file: (messageId: string) => ['chat', 'file', messageId] as const,
};

/** A message as the thread shows it: sent, or still on its way from this browser. */
export type ShownMessage = ChatMessage & {
  /** Not yet stored by the portal (a clock instead of ticks). */
  pending?: boolean;
  /** The send failed; tap to try again. */
  failed?: boolean;
  /** A photo being sent: its local preview. */
  localUrl?: string;
};

export type MessagePages = InfiniteData<ChatMessagesPage, unknown>;

// ── Pure helpers (tested) ──────────────────────────────────────────────────

const TICK_RANK: Record<ChatTick, number> = { sent: 0, delivered: 1, read: 2 };

/**
 * Adds a message to a page (oldest first), or replaces the one it is — the
 * same id, or the pending copy with its clientRef. Pure — tested.
 */
export function mergeMessage<M extends ShownMessage>(items: readonly M[], m: M): M[] {
  const at = items.findIndex(
    (x) => x.id === m.id || (!!m.clientRef && x.clientRef === m.clientRef && x.mine === m.mine),
  );
  if (at >= 0) {
    const next = [...items];
    // A live copy never downgrades the ticks the thread already shows.
    const old = next[at]!;
    next[at] =
      !old.pending && TICK_RANK[old.tick] > TICK_RANK[m.tick]
        ? { ...m, tick: old.tick, deliveredAt: old.deliveredAt, readAt: old.readAt }
        : m;
    return next;
  }
  const next = [...items, m];
  next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return next;
}

/** My messages reached the other person (or they read them). Pure — tested. */
export function applyReceipt<M extends ShownMessage>(
  items: readonly M[],
  ids: readonly string[],
  tick: Exclude<ChatTick, 'sent'>,
  at: string,
): M[] {
  const set = new Set(ids);
  let changed = false;
  const next = items.map((m) => {
    if (!m.mine || !set.has(m.id) || TICK_RANK[m.tick] >= TICK_RANK[tick]) return m;
    changed = true;
    return {
      ...m,
      tick,
      deliveredAt: m.deliveredAt ?? at,
      readAt: tick === CHAT_TICK.read ? (m.readAt ?? at) : m.readAt,
    };
  });
  return changed ? next : (items as M[]);
}

/** Their messages to me that I have not read. Pure — tested. */
export function unreadFromThem(items: readonly ShownMessage[]): ShownMessage[] {
  return items.filter((m) => !m.mine && !m.readAt);
}

/** The thread's messages, oldest first, from the infinite query's pages (newest page first). */
export function flattenPages(data: MessagePages | undefined): ShownMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.items as ShownMessage[]);
}

const IST = 330 * 60_000;
const istDay = (iso: string | Date): string =>
  new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The day separator: "Today", "Yesterday", "3 Nov 2026". Pure — tested. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = istDay(iso);
  if (d === istDay(now)) return 'Today';
  if (d === istDay(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Messages grouped under their IST day, oldest first. Pure — tested. */
export function groupByDay<M extends { createdAt: string }>(
  items: readonly M[],
  now: Date = new Date(),
): { key: string; label: string; items: M[] }[] {
  const out: { key: string; label: string; items: M[] }[] = [];
  for (const m of items) {
    const key = istDay(m.createdAt);
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(m);
    else out.push({ key, label: dayLabel(m.createdAt, now), items: [m] });
  }
  return out;
}

/** A bubble's time, "2:05 pm" (IST). Pure — tested. */
export function bubbleTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
}

/** The chat list's time: the time today, "Yesterday", else the date. Pure — tested. */
export function listTime(iso: string, now: Date = new Date()): string {
  const label = dayLabel(iso, now);
  if (label === 'Today') return bubbleTime(iso);
  if (label === 'Yesterday') return label;
  const [y, m, d] = istDay(iso).split('-');
  return `${d}/${m}/${y!.slice(2)}`;
}

/** "0:07", "12:30". Pure — tested. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "820 KB", "2.4 MB". Pure — tested. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for the round avatar. Pure — tested. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Why a picked file cannot go (null when it can): too big, or a type this
 * kind does not take. Pure — tested.
 */
export function attachmentProblem(
  kind: ChatAttachmentKind,
  file: { size: number; type: string },
): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return `Files up to ${CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB can be sent.`;
  }
  if (!file.type || !chatAttachmentAllowed(kind, file.type)) {
    return kind === 'image'
      ? 'Send a JPEG, PNG, WebP, GIF or HEIC photo.'
      : 'This file type cannot be sent. Try PDF, Word, Excel, PowerPoint, CSV, text or ZIP.';
  }
  return null;
}

/** A voice note's file extension from its recorded type. Pure — tested. */
export function voiceExtension(contentType: string): string {
  const t = contentType.split(';')[0]!.trim().toLowerCase();
  if (t === 'audio/ogg') return 'ogg';
  if (t === 'audio/mp4' || t === 'audio/x-m4a' || t === 'audio/aac') return 'm4a';
  if (t === 'audio/mpeg') return 'mp3';
  if (t === 'audio/wav') return 'wav';
  return 'webm';
}

/** A file's bytes as base64 (without the data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

// ── Cache edits ────────────────────────────────────────────────────────────

/** Puts a message into its thread's newest page (if the thread is loaded). */
export function putMessage(qc: QueryClient, m: ShownMessage): void {
  qc.setQueryData<MessagePages>(CHAT_KEYS.messages(m.conversationId), (data) => {
    if (!data || data.pages.length === 0) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first!, items: mergeMessage(first!.items, m) }, ...rest] };
  });
}

/** Edits every loaded page of a thread. */
export function patchThread(
  qc: QueryClient,
  conversationId: string,
  fn: (items: ShownMessage[]) => ShownMessage[],
): void {
  qc.setQueryData<MessagePages>(CHAT_KEYS.messages(conversationId), (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items as ShownMessage[]) })) }
      : data,
  );
}

// ── Which chat is open (the live handler reads it) ─────────────────────────

let openChat: string | null = null;
export function setOpenChat(id: string | null): void {
  openChat = id;
}
/** The chat on screen, when the tab is in front. */
function chatInView(): string | null {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return null;
  return openChat;
}

// ── "typing…" ──────────────────────────────────────────────────────────────

const typingUntil = new Map<string, number>();
const typingListeners = new Set<() => void>();
let typingVersion = 0;
const bumpTyping = (): void => {
  typingVersion++;
  for (const l of [...typingListeners]) l();
};

export function setTyping(conversationId: string, on: boolean): void {
  if (on) {
    typingUntil.set(conversationId, Date.now() + CHAT_TYPING_SHOW_MS);
    setTimeout(bumpTyping, CHAT_TYPING_SHOW_MS + 50);
  } else if (!typingUntil.delete(conversationId)) {
    return;
  }
  bumpTyping();
}

/** Whether the other person in this chat is typing now. */
export function isTyping(conversationId: string, now: number = Date.now()): boolean {
  return (typingUntil.get(conversationId) ?? 0) > now;
}

/** Re-renders when anyone's "typing…" starts or stops; read with isTyping(). */
export function useTypingVersion(): number {
  return useSyncExternalStore(
    (l) => {
      typingListeners.add(l);
      return () => typingListeners.delete(l);
    },
    () => typingVersion,
    () => 0,
  );
}

// ── Live frames ────────────────────────────────────────────────────────────

/** Reads it now (the chat is on screen), else tells the sender it arrived. */
export async function acknowledge(qc: QueryClient, m: ChatMessage): Promise<void> {
  if (chatInView() === m.conversationId) {
    await markRead(qc, m.conversationId);
  } else {
    await apiFetch('/chat/delivered', { method: 'POST', body: { messageIds: [m.id] } }).catch(
      () => undefined,
    );
  }
}

/** I read everything in this chat: tell the portal, and show it here at once. */
export async function markRead(qc: QueryClient, conversationId: string): Promise<void> {
  await apiFetch(`/chat/conversations/${conversationId}/read`, { method: 'POST' }).catch(
    () => undefined,
  );
  const at = new Date().toISOString();
  patchThread(qc, conversationId, (items) =>
    items.some((m) => !m.mine && !m.readAt)
      ? items.map((m) =>
          !m.mine && !m.readAt ? { ...m, deliveredAt: m.deliveredAt ?? at, readAt: at } : m,
        )
      : items,
  );
  qc.setQueryData<ChatConversation[]>(CHAT_KEYS.conversations, (list) =>
    list?.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)),
  );
  void qc.invalidateQueries({ queryKey: CHAT_KEYS.unread });
}

/** What a chat frame on the live stream changes. */
export function handleChatEvent(qc: QueryClient, e: ChatLiveEvent): void {
  if (e.kind === CHAT_LIVE_EVENT.typing) {
    setTyping(e.conversationId, true);
    return;
  }
  if (e.kind === CHAT_LIVE_EVENT.receipt && e.receipt) {
    const { messageIds, tick, at } = e.receipt;
    patchThread(qc, e.conversationId, (items) => applyReceipt(items, messageIds, tick, at));
    qc.setQueryData<ChatConversation[]>(CHAT_KEYS.conversations, (list) =>
      list?.map((c) =>
        c.id === e.conversationId && c.lastMessage
          ? { ...c, lastMessage: applyReceipt([c.lastMessage], messageIds, tick, at)[0]! }
          : c,
      ),
    );
    return;
  }
  if (e.kind === CHAT_LIVE_EVENT.message) {
    setTyping(e.conversationId, false);
    if (e.message) {
      putMessage(qc, e.message);
      void acknowledge(qc, e.message);
    } else {
      // Too big for a frame: read the thread again (which marks it delivered).
      void qc.invalidateQueries({ queryKey: CHAT_KEYS.messages(e.conversationId) });
    }
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.conversations });
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.unread });
  }
}

/** Remembers which chat is open while the thread is mounted. */
export function useOpenChat(id: string | null): void {
  useEffect(() => {
    setOpenChat(id);
    return () => setOpenChat(null);
  }, [id]);
}
