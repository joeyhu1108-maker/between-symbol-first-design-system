#!/usr/bin/env bash
# Copy the recognizer + models onto the board over SSH.
set -euo pipefail
HOST="${1:-${RDK_HOST:-192.168.127.10}}"
USER_NAME="${RDK_USER:-sunrise}"
REMOTE="${USER_NAME}@${HOST}"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "push $SRC -> $REMOTE:~/dice"
ssh -o StrictHostKeyChecking=accept-new "$REMOTE" "mkdir -p ~/dice"
scp -r "$SRC/dice_recognizer.py" "$SRC/requirements.txt" "$SRC/install_on_board.sh" "$SRC/models" "$REMOTE:~/dice/"
ssh "$REMOTE" "chmod +x ~/dice/install_on_board.sh ~/dice/dice_recognizer.py && ~/dice/install_on_board.sh"
echo
echo "start on board:"
echo "  ssh $REMOTE"
echo "  python3 ~/dice/dice_recognizer.py --camera 0 --stereo auto --http 8080 --no-window"
