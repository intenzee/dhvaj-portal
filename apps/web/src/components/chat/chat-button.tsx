'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { CHAT_LIVE_EVENT, chatPreview, type ChatUnread } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LiveState } from '@/lib/live';
import { isChatEvent, subscribeLive } from '@/lib/live-hub';
import { CHAT_KEYS, handleChatEvent, initials } from './chat-api';

interface Note {
  conversationId: string;
  from: string;
  preview: string;
}

/**
 * The top bar's chat button (WhatsApp-green count of unread messages), and
 * the one place chat frames on the live stream are handled — so ticks,
 * "typing…" and new messages land on whatever screen the person is on, and
 * their portal says "delivered" as soon as a message reaches it.
 */
export function ChatButton(): JSX.Element | null {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [live, setLive] = useState<LiveState>('connecting');
  const linked = !!principal?.employeeId;

  // Asking for the count also marks waiting messages delivered.
  const unread = useQuery({
    queryKey: CHAT_KEYS.unread,
    queryFn: () => apiFetch<ChatUnread>('/chat/unread'),
    refetchInterval: live === 'live' ? 60_000 : 15_000,
    refetchIntervalInBackground: true,
    enabled: linked,
  });

  useEffect(() => {
    if (!linked) return;
    return subscribeLive({
      onEvent: (e) => {
        if (!isChatEvent(e)) return;
        handleChatEvent(qc, e);
        // Away from the chat screen: a quiet note of who wrote.
        if (
          e.kind === CHAT_LIVE_EVENT.message &&
          e.message &&
          !pathRef.current?.startsWith('/chat')
        ) {
          setNote({
            conversationId: e.conversationId,
            from: e.fromName ?? 'New message',
            preview: chatPreview(e.message).slice(0, 120),
          });
        }
      },
      onState: setLive,
    });
  }, [linked, qc]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  if (!linked) return null;
  const n = unread.data?.messages ?? 0;
  return (
    <>
      <Link
        href="/chat"
        title={`Chat${n ? ` — ${n} unread` : ''}`}
        aria-label={n ? `Chat, ${n} unread` : 'Chat'}
        className="relative rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
      >
        <MessageCircle className="h-5 w-5" />
        {n > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#25D366] px-1 text-[10px] font-semibold text-white">
            {n > 99 ? '99+' : n}
          </span>
        )}
      </Link>
      {note &&
        typeof document !== 'undefined' &&
        createPortal(
          <button
            type="button"
            onClick={() => {
              setNote(null);
              router.push(`/chat?c=${note.conversationId}`);
            }}
            className="fixed bottom-4 left-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left shadow-pop"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366]/15 text-xs font-semibold text-[#128C7E]">
              {initials(note.from)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{note.from}</span>
              <span className="block truncate text-sm text-ink-muted">{note.preview}</span>
            </span>
          </button>,
          document.body,
        )}
    </>
  );
}
