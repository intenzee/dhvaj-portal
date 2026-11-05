'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquarePlus, Search } from 'lucide-react';
import { chatPreview, type ChatConversation, type ChatPerson } from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useToast } from '@/lib/toast';
import { EmptyState, Spinner } from '@/components/ui';
import { CHAT_KEYS, initials, isTyping, listTime, useTypingVersion } from './chat-api';
import { Ticks } from './chat-bubble';

/** A round avatar with the person's initials, and WhatsApp's green dot while they are online. */
export function Avatar({
  name,
  online,
  size = 'md',
}: {
  name: string;
  online?: boolean;
  size?: 'md' | 'lg';
}): JSX.Element {
  return (
    <span className="relative shrink-0">
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-[#DFE5E7] font-semibold text-[#54656F] dark:bg-[#202C33] dark:text-[#AEBAC1]',
          size === 'lg' ? 'h-12 w-12 text-sm' : 'h-10 w-10 text-xs',
        )}
        aria-hidden
      >
        {initials(name)}
      </span>
      {online && (
        <span
          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-[#25D366]"
          aria-label="online"
        />
      )}
    </span>
  );
}

/** Matches a search box: name, staff code or office. Pure — tested. */
export function personMatches(
  p: Pick<ChatPerson, 'name' | 'code' | 'officeCode'>,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [p.name, p.code, p.officeCode].some((x) => x?.toLowerCase().includes(needle));
}

function ConversationRow({
  c,
  active,
  onOpen,
}: {
  c: ChatConversation;
  active: boolean;
  onOpen: () => void;
}): JSX.Element {
  const typing = isTyping(c.id);
  const last = c.lastMessage;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left hover:bg-surface-sunken',
          active && 'bg-surface-sunken',
        )}
      >
        <Avatar name={c.other.name} online={c.other.online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-ink">{c.other.name}</span>
            <span
              className={cn(
                'ml-auto shrink-0 text-[11px]',
                c.unread > 0 ? 'font-medium text-[#25D366]' : 'text-ink-faint',
              )}
            >
              {listTime(c.lastActivityAt)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {typing ? (
              <span className="truncate text-sm text-[#25D366]">typing…</span>
            ) : last ? (
              <>
                {last.mine && <Ticks m={last} className="shrink-0" />}
                <span
                  className={cn('truncate text-sm', c.unread > 0 ? 'text-ink' : 'text-ink-muted')}
                >
                  {chatPreview(last)}
                </span>
              </>
            ) : (
              <span className="truncate text-sm italic text-ink-faint">No messages yet</span>
            )}
            {c.unread > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-semibold text-white">
                {c.unread > 99 ? '99+' : c.unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/** The chat list, and "New chat" — anyone in the firm who can sign in. */
export function ChatList({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  useTypingVersion();

  const list = useQuery({
    queryKey: CHAT_KEYS.conversations,
    queryFn: () => apiFetch<ChatConversation[]>('/chat/conversations'),
    // Green dots and the order stay current.
    refetchInterval: 30_000,
  });
  const people = useQuery({
    queryKey: CHAT_KEYS.people,
    queryFn: () => apiFetch<ChatPerson[]>('/chat/people'),
    enabled: picking,
    staleTime: 60_000,
  });

  const start = useMutation({
    mutationFn: (employeeId: string) =>
      apiFetch<ChatConversation>('/chat/conversations', { method: 'POST', body: { employeeId } }),
    onSuccess: (c) => {
      qc.setQueryData(CHAT_KEYS.conversation(c.id), c);
      void qc.invalidateQueries({ queryKey: CHAT_KEYS.conversations });
      setPicking(false);
      setQ('');
      onOpen(c.id);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not open the chat.', 'error'),
  });

  const chats = useMemo(
    () => (list.data ?? []).filter((c) => personMatches(c.other, q)),
    [list.data, q],
  );
  const found = useMemo(
    () => (people.data ?? []).filter((p) => personMatches(p, q)),
    [people.data, q],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface-raised px-3 py-2.5">
        {picking ? (
          <>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setQ('');
              }}
              className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken"
              aria-label="Back to chats"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-ink">New chat</span>
          </>
        ) : (
          <>
            <span className="text-base font-semibold text-ink">Chats</span>
            <button
              type="button"
              onClick={() => {
                setPicking(true);
                setQ('');
              }}
              className="ml-auto rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              aria-label="New chat"
              title="New chat"
            >
              <MessageSquarePlus className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
      <div className="border-b border-line px-3 py-2">
        <label className="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-1.5">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={picking ? 'Search people' : 'Search chats'}
            aria-label={picking ? 'Search people' : 'Search chats'}
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {picking ? (
          <>
            {people.isLoading && (
              <li className="p-4">
                <Spinner />
              </li>
            )}
            {people.isSuccess && found.length === 0 && (
              <li className="p-4">
                <EmptyState>No one by that name.</EmptyState>
              </li>
            )}
            {found.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={start.isPending}
                  onClick={() => start.mutate(p.id)}
                  className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left hover:bg-surface-sunken disabled:opacity-60"
                >
                  <Avatar name={p.name} online={p.online} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{p.name}</div>
                    <div className="truncate text-xs text-ink-muted">
                      {[p.code, p.role, p.officeCode].filter(Boolean).join(' · ') || ' '}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </>
        ) : (
          <>
            {list.isLoading && (
              <li className="p-4">
                <Spinner />
              </li>
            )}
            {list.isError && (
              <li className="p-4 text-sm text-ink-muted">Could not load your chats.</li>
            )}
            {list.isSuccess && chats.length === 0 && (
              <li className="p-4">
                <EmptyState>
                  {q ? 'No chat matches.' : 'No chats yet. Start one with the button above.'}
                </EmptyState>
              </li>
            )}
            {chats.map((c) => (
              <ConversationRow
                key={c.id}
                c={c}
                active={c.id === activeId}
                onOpen={() => onOpen(c.id)}
              />
            ))}
          </>
        )}
      </ul>
    </div>
  );
}
