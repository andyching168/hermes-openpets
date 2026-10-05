import type { HermesPetState } from "./pet-state.ts";

export interface OpenPetsAdapter {
  probe(): Promise<boolean>;
  setState(state: HermesPetState, options?: { text?: string; toolName?: string }): Promise<void>;
  reset(): Promise<void>;
  isAvailable(): boolean;
}

/** Hermes semantic state -> OpenPets reaction (see OpenPets `allowedReactions`). */
export const REACTION_BY_STATE: Record<HermesPetState, string> = {
  idle: "idle",
  run: "working",
  review: "thinking",
  waiting: "waiting",
  wave: "waving",
  jump: "celebrating",
  failed: "error",
};

export interface OpenPetsAdapterOptions {
  getUrl: () => string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  onAvailabilityChange?: (available: boolean) => void;
  log?: (msg: string) => void;
}

const REQUEST_TIMEOUT_MS = 1500;
const BACKOFF_MS = [5_000, 15_000, 60_000];

/**
 * Talks to the local OpenPets relay (relay/openpets-relay.mjs) over 127.0.0.1.
 * The only module that calls fetch(). Never throws.
 */
export function createOpenPetsAdapter(opts: OpenPetsAdapterOptions): OpenPetsAdapter {
  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let available = true;
  let failures = 0;
  let retryAt = 0;
  let lastSent: HermesPetState | null = null;
  let wanted: HermesPetState | null = null;

  const markDown = (why: string) => {
    const wasUp = available;
    available = false;
    retryAt = now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
    failures += 1;
    lastSent = null;
    if (wasUp) {
      opts.log?.(`OpenPets unavailable (${why})`);
      opts.onAvailabilityChange?.(false);
    }
  };
  const markUp = () => {
    failures = 0;
    if (!available) {
      available = true;
      opts.log?.("OpenPets available");
      opts.onAvailabilityChange?.(true);
    }
  };

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      return await doFetch(opts.getUrl().replace(/\/+$/, "") + path, { ...init, signal: ctl?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function send(state: HermesPetState): Promise<void> {
    try {
      // text/plain keeps this a CORS "simple request" (no preflight).
      const res = await request("/react", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ reaction: REACTION_BY_STATE[state] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (body.ok === false) throw new Error("relay could not reach OpenPets");
      lastSent = state;
      markUp();
    } catch (e) {
      markDown(e instanceof Error ? e.message : "error");
    }
  }

  return {
    isAvailable: () => available,
    async probe() {
      try {
        const res = await request("/health");
        const body = (await res.json()) as { ok?: boolean; openpets?: boolean };
        const up = res.ok && body.ok === true && body.openpets !== false;
        if (up) markUp();
        else markDown("OpenPets not running");
        return up;
      } catch (e) {
        markDown(e instanceof Error ? e.message : "error");
        return false;
      }
    },
    async setState(state) {
      try {
        wanted = state;
        if (state === lastSent) return; // dedupe
        if (!available && now() < retryAt) return; // stay quiet while unavailable
        await send(state);
      } catch {
        /* fail open */
      }
    },
    async reset() {
      try {
        wanted = null;
        if (available || now() >= retryAt) await send("idle");
      } catch {
        /* fail open */
      }
    },
  };
}
