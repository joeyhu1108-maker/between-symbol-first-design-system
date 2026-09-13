#!/bin/zsh
# One local server for the whole piece: symbol console, main game, printer scene and artwork jobs.
cd "$(dirname "$0")"
PORT=${PORT:-8765}
URL="http://127.0.0.1:$PORT/prototype-3d.html"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then open "$URL"; exit 0; fi
seed_python=""
for py in ./.venv/bin/python ../.venv/bin/python python3 "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import numpy, PIL, reportlab' 2>/dev/null; then seed_python="$py"; break; fi
done
if [[ -z "$seed_python" ]]; then
  print '未找到可用的 Python 环境。请安装 printer/requirements.txt 中的依赖后重新启动。'
  exit 1
fi
(sleep 1; open "$URL") &
PORT=$PORT exec "$seed_python" printer/server.py
