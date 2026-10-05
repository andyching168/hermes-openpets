import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHermesEvent } from "../src/event-normalizer.ts";
import { ActivityTracker } from "../src/activity-model.ts";

test("normalizes known events", () => {
  assert.deepEqual(normalizeHermesEvent({ type: "message.start", session_id: "s1" }), { type: "TURN_STARTED", sessionId: "s1" });
  assert.equal(normalizeHermesEvent({ type: "message.complete", payload: {} }).type, "TURN_COMPLETED");
  assert.equal(normalizeHermesEvent({ type: "message.complete", payload: { status: "error" } }).type, "ERROR");
  assert.equal(normalizeHermesEvent({ type: "message.complete", payload: { status: "interrupted" } }).type, "TURN_INTERRUPTED");
  assert.equal(normalizeHermesEvent({ type: "tool.start", payload: { name: "terminal" } }).type, "TOOL_STARTED");
  assert.equal(normalizeHermesEvent({ type: "reasoning.delta" }).type, "REASONING_STARTED");
  assert.equal(normalizeHermesEvent({ type: "error" }).type, "ERROR");
});

test("never throws on garbage", () => {
  for (const v of [null, undefined, 1, "x", {}, { type: 5 }, { type: "message.complete", payload: 7 }]) {
    assert.doesNotThrow(() => normalizeHermesEvent(v));
  }
  assert.equal(normalizeHermesEvent({ type: "weird.new.event" }).type, "UNKNOWN");
});

test("session filtering: background sessions ignored, unknown identity degrades to global", () => {
  const t = new ActivityTracker();
  t.apply({ type: "FOCUS_CHANGED", sessionId: "A" });
  t.apply({ type: "TOOL_STARTED", sessionId: "B" });
  assert.equal(t.snapshot().toolRunning, false);
  t.apply({ type: "TOOL_STARTED", sessionId: "A" });
  assert.equal(t.snapshot().toolRunning, true);
  t.apply({ type: "TOOL_COMPLETED" });
  assert.equal(t.snapshot().toolRunning, false);
});

test("completion pulses once; busy=false clears stale flags", () => {
  const t = new ActivityTracker();
  t.apply({ type: "BUSY_CHANGED", busy: true });
  t.apply({ type: "TOOL_STARTED" });
  t.apply({ type: "BUSY_CHANGED", busy: false });
  assert.equal(t.snapshot().toolRunning, false);
  t.apply({ type: "TURN_COMPLETED" });
  assert.equal(t.snapshot().justCompleted, true);
  t.clearPulses();
  assert.equal(t.snapshot().justCompleted, false);
});

import { toolLabel } from "../src/tool-label.ts";
import { StatePolicy } from "../src/state-policy.ts";

test("tool labels are sanitized categories only", () => {
  assert.equal(toolLabel("terminal"), "Running terminal…");
  assert.equal(toolLabel("web_search"), "Searching…");
  assert.equal(toolLabel("browser_click"), "Using browser…");
  assert.equal(toolLabel("my_secret_internal_tool /home/x --token=abc"), "Working…");
});

test("snapshot carries label only while a tool runs; policy re-emits on tool change", () => {
  const t = new ActivityTracker();
  t.apply({ type: "BUSY_CHANGED", busy: true });
  assert.equal(t.snapshot().toolLabel, null);
  t.apply({ type: "TOOL_STARTED", toolName: "terminal" });
  assert.equal(t.snapshot().toolLabel, "Running terminal…");

  let now = 0;
  const q: Array<[number, () => void]> = [];
  const out: Array<[string, string | undefined]> = [];
  const p = new StatePolicy({
    timers: { now: () => now, setTimeout: (fn, ms) => (q.push([now + ms, fn]), () => {}) },
    emit: (s, d) => out.push([s, d]),
  });
  const run = (to: number) => { now = to; q.splice(0).forEach(([, f]) => f()); };
  p.update(t.snapshot()); run(500);
  t.apply({ type: "TOOL_COMPLETED" }); t.apply({ type: "TOOL_STARTED", toolName: "web_search" });
  p.update(t.snapshot()); run(1500);
  assert.deepEqual(out, [["run", "Running terminal…"], ["run", "Searching…"]]);
});
