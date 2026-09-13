# BETWEEN symbol geometry QA

Generated from the 362 × 362 SVG snapshots in `original-vectors/`. The script removes only the known outer `g#normalized` centering translation before comparison, keeping the original part coordinates unchanged and aligned to the source tiles. Reproduce with `node seed-universe/motion/qa/run-geometry-qa.mjs` from the workspace.

## Evidence

- `source-vector-cyan-contact-sheet.png`: 12 symbol groups; each contains the supplied source, clean vector rendering, and a cyan vector overlay on the source foreground mask.
- `smoothness-200pct-contact-sheet.png` and `smoothness-200pct/01.png` through `12.png`: SVG rendered directly at 724 × 724, with no raster enlargement, to inspect curve joins and hole shapes.
- `geometry-metrics.json`: raw counts, IoU and bounds. Bounds are inclusive `left, top, right, bottom`.

## Alpha caveat and comparison method

The previous raster background-removal result retains substantial opaque neutral-gray checkerboard pixels. The raw-alpha mask therefore overstates the artwork silhouette. For example, 01 has 32,064 opaque pixels; 16,471 are near-neutral pixels in the 160–175 mean-RGB band. Raw-alpha IoU is reported for transparency and must not be treated as a pure geometry score.

The diagnostic foreground mask keeps alpha ≥ 128 and either mean RGB &lt; 120 or RGB channel spread &gt; 35. This keeps the near-black, blue and red drawing while discarding most neutral checkerboard residue. It also discards some light antialiased raster-edge pixels, so it is an approximation rather than a certified ground truth. The vector mask uses alpha ≥ 128. Both renderings remain on the same unscaled 362 × 362 coordinate grid.

Mean foreground IoU: **84.6%**. This is a diagnostic of the current smooth reconstruction, not an automatic approval threshold or proof of exact tracing.

| Symbol | Raw alpha IoU | Foreground IoU | Rejected gray/edge px | Source bounds | Vector bounds |
| --- | ---: | ---: | ---: | --- | --- |
| 01 种匣 | 42.7% | 88.8% | 17,338 | 107, 82, 265, 359 | 107, 82, 265, 358 |
| 02 镜叶 | 41.3% | 79.5% | 17,015 | 72, 129, 322, 338 | 71, 130, 320, 337 |
| 03 并茎 | 45.4% | 87.4% | 16,407 | 75, 113, 281, 347 | 76, 113, 281, 346 |
| 04 寄枝 | 31.9% | 84.2% | 18,148 | 95, 86, 267, 357 | 95, 85, 265, 357 |
| 05 环束 | 47.2% | 87.9% | 15,099 | 104, 87, 269, 333 | 105, 88, 269, 334 |
| 06 破壳 | 41.1% | 89.2% | 15,655 | 85, 72, 278, 329 | 85, 72, 277, 329 |
| 07 交汇结 | 46.7% | 85.2% | 15,777 | 40, 140, 327, 303 | 40, 140, 326, 306 |
| 08 合生 | 38.4% | 83.6% | 16,504 | 76, 106, 279, 330 | 75, 108, 279, 332 |
| 09 争隙 | 36.0% | 82.2% | 15,970 | 73, 62, 304, 263 | 72, 62, 306, 263 |
| 10 共脉 | 42.0% | 86.3% | 15,957 | 42, 114, 321, 240 | 42, 117, 320, 241 |
| 11 断丝 | 24.6% | 88.3% | 16,435 | 44, 123, 324, 231 | 44, 123, 326, 232 |
| 12 分叉 | 32.8% | 72.8% | 16,676 | 53, 60, 282, 281 | 53, 60, 281, 281 |

## Visual inspection

The contact sheets and enlarged 02 / 12 exports were visually inspected. All twelve retain their source symbol's principal topology and node count; smooth cubic curves replace the raster's rough edge texture. There is no faceted polygon tracing visible in the 200% exports. This check concerns the resting geometry only; animation frames and native Lottie playback require separate QA.

- **01, 03, 05, 06:** primary contours, enclosed negative spaces, number of dots/rays and source bounds are closely preserved. 05 regularizes the ellipse widths; 06 retains the deliberate angular shell shoulders.
- **02:** the interior leaf spaces are more regular than the source. A tiny projecting corner remains where the blue leaf outline meets its vein. This is a small join-quality difference, not a missing component or filled-in hole.
- **04:** the supporting stem, offshoot, large dark node and small red node retain their relationship. The red leaf remains an independent component, matching the reference's open junction.
- **07:** the blue and red channels and central black loop retain the woven crossing order; there are no new enclosed areas from the cyan-overlay comparison.
- **08–11:** converging drop, opposing waist, three channels and separated connectors preserve their distinct layouts and dot counts. Line widths are deliberately cleaner and more uniform than the raster.
- **12 — junctions refined:** the upper red and blue leaf tips now extend into their supporting black branches, with their animation pivots moved to those same junctions. The lower-left black stem now ends at the pendant blue leaf attachment rather than crossing most of its body. The 200% rendering was re-inspected after the change: both upper leaves remain joined, and the pendant blue body is visible. Foreground IoU changed from 72.5% to 72.8%; remaining differences concern the smoother, more uniform stems and leaf proportions, so this is not an exact tracing claim. Existing staggered leaf motion is preserved; final animation playback is checked separately.

The original source-coordinate bounds nearly touch the bottom edge for 01 and 04. The showcase's centering wrapper adds presentation breathing room; this report cancels it solely for source comparison. Motion overflow must be checked in the final centered presentation.
