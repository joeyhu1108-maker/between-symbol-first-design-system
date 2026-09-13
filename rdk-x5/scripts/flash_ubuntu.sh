#!/usr/bin/env bash
# Flash official RDK X5 Ubuntu 22.04 Desktop 3.5.0 onto a Micro SD card from macOS.
set -euo pipefail

IMG_XZ="${IMG_XZ:-$HOME/Downloads/rdk-x5/rdk-x5-ubuntu22-preinstalled-desktop-3.5.0-arm64.img.xz}"
IMG="${IMG_XZ%.xz}"
EXPECTED_XZ=2768107136
EXPECTED_MD5=b39cd58ab65e838929063e4f1e184d0b

die() { echo "error: $*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin ]] || die "this flash helper is for macOS (uses diskutil)"
[[ -f "$IMG_XZ" ]] || die "image not found: $IMG_XZ"
size=$(stat -f%z "$IMG_XZ")
[[ "$size" == "$EXPECTED_XZ" ]] || die "incomplete image: $size bytes (want $EXPECTED_XZ). wait for download."

echo "== md5 =="
got=$(md5 -q "$IMG_XZ")
[[ "$got" == "$EXPECTED_MD5" ]] || die "md5 mismatch: $got != $EXPECTED_MD5"

if [[ ! -f "$IMG" ]]; then
  echo "== decompress (python lzma) =="
  python3 - "$IMG_XZ" "$IMG" <<'PY'
import lzma, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
with lzma.open(src, "rb") as fsrc, open(dst, "wb") as fdst:
    shutil.copyfileobj(fsrc, fdst)
print("wrote", dst)
PY
fi

echo "== removable disks =="
diskutil list external physical
mapfile=$(diskutil list external physical | awk '/^\/dev\/disk[0-9]+/ {print $1}')
# bash 3.2 on mac has no mapfile reliably with that; collect manually
disks=()
while IFS= read -r line; do
  disks+=("$line")
done < <(diskutil list external physical | awk '/^\/dev\/disk[0-9]+ \(external, physical\)/ {print $1}')

if [[ ${#disks[@]} -eq 0 ]]; then
  die "no external disk. insert a Micro SD (>=16GB) in a USB reader."
fi

echo "candidates:"
i=1
for d in "${disks[@]}"; do
  echo "  [$i] $d"
  diskutil info "$d" | awk '/Device \/ Media Name|Disk Size|Volume Name|Protocol/ {print "      "$0}'
  i=$((i+1))
done

if [[ $# -ge 1 ]]; then
  DEV="$1"
else
  if [[ ${#disks[@]} -eq 1 ]]; then
    DEV="${disks[0]}"
  else
    die "pass the target disk explicitly, e.g. $0 /dev/disk4"
  fi
fi

[[ "$DEV" == /dev/disk* ]] || die "refusing $DEV (must be /dev/diskN)"
[[ "$DEV" != /dev/disk0 ]] || die "refusing to flash disk0 (internal)"
diskutil info "$DEV" | grep -q "Internal.*No\|Protocol.*USB\|Protocol.*Secure Digital" \
  || echo "warning: could not confirm USB/SD protocol; double-check $DEV" >&2

echo
echo "ABOUT TO ERASE AND FLASH:"
echo "  image: $IMG"
echo "  disk : $DEV"
diskutil info "$DEV" | awk '/Device \/ Media Name|Disk Size|Protocol|Volume Name/ {print "  "$0}'
echo
read -r -p "type FLASH to continue: " ans
[[ "$ans" == FLASH ]] || die "aborted"

echo "== unmount =="
diskutil unmountDisk "$DEV"
RAW="/dev/r${DEV#/dev/}"
echo "== dd $IMG -> $RAW (sudo) =="
sudo dd if="$IMG" of="$RAW" bs=4m status=progress
sync
echo "== eject =="
diskutil eject "$DEV"
echo "done. insert the SD into the RDK X5, connect HDMI if you have a screen, then power on."
echo "default accounts: sunrise/sunrise  and  root/root"
echo "wired IP 192.168.127.10   USB gadget IP 192.168.128.10"
