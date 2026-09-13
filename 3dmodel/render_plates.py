#!/usr/bin/env python3
"""把打印机模型渲染成手绘科学图版（3D 手绘风）。"""
from __future__ import annotations

import pickle
import sys
import time
from pathlib import Path

import numpy as np

import printer_model as pm
import stroke_render as sr

ROOT = Path(__file__).resolve().parent
PREVIEW = ROOT / "preview"
CACHE = ROOT / "out" / "_parts.pkl"

# 手绘图版调色：淡青瓷、淡玫、米黄，唯一的黑给陨石，唯一的朱红给指示灯
# 浅色调：机身近白，只带一点青瓷的凉。内脏必须比机身暗，
# 否则窗口里白压浅色 = 看不见（试过白纸卷，等于没开窗）。
HAND = {
    "shell":      (0.933, 0.945, 0.929),   # 机身：近白微青
    "steel":      (0.800, 0.812, 0.796),   # 金属
    "dark_steel": (0.686, 0.698, 0.674),
    "graphite":   (0.365, 0.361, 0.396),   # 胶辊：窗里的暗调
    "black":      (0.129, 0.118, 0.145),   # 陨石：全场唯一的黑
    "paper":      (0.976, 0.969, 0.941),   # 纸
    "ink":        (0.157, 0.145, 0.161),
    "card":       (0.208, 0.196, 0.243),
    "rose":       (0.851, 0.667, 0.694),   # 淡玫：纸卷轴心
    "sage":       (0.702, 0.769, 0.639),   # 淡青：主板
    "vermillion": (0.839, 0.271, 0.169),   # 朱红：唯一的暖点
    "roll":       (0.878, 0.855, 0.796),   # 纸卷：比机身暗一档才看得见
}
METALS = {"steel", "dark_steel"}
HAND["cavity"] = (0.784, 0.792, 0.776)   # 内腔：窗口后的阴影
GLASS: set[str] = set()   # 壳改为不透明，内脏只从观察窗露出


def build(fresh=False):
    if CACHE.exists() and not fresh:
        return pickle.loads(CACHE.read_bytes())
    parts = pm.build_parts()
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_bytes(pickle.dumps(parts))
    return parts


def styles_for(parts):
    st = {}
    for name in parts:
        m = pm.PART_MAT[name]
        st[name] = {
            "color": HAND[m],
            "alpha": 1.0,
            "smooth": name in ("core", "shell", "roll", "roll_core", "roller", "core_ring", "paper", "base"),
            "metal": 1.0 if m in METALS else 0.0,
        }
    return st


CAPS = {
    "hero":   ("Plate I.  Machina seminis — habitus",   "输出端 · 整机 · 四分之三视"),
    "front":  ("Plate II.  Facies anterior",            "输出端 · 正视 · 出纸口与卡缝"),
    "side":   ("Plate III.  Latus dextrum",             "输出端 · 侧视 · 纸的行程"),
    "top":    ("Plate IV.  Nucleus, a supra visus",     "输出端 · 俯视 · 核"),
    "detail": ("Plate V.  Nucleus et annulus",          "输出端 · 核与托圈 · 局部"),
}


def main():
    fresh = "--fresh" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    parts = build(fresh)
    styles = styles_for(parts)
    order = [n for n in pm.DRAW_ORDER if n in parts]
    PREVIEW.mkdir(exist_ok=True)
    for view in (only or ["hero", "front", "side", "top", "detail"]):
        cap, sub = CAPS[view]
        t0 = time.time()
        out = PREVIEW / f"hand_{view}.png"
        sr.paint(parts, styles, out, view=view, order=order,
                 caption=cap, subcaption=sub, seed=11)
        print(f"  {out.name:20s} {time.time() - t0:5.1f}s")


if __name__ == "__main__":
    np.seterr(all="ignore")
    main()
