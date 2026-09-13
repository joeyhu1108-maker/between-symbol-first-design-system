#!/usr/bin/env bash
# Poll until the RDK X5 is reachable over USB gadget, Ethernet, or SSH.
set -euo pipefail
TARGETS=(192.168.128.10 192.168.127.10)
USER_NAME="${RDK_USER:-sunrise}"

echo "waiting for RDK X5 (USB gadget 192.168.128.10 / ethernet 192.168.127.10 / USB serial)..."
echo "plug: USB-C data cable into the board Type-C device port, or Ethernet, or serial."

for i in $(seq 1 120); do
  if diskutil list external physical 2>/dev/null | grep -q disk; then
    echo "external disk present (SD reader?). run scripts/flash_ubuntu.sh"
  fi
  for ip in "${TARGETS[@]}"; do
    if ping -c 1 -W 500 "$ip" >/dev/null 2>&1; then
      echo "PING $ip"
      if nc -z -G 2 "$ip" 22 >/dev/null 2>&1; then
        echo "SSH $USER_NAME@$ip"
        echo "try: ssh $USER_NAME@$ip"
        exit 0
      fi
    fi
  done
  # USB serial (CH340 debug UART)
  for dev in /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.SLAB*; do
    [[ -e "$dev" ]] || continue
    echo "serial $dev  115200 8N1  login root/root"
    exit 0
  done
  # USB gadget ethernet interface without IP yet
  if ifconfig | grep -q "192.168.128"; then
    echo "USB gadget interface is up"
  fi
  sleep 2
done
echo "board not seen after 4 minutes" >&2
exit 1
