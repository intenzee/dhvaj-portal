'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  lastSeenLabel,
  type ChatConversation,
  type ChatMessage,
  type ChatMessagesPage,
  type SendChatMessageInput,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useToast } from '@/lib/toast';
import { Spinner } from '@/components/ui';
import {
  CHAT_KEYS,
  blobToBase64,
  flattenPages,
  groupByDay,
  isTyping,
  markRead,
  putMessage,
  unreadFromThem,
  useOpenChat,
  useTypingVersion,
  type ShownMessage,
} from './chat-api';
import { ChatBubble } from './chat-bubble';
import { ChatComposer, type Outgoing } from './chat-composer';
import { Avatar } from './chat-list';

/** Is the tab in front (read receipts wait until it is). */
function useVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  useEffect(() => {
    const on = (): void => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
    };
  }, []);
  return visible;
}

/** One chat: the other person (online / last seen / typing…), the messages, and the box to write in. */
export function ChatThread({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const visible = useVisible();
  useOpenChat(id);
  useTypingVersion();

  const head = useQuery({
    queryKey: CHAT_KEYS.conversation(id),
    queryFn: () => apiFetch<ChatConversation>(`/chat/conversations/${id}`),
    // Online / last seen stays current.
    refetchInterval: 30_000,
  });
  const msgs = useInfiniteQuery({
    queryKey: CHAT_KEYS.messages(id),
    queryFn: ({ pageParam }) =>
      apiFetch<ChatMessagesPage>(
        `/chat/conversations/${id}/messages${pageParam ? `?before=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
    // Live frames keep it current; this catches anything missed.
    refetchInterval: 60_000,
  });

  // Messages on their way from this browser (kept apart, so a refetch never drops them).
  const [pending, setPending] = useState<ShownMessage[]>([]);
  const outgoing = useRef(new Map<string, Outgoing>());
  useEffect(() => setPending([]), [id]);

  const items = useMemo(() => {
    const stored = flattenPages(msgs.data);
    const refs = new Set(stored.map((m) => m.clientRef).filter(Boolean));
    return [...stored, ...pending.filter((p) => !refs.has(p.clientRef))];
  }, [msgs.data, pending]);
  const days = useMemo(() => groupByDay(items), [items]);

  // Blue ticks for them: read whatever they sent while this chat is on screen.
  const reading = useRef(false);
  const unread = unreadFromThem(items).length;
  useEffect(() => {
    if (!visible || unread === 0 || reading.current) return;
    reading.current = true;
    void markRead(qc, id).finally(() => {
      reading.current = false;
    });
  }, [visible, unread, qc, id]);

  // ── Scrolling: start at the newest; follow new ones; older ones at the top ──
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const restore = useRef<number | null>(null);
  const lastId = items[items.length - 1]?.id;
  useEffect(() => {
    stick.current = true;
  }, [id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
      return;
    }
    const last = items[items.length - 1];
    if (stick.current || last?.mine) el.scrollTop = el.scrollHeight;
  }, [lastId, items.length, items]);

  const onScroll = (): void => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && msgs.hasNextPage && !msgs.isFetchingNextPage) {
      restore.current = el.scrollHeight - el.scrollTop;
      void msgs.fetchNextPage();
    }
  };

  // ── Sending ──
  const send = useCallback(
    async (o: Outgoing, clientRef: string = crypto.randomUUID()): Promise<void> => {
      outgoing.current.set(clientRef, o);
      const f = o.file;
      const temp: ShownMessage = {
        id: `pending:${clientRef}`,
        conversationId: id,
        senderId: principal?.employeeId ?? '',
        mine: true,
        body: o.body,
        attachment: f
          ? {
              kind: f.kind,
              fileName: f.fileName,
              contentType: f.contentType,
              sizeBytes: f.blob.size,
              durationMs: f.durationMs ?? null,
            }
          : null,
        clientRef,
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        tick: 'sent',
        pending: true,
        localUrl: f?.kind === 'image' ? URL.createObjectURL(f.blob) : undefined,
      };
      stick.current = true;
      setPending((p) => [...p.filter((x) => x.clientRef !== clientRef), temp]);
      try {
        const input: SendChatMessageInput = { clientRef };
        if (o.body) input.body = o.body;
        if (f) {
          input.attachment = {
            kind: f.kind,
            fileName: f.fileName,
            contentType: f.contentType,
            contentBase64: await blobToBase64(f.blob),
            ...(f.durationMs !== undefined ? { durationMs: Math.round(f.durationMs) } : {}),
          };
        }
        const saved = await apiFetch<ChatMessage>(`/chat/conversations/${id}/messages`, {
          method: 'POST',
          body: input,
        });
        // The bytes are here already: no need to fetch them back.
        if (f) {
          qc.setQueryData(CHAT_KEYS.file(saved.id), {
            blob: f.blob,
            contentType: f.contentType,
            filename: f.fileName,
          });
        }
        putMessage(qc, saved);
        outgoing.current.delete(clientRef);
        setPending((p) => p.filter((x) => x.clientRef !== clientRef));
        if (temp.localUrl) URL.revokeObjectURL(temp.localUrl);
        void qc.invalidateQueries({ queryKey: CHAT_KEYS.conversations });
      } catch (err) {
        setPending((p) =>
          p.map((x) => (x.clientRef === clientRef ? { ...x, pending: false, failed: true } : x)),
        );
        toast(
          err instanceof ApiError ? err.message : 'The message did not go. Try again.',
          'error',
        );
      }
    },
    [id, principal?.employeeId, qc, toast],
  );

  const retry = useCallback(
    (m: ShownMessage) => {
      const o = m.clientRef ? outgoing.current.get(m.clientRef) : undefined;
      if (o && m.clientRef) void send(o, m.clientRef);
    },
    [send],
  );

  const other = head.data?.other;
  const typing = isTyping(id);
  const status = typing ? 'typing…' : other ? lastSeenLabel(other) : '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface-raised px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken md:hidden"
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {other ? (
          <>
            <Avatar name={other.name} online={other.online} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{other.name}</div>
              <div
                className={cn('truncate text-xs', typing ? 'text-[#25D366]' : 'text-ink-muted')}
                aria-live="polite"
              >
                {status || [other.role, other.officeCode].filter(Boolean).join(' · ')}
              </div>
            </div>
          </>
        ) : head.isError ? (
          <div className="text-sm text-ink-muted">This chat could not be opened.</div>
        ) : (
          <Spinner />
        )}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-[#EFEAE2] px-3 py-3 dark:bg-[#0B141A] sm:px-6"
      >
        {msgs.isFetchingNextPage && (
          <div className="mb-2 flex justify-center">
            <Spinner label="Loading earlier messages…" />
          </div>
        )}
        {msgs.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {msgs.isError && (
          <div className="py-6 text-center text-sm text-ink-muted">
            Could not load the messages.
          </div>
        )}
        {msgs.isSuccess && items.length === 0 && (
          <div className="mx-auto mt-6 max-w-sm rounded-lg bg-[#FFEECD] px-3 py-2 text-center text-xs text-[#54656F] dark:bg-[#182229] dark:text-[#FFD279]">
            Messages here are between the two of you only. Say hello, or send a photo, a voice
            message or a document.
          </div>
        )}
        {days.map((d) => (
          <section key={d.key} className="space-y-1.5">
            <div className="sticky top-0 z-[1] flex justify-center py-2">
              <span className="rounded-lg bg-surface/95 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted shadow-sm">
                {d.label}
              </span>
            </div>
            {d.items.map((m) => (
              <ChatBubble key={m.clientRef ?? m.id} m={m} onRetry={retry} />
            ))}
          </section>
        ))}
      </div>

      <ChatComposer
        conversationId={id}
        onSend={(o) => void send(o)}
        onError={(message) => toast(message, 'error')}
      />
    </div>
  );
}
