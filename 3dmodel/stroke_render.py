#!/usr/bin/env python3
"""
笔画渲染器 —— 按 19 世纪科学图版真正的画法出图。

与上一版（先渲染再后处理）的根本区别：**线是画出来的，不是检出来的**。

    1. 从网格提取 3D 曲线：silhouette（正背面交界）+ crease（折痕）+ boundary
    2. 串成连续折线 → 正交投影 → 用深度缓冲剔除被遮挡的段
    3. 变宽笔触描线：起笔重、收笔轻、沿途粗细随手抖起伏
    4. 线围成的区域平涂淡彩（阶梯而非渐变），并与线错开一点点

笔触实现的关键是一次带索引的距离变换：
先把中心线的"半径 / 浓度"写进缓冲，再对每个像素查最近的中心线像素，
比较距离与那一点的半径 —— 一次 O(HW) 就得到任意变宽的笔画，
不需要逐段光栅化几万个四边形。
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import trimesh
from scipy import ndimage as ndi

from npr_render import (INK, PAPER, VIEWS, Buffers, Camera, _cjk_font, _fbm,
                        _font, _warp, _warp_field, rasterize)

np.seterr(all="ignore")


# ---------------------------------------------------------------- 1. 提线
def mesh_lines(mesh, cam, crease_deg=34.0):
    """返回 [(顶点索引数组, 类型)]。类型: 'sil' 轮廓 / 'crease' 折痕。"""
    fn = mesh.face_normals
    facing = fn @ cam.fwd            # < 0 朝向相机
    front = facing < 0.0

    fa = mesh.face_adjacency
    fae = mesh.face_adjacency_edges
    if len(fa) == 0:
        return []
    a, b = fa[:, 0], fa[:, 1]

    # 轮廓：相邻两面一正一背 —— 这条边就是形的外缘
    sil = front[a] != front[b]
    # 折痕：两面都可见且夹角够大。凸起（ridge）比凹陷（valley）画得重
    ang = mesh.face_adjacency_angles
    both = front[a] & front[b]
    crease = both & (ang > math.radians(crease_deg))

    out = []
    if sil.any():
        out.append((fae[sil], "sil"))
    if crease.any():
        out.append((fae[crease], "crease"))

    # 开放边界（本项目网格都是闭合的，留作兜底）
    grp = trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1)
    if len(grp):
        out.append((mesh.edges_sorted[grp], "sil"))
    return out


def chain_edges(edges, max_pts=100000):
    """把无序边集串成尽量长的折线（顶点索引序列）。"""
    if len(edges) == 0:
        return []
    adj: dict[int, list[int]] = {}
    for i, (u, v) in enumerate(edges):
        adj.setdefault(int(u), []).append(i)
        adj.setdefault(int(v), []).append(i)
    used = np.zeros(len(edges), bool)
    chains = []

    def walk(start_v, e0):
        seq = [start_v]
        v = start_v
        e = e0
        while True:
            used[e] = True
            u, w = edges[e]
            nxt = int(w) if int(u) == v else int(u)
            seq.append(nxt)
            v = nxt
            cand = [k for k in adj.get(v, ()) if not used[k]]
            if len(cand) != 1:      # 分叉或到头 → 断笔
                break
            e = cand[0]
        return seq

    for i in range(len(edges)):
        if used[i]:
            continue
        u, v = int(edges[i][0]), int(edges[i][1])
        fwd_seq = walk(u, i)                       # 从 u 往 v 方向
        # 再从起点反向延伸
        back = [k for k in adj.get(u, ()) if not used[k]]
        if len(back) == 1:
            bwd = walk(u, back[0])
            fwd_seq = bwd[::-1][:-1] + fwd_seq
        if len(fwd_seq) >= 2:
            chains.append(np.asarray(fwd_seq, np.int64))
    return chains


def _resample(xy, step):
    """按弧长重采样成等距点列，顺带轻微平滑（手画的线不会有硬拐点）。"""
    d = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(d)])
    total = float(s[-1])
    if total < step:
        return None, 0.0
    n = max(int(total / step) + 1, 2)
    t = np.linspace(0, total, n)
    out = np.stack([np.interp(t, s, xy[:, 0]), np.interp(t, s, xy[:, 1])], -1)
    if len(out) >= 5:
        k = np.array([0.25, 0.5, 0.25])
        for c in (0, 1):
            out[1:-1, c] = np.convolve(out[:, c], k, mode="same")[1:-1]
    return out, total


def polylines_2d(parts, styles, cam, buf, order, step=1.0, bias=1.4):
    """所有部件 → 屏幕空间可见折线 [(xy, kind, part)]。"""
    H, W = buf.depth.shape
    strokes = []
    for name in order:
        mesh = parts[name]
        if styles[name].get("no_line"):
            continue
        scr = cam.project(mesh.vertices)
        for edges, kind in mesh_lines(mesh, cam, styles[name].get("crease", 34.0)):
            for chain in chain_edges(edges):
                xy = scr[chain][:, :2]
                z = scr[chain][:, 2]
                pts, total = _resample(xy, step)
                if pts is None:
                    continue
                # 深度沿弧长同步重采样，用于遮挡判定
                d = np.linalg.norm(np.diff(xy, axis=0), axis=1)
                s = np.concatenate([[0.0], np.cumsum(d)])
                zz = np.interp(np.linspace(0, total, len(pts)), s, z)

                ix = np.clip(pts[:, 0].astype(int), 0, W - 1)
                iy = np.clip(pts[:, 1].astype(int), 0, H - 1)
                inb = ((pts[:, 0] >= 0) & (pts[:, 0] < W)
                       & (pts[:, 1] >= 0) & (pts[:, 1] < H))
                # 轮廓线正好落在剪影边缘，深度判定天生脆弱 → 给足容差
                tol = bias * (2.6 if kind == "sil" else 1.0)
                vis = inb & (zz <= buf.depth[iy, ix] + tol)
                # 连续可见段切分
                idx = np.nonzero(vis)[0]
                if len(idx) < 2:
                    continue
                for run in np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1):
                    if len(run) >= 3:
                        strokes.append((pts[run], kind, name))
    return strokes


# ---------------------------------------------------------------- 2. 笔触
def stamp_strokes(shape, strokes, rng, ss=2, base_w=1.5, ink_gain=1.0):
    """把折线画成变宽笔画。返回 alpha 图（0–1）。"""
    H, W = shape
    R = np.zeros((H, W), np.float32)   # 半径
    D = np.zeros((H, W), np.float32)   # 浓度
    wob_field = _fbm((H, W), rng, octaves=3, base=max(int(W / 40), 4))

    for pts, kind, _name in strokes:
        n = len(pts)
        t = np.linspace(0.0, 1.0, n)
        # 起笔重、收笔轻的压感曲线
        taper = np.sin(np.pi * np.clip(t, 0, 1)) ** 0.42
        taper = 0.34 + 0.66 * taper
        if kind == "sil":
            w = base_w * ss * (0.92 + 0.5 * taper)
            dark = 0.94
        else:
            w = base_w * ss * 0.52 * (0.7 + 0.6 * taper)
            dark = 0.60
        ix = np.clip(pts[:, 0].astype(int), 0, W - 1)
        iy = np.clip(pts[:, 1].astype(int), 0, H - 1)
        # 沿途手抖：粗细与浓度都随低频噪声起伏，偶尔提笔
        wob = wob_field[iy, ix]
        w = w * (0.72 + 0.62 * wob)
        dk = dark * ink_gain * np.clip(0.55 + 0.85 * wob, 0.18, 1.0) * taper
        np.maximum.at(R, (iy, ix), w)
        np.maximum.at(D, (iy, ix), dk)

    if not R.any():
        return np.zeros((H, W), np.float32)

    # 一次带索引的距离变换 → 任意变宽笔画
    dist, (iy_n, ix_n) = ndi.distance_transform_edt(R == 0, return_indices=True)
    rad = R[iy_n, ix_n]
    dk = D[iy_n, ix_n]
    edge = np.clip((rad - dist) / 1.25, 0.0, 1.0)      # 笔缘微微洇开
    return np.clip(edge * dk, 0, 1).astype(np.float32)


# ---------------------------------------------------------------- 3. 平涂
KEY = np.array([-0.40, -0.52, 0.75]); KEY /= np.linalg.norm(KEY)
FILL = np.array([0.62, 0.15, 0.30]); FILL /= np.linalg.norm(FILL)


def flat_wash(buf, mask, pigment):
    """阶梯平涂：把光照量化成 3 档，每档一个平色，亮档留白给纸。"""
    n = buf.nrm
    lit = np.clip(0.60 * np.clip(n @ KEY, 0, 1)
                  + 0.30 * np.clip(n @ FILL, 0, 1)
                  + 0.34 * (0.5 + 0.5 * n[..., 2]), 0, 1.4)
    # 硬阶梯（图版是一层层涂的，不是渐变）
    step = np.zeros_like(lit)
    step[lit > 0.42] = 1.0
    step[lit > 0.72] = 2.0
    step[lit > 0.98] = 3.0
    tone = np.choose(step.astype(int), [0.80, 0.90, 0.975, 1.0])
    tone = tone + 0.035 * (pigment - 0.5)
    rgb = buf.alb * tone[..., None]
    hi = (step >= 3)[..., None]
    rgb = np.where(hi, PAPER[None, None, :] * 0.995, rgb)
    return np.where(mask[..., None], np.clip(rgb, 0, 1), 0.0), lit


def pigment_pool(mask, rng, width, strength):
    if not mask.any():
        return np.zeros(mask.shape, np.float32)
    d = ndi.distance_transform_edt(mask).astype(np.float32)
    band = np.clip(1.0 - d / max(width, 1.0), 0, 1) ** 1.6
    return band * strength * (0.5 + 0.95 * _fbm(mask.shape, rng, octaves=3, base=8))


def hatch(shape, cam, buf, mask, rng, period, amp):
    """排线：只在暗面画，硬边细线，方向沿世界 Z 的屏幕投影。"""
    H, W = shape
    zd = np.array([-(cam.right @ [0, 0, 1.0]), -(cam.up @ [0, 0, 1.0])])
    perp = np.array([-zd[1], zd[0]])
    perp /= max(np.linalg.norm(perp), 1e-9)
    yy, xx = np.mgrid[0:H, 0:W]
    u = xx * perp[0] + yy * perp[1]
    wob = _fbm((H, W), rng, octaves=3, base=6) - 0.5
    s = 0.5 + 0.5 * np.sin((u / period + wob * 1.5) * 2 * math.pi)
    lam = np.clip(buf.nrm @ KEY, 0, 1)
    hard = np.clip((s - 0.50) / 0.14, 0, 1)
    return np.where(mask, hard * amp * (1.0 - 0.85 * lam) ** 1.5, 0.0)


# ---------------------------------------------------------------- 4. 出图
def paint(parts, styles, out_path, view="hero", size=(1500, 1150), ss=2,
          order=None, caption=None, subcaption=None, seed=13, plate=True,
          base_w=1.5, hatch_on=("shell",)):
    from PIL import Image, ImageDraw

    W0, H0 = size
    W, H = W0 * ss, H0 * ss
    rng = np.random.default_rng(seed)
    yaw, pitch, scale, ctr = VIEWS[view]
    cam = Camera(yaw, pitch, scale * ss, ctr, W, H)
    order = [n for n in (order or list(parts)) if n in parts]

    # --- 两趟缓冲 ---
    # 关键：透明壳必须和不透明件分开光栅化。共用一个深度缓冲时壳会赢 z 测试，
    # 把纸卷 / 主板 / 胶辊整个挡掉 —— "看得见内脏"的设计就没了。
    glass = [n for n in order if styles[n].get("alpha", 1.0) < 1.0]
    solid = [n for n in order if styles[n].get("alpha", 1.0) >= 1.0]

    buf = Buffers(H, W)          # 只装不透明件
    for i, name in enumerate(solid):
        st = styles[name]
        rasterize(buf, parts[name], cam, i, st["color"],
                  st.get("smooth", False), st.get("metal", 0.0))

    gbuf = None
    if glass:
        gbuf = Buffers(H, W)
        for name in glass:
            st = styles[name]
            rasterize(gbuf, parts[name], cam, 1, st["color"], True, 0.0)

    pig = _fbm((H, W), rng, octaves=5, base=3)
    fiber = _fbm((H, W), rng, octaves=6, base=24)

    # --- 纸 ---
    img = (PAPER[None, None, :] * (0.978 + 0.045 * pig[..., None])).astype(np.float32)
    img *= 1.0 - 0.030 * (fiber[..., None] - 0.5)
    g = cam.project(np.array([[0.0, -14.0, 0.0]]))[0]
    yy, xx = np.mgrid[0:H, 0:W]
    rr = np.sqrt(((xx - g[0]) / (300 * scale * ss / 2.6)) ** 2
                 + ((yy - g[1] - 5 * ss) / (86 * scale * ss / 2.6)) ** 2)
    sh = np.clip(1 - rr, 0, 1) ** 1.9 * 0.15 * (0.7 + 0.6 * pig)
    img = img * (1 - sh[..., None]) + INK[None, None, :] * sh[..., None] * 0.32

    # --- 平涂（与线错开约 1.6 px，手上色盖不准线稿）---
    dx, dy = _warp_field((H, W), rng, 1.6 * ss)

    # (a) 不透明层
    mask = buf.pid >= 0
    rgb, lit = flat_wash(buf, mask, pig)
    rgb = _warp(rgb, dx, dy)
    mw = _warp(mask.astype(np.float32), dx, dy) > 0.5
    pool = pigment_pool(mw, rng, 5.0 * ss, 0.24)
    rgb *= (1 - pool[..., None] * 0.9)
    img = np.where(mw[..., None], np.clip(rgb, 0, 1), img)

    # (b) 透明壳叠上去：边缘（掠射角）更实，正面更透 —— 内脏从正面隐约透出
    if gbuf is not None:
        gmask = gbuf.pid >= 0
        grgb, _ = flat_wash(gbuf, gmask, pig)
        base_a = styles[glass[0]].get("alpha", 0.3)
        fres = (1 - np.abs(gbuf.nrm @ cam.fwd)) ** 2.0
        ga = np.clip(base_a * 0.55 + 0.78 * fres, 0, 0.90) * gmask
        # 磨砂扩散：壳后的东西向壳色靠拢、对比压平。
        # 少了这一步内脏会清晰成板件，读作玻璃橱窗而不是磨砂机身。
        shell_rgb = np.asarray(styles[glass[0]]["color"], np.float32)
        behind_m = (_warp(gmask.astype(np.float32), dx, dy) > 0.5) & mw
        if behind_m.any():
            diff = 0.40
            blur = np.stack([ndi.uniform_filter(img[..., c], size=max(int(3.4 * ss), 3))
                             for c in range(3)], -1)
            frost = blur * (1 - diff) + shell_rgb[None, None, :] * diff
            img = np.where(behind_m[..., None], frost, img)
        grgb = _warp(grgb, dx, dy)
        ga = _warp(ga.astype(np.float32), dx, dy)
        ga *= (1 - pigment_pool(_warp(gmask.astype(np.float32), dx, dy) > 0.5,
                                rng, 4.0 * ss, 0.20))
        img = img * (1 - ga[..., None]) + np.clip(grgb, 0, 1) * ga[..., None]

        # --- 排线：壳的暗面 ---
        hz = hatch((H, W), cam, gbuf, gmask, rng, 7.6 * ss, 0.22)
        hz = _warp(hz, dx, dy)
        img = img * (1 - hz[..., None]) + INK[None, None, :] * hz[..., None]

    # --- 墨线 ---
    # 壳自己的线要能被内脏遮挡也能挡住内脏 → 用两趟深度的较近值做判定
    comb = Buffers(H, W)
    comb.depth = np.minimum(buf.depth, gbuf.depth) if gbuf is not None else buf.depth

    solid_strokes = polylines_2d(parts, styles, cam, buf, solid,
                                 step=1.0 * ss, bias=1.2 * ss)
    glass_strokes = (polylines_2d(parts, styles, cam, comb, glass,
                                  step=1.0 * ss, bias=1.2 * ss) if glass else [])

    ink = np.zeros((H, W), np.float32)
    if solid_strokes:
        # 落在壳后面的线：隔着磨砂看，画淡
        gd = gbuf.depth if gbuf is not None else None
        near, far = [], []
        for pts, kind, name in solid_strokes:
            if gd is None:
                near.append((pts, kind, name)); continue
            ix = np.clip(pts[:, 0].astype(int), 0, W - 1)
            iy = np.clip(pts[:, 1].astype(int), 0, H - 1)
            frac = float(np.mean(np.isfinite(gd[iy, ix])))
            (far if frac > 0.5 else near).append((pts, kind, name))
        if far:
            ink = np.maximum(ink, stamp_strokes((H, W), far, rng, ss,
                                                base_w * 0.72, ink_gain=0.22))
        if near:
            ink = np.maximum(ink, stamp_strokes((H, W), near, rng, ss, base_w))
    if glass_strokes:
        ink = np.maximum(ink, stamp_strokes((H, W), glass_strokes, rng, ss,
                                            base_w, ink_gain=0.92))
    idx, idy = _warp_field((H, W), rng, 0.8 * ss, base=5)
    ink = _warp(ink, idx, idy)
    ia = ink[..., None]
    img = img * (1 - ia) + INK[None, None, :] * ia

    img *= 1.0 - 0.026 * (fiber[..., None] - 0.5)
    pil = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize(
        (W0, H0), Image.LANCZOS)

    if plate:
        d = ImageDraw.Draw(pil)
        ic = tuple(int(v * 255) for v in (INK * 0.55 + PAPER * 0.45))
        for pad, wid in ((26, 2), (33, 1)):
            d.rectangle([pad, pad, W0 - pad, H0 - pad], outline=ic, width=wid)
        d.line([(33, H0 - 96), (W0 - 33, H0 - 96)], fill=ic, width=1)
        f1, f2 = _font(int(H0 * 0.026)), _cjk_font(int(H0 * 0.020))
        tc = tuple(int(v * 255) for v in INK)
        if caption and f1:
            d.text((W0 / 2, H0 - 74), caption, font=f1, fill=tc, anchor="mm")
        if subcaption and f2:
            d.text((W0 / 2, H0 - 48), subcaption, font=f2, fill=tc, anchor="mm")
    pil.save(out_path)
    return out_path
