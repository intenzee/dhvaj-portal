'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { EmptyState, PageHeader, Spinner } from '@/components/ui';
import { ChatList } from '@/components/chat/chat-list';
import { ChatThread } from '@/components/chat/chat-thread';

function Chat(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const { principal } = useAuth();
  const open = params.get('c');
  const go = (id: string | null) =>
    router.replace(id ? `/chat?c=${id}` : '/chat', { scroll: false });

  if (principal && !principal.employeeId) {
    return (
      <>
        <PageHeader title="Chat" />
        <EmptyState>
          Chat is for people on the firm&apos;s staff list; this sign-in is not linked to one.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle="Direct messages with anyone in the firm — text, photos, voice messages and documents. Only the two of you can read a chat."
      />
      <div className="grid h-[calc(100vh-13rem)] min-h-[28rem] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-card md:grid-cols-[22rem_1fr]">
        <div className={cn('min-h-0 min-w-0 border-r border-line', open && 'hidden md:block')}>
          <ChatList activeId={open} onOpen={(id) => go(id)} />
        </div>
        <div className={cn('min-h-0 min-w-0', !open && 'hidden md:block')}>
          {open ? (
            <ChatThread key={open} id={open} onBack={() => go(null)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-raised px-6 text-center">
              <MessageCircle className="h-12 w-12 text-ink-faint" aria-hidden />
              <div className="text-lg font-semibold text-ink">Chat</div>
              <p className="max-w-sm text-sm text-ink-muted">
                Pick a chat, or start a new one. One grey tick: sent. Two grey: delivered to their
                portal. Two blue: they read it.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function ChatPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <Chat />
    </Suspense>
  );
}
