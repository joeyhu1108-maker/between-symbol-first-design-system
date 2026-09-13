#!/usr/bin/env python3
"""
手绘风渲染器（NPR）—— 把 3D 网格画成 19 世纪科学图谱的样子。

参考：Kofoid & Swezy《Unarmored Dinoflagellata》图版、Hilma af Klint 的淡彩。
做法（全部 numpy，无外部渲染器）：
    三角光栅化 → depth / normal / id / albedo 缓冲
    → 分层水彩（把 Lambert 量化成 3 段淡彩，叠低频颜料不均）
    → 墨线（轮廓 = id/深度断裂，折痕 = 法向夹角；线宽与浓度带手抖噪声）
    → 纵向排线（壳体上的细竖纹，对应图版里的纵向条纹）
    → 米色纸底 + 纸纤维颗粒 + 图版双线边框 + 图注

正交投影，因此深度可线性插值，重心坐标即精确插值。
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import trimesh
from scipy import ndimage as ndi

np.seterr(all="ignore")

# 纸与墨（暖调，取自图版原作）
PAPER = np.array([0.957, 0.937, 0.878])
PAPER_DARK = np.array([0.898, 0.867, 0.784])
INK = np.array([0.184, 0.161, 0.137])

VIEWS = {
    "hero":  (-34.0, 20.0, 2.60, (0, -46, 96)),
    "front": (-1.0, 8.0, 2.70, (0, -40, 98)),
    "side":  (-88.0, 7.0, 2.60, (0, -46, 98)),
    "top":   (-26.0, 54.0, 2.40, (0, -40, 84)),
    "detail": (-40.0, 26.0, 4.60, (0, 10, 168)),
}


def _fbm(shape, rng, octaves=4, base=4):
    """低频分形噪声：颜料不均 / 手抖 / 纸纤维都用它。"""
    H, W = shape
    out = np.zeros(shape, np.float32)
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        h = max(int(base * 2**o), 2)
        w = max(int(base * 2**o * W / H), 2)
        g = rng.random((h, w)).astype(np.float32)
        yi = np.linspace(0, h - 1, H)
        xi = np.linspace(0, w - 1, W)
        y0 = np.floor(yi).astype(int); x0 = np.floor(xi).astype(int)
        y1 = np.minimum(y0 + 1, h - 1); x1 = np.minimum(x0 + 1, w - 1)
        fy = (yi - y0)[:, None]; fx = (xi - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        g = (g[np.ix_(y0, x0)] * (1 - fy) * (1 - fx) + g[np.ix_(y1, x0)] * fy * (1 - fx)
             + g[np.ix_(y0, x1)] * (1 - fy) * fx + g[np.ix_(y1, x1)] * fy * fx)
        out += amp * g
        tot += amp
        amp *= 0.5
    return out / tot


def _warp(field, dx, dy, order=1):
    """按位移场重采样。手绘的形与"正确的形"永远差一点点，这一点点就是手感。"""
    H, W = field.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    co = np.array([yy + dy, xx + dx])
    if field.ndim == 2:
        return ndi.map_coordinates(field, co, order=order, mode="nearest")
    return np.stack([ndi.map_coordinates(field[..., c], co, order=order, mode="nearest")
                     for c in range(field.shape[2])], -1)


def _warp_field(shape, rng, amp, base=3):
    """低频位移场（像素）。"""
    dx = (_fbm(shape, rng, octaves=3, base=base) - 0.5) * 2 * amp
    dy = (_fbm(shape, rng, octaves=3, base=base) - 0.5) * 2 * amp
    return dx.astype(np.float32), dy.astype(np.float32)


def pigment_pool(mask, rng, width, strength=0.30):
    """水彩边界积色：颜料在干燥时向边缘聚集，所以轮廓内侧一圈更深。"""
    if not mask.any():
        return np.zeros(mask.shape, np.float32)
    d = ndi.distance_transform_edt(mask).astype(np.float32)
    band = np.clip(1.0 - d / max(width, 1.0), 0, 1) ** 1.5
    return band * strength * (0.55 + 0.9 * _fbm(mask.shape, rng, octaves=3, base=8))


def stipple(mask, lit, rng, spacing, strength=0.12):
    """点画：图版靠疏密的小点表现暗部，而不是连续灰阶。"""
    H, W = mask.shape
    n = _fbm((H, W), rng, octaves=2, base=max(int(W / spacing), 4))
    dots = (n > 0.72).astype(np.float32)
    dots = ndi.maximum_filter(dots, size=2)
    dark = np.clip(1.0 - lit, 0, 1) ** 1.6
    return dots * dark * strength * mask


def broken_strokes(e, rng, ss=2, keep=0.94):
    """钢笔线：先加粗成有厚度的线，再让粗细随手抖起伏、偶尔提笔。

    关键是"先粗后断"。反过来做（在细线上断）会把线打成虚线点，
    远看就消失了 —— 上一版整张图看不出手绘感就是这个原因。
    """
    H, W = e.shape
    core = e > 0.18
    # 基础线宽 ≈ 1.6*ss px：图版的轮廓是果断的一笔，不是发丝
    body = ndi.grey_dilation(e, size=max(int(1.6 * ss), 2))
    wob = _fbm((H, W), rng, octaves=3, base=max(int(W / 34), 4))
    # 粗细起伏：局部再加一圈
    fat = ndi.grey_dilation(body, size=max(int(1.1 * ss), 2)) * (wob > 0.56)
    line = np.maximum(body, fat * 0.92)
    # 提笔：低频噪声压低浓度，但不完全归零（保留淡淡的痕）
    gap = _fbm((H, W), rng, octaves=4, base=max(int(W / 22), 4))
    line = line * np.clip((gap - (1 - keep)) / 0.30 + 0.62, 0.18, 1.0)
    return np.clip(line * (0.86 + 0.34 * wob), 0, 1)


class Buffers:
    def __init__(self, H, W):
        self.depth = np.full((H, W), np.inf, np.float32)
        self.nrm = np.zeros((H, W, 3), np.float32)
        self.alb = np.zeros((H, W, 3), np.float32)
        self.pid = np.full((H, W), -1, np.int16)
        self.metal = np.zeros((H, W), np.float32)


class Camera:
    """正交相机。世界 Z 向上，-Y 为正面。"""

    def __init__(self, yaw_deg, pitch_deg, scale, center, W, H, cy_frac=0.60):
        yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
        self.fwd = np.array([math.sin(yaw) * math.cos(pitch),
                             math.cos(yaw) * math.cos(pitch), -math.sin(pitch)])
        self.right = np.cross(self.fwd, [0, 0, 1.0])
        self.right /= np.linalg.norm(self.right)
        self.up = np.cross(self.right, self.fwd)
        self.scale, self.center = scale, np.asarray(center, float)
        self.cx, self.cy = W / 2, H * cy_frac

    def project(self, pts):
        rel = pts - self.center
        x = (rel @ self.right) * self.scale + self.cx
        y = -(rel @ self.up) * self.scale + self.cy
        return np.stack([x, y, rel @ self.fwd], -1)


def rasterize(buf, mesh, cam, pid, albedo, smooth=False, metal=0.0):
    """把一个网格光栅化进缓冲区（正交 + z-buffer + 背面剔除）。"""
    H, W = buf.depth.shape
    scr = cam.project(mesh.vertices)
    F = mesh.faces
    fn = mesh.face_normals
    vn = mesh.vertex_normals if smooth else None
    p0, p1, p2 = scr[F[:, 0]], scr[F[:, 1]], scr[F[:, 2]]
    # 屏幕空间叉积 > 0 = 背向（y 轴向下翻转过）
    area = ((p1[:, 0] - p0[:, 0]) * (p2[:, 1] - p0[:, 1])
            - (p1[:, 1] - p0[:, 1]) * (p2[:, 0] - p0[:, 0]))
    keep = area < -1e-9
    idx = np.nonzero(keep)[0]
    alb = np.asarray(albedo, np.float32)
    for t in idx:
        a, b, c = p0[t], p1[t], p2[t]
        xmin = max(int(math.floor(min(a[0], b[0], c[0]))), 0)
        xmax = min(int(math.ceil(max(a[0], b[0], c[0]))) + 1, W)
        ymin = max(int(math.floor(min(a[1], b[1], c[1]))), 0)
        ymax = min(int(math.ceil(max(a[1], b[1], c[1]))) + 1, H)
        if xmin >= xmax or ymin >= ymax:
            continue
        xs = np.arange(xmin, xmax) + 0.5
        ys = np.arange(ymin, ymax) + 0.5
        X, Y = np.meshgrid(xs, ys)
        d = area[t]
        w0 = ((b[0] - a[0]) * (Y - a[1]) - (b[1] - a[1]) * (X - a[0])) / d
        w1 = ((c[0] - b[0]) * (Y - b[1]) - (c[1] - b[1]) * (X - b[0])) / d
        w2 = 1.0 - w0 - w1
        # w1 对应顶点 a, w2 → b, w0 → c（边函数的标准轮换）
        m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not m.any():
            continue
        z = w1 * a[2] + w2 * b[2] + w0 * c[2]
        sub = buf.depth[ymin:ymax, xmin:xmax]
        hit = m & (z < sub)
        if not hit.any():
            continue
        yy, xx = np.nonzero(hit)
        yy += ymin; xx += xmin
        buf.depth[yy, xx] = z[hit]
        buf.pid[yy, xx] = pid
        buf.alb[yy, xx] = alb
        buf.metal[yy, xx] = metal
        if smooth:
            n = (vn[F[t, 0]] * w1[hit][:, None] + vn[F[t, 1]] * w2[hit][:, None]
                 + vn[F[t, 2]] * w0[hit][:, None])
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
            buf.nrm[yy, xx] = n
        else:
            buf.nrm[yy, xx] = fn[t]


KEY = np.array([-0.40, -0.52, 0.75]); KEY /= np.linalg.norm(KEY)
FILL = np.array([0.62, 0.15, 0.30]); FILL /= np.linalg.norm(FILL)


def wash(buf, cam, pigment, mask):
    """分层水彩：Lambert 量化成 3 段，叠颜料不均，暗部偏冷偏灰。"""
    n = buf.nrm
    lam = np.clip(n @ KEY, 0, 1)
    fil = np.clip(n @ FILL, 0, 1) * 0.32
    sky = 0.5 + 0.5 * n[..., 2]
    lit = np.clip(0.62 * lam + fil + 0.30 * sky, 0, 1.4)
    # 两段淡彩（阶梯而非渐变）+ 大面积留白：图版是一层层涂上去的，不是渲染出来的
    e0, e1 = 0.50, 0.86
    band = (0.72
            + np.clip((lit - e0 + 0.06) / 0.12, 0, 1) * 0.15
            + np.clip((lit - e1 + 0.06) / 0.12, 0, 1) * 0.16)
    band = band + 0.07 * pigment
    rgb = buf.alb * band[..., None]
    # 金属：一条窄高光带
    spec = (np.clip(n @ KEY, 0, 1) ** 60) * buf.metal
    rgb = rgb + spec[..., None] * 0.30
    # 亮部留白：让纸自己透出来，而不是画一层浅灰
    hi = np.clip((lit - 0.94) / 0.22, 0, 1)[..., None]
    rgb = rgb * (1 - hi) + PAPER[None, None, :] * hi
    return np.where(mask[..., None], np.clip(rgb, 0, 1), 0.0), lit


def ink_edges(buf, jitter, depth_thresh=1.6, crease=0.62):
    """轮廓线 + 折痕线。返回 0–1 浓度图。"""
    pid, dep, nrm = buf.pid, buf.depth, buf.nrm
    solid = pid >= 0
    e = np.zeros(pid.shape, np.float32)
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        p_s = np.roll(np.roll(pid, dy, 0), dx, 1)
        d_s = np.roll(np.roll(dep, dy, 0), dx, 1)
        n_s = np.roll(np.roll(nrm, dy, 0), dx, 1)
        sil = (p_s != pid) & (solid | (p_s >= 0))
        djump = np.abs(np.where(np.isfinite(dep), dep, 0) - np.where(np.isfinite(d_s), d_s, 0))
        step = solid & (p_s >= 0) & (djump > depth_thresh)
        cr = solid & (p_s >= 0) & (np.sum(nrm * n_s, -1) < crease)
        e = np.maximum(e, sil * 1.0)
        e = np.maximum(e, step * 0.92)
        e = np.maximum(e, cr * 0.55)
    # 手抖：线浓度随低频噪声起伏，并偶尔断线
    e = e * (0.62 + 0.62 * jitter)
    return np.clip(e, 0, 1)


def striations(shape, cam, buf, mask, rng, period=5.4, amp=0.055):
    """纵向排线：沿世界 Z 在屏幕上的投影方向排细线，只画在指定 mask 上。"""
    H, W = shape
    zdir = np.array([-(cam.right @ [0, 0, 1.0]), -(cam.up @ [0, 0, 1.0])])
    perp = np.array([-zdir[1], zdir[0]])
    perp /= max(np.linalg.norm(perp), 1e-9)
    yy, xx = np.mgrid[0:H, 0:W]
    u = xx * perp[0] + yy * perp[1]
    wob = _fbm((H, W), rng, octaves=3, base=6) - 0.5
    s = 0.5 + 0.5 * np.sin((u / period + wob * 1.6) * 2 * math.pi)
    lam = np.clip(buf.nrm @ KEY, 0, 1)
    # 只在暗面排线（亮面留白），并做成硬边的线而不是正弦灰阶
    hard = np.clip((s - 0.42) / 0.16, 0, 1)
    return np.where(mask, hard * amp * (1.0 - 0.80 * lam) ** 1.4, 0.0)


def _font(size):
    from PIL import ImageFont
    for p in ("/System/Library/Fonts/Supplemental/Times New Roman.ttf",
              "/System/Library/Fonts/Supplemental/Georgia.ttf",
              "/Library/Fonts/Times New Roman.ttf",
              "/System/Library/Fonts/Palatino.ttc",
              "/System/Library/Fonts/Times.ttc"):
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:  # noqa: BLE001
                pass
    return None


def _cjk_font(size):
    from PIL import ImageFont
    for p in ("/System/Library/Fonts/Supplemental/Songti.ttc",
              "/System/Library/Fonts/Hiragino Sans GB.ttc",
              "/System/Library/Fonts/PingFang.ttc"):
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:  # noqa: BLE001
                pass
    return None


def render(parts, styles, out_path, view="hero", size=(1500, 1150), ss=2,
           order=None, plate=True, caption=None, subcaption=None, seed=7):
    """parts: {name: mesh}；styles: {name: {color, alpha, smooth, metal}}。"""
    from PIL import Image, ImageDraw

    W0, H0 = size
    W, H = W0 * ss, H0 * ss
    rng = np.random.default_rng(seed)
    yaw, pitch, scale, ctr = VIEWS[view]
    cam = Camera(yaw, pitch, scale * ss, ctr, W, H)

    order = order or list(parts)
    opaque = [n for n in order if n in parts and styles[n].get("alpha", 1.0) >= 1.0]
    glassy = [n for n in order if n in parts and styles[n].get("alpha", 1.0) < 1.0]

    bo = Buffers(H, W)
    for i, n in enumerate(opaque):
        st = styles[n]
        rasterize(bo, parts[n], cam, i, st["color"], st.get("smooth", False), st.get("metal", 0.0))

    bg_pig = _fbm((H, W), rng, octaves=5, base=3)
    fiber = _fbm((H, W), rng, octaves=6, base=26)
    jitter = _fbm((H, W), rng, octaves=4, base=10)

    # 纸底
    img = (PAPER[None, None, :] * (0.975 + 0.05 * bg_pig[..., None])).astype(np.float32)
    img = img * (1.0 - 0.030 * (fiber[..., None] - 0.5))
    # 接触阴影（淡墨一抹）
    g = cam.project(np.array([[0.0, -12.0, 0.0]]))[0]
    yy, xx = np.mgrid[0:H, 0:W]
    rr = np.sqrt(((xx - g[0]) / (330 * scale * ss / 2.6)) ** 2
                 + ((yy - g[1] - 6 * ss) / (96 * scale * ss / 2.6)) ** 2)
    shade = np.clip(1 - rr, 0, 1) ** 1.8 * 0.16 * (0.7 + 0.6 * bg_pig)
    img = img * (1 - shade[..., None]) + INK[None, None, :] * shade[..., None] * 0.35

    mo = bo.pid >= 0
    rgb_o, lit_o = wash(bo, cam, bg_pig, mo)
    img = np.where(mo[..., None], rgb_o, img)

    # 透明壳：单独一遍，菲涅尔加权合成；壳后的墨线被磨砂减弱
    for n in glassy:
        st = styles[n]
        bg_ = Buffers(H, W)
        rasterize(bg_, parts[n], cam, 900, st["color"], st.get("smooth", True), st.get("metal", 0.0))
        mg = bg_.pid >= 0
        front = mg & (bg_.depth < bo.depth)
        rgb_g, lit_g = wash(bg_, cam, bg_pig, mg)
        fres = (1 - np.abs(bg_.nrm @ cam.fwd)) ** 2.1
        a = np.clip(st["alpha"] * 0.40 + 0.86 * fres, 0, 0.93) * front
        gdx, gdy = _warp_field((H, W), rng, 1.4 * ss, base=4)
        rgb_g = _warp(rgb_g, gdx, gdy)
        a = _warp(a.astype(np.float32), gdx, gdy)
        a = a * (1 - pigment_pool(front, rng, 4.0 * ss, 0.22))
        img = img * (1 - a[..., None]) + rgb_g * a[..., None]
        # 壳上的纵向排线
        st_lines = striations((H, W), cam, bg_, front, rng, period=5.6 * ss, amp=0.26)
        st_lines = _warp(st_lines, gdx, gdy)
        img = img * (1 - st_lines[..., None]) + INK[None, None, :] * st_lines[..., None]
        ink_g = ink_edges(bg_, jitter, depth_thresh=2.0 * ss, crease=0.30)
        # 壳内物件的线：磨砂后变淡
        ink_o = ink_edges(bo, jitter, depth_thresh=1.5 * ss)
        ink_o = ink_o * np.where(front, 0.40, 1.0)
        ink = np.maximum(ink_o, ink_g * 0.88)
        ink = broken_strokes(ink, rng, ss)
        idx_, idy_ = _warp_field((H, W), rng, 0.9 * ss, base=5)
        ink = _warp(ink, idx_, idy_)
        ia = (ink * 0.96)[..., None]
        img = img * (1 - ia) + INK[None, None, :] * ia
        break
    else:
        ink = broken_strokes(ink_edges(bo, jitter), rng, ss)
        idx_, idy_ = _warp_field((H, W), rng, 0.9 * ss, base=5)
        ink = _warp(ink, idx_, idy_)
        ia = (ink * 0.96)[..., None]
        img = img * (1 - ia) + INK[None, None, :] * ia

    # 整体纸感
    img = img * (1.0 - 0.028 * (fiber[..., None] - 0.5))
    img = np.clip(img, 0, 1)

    pil = Image.fromarray((img * 255).astype(np.uint8)).resize((W0, H0), Image.LANCZOS)

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
