#!/bin/zsh
cd "$(dirname "$0")"
if curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  open 'http://127.0.0.1:8765/input'
  exit 0
fi
(sleep 1; open 'http://127.0.0.1:8765/input') &
../../.venv/bin/python server.py
