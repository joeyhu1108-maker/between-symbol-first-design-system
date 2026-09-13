#!/usr/bin/env python3
"""
用 Bambu Studio 命令行无界面切片：STL → 可打印的 .gcode.3mf

已在 Bambu Studio 02.08.02.61 / macOS 上实测通过。

两个实测得出的坑（都已在本脚本内规避）：
  1. --export-3mf 必须给绝对路径。相对路径会在写 .tmp 中间文件时
     报 "Unable to open the file"，而此时 gcode 其实已经切好了。
  2. 工艺细节（支撑、填充、层高…）无法从命令行覆盖 —— CLI 只有 57 个参数，
     不含 --enable-support。要改工艺必须派生一份预设 json，
     本脚本的 --support 即为此自动生成。

另外刻意不使用 --orient：种子的底面是在 SDF 阶段特意削平的，
交给切片器自动摆正有可能推翻这个设计。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

BS_APP = Path("/Applications/BambuStudio.app/Contents/MacOS/BambuStudio")
SYS_BBL = Path.home() / "Library/Application Support/BambuStudio/system/BBL"

HERE = Path(__file__).resolve().parent
PRESET_DIR = HERE / "presets"
OUT_DIR = HERE / "out"


def sys_preset(kind: str, name: str) -> Path:
    p = SYS_BBL / kind / f"{name}.json"
    if not p.is_file():
        sys.exit(f"找不到预设: {p}")
    return p


def make_support_preset(base: Path, tag: str = "seed_support") -> Path:
    """派生一份开启树形支撑的工艺预设（CLI 无法直接覆盖工艺参数）。"""
    d = json.loads(base.read_text(encoding="utf-8"))
    d["name"] = f"{tag} @derived"
    d["enable_support"] = "1"
    d["support_type"] = "tree(auto)"  # 树形：接触点少，有机曲面好剥离
    d["support_threshold_angle"] = "30"
    d["support_top_z_distance"] = "0.2"
    PRESET_DIR.mkdir(parents=True, exist_ok=True)
    out = PRESET_DIR / f"{tag}.json"
    out.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def slice_one(
    stl: Path,
    machine: str,
    process: str,
    filament: str,
    support: bool,
    outdir: Path,
) -> dict:
    if not BS_APP.is_file():
        sys.exit(f"找不到 Bambu Studio: {BS_APP}")

    m = sys_preset("machine", machine)
    pr = sys_preset("process", process)
    fl = sys_preset("filament", filament)
    if support:
        pr = make_support_preset(pr)

    outdir.mkdir(parents=True, exist_ok=True)
    # 必须绝对路径，否则 .tmp 写入失败
    target = (outdir / f"{stl.stem}.gcode.3mf").resolve()
    if target.exists():
        target.unlink()

    cmd = [
        str(BS_APP),
        "--debug", "1",
        "--load-settings", f"{m};{pr}",
        "--load-filaments", str(fl),
        "--arrange", "1",
        "--slice", "0",
        "--export-3mf", str(target),
        str(stl.resolve()),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if not target.is_file():
        tail = "\n".join(
            l for l in (res.stdout + res.stderr).splitlines()
            if any(k in l.lower() for k in ("error", "fail", "unable"))
        )[-1200:]
        sys.exit(f"切片失败 {stl.name}\n{tail}")

    return read_slice_info(target)


def read_slice_info(three_mf: Path) -> dict:
    """从 3mf 里读拓竹自己写的切片元数据 —— 比任何外部估算都准。"""
    info = {"file": three_mf.name, "size_mb": round(three_mf.stat().st_size / 1e6, 1)}
    with zipfile.ZipFile(three_mf) as z:
        names = z.namelist()
        info["has_plate_gcode"] = "Metadata/plate_1.gcode" in names
        try:
            import re

            raw = z.read("Metadata/slice_info.config").decode("utf-8", "replace")
            for key in ("prediction", "support_used", "outside", "weight"):
                m = re.search(rf'key="{key}" value="([^"]*)"', raw)
                if m:
                    info[key] = m.group(1)
            m = re.search(r'used_m="([\d.]+)"', raw)
            if m:
                info["used_m"] = m.group(1)
        except KeyError:
            pass
        # 层数与时间从 gcode 头拿
        if info["has_plate_gcode"]:
            with z.open("Metadata/plate_1.gcode") as fh:
                head = fh.read(4096).decode("utf-8", "replace")
            for marker, key in (
                ("total layer number:", "layers"),
                ("total estimated time:", "eta"),
            ):
                for l in head.splitlines():
                    if marker in l:
                        # 必须按 marker 切分，不能 split(":", 1)：
                        # gcode 里这一行是 "; model printing time: 32m 24s;
                        # total estimated time: 32m 25s"，首个冒号会带出前半段。
                        info[key] = l.split(marker, 1)[1].strip().rstrip(";")
                        break
    secs = int(info.get("prediction", 0) or 0)
    if secs:
        info["eta_hms"] = f"{secs//3600}h{secs%3600//60:02d}m" if secs >= 3600 else f"{secs//60}m{secs%60:02d}s"
    return info


def main():
    ap = argparse.ArgumentParser(description="Bambu Studio 无界面切片")
    ap.add_argument("stl", nargs="*", help="STL 路径；省略则切 stl/ 下全部")
    ap.add_argument("--machine", default="Bambu Lab H2S 0.4 nozzle")
    ap.add_argument("--process", default="0.20mm Standard @BBL H2S")
    ap.add_argument("--filament", default="Bambu PLA Basic @BBL H2S")
    ap.add_argument("--support", action="store_true", help="开启树形支撑（星环需要）")
    ap.add_argument("--outdir", default=str(OUT_DIR))
    args = ap.parse_args()

    files = [Path(s) for s in args.stl] if args.stl else sorted((HERE / "stl").glob("*.stl"))
    if not files:
        sys.exit("没有找到 STL，先运行 generate_seeds.py")

    outdir = Path(args.outdir)
    rows = []
    for f in files:
        if not f.is_file():
            print(f"跳过（不存在）: {f}")
            continue
        print(f"切片 {f.name} … ", end="", flush=True)
        info = slice_one(f, args.machine, args.process, args.filament, args.support, outdir)
        print(
            f"{info.get('eta_hms', info.get('eta','?'))}  "
            f"{info.get('layers','?')} 层  "
            f"{info.get('used_m','?')} m 料  "
            f"支撑={info.get('support_used','?')}  "
            f"超出构建体积={info.get('outside','?')}"
        )
        rows.append(info)

    (HERE / "slice_report.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    bad = [r["file"] for r in rows if not r.get("has_plate_gcode") or r.get("outside") == "true"]
    print()
    if bad:
        print(f"❌ 有问题: {', '.join(bad)}")
    else:
        print(f"✅ {len(rows)} 件切片完成 → {outdir}")
        print("   下一步: ../.venv/bin/python bambu.py print out/<文件>.gcode.3mf --confirm")


if __name__ == "__main__":
    main()
