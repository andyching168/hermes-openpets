// src/plugin.ts
import { host, PALETTE_AREA } from "@hermes/plugin-sdk";

// src/tool-label.ts
function toolLabel(toolName) {
  const n = (toolName ?? "").toLowerCase();
  if (/terminal|shell|bash|exec|command/.test(n)) return "Running terminal\u2026";
  if (/browser|navigate|click|screenshot/.test(n)) return "Using browser\u2026";
  if (/search|web|fetch|grep|find/.test(n)) return "Searching\u2026";
  if (/python|code_exec|jupyter|notebook/.test(n)) return "Running Python\u2026";
  if (/file|read|write|edit|patch|diff/.test(n)) return "Editing files\u2026";
  return "Working\u2026";
}

// src/activity-model.ts
var NATIVE_STATES = /* @__PURE__ */ new Set(["idle", "wave", "run", "failed", "review", "jump", "waiting"]);
var ActivityTracker = class {
  focused = null;
  busy = false;
  tools = 0;
  reasoning = false;
  lastTool;
  native = null;
  pulses = { error: false, justCompleted: false, celebrate: false };
  apply(ev) {
    switch (ev.type) {
      case "BUSY_CHANGED":
        this.busy = ev.busy;
        if (!ev.busy) this.resetLive();
        return;
      case "FOCUS_CHANGED":
        if (ev.sessionId !== this.focused) {
          this.focused = ev.sessionId;
          this.resetLive();
        }
        return;
      case "NATIVE_STATE":
        this.native = ev.state && NATIVE_STATES.has(ev.state) ? ev.state : null;
        return;
      case "UNKNOWN":
        return;
    }
    if (!this.accepts(ev.sessionId)) return;
    switch (ev.type) {
      case "TURN_STARTED":
        this.busy = true;
        return;
      case "TURN_COMPLETED":
        this.busy = false;
        this.resetLive();
        this.pulses.justCompleted = true;
        return;
      case "TURN_INTERRUPTED":
        this.busy = false;
        this.resetLive();
        return;
      case "TOOL_STARTED":
        this.tools += 1;
        this.lastTool = ev.toolName;
        this.reasoning = false;
        return;
      case "TOOL_COMPLETED":
        this.tools = Math.max(0, this.tools - 1);
        if (ev.error) this.pulses.error = true;
        return;
      case "REASONING_STARTED":
        this.reasoning = true;
        return;
      case "REASONING_ENDED":
        this.reasoning = false;
        return;
      case "ERROR":
        this.busy = false;
        this.resetLive();
        this.pulses.error = true;
        return;
    }
  }
  /** Session policy: only the focused session drives the pet; unknown identity degrades to global. */
  accepts(sessionId) {
    return !this.focused || !sessionId || sessionId === this.focused;
  }
  resetLive() {
    this.tools = 0;
    this.reasoning = false;
  }
  snapshot() {
    return {
      sessionId: this.focused,
      busy: this.busy,
      awaitingInput: false,
      // v0.3: only with a public SDK signal for approval/clarify
      toolRunning: this.tools > 0,
      reasoning: this.reasoning,
      error: this.pulses.error,
      justCompleted: this.pulses.justCompleted,
      celebrate: this.pulses.celebrate,
      native: this.native,
      toolLabel: this.tools > 0 ? toolLabel(this.lastTool) : null
    };
  }
  clearPulses() {
    this.pulses = { error: false, justCompleted: false, celebrate: false };
  }
};

// src/event-normalizer.ts
function asRecord(v) {
  return typeof v === "object" && v !== null ? v : null;
}
function normalizeHermesEvent(raw) {
  try {
    const ev = asRecord(raw);
    if (!ev || typeof ev.type !== "string") return { type: "UNKNOWN" };
    const sessionId = typeof ev.session_id === "string" && ev.session_id ? ev.session_id : void 0;
    const payload = asRecord(ev.payload);
    switch (ev.type) {
      case "message.start":
        return { type: "TURN_STARTED", sessionId };
      case "message.complete": {
        const status = payload?.status;
        if (status === "error" || typeof payload?.error === "string" && payload.error) return { type: "ERROR", sessionId };
        if (status === "interrupted") return { type: "TURN_INTERRUPTED", sessionId };
        return { type: "TURN_COMPLETED", sessionId };
      }
      case "tool.start":
        return { type: "TOOL_STARTED", sessionId, toolName: typeof payload?.name === "string" ? payload.name : void 0 };
      case "tool.complete":
        return { type: "TOOL_COMPLETED", sessionId };
      case "reasoning.delta":
      case "thinking.delta":
        return { type: "REASONING_STARTED", sessionId };
      case "message.delta":
        return { type: "REASONING_ENDED", sessionId };
      case "error":
        return { type: "ERROR", sessionId };
      default:
        return { type: "UNKNOWN" };
    }
  } catch {
    return { type: "UNKNOWN" };
  }
}

