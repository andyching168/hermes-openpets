import { derivePetState, TRANSIENT_STATES, withLiveness, type HermesPetState } from "./pet-state.ts";
import type { ActivitySnapshot } from "./activity-model.ts";

export interface Timers {
  now(): number;
  /** Returns a canceller. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export interface PolicyOptions {
  emit: (state: HermesPetState, detail?: string) => void;
  timers: Timers;
  transientMs?: number;
  debounceMs?: number;
  minDwellMs?: number;
  showCompletionAnimation?: () => boolean;
}

/**
 * Turns activity snapshots into a de-duplicated, debounced stream of pet states.
 * Transient reactions (wave/jump/failed) hold for transientMs, then the steady
 * activity is re-evaluated — never blindly "idle".
 */
export class StatePolicy {
  private last: HermesPetState | null = "idle"; // pet assumed idle at start
  private lastDetail: string | undefined;
  private detail: string | undefined;
  private lastEmitAt = -Infinity;
  private transient: HermesPetState | null = null;
  private cancelTransient: (() => void) | null = null;
  private cancelPending: (() => void) | null = null;
  private steady: HermesPetState = "idle";
  private disposed = false;

  private readonly o: PolicyOptions;

  constructor(o: PolicyOptions) {
    this.o = o;
  }

  update(a: ActivitySnapshot): void {
    if (this.disposed) return;
    if (a.native) {
      this.clearTransient();
      this.steady = a.native;
      this.schedule();
      return;
    }
    const pulse = this.pulseState(a);
    this.detail = a.busy ? (a.toolLabel ?? undefined) : undefined;
    this.steady = derivePetState(withLiveness({ ...a, error: false, celebrate: false, justCompleted: false }));
    if (pulse) this.startTransient(pulse);
    this.schedule();
  }

  /** Current wanted state (transient wins over steady). */
  desired(): HermesPetState {
    return this.transient ?? this.steady;
  }

  lastEmitted(): HermesPetState | null {
    return this.last;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTransient();
    this.cancelPending?.();
    this.cancelPending = null;
  }

  private pulseState(a: ActivitySnapshot): HermesPetState | null {
    const anim = this.o.showCompletionAnimation?.() ?? true;
    if (a.error) return "failed";
    if (a.celebrate) return anim ? "jump" : null;
    if (a.justCompleted) return anim ? "wave" : null;
    return null;
  }

  private startTransient(state: HermesPetState): void {
    if (!TRANSIENT_STATES.has(state)) return;
    // A failure is never downgraded by a later wave/jump.
    if (this.transient === "failed" && state !== "failed") return;
    this.cancelTransient?.();
    this.transient = state;
    this.cancelTransient = this.o.timers.setTimeout(() => {
      this.transient = null;
      this.cancelTransient = null;
      this.schedule();
    }, this.o.transientMs ?? 1600);
  }

  private clearTransient(): void {
    this.cancelTransient?.();
    this.cancelTransient = null;
    this.transient = null;
  }

  private schedule(): void {
    if (this.disposed) return;
    this.cancelPending?.();
    this.cancelPending = null;
    const want = this.desired();
    const detail = want === "run" ? this.detail : undefined;
    if (want === this.last && detail === this.lastDetail) return;
    const debounce = this.o.debounceMs ?? 150;
    const dwell = this.o.minDwellMs ?? 400;
    const wait = Math.max(debounce, this.lastEmitAt + dwell - this.o.timers.now());
    this.cancelPending = this.o.timers.setTimeout(() => {
      this.cancelPending = null;
      const state = this.desired();
      const d = state === "run" ? this.detail : undefined;
      if (state === this.last && d === this.lastDetail) return;
      this.last = state;
      this.lastDetail = d;
      this.lastEmitAt = this.o.timers.now();
      try {
        this.o.emit(state, d);
      } catch {
        /* fail open */
      }
    }, wait);
  }
}
