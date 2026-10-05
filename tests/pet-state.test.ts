import test from "node:test";
import assert from "node:assert/strict";
import { derivePetState, withLiveness, type ActivityModel } from "../src/pet-state.ts";

const base: ActivityModel = { sessionId: null, busy: false, awaitingInput: false, toolRunning: false, reasoning: false, error: false, justCompleted: false, celebrate: false };
const d = (o: Partial<ActivityModel>) => derivePetState({ ...base, ...o });

test("single flags", () => {
  assert.equal(d({}), "idle");
  assert.equal(d({ busy: true }), "run");
  assert.equal(d({ reasoning: true }), "review");
  assert.equal(d({ toolRunning: true }), "run");
  assert.equal(d({ awaitingInput: true }), "waiting");
  assert.equal(d({ justCompleted: true }), "wave");
  assert.equal(d({ celebrate: true }), "jump");
  assert.equal(d({ error: true }), "failed");
});

test("priority chain", () => {
  assert.equal(d({ error: true, celebrate: true }), "failed");
  assert.equal(d({ celebrate: true, justCompleted: true }), "jump");
  assert.equal(d({ justCompleted: true, awaitingInput: true }), "wave");
  assert.equal(d({ awaitingInput: true, toolRunning: true }), "waiting");
  assert.equal(d({ toolRunning: true, reasoning: true }), "run");
  assert.equal(d({ reasoning: true, busy: true }), "review");
});

test("stale protection: tool/reasoning ignored when not busy", () => {
  const live = withLiveness({ ...base, busy: false, toolRunning: true, reasoning: true });
  assert.equal(derivePetState(live), "idle");
  assert.equal(derivePetState(withLiveness({ ...base, busy: true, toolRunning: true })), "run");
});
