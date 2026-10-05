// hermes-openpets' own compatibility types. Not imported from Hermes.
export type HermesPetState = "idle" | "wave" | "run" | "failed" | "review" | "jump" | "waiting";

export interface ActivityModel {
  sessionId: string | null;
  busy: boolean;
  awaitingInput: boolean;
  toolRunning: boolean;
  reasoning: boolean;
  error: boolean;
  justCompleted: boolean;
  celebrate: boolean;
}

export const TRANSIENT_STATES: ReadonlySet<HermesPetState> = new Set(["wave", "jump", "failed"]);

/** error > celebrate > justCompleted > awaitingInput > toolRunning > reasoning > busy > idle */
export function derivePetState(a: ActivityModel): HermesPetState {
  if (a.error) return "failed";
  if (a.celebrate) return "jump";
  if (a.justCompleted) return "wave";
  if (a.awaitingInput) return "waiting";
  if (a.toolRunning) return "run";
  if (a.reasoning) return "review";
  if (a.busy) return "run";
  return "idle";
}

/** Stale protection: tool/reasoning flags only count while the turn is busy. */
export function withLiveness(a: ActivityModel): ActivityModel {
  return { ...a, toolRunning: a.busy && a.toolRunning, reasoning: a.busy && a.reasoning };
}
