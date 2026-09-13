#!/usr/bin/env python3
"""
《星环中的萌生》— 标本组 3D 建模生成器（SDF → 网格）

概念映射（见 星环中的萌生.md）:
    "它第一次出现时，像自然生成的陨石与胚胎，粗糙、不规则、不可命名；
      之后每一次进入新的环境，外壳都会被剥落、重组、替换。
      它看似不断复活，却逐渐变得更加标准化 ...
      直到最后，它拒绝再次变成原来的形状。"

因此输出 5 枚"编号标本" + 1 枚星环底座：
    seed_01  t=0.00  陨石胚体：低频不规则，无接缝，不可命名
    seed_02  t=0.30  开始出现十二面体倾向，浅接缝
    seed_03  t=0.60  更规整、更高效，接缝加深
    seed_04  t=0.88  近乎标准件：可复制的外壳
    seed_05  t=1.00* 拒绝：在标准壳体上长出不对称、不可归档的结构 + 一道裂隙
    ring     星环：标本置于其中，穿过光环进入新环境

几何全部由 SDF（符号距离场）采样 + marching cubes 生成，
再用 trimesh 修补成 watertight 实体，导出毫米单位 STL。
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import trimesh
from skimage import measure

# ----------------------------------------------------------------------------
# 采样网格
# ----------------------------------------------------------------------------


def make_grid(extent, n):
    """返回 (X, Y, Z) 广播坐标 + spacing + origin。extent/n 可按轴各给一个值。"""
    ex, ey, ez = extent
    nx, ny, nz = n
    xs = np.linspace(-ex, ex, nx, dtype=np.float32)
    ys = np.linspace(-ey, ey, ny, dtype=np.float32)
    zs = np.linspace(-ez, ez, nz, dtype=np.float32)
    X = xs.reshape(-1, 1, 1)
    Y = ys.reshape(1, -1, 1)
    Z = zs.reshape(1, 1, -1)
    spacing = (xs[1] - xs[0], ys[1] - ys[0], zs[1] - zs[0])
    origin = (xs[0], ys[0], zs[0])
    return X, Y, Z, spacing, origin


# ----------------------------------------------------------------------------
# 场运算
# ----------------------------------------------------------------------------


def smooth_union(a, b, k):
    """平滑并集（IQ opSmoothUnion）：让增生结构与壳体长在一起，而不是粘上去。"""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)


def smooth_subtract(a, b, k):
    """平滑差集：从实体 a 中挖去实体 b（两者均为 SDF，内部为负）。"""
    h = np.clip(0.5 - 0.5 * (a + b) / k, 0.0, 1.0)
    return a * (1.0 - h) - b * h + k * h * (1.0 - h)


def band_noise(dot_provider, seed, octaves=4, base_freq=2.1, amp=1.0, waves=3):
    """
    球面带限噪声：把若干个随机方向的正弦波叠起来。
    比 value-noise 便宜，且天然连续 —— 适合"不规则但不撕裂"的陨石表面。

    关键：必须归一化，否则叠加后会淹没半径场，形状直接撕裂。
    按各分量振幅的 RMS 归一，使输出标准差 ≈ amp（而不是按最坏情况振幅和
    归一 —— 那会因为各波部分抵消而把起伏压到肉眼不可见）。
    再截断到 ±2*amp，保证半径场恒为正。
    """
    rng = np.random.default_rng(seed)
    total = None
    sum_sq = 0.0
    for o in range(octaves):
        freq = base_freq * (1.9**o)
        a = 1.0 / (1.85**o)
        for _ in range(waves):
            n = rng.normal(size=3)
            n /= np.linalg.norm(n)
            phase = rng.uniform(0, 2 * math.pi)
            term = a * np.sin(freq * dot_provider(n) + phase)
            total = term if total is None else total + term
            sum_sq += a * a
    # 独立正弦之和的标准差 = sqrt(Σa²/2)
    norm = math.sqrt(sum_sq * 0.5)
    return np.clip(total * (amp / max(norm, 1e-9)), -2.0 * amp, 2.0 * amp)


# 十二面体的 6 组法向（(±1, ±φ, 0) 的循环置换，取无符号唯一轴）
_PHI = (1 + 5**0.5) / 2
_DODECA_AXES = np.array(
    [
        [1, _PHI, 0],
        [1, -_PHI, 0],
        [0, 1, _PHI],
        [0, 1, -_PHI],
        [_PHI, 0, 1],
        [-_PHI, 0, 1],
    ],
    dtype=np.float64,
)
_DODECA_AXES /= np.linalg.norm(_DODECA_AXES, axis=1, keepdims=True)


def dodeca_radius(dot_provider, sharpness):
    """
    规整多面体的径向半径。sharpness 越大棱越硬 ——
    "越来越标准化，越来越高效，也越来越失去个体差异"。
    """
    acc = None
    for n in _DODECA_AXES:
        d = np.abs(dot_provider(n)) ** sharpness
        acc = d if acc is None else acc + d
    soft_max = acc ** (1.0 / sharpness)
    return 1.0 / np.maximum(soft_max, 1e-6)


# ----------------------------------------------------------------------------
# 标本
# ----------------------------------------------------------------------------


def seed_sdf(t, seed, n=200, revolt=False):
    """
    构造一枚标本的 SDF。t ∈ [0,1] 为"标准化程度"。
    revolt=True 时在标准壳体上长出不可复制的增生结构。
    """
    # 采样盒留出余量：噪声最大可把半径推到 ~1.5，若贴边会被网格壁削平
    X, Y, Z, spacing, origin = make_grid((1.62, 1.62, 1.62), (n, n, n))
    r = np.sqrt(X * X + Y * Y + Z * Z)
    np.maximum(r, 1e-6, out=r)

    def dot(nrm):
        """单位方向与 nrm 的点积（即球面坐标上的线性函数）。"""
        return (X * nrm[0] + Y * nrm[1] + Z * nrm[2]) / r

    # --- 径向半径场：有机 ←→ 标准件 ---
    organic = 1.0 + band_noise(dot, seed, octaves=4, base_freq=2.0, amp=0.20)
    # 低频压扁，让胚体有"漂泊磨损"的方向性
    organic += 0.07 * dot(np.array([0.3, 0.8, 0.5]) / np.linalg.norm([0.3, 0.8, 0.5])) ** 2

    sharp = 3.0 + 9.0 * t
    poly = dodeca_radius(dot, sharp) * 0.965

    R = (1.0 - t) * organic + t * poly
    # 残留个体差异随标准化衰减，但永不为零
    R += (1.0 - 0.88 * t) * band_noise(dot, seed + 977, octaves=3, base_freq=7.5, amp=0.030)

    sdf = (r - R).astype(np.float32)
    del organic, poly, R

    # --- 模具接缝：外壳被剥落、重组、替换的痕迹 ---
    # 刻槽 = 薄板 ∩ 外层壳（只削表皮，不能切穿本体）
    if t > 0.02:
        depth = 0.02 + 0.05 * t
        width = 0.040
        for axis in (
            np.array([1.0, 0.0, 0.0]),
            np.array([0.0, 1.0, 0.0]),
            np.array([0.35, 0.0, 0.94]),
        ):
            axis = axis / np.linalg.norm(axis)
            slab = np.abs(X * axis[0] + Y * axis[1] + Z * axis[2]) - width
            shell = -(sdf + depth)  # 距表面 depth 以内为负
            cutter = np.maximum(slab, shell).astype(np.float32)
            sdf = smooth_subtract(sdf, cutter, 0.025)
            del slab, shell, cutter

    # --- 拒绝：不对称、不可归档的增生 ---
    if revolt:
        rng = np.random.default_rng(seed + 4241)
        # 全部集中在一侧 —— 打破十二面体的可复制对称
        anchor = np.array([0.45, 0.62, 0.65])
        anchor /= np.linalg.norm(anchor)
        for i in range(7):
            jitter = rng.normal(scale=0.55, size=3)
            d = anchor + jitter
            d /= np.linalg.norm(d)
            if np.dot(d, anchor) < 0.05:  # 不许长到背面去
                continue
            reach = rng.uniform(0.86, 1.34)
            rad = rng.uniform(0.10, 0.23)
            cx, cy, cz = d * reach
            # 沿生长方向拉长的椭球
            px, py, pz = X - cx, Y - cy, Z - cz
            along = px * d[0] + py * d[1] + pz * d[2]
            perp2 = (px * px + py * py + pz * pz) - along * along
            lobe = np.sqrt(np.maximum(perp2, 0.0) + (along / 1.75) ** 2) - rad
            sdf = smooth_union(sdf, lobe.astype(np.float32), 0.11)
            del px, py, pz, along, perp2, lobe

        # 一道不规则裂隙：壳体不再合拢
        fissure_n = np.array([0.86, -0.44, 0.26])
        fissure_n /= np.linalg.norm(fissure_n)
        plane = X * fissure_n[0] + Y * fissure_n[1] + Z * fissure_n[2]
        wobble = 0.055 * band_noise(dot, seed + 88, octaves=2, base_freq=3.2, amp=1.0)
        slab = np.abs(plane - wobble) - 0.042
        # 只裂开上半部，底部保持相连以便整体站立
        gate = np.maximum(slab, 0.20 - Z)
        sdf = smooth_subtract(sdf, gate.astype(np.float32), 0.02)
        del plane, wobble, slab, gate

    # --- 削平底面：FDM 首层附着 + 展陈时稳定站立 ---
    z_cut = -1.0 + 0.135
    sdf = np.maximum(sdf, (z_cut - Z).astype(np.float32))

    return sdf, spacing, origin


def ring_sdf(n_xy=272, n_z=72):
    """星环：扁平环体，标本置于环心。侧卧平放。"""
    X, Y, Z, spacing, origin = make_grid((1.15, 1.15, 0.30), (n_xy, n_xy, n_z))
    rho = np.sqrt(X * X + Y * Y)
    np.maximum(rho, 1e-6, out=rho)

    # 角向轻微起伏，让环体与标本共用同一套形态语言
    theta = np.arctan2(Y, X)
    wob = 0.018 * np.sin(theta * 7.0 + 0.7) + 0.011 * np.sin(theta * 13.0 - 1.9)

    r0 = 0.80 + wob  # 环心半径
    a, b = 0.185, 0.115  # 截面半宽 / 半高
    q = np.sqrt(((rho - r0) / a) ** 2 + (Z / b) ** 2) - 1.0
    sdf = (q * min(a, b)).astype(np.float32)

    # 削平上下，成为可平放的扁环
    sdf = np.maximum(sdf, (np.abs(Z) - 0.115).astype(np.float32))
    return sdf, spacing, origin


# ----------------------------------------------------------------------------
# SDF → 网格
# ----------------------------------------------------------------------------


def sdf_to_mesh(sdf, spacing, origin, target_size_mm, name):
    verts, faces, _, _ = measure.marching_cubes(sdf, level=0.0, spacing=spacing)
    verts = verts + np.asarray(origin, dtype=np.float64)

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_infinite_values()

    # 只保留最大连通体，去掉噪声产生的碎片
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        mesh = max(parts, key=lambda m: m.volume if m.volume > 0 else len(m.faces))

    trimesh.repair.fill_holes(mesh)
    trimesh.repair.fix_normals(mesh)
    trimesh.repair.fix_inversion(mesh)

    # 缩放到目标毫米尺寸（按最长边）
    extents = mesh.extents
    mesh.apply_scale(target_size_mm / float(max(extents)))

    # 落到 Z=0 平面、XY 居中 —— 导入任何 3D 软件即可使用
    mesh.apply_translation(-mesh.bounds[0] * np.array([0, 0, 1]))
    c = mesh.bounds.mean(axis=0)
    mesh.apply_translation([-c[0], -c[1], 0])

    info = {
        "name": name,
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "volume_mm3": round(float(mesh.volume), 1),
        "faces": int(len(mesh.faces)),
        "size_mm": [round(float(v), 2) for v in mesh.extents],
        "euler": int(mesh.euler_number),
    }
    return mesh, info


# ----------------------------------------------------------------------------
# 预览（不依赖 GPU：直接对体数据做正交深度着色）
# ----------------------------------------------------------------------------


def preview_png(sdf, out_path):
    from PIL import Image

    light = np.array([-0.45, 0.35, 0.82])
    light /= np.linalg.norm(light)

    tiles = []
    for axis, flip in ((1, False), (0, True)):  # 正视 + 侧视
        vol = np.moveaxis(sdf, axis, 0)  # (D, H, W)，沿 axis0 为视线方向
        occ = vol < 0
        any_hit = occ.any(axis=0)
        k = occ.argmax(axis=0)

        # 亚体素深度：在首个符号变化处线性插值出零点。
        # 直接用 argmax 的整数索引会产生阶梯量化，表现为同心等高线条纹。
        h, w = k.shape
        ii, jj = np.indices((h, w))
        s_k = vol[k, ii, jj]
        s_p = vol[np.maximum(k - 1, 0), ii, jj]
        denom = s_p - s_k
        ok = np.abs(denom) > 1e-9
        # np.where 会先求值两个分支，因此除数必须先夹住，否则触发 divide-by-zero
        frac = np.where(ok, s_p / np.where(ok, denom, 1.0), 0.0)
        depth = np.where(k > 0, (k - 1) + frac, k.astype(np.float64))
        depth = np.where(any_hit, depth, np.nan)

        far = float(np.nanmax(depth)) if any_hit.any() else 0.0
        near = float(np.nanmin(depth)) if any_hit.any() else 0.0
        gy, gx = np.gradient(np.nan_to_num(depth, nan=far))

        # 由深度梯度反推视空间法向，再做 Lambert 着色
        nx, ny, nz = -gx, -gy, np.ones_like(gx)
        inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
        lam = np.clip(
            (nx * light[0] + ny * light[1] + nz * light[2]) * inv, 0.0, 1.0
        )
        dn = np.nan_to_num((depth - near) / max(far - near, 1e-6), nan=1.0)
        shade = np.clip((0.16 + 0.84 * lam) * (1.0 - 0.35 * dn), 0.0, 1.0)

        img = np.where(any_hit, 8 + 245 * shade, 12).astype(np.uint8)
        img = np.rot90(img)
        if flip:
            img = img[:, ::-1]
        tiles.append(img)

    h = max(t.shape[0] for t in tiles)
    canvas = np.full((h, sum(t.shape[1] for t in tiles) + 12, 3), 12, np.uint8)
    x = 0
    for t in tiles:
        canvas[: t.shape[0], x : x + t.shape[1]] = t[..., None]
        x += t.shape[1] + 12
    Image.fromarray(canvas).save(out_path)


# ----------------------------------------------------------------------------


SPECIMENS = [
    # (编号, 标准化程度 t, 随机种子, 拒绝, 目标尺寸 mm, 说明)
    ("seed_01", 0.00, 101, False, 58.0, "陨石胚体 · 不可命名"),
    ("seed_02", 0.30, 202, False, 56.0, "开始被塑形"),
    ("seed_03", 0.60, 303, False, 55.0, "更规整 · 更高效"),
    ("seed_04", 0.88, 404, False, 54.0, "标准件 · 可复制外壳"),
    ("seed_05", 1.00, 505, True, 62.0, "拒绝 · 不可归档的增生"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=200, help="标本体素分辨率（越高越细）")
    ap.add_argument("--only", type=str, default=None, help="只生成某一件，如 seed_05 / ring")
    ap.add_argument("--no-preview", action="store_true")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent
    stl_dir = root / "stl"
    pre_dir = root / "preview"
    stl_dir.mkdir(parents=True, exist_ok=True)
    pre_dir.mkdir(parents=True, exist_ok=True)

    report = []

    for name, t, seed, revolt, size_mm, note in SPECIMENS:
        if args.only and args.only != name:
            continue
        print(f"[{name}] t={t:.2f} {note} ... ", end="", flush=True)
        sdf, spacing, origin = seed_sdf(t, seed, n=args.res, revolt=revolt)
        mesh, info = sdf_to_mesh(sdf, spacing, origin, size_mm, name)
        info["note"] = note
        info["standardization_t"] = t
        mesh.export(stl_dir / f"{name}.stl")
        if not args.no_preview:
            preview_png(sdf, pre_dir / f"{name}.png")
        del sdf
        print(
            f"watertight={info['watertight']} "
            f"faces={info['faces']} size={info['size_mm']} mm"
        )
        report.append(info)

    if not args.only or args.only == "ring":
        print("[ring]    星环底座 ... ", end="", flush=True)
        sdf, spacing, origin = ring_sdf()
        mesh, info = sdf_to_mesh(sdf, spacing, origin, 148.0, "ring")
        info["note"] = "星环 · 标本置于环心"
        mesh.export(stl_dir / "ring.stl")
        if not args.no_preview:
            preview_png(sdf, pre_dir / "ring.png")
        del sdf
        print(
            f"watertight={info['watertight']} "
            f"faces={info['faces']} size={info['size_mm']} mm"
        )
        report.append(info)

    (root / "build_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    bad = [r["name"] for r in report if not (r["watertight"] and r["winding_consistent"])]
    print("\n" + "=" * 62)
    if bad:
        print(f"⚠️  未通过实体校验: {', '.join(bad)}")
    else:
        print(f"✅ {len(report)} 件全部 watertight，可直接切片")
    total = sum(r["volume_mm3"] for r in report) / 1000.0
    print(f"   合计体积 {total:.1f} cm³（实心）")
    print(f"   STL → {stl_dir}")


if __name__ == "__main__":
    main()
