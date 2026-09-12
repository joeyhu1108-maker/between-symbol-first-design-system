#!/usr/bin/env python3
"""Relay stable dice readings from the RDK X5 recognizer to the local BETWEEN server.

    ssh sunrise@<board-ip> 'python3 ~/dice/dice_recognizer.py --camera 0 --stereo auto --json --no-window' \\
      | python3 hardware/dice_push.py

Dice are ordered left to right: the left die is the growth die (◒), the right die the relation die (⋔).
A reading is sent once it has held for --stable seconds, then repeated as a heartbeat while it stays,
so the console can tell a live board from a stale one. Uses only the standard library.
"""
import argparse, json, sys, time, urllib.error, urllib.request


def post(url, values):
    body = json.dumps({'values': values}).encode()
    request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    try:
        urllib.request.urlopen(request, timeout=2).read()
    except (urllib.error.URLError, TimeoutError) as error:
        print(f'dice_push: {error}', file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default='http://127.0.0.1:8765/api/dice')
    ap.add_argument('--stable', type=float, default=0.8, help='seconds a reading must hold before it counts')
    ap.add_argument('--heartbeat', type=float, default=1.0, help='resend interval while the reading holds')
    args = ap.parse_args()
    held, since, sent, sent_at = None, 0.0, None, 0.0
    for line in sys.stdin:
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue  # the recognizer also prints human-readable status lines
        dice = sorted((d for d in frame.get('dice', []) if d.get('pips')), key=lambda d: d['xmin'])
        values = [int(d['pips']) for d in dice][:6]
        now = time.time()
        if values != held:
            held, since = values, now
            continue
        if not values or now - since < args.stable:
            continue
        if values != sent or now - sent_at >= args.heartbeat:
            post(args.url, values)
            sent, sent_at = values, now
            print(f'dice {values}', flush=True)


if __name__ == '__main__':
    main()
