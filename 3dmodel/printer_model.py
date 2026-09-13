#!/usr/bin/env python3
"""
《星环中的萌生》— 输出端：打印机的数字化 3D 建模（v2 · 具象化）

v1 太抽象（像飞碟）。v2 回到**小票打印机的可辨识轮廓**：
圆角机身 + 前上方倾斜面罩 + 撕纸口 + 纸从口里出来垂到桌面。
在此之上做艺术化：

    磨砂半透明机身（能看见内脏：纸卷 / 胶辊 / 打印头 / 主板）
  + 竖向瓦楞（Tiffany 立面 / 甲藻壳上的纵向条纹）
  + 一道倾斜 5° 的金属腰线（甲藻的横沟 = 产品的分模线）
  + 顶部一枚黑色陨石"核"，嵌在金属托圈里 —— 它的大脑
  + 面罩上一道卡缝：塔罗牌插入 = 输入
  + 纸上打出一枚像素星环 —— 唯一的"墨"

部件全部毫米，Z 向上，-Y 朝向观众（正面）。
输出 out/printer.glb（分部件 + PBR）、out/printer_*.stl、preview/*.png
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

import generate_seeds as gs

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
PREVIEW = ROOT / "preview"

# ------------------------------------------------------------------ 主尺寸
BASE_A, BASE_B, BASE_H = 104.0, 124.0, 7.0          # 金属底盘半宽 / 半深 / 厚
A, B, C = 100.0, 120.0, 85.0                        # 机身半轴
P = 9.5                                             # 超椭球指数 → 圆角方盒
Z0 = BASE_H                                         # 机身底面
CZ = Z0 + C                                         # 机身中心高
TOP = CZ + C                                        # 机身顶 = 192

# 倒角带（不是整块面罩）。只削掉顶前那道棱：
# 前脸必须保留竖直面，否则整机读成蛋糕罩 / 穹顶，而不是打印机。
VISOR_DEG = 34.0
VISOR_Y0, VISOR_Z0 = -108.0, 150.0                  # 倒角平面参考点
_TN = math.tan(math.radians(VISOR_DEG))

SLOT_Y, SLOT_W, SLOT_GAP = -104.0, 124.0, 8.0   # 出纸口：在倒角带上       # 出纸口
# 卡缝改到顶面：顶上插牌（输入）、前面出纸（输出），两个动作彻底分开
CARD_Y, CARD_W, CARD_GAP = -10.0, 74.0, 4.4
CARD_DEPTH, CARD_OUT = 76.0, 25.0               # 吃进机身 / 露在外面         # 卡缝
CORE_Y, CORE_SIZE = 36.0, 80.0                      # 顶部核
PAPER_W = 50.0
RIB_N, RIB_R, RIB_OUT = 5, 4.0, 2.2
# 观察窗：开在 +X 侧壁，正对纸卷。
# 壳做不透明 + 只开一扇窗，是"诚实的机器"在线稿语言里唯一读得通的画法 ——
# 整壳半透明会让所有轮廓一次画出来，糊成一团（试过清玻璃和奶玻璃两个极端都不成）。
WIN_Y, WIN_Z, WIN_H, WIN_V = 34.0, 100.0, 74.0, 66.0
WALL = 3.5          # 壁厚。机身必须抽壳：superellipsoid 出来是实心体，
                    # 不挖内腔的话窗口只是在实心材料上挖坑，纸卷/主板全埋在实体里。                # 瓦楞
GIRDLE_TILT, GIRDLE_W, GIRDLE_OUT, GIRDLE_T = 2.5, 5.0, -2.6, 2.4


def visor_z(y):
    """面罩平面在给定 y 处的高度。"""
    return VISOR_Z0 + _TN * (y - VISOR_Y0)


# ------------------------------------------------------------------ 材质
COL = {
    "shell": (0.933, 0.945, 0.929),   # 机身：近白微青
    "cavity": (0.784, 0.792, 0.776),  # 内腔衬里：窗口后的阴影
    "steel": (0.800, 0.812, 0.827),   # 拉丝钢
    "dark_steel": (0.596, 0.616, 0.639),
    "graphite": (0.227, 0.231, 0.251),
    "black": (0.110, 0.098, 0.129),   # 陨石黑
    "paper": (0.988, 0.984, 0.965),
    "ink": (0.086, 0.082, 0.098),
    "card": (0.043, 0.039, 0.070),
    "rose": (0.890, 0.776, 0.808),    # 藻绘图里的淡玫
    "sage": (0.796, 0.847, 0.769),    # 藻绘图里的淡青
    "vermillion": (0.839, 0.271, 0.169),
}


def mat(name, rgb, metallic=0.0, roughness=0.5, alpha=1.0):
    return PBRMaterial(
        name=name, baseColorFactor=[*rgb, alpha],
        metallicFactor=metallic, roughnessFactor=roughness,
        alphaMode="BLEND" if alpha < 1 else "OPAQUE",
    )


MATS = {
    "shell": mat("shell", COL["shell"], 0.0, 0.42),
    "cavity": mat("cavity", COL["cavity"], 0.0, 0.72),
    "steel": mat("brushed_steel", COL["steel"], 1.0, 0.26),
    "dark_steel": mat("dark_steel", COL["dark_steel"], 0.95, 0.42),
    "graphite": mat("graphite", COL["graphite"], 0.35, 0.62),
    "black": mat("meteorite", COL["black"], 0.0, 0.86),
    "paper": mat("paper", COL["paper"], 0.0, 0.92),
    "ink": mat("thermal_ink", COL["ink"], 0.0, 0.78),
    "card": mat("card", COL["card"], 0.0, 0.60),
    "rose": mat("rose", COL["rose"], 0.0, 0.70),
    "sage": mat("sage", COL["sage"], 0.0, 0.66),
    "vermillion": mat("indicator", COL["vermillion"], 0.0, 0.40),
}


# ------------------------------------------------------------------ 几何工具
def spow(x, e):
    return np.sign(x) * np.abs(x) ** e


def superellipsoid(a, b, c, p, nu=64, nv=128):
    e = 2.0 / p
    u = np.linspace(-math.pi / 2, math.pi / 2, nu)
    v = np.linspace(-math.pi, math.pi, nv, endpoint=False)
    U, V = np.meshgrid(u, v, indexing="ij")
    x = a * spow(np.cos(U), e) * spow(np.cos(V), e)
    y = b * spow(np.cos(U), e) * spow(np.sin(V), e)
    z = c * spow(np.sin(U), e)
    verts = np.stack([x, y, z], -1)
    # 两极必须精确落在轴上。spow(cos(±π/2), 2/p) 会留下 ~1e-4 mm 的残余半径，
    # 低于 merge_vertices 阈值却又不为零 → 每极留下一圈 nv 个不重合顶点，
    # 网格出现 2*nv 条边界边，manifold 直接拒绝布尔（"Not all meshes are volumes"）。
    verts[0, :, :2] = 0.0
    verts[-1, :, :2] = 0.0
    verts = verts.reshape(-1, 3)
    faces = []
    for i in range(nu - 1):
        for j in range(nv):
            j2 = (j + 1) % nv
            p00, p01 = i * nv + j, i * nv + j2
            p10, p11 = (i + 1) * nv + j, (i + 1) * nv + j2
            faces.append([p00, p10, p11])
            faces.append([p00, p11, p01])
    m = trimesh.Trimesh(verts, np.asarray(faces), process=True)
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    trimesh.repair.fix_normals(m)
    return m


def se_radius(theta, z, a=A, b=B, c=C, p=P):
    """超椭球在高度 z、方位 theta 处的水平半径。"""
    k = 1.0 - min(abs(z / c) ** p, 1.0)
    if k <= 0:
        return 0.0
    ct, st = abs(math.cos(theta)), abs(math.sin(theta))
    return (((ct / a) ** p + (st / b) ** p) / k) ** (-1.0 / p)


def ray_hit_se(origins, dirs, a, b, c, p, r_hi=420.0, it=44):
    lo = np.zeros(len(origins))
    hi = np.full(len(origins), r_hi)
    for _ in range(it):
        mid = 0.5 * (lo + hi)
        q = origins + dirs * mid[:, None]
        f = (np.abs(q[:, 0] / a) ** p + np.abs(q[:, 1] / b) ** p + np.abs(q[:, 2] / c) ** p) - 1.0
        inside = f < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return 0.5 * (lo + hi)


def loft_closed(rings):
    rings = [np.asarray(r) for r in rings]
    n, m = len(rings[0]), len(rings)
    verts = np.concatenate(rings)
    faces = []
    for k in range(m):
        k2 = (k + 1) % m
        for j in range(n):
            j2 = (j + 1) % n
            a0, a1, b0, b1 = k * n + j, k * n + j2, k2 * n + j, k2 * n + j2
            faces.append([a0, b0, b1])
            faces.append([a0, b1, a1])
    mesh = trimesh.Trimesh(verts, np.asarray(faces), process=True)
    trimesh.repair.fix_normals(mesh)
    return mesh


def tube(path, radius, sections=12):
    """沿 3D 曲线扫掠一根管（radius 可为标量或逐点数组），两端封盖。"""
    P_ = np.asarray(path, float)
    R_ = np.full(len(P_), float(radius)) if np.isscalar(radius) else np.asarray(radius, float)
    T = np.gradient(P_, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    ang = np.linspace(0, 2 * math.pi, sections, endpoint=False)
    rings = []
    for pt, t, r in zip(P_, T, R_):
        a = np.cross(t, [0.0, 0.0, 1.0])
        if np.linalg.norm(a) < 1e-6:
            a = np.cross(t, [1.0, 0.0, 0.0])
        a /= np.linalg.norm(a)
        b = np.cross(t, a)
        rings.append(pt[None, :] + r * (np.cos(ang)[:, None] * a[None, :]
                                        + np.sin(ang)[:, None] * b[None, :]))
    n, m = sections, len(rings)
    verts = np.concatenate(rings)
    faces = []
    for k in range(m - 1):
        for j in range(n):
            j2 = (j + 1) % n
            a0, a1 = k * n + j, k * n + j2
            b0, b1 = (k + 1) * n + j, (k + 1) * n + j2
            faces.append([a0, b0, b1])
            faces.append([a0, b1, a1])
    c0 = len(verts)
    verts = np.vstack([verts, rings[0].mean(0), rings[-1].mean(0)])
    for j in range(n):
        j2 = (j + 1) % n
        faces.append([c0, j2, j])
        faces.append([c0 + 1, (m - 1) * n + j, (m - 1) * n + j2])
    mesh = trimesh.Trimesh(verts, np.asarray(faces), process=True)
    trimesh.repair.fix_normals(mesh)
    return mesh


def loft_open(rings):
    """把等点数的开口曲线缝成一条带端盖的实体（腰线只走后弧，不闭合成整圈）。"""
    rings = [np.asarray(r) for r in rings]
    n, m = len(rings[0]), len(rings)
    verts = np.concatenate(rings)
    faces = []
    for k in range(m):
        k2 = (k + 1) % m
        for j in range(n - 1):
            a0, a1, b0, b1 = k * n + j, k * n + j + 1, k2 * n + j, k2 * n + j + 1
            faces.append([a0, b0, b1])
            faces.append([a0, b1, a1])
    for j, sgn in ((0, 1), (n - 1, -1)):
        quad = [k * n + j for k in range(m)]
        tri = [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]]
        faces += [t[::sgn] for t in tri]
    mesh = trimesh.Trimesh(verts, np.asarray(faces), process=True)
    trimesh.repair.fix_normals(mesh)
    return mesh


def box(size, center, rot=None):
    m = trimesh.creation.box(extents=size)
    if rot is not None:
        m.apply_transform(rot)
    m.apply_translation(center)
    return m


def rot_x(deg):
    return trimesh.transformations.rotation_matrix(math.radians(deg), [1, 0, 0])


def cyl_x(r, length, center, sections=32):
    m = trimesh.creation.cylinder(radius=r, height=length, sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    m.apply_translation(center)
    return m


def concat(ms):
    return trimesh.util.concatenate([m for m in ms if m is not None and len(m.faces)])


def boolean(op, meshes, label):
    try:
        r = getattr(trimesh.boolean, op)(meshes, engine="manifold")
        if len(r.faces):
            return r
        print(f"  ! {label}: 布尔结果为空，保留原件")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {label}: 布尔失败 {exc}")
    return meshes[0]


def chaikin(pts, iters=3):
    P_ = np.asarray(pts, float)
    for _ in range(iters):
        out = [P_[0]]
        for i in range(len(P_) - 1):
            out.append(0.75 * P_[i] + 0.25 * P_[i + 1])
            out.append(0.25 * P_[i] + 0.75 * P_[i + 1])
        out.append(P_[-1])
        P_ = np.asarray(out)
    return P_


def ribbon(path_yz, width, thick):
    """把 (y,z) 中心线扩成一条宽 width、厚 thick 的实体薄带（沿 X 展开）。"""
    Pp = np.asarray(path_yz, float)
    rails = [[], [], [], []]
    for i in range(len(Pp)):
        i0, i1 = max(i - 1, 0), min(i + 1, len(Pp) - 1)
        t = Pp[i1] - Pp[i0]
        t /= max(np.linalg.norm(t), 1e-9)
        nrm = np.array([-t[1], t[0]])
        lo, hi = Pp[i], Pp[i] + nrm * thick
        rails[0].append([-width / 2, lo[0], lo[1]])
        rails[1].append([width / 2, lo[0], lo[1]])
        rails[2].append([width / 2, hi[0], hi[1]])
        rails[3].append([-width / 2, hi[0], hi[1]])
    n = len(Pp)
    verts = np.concatenate([np.array(r) for r in rails])
    faces = []
    for i in range(n - 1):
        for k in range(4):
            k2 = (k + 1) % 4
            a0, a1, b0, b1 = k * n + i, k * n + i + 1, k2 * n + i, k2 * n + i + 1
            faces.append([a0, b0, b1])
            faces.append([a0, b1, a1])
    faces += [[0, n, 2 * n], [0, 2 * n, 3 * n]]
    e = n - 1
    faces += [[e, 2 * n + e, n + e], [e, 3 * n + e, 2 * n + e]]
    m = trimesh.Trimesh(verts, np.asarray(faces), process=True)
    trimesh.repair.fix_normals(m)
    return m


# ------------------------------------------------------------------ 部件
def make_base():
    plate = superellipsoid(BASE_A, BASE_B, BASE_H / 2, 8.0, nu=28, nv=72)
    plate.apply_translation([0, 0, BASE_H / 2])
    return plate


def rounded_slab(h, v, thick, center):
    """沿 X 向的圆角矩形板（做观察窗切口用）。"""
    m = superellipsoid(thick / 2, h / 2, v / 2, 7.0, nu=30, nv=64)
    m.apply_translation(center)
    return m


def make_ribs():
    """竖向瓦楞。

    必须让管轴**沿机身表面**走（半径随高度变化），并在两端收细到 0。
    早先用等半径圆柱 + 放大包壳求交：机身向上收窄后，整根圆柱跑到壳外，
    渲染出来是一排悬空的细杆，而不是壳上的棱。
    """
    t0, t1 = math.radians(96.0), math.radians(206.0)   # 只在后半圈
    zl = np.linspace(-0.86 * C, 0.86 * C, 46)
    ribs = []
    for i in range(RIB_N):
        t = t0 + (t1 - t0) * i / (RIB_N - 1)
        r = np.array([se_radius(t, z) for z in zl])
        path = np.stack([r * math.cos(t), r * math.sin(t), zl + CZ], -1)
        u = np.linspace(0.0, 1.0, len(zl))
        rad = RIB_R * np.sin(math.pi * u) ** 0.45      # 两端收细，自然融入壳面
        ribs.append(tube(path, np.maximum(rad, 0.12), sections=12))
    return ribs


def make_shell():
    body = superellipsoid(A, B, C, P)
    body.apply_translation([0, 0, CZ])
    body = boolean("union", [body] + make_ribs(), "body∪ribs")

    rv = rot_x(VISOR_DEG)
    n = np.array([0.0, -math.sin(math.radians(VISOR_DEG)), math.cos(math.radians(VISOR_DEG))])

    cuts = []
    # 顶前棱倒角带：只削掉这一道棱，前脸保持竖直
    cuts.append(box((520, 520, 520), np.array([0, VISOR_Y0, VISOR_Z0]) + n * 260, rv))
    # 出纸口：垂直于倒角面穿进去
    cuts.append(box((SLOT_W, SLOT_GAP, 150),
                    np.array([0, SLOT_Y, visor_z(SLOT_Y)]) - n * 60, rv))
    # 卡缝：从顶面竖直切下（塔罗牌从上方插入）
    cuts.append(box((CARD_W, CARD_GAP, CARD_DEPTH + 12),
                    (0, CARD_Y, TOP - CARD_DEPTH / 2 + 6)))
    # 观察窗：圆角矩形穿透 +X 侧壁
    cuts.append(rounded_slab(WIN_H, WIN_V, 60.0, (A - 22.0, WIN_Y, WIN_Z)))
    # 顶部核的浅凹槽
    dish = trimesh.creation.icosphere(subdivisions=4, radius=40.0)
    dish.apply_translation([0, CORE_Y, TOP + 40.0 - 15.0])
    cuts.append(dish)

    # 内腔：抽壳，壁厚 WALL。也让模型真的可打印。
    cavity = superellipsoid(A - WALL, B - WALL, C - WALL, P, nu=56, nv=112)
    cavity.apply_translation([0, 0, CZ])
    cuts.append(cavity)

    return boolean("difference", [body] + cuts, "shell cuts")


def make_core():
    sdf, spacing, origin = gs.seed_sdf(0.0, 101, n=140, revolt=False)
    mesh, _ = gs.sdf_to_mesh(sdf, spacing, origin, CORE_SIZE, "core")
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(-14), [0, 1, 0]))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(6), [1, 0, 0]))
    b = mesh.bounds
    mesh.apply_translation([-(b[0][0] + b[1][0]) / 2, CORE_Y - (b[0][1] + b[1][1]) / 2, -b[0][2]])
    mesh.apply_translation([0, 0, TOP - 26.0])
    return mesh


def make_core_ring():
    """托圈：把核像宝石一样嵌住。"""
    ring = trimesh.creation.torus(major_radius=30.0, minor_radius=2.0, major_sections=96, minor_sections=14)
    ring.apply_translation([0, CORE_Y, TOP - 7.0])
    posts = [ring]
    for k in range(3):
        a = math.radians(90 + k * 120)
        p = trimesh.creation.cylinder(radius=1.5, height=15.0, sections=16)
        p.apply_translation([30 * math.cos(a), CORE_Y + 30 * math.sin(a), TOP - 14.0])
        posts.append(p)
    return concat(posts)


def _visor_lip(y_center, width, gap, out=2.4, thick=2.0):
    """倒角带开口的撕纸唇 —— 只在纸的下侧一条。

    两侧各一条会在机身上并排出现两根铬管，读成行李箱拉杆。
    """
    rv = rot_x(VISOR_DEG)
    n = np.array([0.0, -math.sin(math.radians(VISOR_DEG)), math.cos(math.radians(VISOR_DEG))])
    inplane = np.array([0.0, math.cos(math.radians(VISOR_DEG)), math.sin(math.radians(VISOR_DEG))])
    c = (np.array([0, y_center, visor_z(y_center)])
         - inplane * (gap / 2 + out / 2) + n * (thick / 2 - 0.6))
    return box((width + 2 * out, out, thick), c, rv)


def make_trim():
    """全部金属细件：出纸口唇 + 撕纸边 + 卡缝唇 + 铰链杆。"""
    parts = [_visor_lip(SLOT_Y, SLOT_W, SLOT_GAP, out=2.2, thick=1.4)]
    # 观察窗的金属框
    outer = rounded_slab(WIN_H + 9.0, WIN_V + 9.0, 3.0, (A - 4.0, WIN_Y, WIN_Z))
    inner = rounded_slab(WIN_H, WIN_V, 12.0, (A - 4.0, WIN_Y, WIN_Z))
    parts.append(boolean("difference", [outer, inner], "window frame"))
    # 顶面卡缝的唇：两条贴着顶面的窄金属条
    for s_ in (-1, 1):
        parts.append(box((CARD_W + 6.0, 2.6, 1.8),
                         (0, CARD_Y + s_ * (CARD_GAP / 2 + 1.3), TOP - 1.2)))
    return concat(parts)


def make_card():
    """竖直插在顶面缝里的空白纸（塔罗牌与打印图案的先后顺序未定，先不画内容）。"""
    h = CARD_DEPTH * 0.62 + CARD_OUT
    return box((CARD_W - 3.0, 0.5, h), (0, CARD_Y, TOP + CARD_OUT - h / 2))


def make_guts():
    """透过磨砂壳看见的内脏 —— 这台机器不假装自己是黑盒。"""
    roll = cyl_x(40.0, 104.0, [0, 40.0, 100.0], sections=48)
    core_tube = cyl_x(11.0, 112.0, [0, 40.0, 100.0], sections=28)
    roller = cyl_x(9.5, 128.0, [0, -44.0, 138.0], sections=32)
    head = box((124.0, 13.0, 8.0), (0, -58.0, 150.0))
    pcb = box((108.0, 84.0, 2.4), (0, 34.0, 15.0))
    return {"roll": roll, "roll_core": core_tube, "roller": roller, "head": head, "pcb": pcb}


# (y, z) 中心线。起点在撕纸口内侧，切向沿面罩朝外上方 —— 纸看起来是被"吐"出来的。
# (y, z) 中心线：出撕纸口 → 贴前壁垂下 → 落到桌面 → 向外卷出。
# 末端必须落到 z≈6（桌面），停在半空会读成一块挂布而不是一条小票。
# (y, z) 中心线：出倒角带的撕纸口 → 翻过前棱 → 贴竖直前脸垂下 → 落桌面向外卷。
PAPER_PATH = [
    (-100, 149), (-113, 155), (-124, 152), (-130, 142),
    (-132, 124), (-133, 98), (-133, 70), (-132, 44), (-134, 24),
    (-140, 11), (-153, 5), (-175, 4), (-198, 6), (-216, 12), (-228, 20),
]


def make_paper():
    path = chaikin(PAPER_PATH, iters=4)
    return ribbon(path, PAPER_W, 0.9), path


GLYPH = [
    "..###..",
    ".#...#.",
    "#.....#",
    "#..#..#",
    "#.....#",
    ".#...#.",
    "..###..",
]


def make_glyph(path, y_center=-176.0, px=6.0):
    """纸上的像素星环：中心一点 = 种子。热敏机的分辨率就是这种语言。"""
    z = float(np.interp(-y_center, -path[:, 0][::-1], path[:, 1][::-1])) + 1.4
    rows, cols = len(GLYPH), len(GLYPH[0])
    cells = []
    for r, line in enumerate(GLYPH):
        for c, ch in enumerate(line):
            if ch != "#":
                continue
            x = (c - (cols - 1) / 2) * px
            y = y_center - (r - (rows - 1) / 2) * px
            cells.append(box((px * 0.92, px * 0.92, 0.6), (x, y, z)))
    return concat(cells)


def make_indicator():
    m = cyl_x(3.6, 3.0, [52.0, -120.0, 100.0], sections=24)
    return m


# ------------------------------------------------------------------ 预览渲染
PART_MAT = {
    "base": "dark_steel", "shell": "shell", "girdle": "steel", "trim": "steel", "cavity": "cavity",
    "core": "black", "core_ring": "steel", "card": "paper", "paper": "paper",
    "glyph": "ink", "roll": "roll", "roll_core": "rose", "roller": "graphite",
    "head": "steel", "pcb": "sage", "indicator": "vermillion",
}
# "shell" 必须列在这里：NPR 渲染器按 DRAW_ORDER 过滤部件，
# 漏掉它会让整个透明壳静默消失（只剩内脏悬在空中）。
DRAW_ORDER = ["base", "cavity", "pcb", "roll_core", "roll", "roller", "head", "core", "core_ring",
              "trim", "card", "indicator", "girdle", "paper", "shell"]


def make_cavity():
    """内腔衬里：比外壳略小的一层，给窗口后面一个更暗的底。

    窗口读得出来靠的是"里面比外面暗"，不是靠画框。
    衬里是闭合实体，**必须把窗口也从它身上挖掉** ——
    否则它的近侧壁正好挡在纸卷前面，窗口里只看得到衬里外表面。
    """
    inner = superellipsoid(A - WALL - 0.6, B - WALL - 0.6, C - WALL - 0.6, P, nu=52, nv=104)
    inner.apply_translation([0, 0, CZ])
    win = rounded_slab(WIN_H, WIN_V, 60.0, (A - 22.0, WIN_Y, WIN_Z))
    return boolean("difference", [inner, win], "cavity window")


def make_girdle():
    tl = math.radians(GIRDLE_TILT)
    n = np.array([0.0, -math.sin(tl), math.cos(tl)])
    e1 = np.array([1.0, 0.0, 0.0])
    e2 = np.cross(n, e1)
    th = np.linspace(math.radians(4), math.radians(176), 180)
    d = np.outer(np.cos(th), e1) + np.outer(np.sin(th), e2)
    rings = []
    for s, lift in ((-GIRDLE_W / 2, GIRDLE_OUT), (-GIRDLE_W / 2, GIRDLE_OUT + GIRDLE_T),
                    (GIRDLE_W / 2, GIRDLE_OUT + GIRDLE_T), (GIRDLE_W / 2, GIRDLE_OUT)):
        org = np.tile(n * s, (len(th), 1))
        r = ray_hit_se(org, d, A, B, C, P)
        rings.append(org + d * (r + lift)[:, None])
    g = loft_open(rings)
    g.apply_translation([0, 0, CZ + 4.0])
    return g


def render(parts, path, view="hero", size=(1700, 1275)):
    from PIL import Image, ImageFilter

    W, H = size
    yaw, pitch, scale, ctr = {
        "hero": (math.radians(-34), math.radians(21), 2.55, (0, -55, 92)),
        "front": (math.radians(-2), math.radians(10), 2.55, (0, -40, 96)),
        "side": (math.radians(-86), math.radians(9), 2.45, (0, -50, 96)),
        "top": (math.radians(-26), math.radians(56), 2.35, (0, -55, 80)),
    }[view]
    fwd = np.array([math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), -math.sin(pitch)])
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    key = np.array([-0.42, -0.46, 0.78]); key /= np.linalg.norm(key)
    rim = np.array([0.55, 0.30, 0.42]); rim /= np.linalg.norm(rim)

    color = np.full((H, W, 3), 0.972, np.float32)
    depth = np.full((H, W), np.inf, np.float32)
    cx, cy = W / 2, H * 0.60
    ctr = np.asarray(ctr, float)

    def project(p):
        rel = p - ctr
        return ((rel @ right) * scale + cx).astype(int), (-(rel @ up) * scale + cy).astype(int), rel @ fwd

    # 接触阴影
    gx, gy, _ = project(np.array([[0.0, -10.0, 0.0]]))
    yy, xx = np.mgrid[0:H, 0:W]
    rr = np.sqrt(((xx - gx[0]) / (BASE_A * 2.5 * scale * 0.52)) ** 2
                 + ((yy - gy[0] - 8) / (BASE_B * 2.3 * scale * 0.20)) ** 2)
    color -= (np.clip(1 - rr, 0, 1) ** 1.7 * 0.15)[..., None]

    def splat(mesh, rgb, alpha=1.0, density=11.0, metal=0.0):
        pts, fidx = trimesh.sample.sample_surface(mesh, max(int(mesh.area * density), 400))
        nrm = mesh.face_normals[fidx]
        sx, sy, d = project(pts)
        ok = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
        sx, sy, d, nrm = sx[ok], sy[ok], d[ok], nrm[ok]
        o = np.argsort(-d)
        sx, sy, d, nrm = sx[o], sy[o], d[o], nrm[o]
        lam = np.clip(nrm @ key, 0, 1)
        sky = 0.5 + 0.5 * nrm[:, 2]
        rimv = np.clip(nrm @ rim, 0, 1) ** 2
        shade = 0.30 * sky + 0.62 * lam + 0.24 * rimv
        col = np.asarray(rgb)[None, :] * (0.42 + 0.68 * shade[:, None])
        if metal:
            spec = np.clip(nrm @ key, 0, 1) ** 26
            col = col + (spec * metal)[:, None] * 0.55
        if alpha >= 1.0:
            depth[sy, sx] = d
            color[sy, sx] = col
        else:
            vis = d < depth[sy, sx]
            sx, sy, col, nrm = sx[vis], sy[vis], col[vis], nrm[vis]
            fres = (1 - np.abs(nrm @ fwd)) ** 2.0
            a = np.clip(alpha * 0.5 + 0.8 * fres, 0, 0.94)[:, None]
            spec = (np.clip(nrm @ key, 0, 1) ** 44 * 0.4)[:, None]
            color[sy, sx] = color[sy, sx] * (1 - a) + (col + spec) * a

    for name in DRAW_ORDER:
        if name not in parts:
            continue
        m = PART_MAT[name]
        metal = 1.0 if m in ("steel", "dark_steel") else 0.0
        splat(parts[name], COL[m], density=16.0 if name == "glyph" else 11.0, metal=metal)
    splat(parts["shell"], COL["shell"], alpha=0.34, density=8.0)

    img = Image.fromarray((np.clip(color, 0, 1) * 255).astype(np.uint8))
    img.filter(ImageFilter.GaussianBlur(0.55)).save(path)


def build_parts():
    parts = {}
    parts["base"] = make_base()
    parts["shell"] = make_shell()
    parts["cavity"] = make_cavity()
    parts["girdle"] = make_girdle()
    parts["core"] = make_core()
    parts["core_ring"] = make_core_ring()
    parts["trim"] = make_trim()
    parts["card"] = make_card()
    parts.update(make_guts())
    paper, path = make_paper()
    parts["paper"] = paper
    # 塔罗牌与打印图案的先后顺序尚未确定 —— 插入的和吐出的都先用空白纸占位。
    # 定稿后取消下一行注释即可把图案印回纸上。
    # parts["glyph"] = make_glyph(path)
    parts["indicator"] = make_indicator()
    return parts


def main():
    np.seterr(all="ignore")
    OUT.mkdir(exist_ok=True)
    PREVIEW.mkdir(exist_ok=True)
    print("建模 …")
    parts = build_parts()

    scene = trimesh.Scene()
    report = []
    for name, m in parts.items():
        m.visual = trimesh.visual.TextureVisuals(material=MATS[PART_MAT[name]])
        scene.add_geometry(m, node_name=name, geom_name=name)
        report.append({"part": name, "material": PART_MAT[name], "faces": int(len(m.faces)),
                       "watertight": bool(m.is_watertight),
                       "size_mm": [round(float(x), 1) for x in m.extents]})
        print(f"  {name:11s} {PART_MAT[name]:11s} faces={len(m.faces):6d} "
              f"wt={m.is_watertight!s:5s} size={np.round(m.extents, 1)}")
    glb = OUT / "printer.glb"
    scene.export(glb)
    (ROOT / "printer_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    for name, m in parts.items():
        m.export(OUT / f"printer_{name}.stl")
    bb = scene.bounds
    print(f"整体外廓 {np.round(bb[1] - bb[0], 1)} mm")
    print(f"GLB → {glb} ({glb.stat().st_size / 1e6:.1f} MB)")

    print("渲染 …")
    for v in ("hero", "front", "side", "top"):
        render(parts, PREVIEW / f"printer_{v}.png", view=v)
        print("  ", f"preview/printer_{v}.png")


if __name__ == "__main__":
    main()
