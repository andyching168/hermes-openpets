import type { NormalizedEvent } from "./event-normalizer.ts";
import { normalizeHermesEvent } from "./event-normalizer.ts";

export interface HermesCapabilities {
  busyState: boolean;
  awaitingResponseState: boolean;
  focusedSessionState: boolean;
  eventStream: boolean;
  nativePetState: boolean;
}

export type Tier = "A" | "B" | "C" | "D";

export interface HermesAdapter {
  start(listener: (event: NormalizedEvent) => void): void;
  stop(): void;
  getCapabilities(): HermesCapabilities;
}

interface Atom<T> {
  get(): T;
  subscribe?(cb: (v: T) => void): () => void;
  listen?(cb: (v: T) => void): () => void;
}

const isAtom = (v: unknown): v is Atom<unknown> => !!v && typeof (v as Atom<unknown>).get === "function";

/** Feature detection only — never version numbers. */
export function detectCapabilities(host: any): HermesCapabilities {
  const s = host?.state;
  return {
    busyState: isAtom(s?.busy),
    awaitingResponseState: isAtom(s?.awaitingResponse),
    focusedSessionState: isAtom(s?.focusedSessionId),
    eventStream: typeof host?.onEvent === "function",
    nativePetState: isAtom(s?.petState),
  };
}

export function tierOf(c: HermesCapabilities): Tier {
  if (!c.busyState) return "D";
  if (c.eventStream && c.focusedSessionState) return "A";
  if (c.eventStream) return "B";
  return "C";
}

/**
 * The only module that touches `host`. Uses the public SDK surface:
 * host.state.* atoms and ctx.onEvent (tracked host.onEvent).
 */
export function createHermesAdapter(
  host: any,
  ctx: { onEvent?: (type: string, fn: (e: unknown) => void) => () => void },
  log?: (msg: string) => void,
): HermesAdapter {
  const caps = detectCapabilities(host);
  const disposers: Array<() => void> = [];

  function watch<T>(atom: Atom<T>, cb: (v: T) => void): void {
    // nanostores: subscribe() fires immediately, listen() does not.
    const off = atom.subscribe ? atom.subscribe(cb) : atom.listen ? (cb(atom.get()), atom.listen(cb)) : undefined;
    if (off) disposers.push(off);
  }

  return {
    getCapabilities: () => caps,
    start(listener) {
      const emit = (e: NormalizedEvent) => {
        try {
          listener(e);
        } catch (err) {
          log?.(`listener error: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      try {
        if (caps.nativePetState) {
          watch(host.state.petState as Atom<unknown>, (v) => emit({ type: "NATIVE_STATE", state: typeof v === "string" ? v : null }));
        }
        if (caps.focusedSessionState) {
          watch(host.state.focusedSessionId as Atom<string | null>, (id) => emit({ type: "FOCUS_CHANGED", sessionId: id ?? null }));
        }
        if (caps.busyState) {
          watch(host.state.busy as Atom<boolean>, (b) => emit({ type: "BUSY_CHANGED", busy: !!b }));
        }
        if (caps.eventStream) {
          const sub = ctx.onEvent ?? host.onEvent.bind(host);
          disposers.push(sub("*", (raw: unknown) => emit(normalizeHermesEvent(raw))));
        }
      } catch (err) {
        log?.(`adapter start failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    stop() {
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
