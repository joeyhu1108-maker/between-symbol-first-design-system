#!/bin/zsh
# One local server for the whole piece: symbol console, main game, printer scene and artwork jobs.
cd "$(dirname "$0")"
PORT=${PORT:-8765}
URL="http://127.0.0.1:$PORT/prototype-3d.html"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then open "$URL"; exit 0; fi
for py in ./.venv/bin/python ../.venv/bin/python python3; do
  command -v "$py" >/dev/null 2>&1 && "$py" -c 'import numpy, PIL, reportlab' 2>/dev/null && break
done
(sleep 1; open "$URL") &
PORT=$PORT exec "$py" printer/server.py
