#!/usr/bin/env bash
set -euo pipefail
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
rm -rf "$HERMES_HOME/desktop-plugins/hermes-openpets"
PLIST="$HOME/Library/LaunchAgents/com.hermes-openpets.relay.plist"
if [ -f "$PLIST" ]; then launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; fi
echo "hermes-openpets removed. (Hermes repo and OpenPets config were never modified.)"
