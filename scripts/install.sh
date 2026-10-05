#!/usr/bin/env bash
# Usage: scripts/install.sh [--dev] [--relay]
#   --dev    symlink dist/plugin.js (rebuilds are picked up live) instead of copying
#   --relay  also install a macOS LaunchAgent that keeps the local relay running
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DEST="$HERMES_HOME/desktop-plugins/hermes-openpets"
DEV=0; RELAY=0
for a in "$@"; do case "$a" in --dev) DEV=1;; --relay) RELAY=1;; *) echo "unknown flag $a"; exit 2;; esac; done

[ -f "$ROOT/dist/plugin.js" ] || (cd "$ROOT" && npm run build)
mkdir -p "$DEST"
rm -f "$DEST/plugin.js"
if [ "$DEV" = 1 ]; then ln -s "$ROOT/dist/plugin.js" "$DEST/plugin.js"; else cp "$ROOT/dist/plugin.js" "$DEST/plugin.js"; fi
echo "plugin -> $DEST/plugin.js"

if [ "$RELAY" = 1 ]; then
  NODE="$(command -v node)"
  PLIST="$HOME/Library/LaunchAgents/com.hermes-openpets.relay.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.hermes-openpets.relay</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/relay/openpets-relay.mjs</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
PL
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "relay LaunchAgent loaded (127.0.0.1:${OPENPETS_RELAY_PORT:-3001})"
else
  echo "relay not installed; run 'node $ROOT/relay/openpets-relay.mjs' or re-run with --relay"
fi
echo "In Hermes Desktop: Cmd+K -> Reload desktop plugins"