// src/hermes-adapter.ts
var isAtom = (v) => !!v && typeof v.get === "function";
function detectCapabilities(host2) {
  const s = host2?.state;
  return {
    busyState: isAtom(s?.busy),
    awaitingResponseState: isAtom(s?.awaitingResponse),
    focusedSessionState: isAtom(s?.focusedSessionId),
    eventStream: typeof host2?.onEvent === "function",
    nativePetState: isAtom(s?.petState)
  };
}
function tierOf(c) {
  if (!c.busyState) return "D";
  if (c.eventStream && c.focusedSessionState) return "A";
  if (c.eventStream) return "B";
  return "C";
}
function createHermesAdapter(host2, ctx, log) {
  const caps = detectCapabilities(host2);
  const disposers = [];
  function watch(atom, cb) {
    const off = atom.subscribe ? atom.subscribe(cb) : atom.listen ? (cb(atom.get()), atom.listen(cb)) : void 0;
    if (off) disposers.push(off);
  }
  return {
    getCapabilities: () => caps,
    start(listener) {
      const emit = (e) => {
        try {
          listener(e);
        } catch (err) {
          log?.(`listener error: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      try {
        if (caps.nativePetState) {
          watch(host2.state.petState, (v) => emit({ type: "NATIVE_STATE", state: typeof v === "string" ? v : null }));
        }
        if (caps.focusedSessionState) {
          watch(host2.state.focusedSessionId, (id) => emit({ type: "FOCUS_CHANGED", sessionId: id ?? null }));
        }
        if (caps.busyState) {
          watch(host2.state.busy, (b) => emit({ type: "BUSY_CHANGED", busy: !!b }));
        }
        if (caps.eventStream) {
          const sub = ctx.onEvent ?? host2.onEvent.bind(host2);
          disposers.push(sub("*", (raw) => emit(normalizeHermesEvent(raw))));
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
        }
      }
    }
  };
}

// src/openpets-adapter.ts
var REACTION_BY_STATE = {
  idle: "idle",
  run: "working",
  review: "thinking",
  waiting: "waiting",
  wave: "waving",
  jump: "celebrating",
  failed: "error"
};
var REQUEST_TIMEOUT_MS = 1500;
var BACKOFF_MS = [5e3, 15e3, 6e4];
function createOpenPetsAdapter(opts) {
  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? ((...a) => fetch(...a));
  let available = true;
  let failures = 0;
  let retryAt = 0;
  let lastSent = null;
  const key = (s, t) => `${s}|${t ?? ""}`;
  const markDown = (why) => {
    const wasUp = available;
    available = false;
    retryAt = now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
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
  async function request(path, init) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      return await doFetch(opts.getUrl().replace(/\/+$/, "") + path, { ...init, signal: ctl?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function send(state, text) {
    try {
      const res = await request("/react", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(text ? { reaction: REACTION_BY_STATE[state], text } : { reaction: REACTION_BY_STATE[state] })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json().catch(() => ({}));
      if (body.ok === false) throw new Error("relay could not reach OpenPets");
      lastSent = key(state, text);
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
        const body = await res.json();
        const up = res.ok && body.ok === true && body.openpets !== false;
        if (up) markUp();
        else markDown("OpenPets not running");
        return up;
      } catch (e) {
        markDown(e instanceof Error ? e.message : "error");
        return false;
      }
    },
    async setState(state, options) {
      try {
        if (key(state, options?.text) === lastSent) return;
        if (!available && now() < retryAt) return;
        await send(state, options?.text);
      } catch {
      }
    },
    async reset() {
      try {
        if (available || now() >= retryAt) await send("idle");
      } catch {
      }
    }
  };
}

// src/pet-state.ts
var TRANSIENT_STATES = /* @__PURE__ */ new Set(["wave", "jump", "failed"]);
function derivePetState(a) {
  if (a.error) return "failed";
  if (a.celebrate) return "jump";
  if (a.justCompleted) return "wave";
  if (a.awaitingInput) return "waiting";
  if (a.toolRunning) return "run";
  if (a.reasoning) return "review";
  if (a.busy) return "run";
  return "idle";
}
function withLiveness(a) {
  return { ...a, toolRunning: a.busy && a.toolRunning, reasoning: a.busy && a.reasoning };
}

// src/state-policy.ts
var StatePolicy = class {
  last = "idle";
  // pet assumed idle at start
  lastDetail;
  detail;
  lastEmitAt = -Infinity;
  transient = null;
  cancelTransient = null;
  cancelPending = null;
  steady = "idle";
  disposed = false;
  o;
  constructor(o) {
    this.o = o;
  }
  update(a) {
    if (this.disposed) return;
    if (a.native) {
      this.clearTransient();
      this.steady = a.native;
      this.schedule();
      return;
    }
    const pulse = this.pulseState(a);
    this.detail = a.busy ? a.toolLabel ?? void 0 : void 0;
    this.steady = derivePetState(withLiveness({ ...a, error: false, celebrate: false, justCompleted: false }));
    if (pulse) this.startTransient(pulse);
    this.schedule();
  }
  /** Current wanted state (transient wins over steady). */
  desired() {
    return this.transient ?? this.steady;
  }
  lastEmitted() {
    return this.last;
  }
  dispose() {
    this.disposed = true;
    this.clearTransient();
    this.cancelPending?.();
    this.cancelPending = null;
  }
  pulseState(a) {
    const anim = this.o.showCompletionAnimation?.() ?? true;
    if (a.error) return "failed";
    if (a.celebrate) return anim ? "jump" : null;
    if (a.justCompleted) return anim ? "wave" : null;
    return null;
  }
  startTransient(state) {
    if (!TRANSIENT_STATES.has(state)) return;
    if (this.transient === "failed" && state !== "failed") return;
    this.cancelTransient?.();
    this.transient = state;
    this.cancelTransient = this.o.timers.setTimeout(() => {
      this.transient = null;
      this.cancelTransient = null;
      this.schedule();
    }, this.o.transientMs ?? 1600);
  }
  clearTransient() {
    this.cancelTransient?.();
    this.cancelTransient = null;
    this.transient = null;
  }
  schedule() {
    if (this.disposed) return;
    this.cancelPending?.();
    this.cancelPending = null;
    const want = this.desired();
    const detail = want === "run" ? this.detail : void 0;
    if (want === this.last && detail === this.lastDetail) return;
    const debounce = this.o.debounceMs ?? 150;
    const dwell = this.o.minDwellMs ?? 400;
    const wait = Math.max(debounce, this.lastEmitAt + dwell - this.o.timers.now());
    this.cancelPending = this.o.timers.setTimeout(() => {
      this.cancelPending = null;
      const state = this.desired();
      const d = state === "run" ? this.detail : void 0;
      if (state === this.last && d === this.lastDetail) return;
      this.last = state;
      this.lastDetail = d;
      this.lastEmitAt = this.o.timers.now();
      try {
        this.o.emit(state, d);
      } catch {
      }
    }, wait);
  }
};

// src/plugin.ts
var ID = "hermes-openpets";
var DEFAULTS = {
  openPetsUrl: "http://127.0.0.1:3001",
  enabled: true,
  showToolActivity: true,
  showCompletionAnimation: true,
  transientDurationMs: 1600,
  debugLogging: false
};
async function loadSettings(storage) {
  try {
    const stored = await Promise.resolve(storage?.get?.("settings"));
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return { ...DEFAULTS, ...parsed && typeof parsed === "object" ? parsed : {} };
  } catch {
    return { ...DEFAULTS };
  }
}
var plugin_default = {
  id: ID,
  name: "OpenPets Bridge",
  register(ctx) {
    try {
      let settings = { ...DEFAULTS };
      const log = (m) => {
        if (settings.debugLogging) console.debug(`[${ID}] ${m}`);
      };
      const caps = detectCapabilities(host);
      const tier = tierOf(caps);
      if (tier === "D") {
        console.warn(`[${ID}] required SDK capability (host.state.busy) missing; output disabled`);
        return;
      }
      const tracker = new ActivityTracker();
      const pets = createOpenPetsAdapter({ getUrl: () => settings.openPetsUrl, log });
      const policy = new StatePolicy({
        timers: {
          now: () => Date.now(),
          setTimeout: (fn, ms) => ctx.setTimeout(fn, ms)
        },
        get transientMs() {
          return settings.transientDurationMs;
        },
        showCompletionAnimation: () => settings.showCompletionAnimation,
        emit: (state, detail) => {
          if (!settings.enabled) return;
          log(`state -> ${state}`);
          void pets.setState(state, { text: settings.showToolActivity ? detail : void 0 });
        }
      });
      const adapter = createHermesAdapter(host, ctx, log);
      adapter.start((ev) => {
        tracker.apply(ev);
        const snap = tracker.snapshot();
        tracker.clearPulses();
        policy.update(tier === "C" ? { ...snap, toolRunning: false, reasoning: false } : snap);
      });
      ctx.onDispose?.(() => {
        adapter.stop();
        policy.dispose();
        void pets.reset();
      });
      void loadSettings(ctx.storage).then((s) => {
        settings = s;
        log(`SDK capabilities: ${JSON.stringify(caps)} tier=${tier} mode=${caps.nativePetState ? "native" : "compatibility"}`);
        void pets.probe();
      });
      ctx.register?.({
        id: "status",
        area: PALETTE_AREA,
        data: {
          id: `${ID}.status`,
          label: "OpenPets: show bridge status",
          keywords: ["openpets", "pet", "bridge"],
          run: async () => {
            const reachable = await pets.probe();
            host.notify({
              kind: reachable ? "info" : "warning",
              message: `OpenPets bridge \u2014 tier ${tier}, ${caps.nativePetState ? "native" : "compatibility"} mode, ${settings.openPetsUrl} ${reachable ? "reachable" : "unreachable"}, pet state: ${policy.lastEmitted() ?? "none"}`
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[${ID}] failed to start:`, err instanceof Error ? err.message : err);
    }
  }
};
export {
  plugin_default as default
};
