import { isChatLiveKind, type ChatLiveEvent, type LiveEvent } from '@hsdg/contracts';
import { connectLive, type AnyLiveEvent, type LiveState } from './live';

/**
 * One live stream for the whole portal, shared by whoever listens (the
 * quick-task alerts, the chat). Opens with the first listener and closes with
 * the last; a listener added later hears the current state at once.
 */
interface Listener {
  onEvent?: (e: AnyLiveEvent) => void;
  onState?: (s: LiveState) => void;
}

const listeners = new Set<Listener>();
let stop: (() => void) | null = null;
let state: LiveState = 'connecting';

export function subscribeLive(l: Listener): () => void {
  listeners.add(l);
  l.onState?.(state);
  if (!stop) {
    stop = connectLive(
      (e) => {
        for (const x of [...listeners]) x.onEvent?.(e);
      },
      (s) => {
        state = s;
        for (const x of [...listeners]) x.onState?.(s);
      },
    );
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
      state = 'connecting';
    }
  };
}

/** A quick-task frame (the stream carries chat frames too). Pure — tested. */
export function isQuickTaskEvent(e: AnyLiveEvent): e is LiveEvent {
  return !isChatLiveKind(e.kind);
}

/** A chat frame. Pure — tested. */
export function isChatEvent(e: AnyLiveEvent): e is ChatLiveEvent {
  return isChatLiveKind(e.kind);
}
