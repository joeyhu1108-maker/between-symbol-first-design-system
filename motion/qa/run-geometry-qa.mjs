import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from '/Users/huzhuoyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs';

const qa = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(qa, '../../..');
const sourceDir = path.join(root, 'output/art/between-symbols-v1/individual');
const snapshotDir = path.join(qa, 'original-vectors');
const size = 362;
const sourceFiles = (await fs.readdir(sourceDir)).filter(f => f.endsWith('.png')).sort();
await fs.mkdir(path.join(qa, 'smoothness-200pct'), { recursive: true });
const labelSvg = (text, width = 724, height = 36, fontSize = 20) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="16" y="${Math.round(height * 0.68)}" font-family="Arial,sans-serif" font-size="${fontSize}" fill="#23332f">${text}</text></svg>`);
const records = [];
const sheet = [];
const enlarged = [];

function mask(data, removeResidual = false) {
  const result = new Uint8Array(size * size);
  for (let i = 0; i < result.length; i++) {
    const p = i * 4;
    const [r, g, b, a] = data.subarray(p, p + 4);
    const lightness = (r + g + b) / 3;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    result[i] = a >= 128 && (!removeResidual || lightness < 120 || chroma > 35) ? 1 : 0;
  }
  return result;
}
function bbox(m) {
  let left = size, right = 0, top = size, bottom = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) {
    const x = i % size, y = Math.floor(i / size);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}
function compare(a, b) {
  let intersection = 0, union = 0, source = 0, vector = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += a[i] && b[i] ? 1 : 0;
    union += a[i] || b[i] ? 1 : 0;
    source += a[i]; vector += b[i];
  }
  return { iou: intersection / union, intersection, union, sourcePixels: source, vectorPixels: vector };
}
function overlay(sourceMask, vectorMask) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < sourceMask.length; i++) {
    let rgb = sourceMask[i] ? [20, 25, 23] : [249, 249, 244];
    if (vectorMask[i]) rgb = rgb.map((value, channel) => Math.round(value * 0.42 + [0, 181, 205][channel] * 0.58));
    out.set([...rgb, 255], i * 4);
  }
  return out;
}

for (let index = 0; index < sourceFiles.length; index++) {
  const sourceFile = sourceFiles[index];
  const id = sourceFile.slice(0, 2);
  const name = sourceFile.slice(3, -4);
  // The showcase build may have already added a single centering wrapper.
  // Remove only that known presentation translation; preserve every part coordinate.
  const svg = Buffer.from((await fs.readFile(path.join(snapshotDir, `${id}.svg`), 'utf8')).replace(/(<g id="normalized") transform="translate\([^\"]+\)"/, '$1'));
  const sourceRaw = await sharp(path.join(sourceDir, sourceFile)).ensureAlpha().raw().toBuffer();
  const vectorRaw = await sharp(svg).resize(size, size).ensureAlpha().raw().toBuffer();
  const sourceAlpha = mask(sourceRaw);
  const sourceForeground = mask(sourceRaw, true);
  const vectorAlpha = mask(vectorRaw);
  const original = compare(sourceAlpha, vectorAlpha);
  const foreground = compare(sourceForeground, vectorAlpha);
  const sourceBounds = bbox(sourceForeground), vectorBounds = bbox(vectorAlpha);
  const residualPixels = original.sourcePixels - foreground.sourcePixels;
  const record = { id, name, rawAlpha: original, foreground, residualPixels, sourceBounds, vectorBounds };
  records.push(record);
  const comparison = await sharp(overlay(sourceForeground, vectorAlpha), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  await fs.writeFile(path.join(qa, `${id}-cyan-overlay.png`), comparison);
  const smooth = await sharp(svg, { density: 144 }).resize(724, 724).flatten({ background: '#f9f9f4' }).png().toBuffer();
  await fs.writeFile(path.join(qa, 'smoothness-200pct', `${id}.png`), smooth);
  const sourceImage = await sharp(path.join(sourceDir, sourceFile)).resize(224, 224).flatten({ background: '#f9f9f4' }).png().toBuffer();
  const vectorImage = await sharp(svg).resize(224, 224).flatten({ background: '#f9f9f4' }).png().toBuffer();
  const overlayImage = await sharp(comparison).resize(224, 224).png().toBuffer();
  const left = (index % 3) * 724, top = Math.floor(index / 3) * 314;
  sheet.push({ input: labelSvg(`${id} ${name} / foreground IoU ${(foreground.iou * 100).toFixed(1)}%`), left, top });
  for (const [j, img] of [sourceImage, vectorImage, overlayImage].entries()) sheet.push({ input: img, left: left + 16 + j * 236, top: top + 40 });
  for (const [j, label] of ['SOURCE + residual gray', 'VECTOR', 'CYAN OVER SOURCE MASK'].entries()) sheet.push({ input: labelSvg(label, 224, 28, 12), left: left + 16 + j * 236, top: top + 269 });
  const smoothTop = Math.floor(index / 3) * 766, smoothLeft = (index % 3) * 724;
  enlarged.push({ input: smooth, left: smoothLeft, top: smoothTop + 42 }, { input: labelSvg(`${id} ${name} / 200%`), left: smoothLeft, top: smoothTop });
}

await sharp({ create: { width: 2172, height: 1256, channels: 4, background: '#eeeee7' } }).composite(sheet).png().toFile(path.join(qa, 'source-vector-cyan-contact-sheet.png'));
await sharp({ create: { width: 2172, height: 3064, channels: 4, background: '#eeeee7' } }).composite(enlarged).png().toFile(path.join(qa, 'smoothness-200pct-contact-sheet.png'));
await fs.writeFile(path.join(qa, 'geometry-metrics.json'), JSON.stringify(records, null, 2));

const mean = records.reduce((sum, r) => sum + r.foreground.iou, 0) / records.length;
const table = records.map(r => `| ${r.id} ${r.name} | ${(r.rawAlpha.iou * 100).toFixed(1)}% | ${(r.foreground.iou * 100).toFixed(1)}% | ${r.residualPixels.toLocaleString('en-US')} | ${r.sourceBounds.join(', ')} | ${r.vectorBounds.join(', ')} |`).join('\n');
const report = `# BETWEEN symbol geometry QA

