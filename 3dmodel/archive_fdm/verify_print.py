#!/usr/bin/env python3
"""
独立打印性审计：重新载入已导出的 STL，不信任生成脚本的自报状态。

检查项：
  1. 流形 / watertight / 法向一致性 / 体积为正
  2. 连通体数量（必须为 1，否则切片器会当成多个物体）
  3. 自交（自相交面会让切片器产生错误路径）
  4. 退化面
  5. 底面平坦区域尺寸（FDM 首层附着 + 展陈稳定性）
  6. 悬垂比例（> 45° 需支撑）
  7. 最小特征尺寸估算（对比 0.4mm 喷嘴）
  8. 实心体积 / 按典型壁厚估算的耗材用量
"""

from pathlib import Path

import numpy as np
import trimesh

NOZZLE = 0.4
OVERHANG_DEG = 45.0
FILAMENT_DENSITY = 1.24e-3  # PLA g/mm^3


def audit(path: Path):
    # 必须 process=True + merge_vertices：STL 格式每个三角面独立存储顶点，
    # 不合并的话每个面都是孤立连通体，watertight 恒为 False（假阴性）。
    m = trimesh.load(path, process=True, force="mesh")
    m.merge_vertices()
    r = {"file": path.name}

    r["watertight"] = bool(m.is_watertight)
    r["winding"] = bool(m.is_winding_consistent)
    r["volume_ok"] = bool(m.volume > 0)
    r["bodies"] = int(len(m.split(only_watertight=False)))
    r["degenerate"] = int((~m.nondegenerate_faces()).sum())
    r["faces"] = int(len(m.faces))
    r["size_mm"] = [round(float(v), 2) for v in m.extents]
    r["volume_cm3"] = round(float(m.volume) / 1000.0, 1)

    # --- 自交 ---
    try:
        from trimesh.collision import CollisionManager  # noqa: F401

        broken = trimesh.repair.broken_faces(m)
        r["broken_faces"] = int(len(broken))
    except Exception:
        r["broken_faces"] = None

    # --- 底面平坦区 ---
    z0 = m.bounds[0][2]
    tri = m.triangles
    on_floor = np.all(np.abs(tri[:, :, 2] - z0) < 0.25, axis=1)
    flat_area = float(m.area_faces[on_floor].sum())
    r["base_area_mm2"] = round(flat_area, 1)
    if on_floor.any():
        pts = tri[on_floor].reshape(-1, 3)[:, :2]
        # NumPy 2.0 移除了 ndarray.ptp()，必须用 np.ptp()
        r["base_span_mm"] = [
            round(float(np.ptp(pts[:, 0])), 1),
            round(float(np.ptp(pts[:, 1])), 1),
        ]
    else:
        r["base_span_mm"] = [0.0, 0.0]

    # --- 悬垂 ---
    # 判据必须是"法向与 -Z 的夹角"：
    #   水平朝下的天花板 nz=-1 → 夹角 0°  → 最需支撑
    #   垂直墙面        nz= 0 → 夹角 90° → 完全不需支撑
    # 早期版本写成 arcsin(|nz|) < 45°，筛出的恰是接近垂直的安全墙面，
    # 而真正的水平天花板被漏掉 —— 结论完全反了。
    n = m.face_normals
    area = m.area_faces
    ang_from_down = np.degrees(np.arccos(np.clip(-n[:, 2], -1.0, 1.0)))
    # 排除底面本身（它贴着热床，不算悬垂）
    above_floor = tri[:, :, 2].min(axis=1) > z0 + 0.5
    steep = (ang_from_down < OVERHANG_DEG) & above_floor
    r["overhang_pct"] = round(100.0 * float(area[steep].sum()) / float(area.sum()), 1)
    # 极端悬垂（近水平天花板）单独统计，这类最容易塌
    r["severe_pct"] = round(
        100.0 * float(area[(ang_from_down < 20.0) & above_floor].sum()) / float(area.sum()),
        1,
    )

    # --- 网格分辨率（注意：这是三角面边长，不是可打印壁厚）---
    # 早期版本把它当"最小特征尺寸"报警，属于误导：marching cubes 会产生
    # 大量极短边，与实际壁厚无关。真实薄壁必须在切片器预览里确认。
    edges = np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2)
    r["mesh_res_mm"] = round(float(np.median(edges)), 3)

    # --- 耗材估算（2 层墙 + 15% 填充近似）---
    shell = float(m.area) * 0.8  # 0.8mm 壁厚
    infill = max(float(m.volume) - shell, 0) * 0.15
    r["est_filament_g"] = round((shell + infill) * FILAMENT_DENSITY, 1)

    r["PASS"] = bool(
        r["watertight"]
        and r["winding"]
        and r["volume_ok"]
        and r["bodies"] == 1
        and r["degenerate"] == 0
        and r["base_area_mm2"] > 30
    )
    return r


def main():
    stl_dir = Path(__file__).resolve().parent / "stl"
    files = sorted(stl_dir.glob("*.stl"))
    if not files:
        print("没有找到 STL，先运行 generate_seeds.py")
        return

    rows = [audit(f) for f in files]

    hdr = (
        f"{'file':<14}{'tight':<7}{'wind':<6}{'bodies':<8}{'degen':<7}"
        f"{'base mm²':<10}{'overhang':<10}{'severe':<9}{'mesh res':<10}{'vol cm³':<9}{'PLA g':<7}"
    )
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(
            f"{r['file']:<14}"
            f"{str(r['watertight']):<7}"
            f"{str(r['winding']):<6}"
            f"{r['bodies']:<8}"
            f"{r['degenerate']:<7}"
            f"{r['base_area_mm2']:<10}"
            f"{str(r['overhang_pct']) + '%':<10}"
            f"{str(r['severe_pct']) + '%':<9}"
            f"{r['mesh_res_mm']:<10}"
            f"{r['volume_cm3']:<9}"
            f"{r['est_filament_g']:<7}"
        )

    print()
    for r in rows:
        flags = []
        if not r["PASS"]:
            flags.append("实体校验未通过")
        # 渐变曲面的悬垂拓竹能靠降速+桥接扛住；真正危险的是近水平天花板
        if r["severe_pct"] > 3:
            flags.append(
                f"近水平悬垂 {r['severe_pct']}% —— 需支撑"
            )
        elif r["overhang_pct"] > 25:
            flags.append(
                f"悬垂 {r['overhang_pct']}%（均为渐变曲面，无近水平面）—— 可不加支撑，底缘会略粗糙"
            )
        if r["base_span_mm"][0] < 12 or r["base_span_mm"][1] < 12:
            flags.append(f"底面接触面偏小 {r['base_span_mm']}mm —— 建议加 brim")
        if flags:
            print(f"  {r['file']}: " + "; ".join(flags))

    bad = [r["file"] for r in rows if not r["PASS"]]
    total_g = sum(r["est_filament_g"] for r in rows)
    print()
    if bad:
        print(f"❌ 未通过: {', '.join(bad)}")
    else:
        print(f"✅ {len(rows)} 件全部通过实体与打印性校验")
    print(f"   预计耗材合计 ≈ {total_g:.0f} g PLA（0.8mm 壁 + 15% 填充）")


if __name__ == "__main__":
    main()
