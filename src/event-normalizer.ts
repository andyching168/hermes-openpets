export type NormalizedEvent =
  | { type: "TURN_STARTED"; sessionId?: string }
  | { type: "TURN_COMPLETED"; sessionId?: string }
  | { type: "TURN_INTERRUPTED"; sessionId?: string }
  | { type: "TOOL_STARTED"; sessionId?: string; toolName?: string }
  | { type: "TOOL_COMPLETED"; sessionId?: string; error?: boolean }
  | { type: "REASONING_STARTED"; sessionId?: string }
  | { type: "REASONING_ENDED"; sessionId?: string }
  | { type: "ERROR"; sessionId?: string }
  | { type: "BUSY_CHANGED"; busy: boolean }
  | { type: "FOCUS_CHANGED"; sessionId: string | null }
  | { type: "NATIVE_STATE"; state: string | null }
  | { type: "UNKNOWN" };

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** The only place that knows Hermes' raw gateway event schema. Never throws. */
export function normalizeHermesEvent(raw: unknown): NormalizedEvent {
  try {
    const ev = asRecord(raw);
    if (!ev || typeof ev.type !== "string") return { type: "UNKNOWN" };
    const sessionId = typeof ev.session_id === "string" && ev.session_id ? ev.session_id : undefined;
    const payload = asRecord(ev.payload);
    switch (ev.type) {
      case "message.start":
        return { type: "TURN_STARTED", sessionId };
      case "message.complete": {
        const status = payload?.status;
        if (status === "error" || (typeof payload?.error === "string" && payload.error)) return { type: "ERROR", sessionId };
        if (status === "interrupted") return { type: "TURN_INTERRUPTED", sessionId };
        return { type: "TURN_COMPLETED", sessionId };
      }
      case "tool.start":
        return { type: "TOOL_STARTED", sessionId, toolName: typeof payload?.name === "string" ? payload.name : undefined };
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
