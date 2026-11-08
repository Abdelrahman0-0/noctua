#!/bin/sh
# Mac / Linux launcher. Run: sh start.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org"; exit 1; }
if [ ! -f .setup-done ]; then
  echo "First time setup..."
  npm install && npx playwright install chromium && echo done > .setup-done || { echo "Setup failed. Check your internet."; exit 1; }
fi
node app.mjs
