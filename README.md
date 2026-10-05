# hermes-openpets

A local-only Hermes Desktop plugin that mirrors Hermes agent activity to
[OpenPets](https://openpets.dev) — with **zero changes to Hermes** and nothing
installed on the remote Hermes server.

```
Remote Hermes Server ──(normal protocol)──▶ Hermes Desktop
                                               │ public Plugin SDK only
                                          hermes-openpets (plugin.js)
                                               │ HTTP, 127.0.0.1 only
                                          openpets-relay (tiny local process)
                                               │ OpenPets local IPC (token)
                                            OpenPets 🐾
```

## Why a relay?
OpenPets exposes only a token-authenticated Unix-socket IPC (no HTTP port), and a
Hermes plugin runs in a renderer that cannot open sockets or read the token file.
`relay/openpets-relay.mjs` (~120 lines, no dependencies) bridges
`127.0.0.1:3001` → OpenPets IPC. It only accepts a fixed set of reaction names,
binds loopback only, and rejects non-local browser origins. Everything stays on
your Mac.

## Install
```bash
npm install && npm run build
scripts/install.sh --relay          # copy plugin + LaunchAgent for the relay
# or for development (live symlink):  scripts/install.sh --dev
```
Then in Hermes Desktop: **⌘K → Reload desktop plugins**. Without `--relay`, run
`node relay/openpets-relay.mjs` yourself. Port: `OPENPETS_RELAY_PORT` (default 3001).

## Uninstall
```bash
scripts/uninstall.sh
```
Or just disable it in Hermes **Settings → Plugins**.

## Diagnostics
```bash
scripts/doctor.sh
```
In-app: **⌘K → "OpenPets: show bridge status"** (tier, mode, reachability, current
pet state). Enable `debugLogging` in plugin storage for `[hermes-openpets]` logs.

## Behaviour
| Hermes activity | Pet |
|---|---|
| idle | idle |
| busy / tool running | working |
| reasoning | thinking |
| turn complete | waving (1.6 s) → re-evaluated |
| error / failed turn | error (1.6 s) → re-evaluated |

Compatibility tiers are chosen by feature detection (never version numbers):
A (busy + events + focused session), B (busy + events), C (busy only → idle/working),
D (unsupported → disabled, logged). If Hermes later exposes `host.state.petState`,
Native Mode is used automatically. `waiting` is intentionally not emitted until a
public SDK signal for approval/clarify exists (v0.3). Only the focused session
drives the pet. No prompts, args, paths or tool output are ever sent.

Fail-open: any error (OpenPets down, schema change, exception) is swallowed;
repeated failures back off (5 s → 15 s → 60 s) instead of retrying in a loop.

## Settings (`ctx.storage` key `settings`)
`openPetsUrl` (http://127.0.0.1:3001), `enabled`, `showToolActivity`,
`showCompletionAnimation`, `transientDurationMs` (1600), `debugLogging`.

## Develop
`npm test` · `npm run typecheck` · `npm run build` → `dist/plugin.js` (single ESM file, no runtime deps).