Generated from the 362 × 362 SVG snapshots in \`original-vectors/\`. The script removes only the known outer \`g#normalized\` centering translation before comparison, keeping the original part coordinates unchanged and aligned to the source tiles. Reproduce with \`node seed-universe/motion/qa/run-geometry-qa.mjs\` from the workspace.

## Evidence

- \`source-vector-cyan-contact-sheet.png\`: 12 symbol groups; each contains the supplied source, clean vector rendering, and a cyan vector overlay on the source foreground mask.
- \`smoothness-200pct-contact-sheet.png\` and \`smoothness-200pct/01.png\` through \`12.png\`: SVG rendered directly at 724 × 724, with no raster enlargement, to inspect curve joins and hole shapes.
- \`geometry-metrics.json\`: raw counts, IoU and bounds. Bounds are inclusive \`left, top, right, bottom\`.

## Alpha caveat and comparison method

The previous raster background-removal result retains substantial opaque neutral-gray checkerboard pixels. The raw-alpha mask therefore overstates the artwork silhouette. For example, 01 has 32,064 opaque pixels; 16,471 are near-neutral pixels in the 160–175 mean-RGB band. Raw-alpha IoU is reported for transparency and must not be treated as a pure geometry score.

The diagnostic foreground mask keeps alpha ≥ 128 and either mean RGB &lt; 120 or RGB channel spread &gt; 35. This keeps the near-black, blue and red drawing while discarding most neutral checkerboard residue. It also discards some light antialiased raster-edge pixels, so it is an approximation rather than a certified ground truth. The vector mask uses alpha ≥ 128. Both renderings remain on the same unscaled 362 × 362 coordinate grid.

Mean foreground IoU: **${(mean * 100).toFixed(1)}%**. This is a diagnostic of the current smooth reconstruction, not an automatic approval threshold or proof of exact tracing.

| Symbol | Raw alpha IoU | Foreground IoU | Rejected gray/edge px | Source bounds | Vector bounds |
| --- | ---: | ---: | ---: | --- | --- |
${table}

## Visual inspection

The contact sheets and enlarged 02 / 12 exports were visually inspected. All twelve retain their source symbol's principal topology and node count; smooth cubic curves replace the raster's rough edge texture. There is no faceted polygon tracing visible in the 200% exports. This check concerns the resting geometry only; animation frames and native Lottie playback require separate QA.

- **01, 03, 05, 06:** primary contours, enclosed negative spaces, number of dots/rays and source bounds are closely preserved. 05 regularizes the ellipse widths; 06 retains the deliberate angular shell shoulders.
- **02:** the interior leaf spaces are more regular than the source. A tiny projecting corner remains where the blue leaf outline meets its vein. This is a small join-quality difference, not a missing component or filled-in hole.
- **04:** the supporting stem, offshoot, large dark node and small red node retain their relationship. The red leaf remains an independent component, matching the reference's open junction.
- **07:** the blue and red channels and central black loop retain the woven crossing order; there are no new enclosed areas from the cyan-overlay comparison.
- **08–11:** converging drop, opposing waist, three channels and separated connectors preserve their distinct layouts and dot counts. Line widths are deliberately cleaner and more uniform than the raster.
- **12 — junctions refined:** the upper red and blue leaf tips now extend into their supporting black branches, with their animation pivots moved to those same junctions. The lower-left black stem now ends at the pendant blue leaf attachment rather than crossing most of its body. The 200% rendering was re-inspected after the change: both upper leaves remain joined, and the pendant blue body is visible. Foreground IoU changed from 72.5% to 72.8%; remaining differences concern the smoother, more uniform stems and leaf proportions, so this is not an exact tracing claim. Existing staggered leaf motion is preserved; final animation playback is checked separately.

The original source-coordinate bounds nearly touch the bottom edge for 01 and 04. The showcase's centering wrapper adds presentation breathing room; this report cancels it solely for source comparison. Motion overflow must be checked in the final centered presentation.
`;
await fs.writeFile(path.join(qa, 'geometry-report.md'), report);
console.log(records.map(r => `${r.id} ${r.name}: raw ${(r.rawAlpha.iou * 100).toFixed(1)}%, foreground ${(r.foreground.iou * 100).toFixed(1)}%`).join('\n'));
