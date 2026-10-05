#!/usr/bin/env bash
# Prints diagnostics only: never prompts, tool args, tool output or secrets.
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN="$HERMES_HOME/desktop-plugins/hermes-openpets/plugin.js"
URL="${OPENPETS_URL:-http://127.0.0.1:3001}"
echo "hermes-openpets"
echo; echo "Plugin:"
[ -e "$PLUGIN" ] && echo "  installed: yes ($([ -L "$PLUGIN" ] && echo symlink || echo copy))" || echo "  installed: no ($PLUGIN)"
echo; echo "Hermes SDK / mode / activity:"
echo "  shown in-app: Cmd+K -> 'OpenPets: show bridge status'"
echo; echo "OpenPets relay:"
echo "  URL: $URL"
H="$(curl -s -m 2 "$URL/health" || true)"
case "$H" in
  *'"openpets":true'*)  echo "  relay reachable: yes"; echo "  OpenPets reachable: yes";;
  *'"openpets":false'*) echo "  relay reachable: yes"; echo "  OpenPets reachable: NO (is OpenPets running?)";;
  *)                    echo "  relay reachable: NO (start: node relay/openpets-relay.mjs, or install.sh --relay)";;
esac
