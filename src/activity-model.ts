import type { NormalizedEvent } from "./event-normalizer.ts";
import type { ActivityModel, HermesPetState } from "./pet-state.ts";

export interface ActivitySnapshot extends ActivityModel {
  /** Set when Hermes itself publishes a pet state (Native Mode). */
  native: HermesPetState | null;
}

const NATIVE_STATES = new Set<string>(["idle", "wave", "run", "failed", "review", "jump", "waiting"]);

/**
 * Folds normalized events into an ActivityModel. error / justCompleted / celebrate
 * are one-shot "pulses": drained by the caller after each snapshot.
 */
export class ActivityTracker {
  private focused: string | null = null;
  private busy = false;
  private tools = 0;
  private reasoning = false;
  private native: HermesPetState | null = null;
  private pulses = { error: false, justCompleted: false, celebrate: false };

  apply(ev: NormalizedEvent): void {
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
        this.native = ev.state && NATIVE_STATES.has(ev.state) ? (ev.state as HermesPetState) : null;
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
  private accepts(sessionId?: string): boolean {
    return !this.focused || !sessionId || sessionId === this.focused;
  }

  private resetLive(): void {
    this.tools = 0;
    this.reasoning = false;
  }

  snapshot(): ActivitySnapshot {
    return {
      sessionId: this.focused,
      busy: this.busy,
      awaitingInput: false, // v0.3: only with a public SDK signal for approval/clarify
      toolRunning: this.tools > 0,
      reasoning: this.reasoning,
      error: this.pulses.error,
      justCompleted: this.pulses.justCompleted,
      celebrate: this.pulses.celebrate,
      native: this.native,
    };
  }

  clearPulses(): void {
    this.pulses = { error: false, justCompleted: false, celebrate: false };
  }
}
