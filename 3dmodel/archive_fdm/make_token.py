#!/usr/bin/env python3
"""
生成一枚微型测试标本（约 2 分钟打完），用于验证整条下发链路。

不是随便一个测试方块：它是《星环中的萌生》里那枚种子的压扁版 ——
同一套 band_noise 表面语言，直径 24mm、高 1.2mm 的薄片，
6 层就能打完，用最低成本验证"生成 → 切片 → 下发 → 打印"全链路。
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from skimage import measure

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_seeds import band_noise, sdf_to_mesh  # 复用同一套噪声与网格化


def token_sdf(n_xy=224, n_z=48, seed=101):
    """扁平圆盘 + 噪声边缘 + 微拱顶面。"""
    xs = np.linspace(-1.35, 1.35, n_xy, dtype=np.float32)
    zs = np.linspace(-0.42, 0.42, n_z, dtype=np.float32)
    X = xs.reshape(-1, 1, 1)
    Y = xs.reshape(1, -1, 1)
    Z = zs.reshape(1, 1, -1)
    spacing = (xs[1] - xs[0], xs[1] - xs[0], zs[1] - zs[0])
    origin = (xs[0], xs[0], zs[0])

    rho = np.sqrt(X * X + Y * Y)
    np.maximum(rho, 1e-6, out=rho)

    # 用极角驱动噪声，让边缘不规则（与种子同源的形态语言）
    theta = np.arctan2(Y, X)

    def dot(nrm):
        # 把方向向量投到圆周上，复用 band_noise 的接口
        return np.cos(theta) * nrm[0] + np.sin(theta) * nrm[1]

    R = 1.0 + band_noise(dot, seed, octaves=3, base_freq=2.4, amp=0.085)

    # 侧壁
    side = rho - R
    # 顶面微拱：中心略高，边缘略低
    dome = 0.30 - 0.10 * (rho / np.maximum(R, 1e-6)) ** 2
    top = Z - dome
    bottom = -0.30 - Z  # 平底，贴热床

    sdf = np.maximum(np.maximum(side, top), bottom)

    # 顶面压一道浅浅的环形凹槽 —— 星环的痕迹
    ring = np.abs(rho - 0.62) - 0.055
    groove = np.maximum(ring, Z - 0.31)
    sdf = np.maximum(sdf, -groove * 0.55)

    return sdf.astype(np.float32), spacing, origin


def main():
    here = Path(__file__).resolve().parent
    stl_dir = here / "stl"
    stl_dir.mkdir(exist_ok=True)

    sdf, spacing, origin = token_sdf()
    mesh, info = sdf_to_mesh(sdf, spacing, origin, 24.0, "token")

    # sdf_to_mesh 按最长边缩放到 24mm，这里把高度压到 1.2mm
    ext = mesh.extents
    mesh.apply_scale([1.0, 1.0, 1.2 / ext[2]])
    mesh.apply_translation(-mesh.bounds[0] * np.array([0, 0, 1]))
    c = mesh.bounds.mean(axis=0)
    mesh.apply_translation([-c[0], -c[1], 0])

    out = stl_dir / "token.stl"
    mesh.export(out)
    print(
        f"token.stl  watertight={mesh.is_watertight}  "
        f"faces={len(mesh.faces)}  "
        f"尺寸={[round(float(v),2) for v in mesh.extents]} mm  "
        f"体积={mesh.volume/1000:.2f} cm³"
    )
    print(f"→ {out}")


if __name__ == "__main__":
    main()
