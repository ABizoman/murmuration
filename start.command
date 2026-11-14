#!/bin/bash
# Double-click to run Murmuration: the signalling server, which also hosts the page.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed: install it from https://nodejs.org (or: brew install node), then run this again."
  read -n 1 -s -r -p "Press any key to close"
  exit 1
fi

# Stop a previous Murmuration server still holding port 8000.
lsof -ti tcp:8000 | xargs kill 2>/dev/null

[ -d node_modules ] || npm install --no-audit --no-fund
node server.js
