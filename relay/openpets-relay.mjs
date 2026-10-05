#!/usr/bin/env node
// hermes-openpets relay: 127.0.0.1 HTTP  ->  OpenPets token-authenticated local IPC.
// Zero dependencies. Needed because a Hermes Desktop plugin runs in a renderer
// and cannot open the Unix socket / read the discovery token OpenPets uses.
//
//   GET  /health            -> {ok:true, openpets:boolean}
//   POST /react  {reaction} -> {ok:boolean}
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.OPENPETS_RELAY_PORT ?? 3001);
const HOST = "127.0.0.1";
const REACTIONS = new Set(["idle", "thinking", "working", "editing", "running", "testing", "waiting", "waving", "success", "error", "celebrating"]);

function discoveryPath() {
  if (process.env.OPENPETS_DISCOVERY_FILE) return process.env.OPENPETS_DISCOVERY_FILE;
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "OpenPets", "runtime", "ipc.json");
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "OpenPets", "runtime", "ipc.json");
  const xdg = process.env.XDG_RUNTIME_DIR;
  return xdg ? join(xdg, "openpets", "ipc.json") : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "OpenPets", "runtime", "ipc.json");
}

function readDiscovery() {
  const p = discoveryPath();
  if (statSync(p).size > 16 * 1024) throw new Error("discovery too large");
  const d = JSON.parse(readFileSync(p, "utf8"));
  if (d.protocol !== "openpets-ipc" || typeof d.endpoint !== "string" || typeof d.token !== "string") throw new Error("bad discovery");
  return d;
}

function connectionFor(endpoint) {
  if (endpoint.startsWith("tcp://")) {
    const u = new URL(endpoint);
    if (!/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) throw new Error("non-local endpoint");
    return createConnection({ host: u.hostname, port: Number(u.port) });
  }
  return createConnection(endpoint);
}

function ipc(method, params) {
  return new Promise((resolve, reject) => {
    let d;
    try {
      d = readDiscovery();
    } catch (e) {
      return reject(e);
    }
    const sock = connectionFor(d.endpoint);
    let buf = "";
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error("timeout")), 3000);
    sock.setEncoding("utf8");
    sock.once("connect", () => sock.write(JSON.stringify({ id: randomUUID(), version: 1, token: d.token, method, params }) + "\n"));
    sock.on("data", (c) => {
      buf += c;
      const i = buf.indexOf("\n");
      if (i < 0) return;
      try {
        const r = JSON.parse(buf.slice(0, i));
        r.ok ? finish(null, r.result) : finish(new Error(r.error?.code ?? "ipc_error"));
      } catch (e) {
        finish(e);
      }
    });
    sock.once("error", finish);
    sock.once("end", () => finish(new Error("closed")));
  });
}

function originAllowed(origin) {
  if (!origin || origin === "null") return true; // Electron file:// / app:// renderers
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" || u.protocol === "https:") return u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return true;
  } catch {
    return false;
  }
}

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (!originAllowed(req.headers.origin)) return send(res, 403, { ok: false });
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    if (req.method === "GET" && req.url === "/health") {
      const up = await ipc("status", {}).then(() => true, () => false);
      return send(res, 200, { ok: true, openpets: up });
    }
    if (req.method === "POST" && req.url === "/react") {
      let raw = "";
      for await (const c of req) {
        raw += c;
        if (raw.length > 1024) return send(res, 413, { ok: false });
      }
      const { reaction } = JSON.parse(raw);
      if (!REACTIONS.has(reaction)) return send(res, 400, { ok: false });
      await ipc("pet.react", { reaction });
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false });
  } catch {
    send(res, 200, { ok: false }); // OpenPets down: report, don't error
  }
});

server.listen(PORT, HOST, () => console.log(`[openpets-relay] listening on http://${HOST}:${PORT}`));
