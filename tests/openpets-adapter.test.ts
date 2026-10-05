import test from "node:test";
import assert from "node:assert/strict";
import { createOpenPetsAdapter } from "../src/openpets-adapter.ts";

const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200 });

test("dedupes, maps reactions, and backs off when unreachable", async () => {
  let t = 0;
  const calls: string[] = [];
  let up = true;
  const adapter = createOpenPetsAdapter({
    getUrl: () => "http://127.0.0.1:3001",
    now: () => t,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${init?.body ?? ""}`);
      if (!up) throw new TypeError("fetch failed");
      return ok();
    }) as typeof fetch,
  });
  await adapter.setState("run");
  await adapter.setState("run");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /"working"/);
  up = false;
  await adapter.setState("wave");
  assert.equal(adapter.isAvailable(), false);
  const n = calls.length;
  await adapter.setState("idle");
  await adapter.setState("run");
  assert.equal(calls.length, n); // no retry storm
  t = 6000;
  up = true;
  await adapter.setState("run");
  assert.equal(adapter.isAvailable(), true);
});
