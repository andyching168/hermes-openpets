import test from "node:test";
import assert from "node:assert/strict";
import { StatePolicy, type Timers } from "../src/state-policy.ts";
import { ActivityTracker } from "../src/activity-model.ts";
import type { HermesPetState } from "../src/pet-state.ts";

function fakeClock() {
  let t = 0;
  const q: Array<{ at: number; fn: () => void; dead: boolean }> = [];
  const timers: Timers = {
    now: () => t,
    setTimeout(fn, ms) {
      const e = { at: t + ms, fn, dead: false };
      q.push(e);
      return () => void (e.dead = true);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = q.filter((e) => !e.dead && e.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = next.at;
      next.dead = true;
      next.fn();
    }
    t = end;
  };
  return { timers, advance };
}

function setup() {
  const clock = fakeClock();
  const out: HermesPetState[] = [];
  const policy = new StatePolicy({ timers: clock.timers, emit: (s) => out.push(s) });
  const tracker = new ActivityTracker();
  const feed = (ev: Parameters<ActivityTracker["apply"]>[0]) => {
    tracker.apply(ev);
    const snap = tracker.snapshot();
    tracker.clearPulses();
    policy.update(snap);
  };
  return { clock, out, feed };
}

test("busy -> run, completion -> wave -> idle after 1600ms", () => {
  const { clock, out, feed } = setup();
  feed({ type: "BUSY_CHANGED", busy: true });
  clock.advance(500);
  feed({ type: "TURN_COMPLETED" });
  feed({ type: "BUSY_CHANGED", busy: false });
  clock.advance(500);
  assert.deepEqual(out, ["run", "wave"]);
  clock.advance(1600);
  assert.deepEqual(out, ["run", "wave", "idle"]);
});

test("duplicate state is not re-sent", () => {
  const { clock, out, feed } = setup();
  feed({ type: "BUSY_CHANGED", busy: true });
  clock.advance(500);
  feed({ type: "TOOL_STARTED" });
  feed({ type: "TOOL_COMPLETED" });
  clock.advance(1000);
  assert.deepEqual(out, ["run"]);
});

test("rapid idle->run->idle flicker is debounced away", () => {
  const { clock, out, feed } = setup();
  feed({ type: "BUSY_CHANGED", busy: true });
  clock.advance(20);
  feed({ type: "BUSY_CHANGED", busy: false });
  clock.advance(1000);
  assert.deepEqual(out, []);
});

test("error while still busy: failed, then back to run (not idle)", () => {
  const { clock, out, feed } = setup();
  feed({ type: "BUSY_CHANGED", busy: true });
  clock.advance(500);
  feed({ type: "TOOL_COMPLETED", error: true });
  clock.advance(500);
  assert.deepEqual(out, ["run", "failed"]);
  clock.advance(1600);
  assert.deepEqual(out, ["run", "failed", "run"]);
});

test("a wave never downgrades an active failure", () => {
  const { clock, out, feed } = setup();
  feed({ type: "ERROR" });
  clock.advance(500);
  feed({ type: "TURN_COMPLETED" });
  clock.advance(500);
  assert.deepEqual(out, ["failed"]);
});

test("native state overrides compatibility derivation", () => {
  const { clock, out, feed } = setup();
  feed({ type: "BUSY_CHANGED", busy: true });
  feed({ type: "NATIVE_STATE", state: "review" });
  clock.advance(500);
  assert.deepEqual(out, ["review"]);
});
