'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Pause,
  Play,
  X,
} from 'lucide-react';
import { CHAT_TICK, type ChatAttachment } from '@hsdg/contracts';
import { downloadFile, fetchBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { CHAT_KEYS, bubbleTime, formatBytes, formatDuration, type ShownMessage } from './chat-api';

/** WhatsApp's ticks: one grey (sent), two grey (delivered), two blue (read); a clock while sending. */
export function Ticks({ m, className }: { m: ShownMessage; className?: string }): JSX.Element {
  if (m.failed) {
    return (
      <AlertCircle className={cn('h-3.5 w-3.5 text-danger-600', className)} aria-label="Not sent" />
    );
  }
  if (m.pending) {
    return <Clock3 className={cn('h-3.5 w-3.5 text-ink-faint', className)} aria-label="Sending" />;
  }
  if (m.tick === CHAT_TICK.read) {
    return <CheckCheck className={cn('h-4 w-4 text-[#34B7F1]', className)} aria-label="Read" />;
  }
  if (m.tick === CHAT_TICK.delivered) {
    return (
      <CheckCheck className={cn('h-4 w-4 text-ink-faint', className)} aria-label="Delivered" />
    );
  }
  return <Check className={cn('h-4 w-4 text-ink-faint', className)} aria-label="Sent" />;
}

/** The attachment's bytes as an object URL (fetched once, kept while the page is open). */
function useFileUrl(messageId: string, enabled = true): { url: string | null; error: boolean } {
  const file = useQuery({
    queryKey: CHAT_KEYS.file(messageId),
    queryFn: () => fetchBlob(`/chat/messages/${messageId}/file`),
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.data) return;
    const u = URL.createObjectURL(file.data.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file.data]);
  return { url, error: file.isError };
}

function Photo({ m }: { m: ShownMessage }): JSX.Element {
  const { url, error } = useFileUrl(m.id, !m.pending && !m.failed);
  const [big, setBig] = useState(false);
  const src = m.localUrl ?? url;
  if (error) {
    return (
      <div className="flex h-40 w-64 max-w-full items-center justify-center gap-2 rounded-lg bg-surface-sunken text-xs text-ink-muted">
        <ImageOff className="h-4 w-4" /> Could not load the photo
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => src && setBig(true)}
        className="block overflow-hidden rounded-lg bg-surface-sunken"
        aria-label="Open the photo"
      >
        {src ? (
          // An object URL from the API (or the local file) — next/image cannot load it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={m.attachment?.fileName ?? 'Photo'}
            className="max-h-72 w-auto max-w-full object-cover sm:max-w-[17rem]"
          />
        ) : (
          <div className="h-40 w-64 max-w-full animate-pulse" />
        )}
      </button>
      {big &&
        src &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex flex-col bg-black/90"
            role="dialog"
            aria-label="Photo"
            onClick={() => setBig(false)}
          >
            <div
              className="flex items-center justify-end gap-2 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() =>
                  void downloadFile(`/chat/messages/${m.id}/file`, m.attachment?.fileName)
                }
                aria-label="Download"
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => setBig(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={m.attachment?.fileName ?? 'Photo'}
                className="max-h-full max-w-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Voice({ m }: { m: ShownMessage }): JSX.Element {
  const [want, setWant] = useState(false);
  const { url, error } = useFileUrl(m.id, want && !m.pending && !m.failed);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const total = m.attachment?.durationMs ?? 0;

  // The first tap fetches it; play as soon as it is here.
  useEffect(() => {
    if (want && url && audio.current && !playing) {
      void audio.current.play().catch(() => undefined);
    }
    // Only when the file arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const toggle = (): void => {
    if (!url) {
      setWant(true);
      return;
    }
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };

  const shown = playing || pos > 0 ? pos * 1000 : total;
  const fraction = total > 0 ? Math.min(1, (pos * 1000) / total) : 0;
  return (
    <div className="flex w-60 max-w-full items-center gap-2.5 py-1">
      <button
        type="button"
        onClick={toggle}
        disabled={m.pending || m.failed}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#128C7E] text-white disabled:opacity-50"
        aria-label={playing ? 'Pause' : 'Play the voice message'}
      >
        {want && !url && !error ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(fraction * 1000)}
          aria-label="Position"
          disabled={!url}
          onChange={(e) => {
            const a = audio.current;
            if (a && total > 0) a.currentTime = (Number(e.target.value) / 1000) * (total / 1000);
          }}
          className="h-1 w-full cursor-pointer accent-[#128C7E]"
        />
        <div className="mt-0.5 text-[11px] text-ink-muted">
          {error ? 'Could not load it' : formatDuration(shown)}
        </div>
      </div>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        />
      )}
    </div>
  );
}

function docLabel(a: ChatAttachment): string {
  const ext = a.fileName.includes('.') ? a.fileName.split('.').pop()!.toUpperCase() : '';
  return [ext || a.contentType.split('/')[1]?.toUpperCase(), formatBytes(a.sizeBytes)]
    .filter(Boolean)
    .join(' · ');
}

function Document({ m }: { m: ShownMessage }): JSX.Element {
  const a = m.attachment!;
  const [busy, setBusy] = useState(false);
  const ready = !m.pending && !m.failed;
  const isPdf = a.contentType === 'application/pdf';
  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const { blob } = await fetchBlob(`/chat/messages/${m.id}/file`);
      const u = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex w-64 max-w-full items-center gap-3 rounded-lg bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.06]">
      <FileText
        className={cn('h-8 w-8 shrink-0', isPdf ? 'text-danger-600' : 'text-primary-600')}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink" title={a.fileName}>
          {a.fileName}
        </div>
        <div className="text-[11px] text-ink-muted">{docLabel(a)}</div>
      </div>
      {ready && isPdf && (
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="rounded-md p-1.5 text-ink-muted hover:bg-black/5 hover:text-ink"
          aria-label="Open the PDF"
          title="Open"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      )}
      {ready && (
        <button
          type="button"
          onClick={() => void downloadFile(`/chat/messages/${m.id}/file`, a.fileName)}
          className="rounded-md p-1.5 text-ink-muted hover:bg-black/5 hover:text-ink"
          aria-label={`Download ${a.fileName}`}
          title="Download"
        >
          <Download className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** One message: mine on the right in green, theirs on the left; time and ticks at the foot. */
export function ChatBubble({
  m,
  onRetry,
}: {
  m: ShownMessage;
  onRetry?: (m: ShownMessage) => void;
}): JSX.Element {
  const a = m.attachment;
  return (
    <div className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-2 pb-1 pt-1.5 text-sm shadow-sm sm:max-w-[70%]',
          m.mine
            ? 'rounded-tr-none bg-[#D9FDD3] text-ink dark:bg-[#005C4B] dark:text-white'
            : 'rounded-tl-none bg-surface text-ink',
        )}
      >
        {a?.kind === 'image' && <Photo m={m} />}
        {a?.kind === 'voice' && <Voice m={m} />}
        {a?.kind === 'document' && <Document m={m} />}
        {m.body && (
          <p className={cn('whitespace-pre-wrap break-words px-1', a && 'mt-1')}>{m.body}</p>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 px-1 text-[11px] text-ink-faint dark:text-white/60">
          {m.failed && onRetry ? (
            <button
              type="button"
              className="font-medium text-danger-600 hover:underline"
              onClick={() => onRetry(m)}
            >
              Not sent — try again
            </button>
          ) : (
            <span>{bubbleTime(m.createdAt)}</span>
          )}
          {m.mine && <Ticks m={m} />}
        </div>
      </div>
    </div>
  );
}
