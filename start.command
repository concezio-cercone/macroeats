#!/bin/bash
# ============================================================================
#  MacroEats — one-click launcher (macOS)
#  Double-click this file in Finder. First run installs what's needed,
#  then starts the app and opens it in your browser. Later runs just start it.
# ============================================================================

# Always run from this file's folder (double-click starts in home dir otherwise)
cd "$(dirname "$0")" || exit 1

pause() { echo; read -n 1 -s -r -p "Press any key to close this window..."; echo; }

echo "=========================================="
echo "  Starting MacroEats"
echo "=========================================="
echo

# 1) Make sure Node.js is installed — this is the only prerequisite.
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed yet — it's the one thing this needs."
  echo
  echo "  1. Go to https://nodejs.org"
  echo "  2. Download the button that says 'LTS' and run the installer"
  echo "  3. Double-click this file again"
  echo
  pause
  exit 1
fi
echo "Node.js found: $(node --version)"

# 2) Install dependencies the first time only.
if [ ! -d node_modules ]; then
  echo "First run — installing (about 30 seconds, needs internet)..."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "Install failed. Check your internet connection and try again."
    pause
    exit 1
  fi
  echo
  echo "Done installing."
else
  echo "Already set up."
fi

# 3) Open the browser shortly after the server boots.
echo
echo "Opening http://localhost:3000 in your browser..."
( sleep 3; open "http://localhost:3000" >/dev/null 2>&1 ) &

# 4) Run the server in this window. Keep the window open while using the app.
echo "Leave this window open while you use the app."
echo "To stop it: close this window, or press Ctrl-C."
echo "------------------------------------------------------------"
echo
node server.js

# If the server stops or crashes, keep the window open so you can read why.
pause
