'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  SendHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  CHAT_ATTACHMENT_TYPES,
  CHAT_MESSAGE_MAX,
  CHAT_TYPING_EVERY_MS,
  CHAT_VOICE_MAX_MS,
  baseContentType,
  type ChatAttachmentKind,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { attachmentProblem, formatBytes, formatDuration, voiceExtension } from './chat-api';

/** What the composer hands up to send. */
export interface Outgoing {
  body: string;
  file?: {
    kind: ChatAttachmentKind;
    blob: Blob;
    fileName: string;
    contentType: string;
    durationMs?: number;
  };
}

const DOCUMENT_ACCEPT =
  [...new Set(CHAT_ATTACHMENT_TYPES.document)].join(',') +
  ',.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.json,.xml';
const IMAGE_ACCEPT = CHAT_ATTACHMENT_TYPES.image.join(',');

/** The browser's best recording format the portal takes. */
function recorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

interface Recording {
  rec: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  /** Send when it stops (false: thrown away). */
  send: boolean;
}

export function ChatComposer({
  conversationId,
  onSend,
  onError,
}: {
  conversationId: string;
  onSend: (o: Outgoing) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<{
    kind: ChatAttachmentKind;
    file: File;
    preview: string | null;
  } | null>(null);
  const [menu, setMenu] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const recordingRef = useRef<Recording | null>(null);
  recordingRef.current = recording;

  // A new chat starts with an empty box.
  useEffect(() => {
    setText('');
    setPicked(null);
    lastTyping.current = 0;
    area.current?.focus();
  }, [conversationId]);

  // The picked photo's preview goes with it.
  useEffect(
    () => () => {
      if (picked?.preview) URL.revokeObjectURL(picked.preview);
    },
    [picked],
  );

  // Grow with the text, up to six lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  // The recording's clock; stops itself at the longest a voice note may be.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const ms = Date.now() - recording.startedAt;
      setElapsed(ms);
      if (ms >= CHAT_VOICE_MAX_MS) stopRecording(true);
    }, 250);
    return () => clearInterval(t);
    // stopRecording only reads the ref'd recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Leaving the chat mid-recording throws it away and frees the microphone.
  useEffect(
    () => () => {
      if (recordingRef.current) {
        recordingRef.current.send = false;
        if (recordingRef.current.rec.state !== 'inactive') recordingRef.current.rec.stop();
        recordingRef.current.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );
  const typing = (): void => {
    const now = Date.now();
    if (now - lastTyping.current < CHAT_TYPING_EVERY_MS) return;
    lastTyping.current = now;
    void apiFetch(`/chat/conversations/${conversationId}/typing`, { method: 'POST' }).catch(
      () => undefined,
    );
  };

  const pick = (kind: ChatAttachmentKind, file: File | undefined): void => {
    setMenu(false);
    if (!file) return;
    // Some systems give no type for Office files; go by the name.
    const type = file.type || guessType(file.name);
    const problem = attachmentProblem(kind, { size: file.size, type });
    if (problem) {
      onError(problem);
      return;
    }
    const f = type === file.type ? file : new File([file], file.name, { type });
    setPicked({ kind, file: f, preview: kind === 'image' ? URL.createObjectURL(f) : null });
    area.current?.focus();
  };

  const send = (): void => {
    const body = text.trim();
    if (picked) {
      onSend({
        body,
        file: {
          kind: picked.kind,
          blob: picked.file,
          fileName: picked.file.name,
          contentType: picked.file.type,
        },
      });
      setPicked(null);
      setText('');
      return;
    }
    if (!body) return;
    onSend({ body });
    setText('');
    lastTyping.current = 0;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const startRecording = async (): Promise<void> => {
    const mimeType = recorderType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      onError('This browser cannot record voice messages.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Allow the microphone for this site to record a voice message.');
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType });
    const r: Recording = { rec, stream, chunks: [], startedAt: Date.now(), send: true };
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) r.chunks.push(ev.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(null);
      setElapsed(0);
      const durationMs = Date.now() - r.startedAt;
      if (!r.send || r.chunks.length === 0 || durationMs < 700) return;
      const contentType = baseContentType(rec.mimeType || mimeType);
      const blob = new Blob(r.chunks, { type: contentType });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      onSend({
        body: '',
        file: {
          kind: 'voice',
          blob,
          fileName: `voice-message-${stamp}.${voiceExtension(contentType)}`,
          contentType,
          durationMs: Math.min(durationMs, CHAT_VOICE_MAX_MS),
        },
      });
    };
    rec.start(1000);
    setRecording(r);
  };

  const stopRecording = (sendIt: boolean): void => {
    const r = recordingRef.current;
    if (!r) return;
    r.send = sendIt;
    if (r.rec.state !== 'inactive') r.rec.stop();
  };

  if (recording) {
    return (
      <div className="flex items-center gap-3 border-t border-line bg-surface-raised px-3 py-2.5">
        <button
          type="button"
          onClick={() => stopRecording(false)}
          className="rounded-full p-2 text-ink-muted hover:bg-surface-sunken hover:text-danger-600"
          aria-label="Throw away the recording"
          title="Delete"
        >
          <Trash2 className="h-5 w-5" />
        </button>
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger-600" aria-hidden />
        <span className="font-mono text-sm text-ink" aria-live="polite">
          {formatDuration(elapsed)}
        </span>
        <span className="text-sm text-ink-muted">Recording…</span>
        <button
          type="button"
          onClick={() => stopRecording(true)}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5b]"
          aria-label="Send the voice message"
          title="Send"
        >
          <SendHorizontal className="h-5 w-5" />
        </button>
      </div>
    );
  }

  const canSend = !!picked || text.trim().length > 0;
  return (
    <div className="border-t border-line bg-surface-raised">
      {picked && (
        <div className="flex items-center gap-3 border-b border-line px-3 py-2">
          {picked.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picked.preview} alt="" className="h-14 w-14 rounded-md object-cover" />
          ) : (
            <FileText className="h-10 w-10 text-primary-600" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{picked.file.name}</div>
            <div className="text-xs text-ink-muted">
              {picked.kind === 'image' ? 'Photo' : 'Document'} · {formatBytes(picked.file.size)} ·
              add a caption below, or just send
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
            aria-label="Remove the attachment"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu((x) => !x)}
            className="rounded-full p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink"
            aria-label="Attach"
            aria-expanded={menu}
            title="Attach a photo or document"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          {menu && (
            <div className="absolute bottom-12 left-0 z-10 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop">
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken"
              >
                <ImageIcon className="h-4 w-4 text-[#BF59CF]" /> Photo
              </button>
              <button
                type="button"
                onClick={() => docInput.current?.click()}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken"
              >
                <FileText className="h-4 w-4 text-[#5157AE]" /> Document or PDF
              </button>
            </div>
          )}
          <input
            ref={photoInput}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              pick('image', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={docInput}
            type="file"
            accept={DOCUMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              pick('document', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={CHAT_MESSAGE_MAX}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) typing();
          }}
          onKeyDown={onKey}
          onPaste={(e) => {
            const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
            if (f) {
              e.preventDefault();
              pick('image', f);
            }
          }}
          placeholder={picked ? 'Add a caption' : 'Type a message'}
          aria-label="Message"
          className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
        {canSend ? (
          <button
            type="button"
            onClick={send}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5b]"
            aria-label="Send"
            title="Send (Enter)"
          >
            <SendHorizontal className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5b]"
            aria-label="Record a voice message"
            title="Record a voice message"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** A type from the name, for files the system gives none. Pure — tested. */
export function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip',
    json: 'application/json',
    xml: 'application/xml',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? '';
}
