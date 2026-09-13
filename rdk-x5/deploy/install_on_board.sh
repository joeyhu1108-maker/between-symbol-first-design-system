#!/usr/bin/env bash
# Run ON the RDK X5 after Ubuntu is booted.
set -euo pipefail
cd "$(dirname "$0")"

sudo apt-get update
sudo apt-get install -y python3-pip python3-opencv python3-numpy v4l-utils

python3 -m pip install --user -U pip
# tflite_runtime wheel for Ubuntu 22.04 aarch64 / py3.10
if ! python3 -c "import tflite_runtime" 2>/dev/null; then
  python3 -m pip install --user tflite-runtime || python3 -m pip install --user ai-edge-litert || true
fi
python3 -c "import cv2, numpy; print('opencv', cv2.__version__)"
python3 - <<'PY'
try:
    from tflite_runtime.interpreter import Interpreter
    print("tflite_runtime ok")
except Exception:
    try:
        from ai_edge_litert.interpreter import Interpreter
        print("ai_edge_litert ok")
    except Exception as e:
        print("WARNING: no tflite interpreter:", e)
PY

echo "== cameras =="
v4l2-ctl --list-devices || true
ls -l /dev/video* 2>/dev/null || echo "no /dev/video* yet (plug USB camera)"

chmod +x dice_recognizer.py
echo
echo "run:"
echo "  python3 $(pwd)/dice_recognizer.py --camera 0 --stereo auto --http 8080 --no-window"
echo "then open http://<board-ip>:8080/stream"
