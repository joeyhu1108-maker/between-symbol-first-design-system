// Shapes are ordered back to front. Every state begins and ends at the source silhouette.
const BLACK = '#141917', BLUE = '#173448', RED = '#b73728';
const rest = [100, 100];
const pulse = (at, amount = 118) => [[0, rest], [Math.max(.06, at - .16), [92, 108]], [at, [amount, amount]], [Math.min(.92, at + .22), [97, 102]], [1, rest]];
const bend = (fn, values) => values.map(([t, value]) => [t, fn(value)]);
const sway = (amount, at = .5) => [[0, 0], [.12, -amount * .16], [at, amount], [.82, -amount * .14], [1, 0]];
const dot = (name, x, y, radius, fill, at = .5) => ({
  name, circle: [x, y, radius], fill, pivot: [x, y],
  idle: { s: [[0, rest], [at, [104, 104]], [1, rest]] },
  hover: { s: pulse(at, 112) }, tap: { s: pulse(at, 130) },
});
const stroke = (name, d, color, width, extra = {}) => ({ name, d, stroke: color, width, ...extra });

const blueIn = q => `M50 158 C91 ${154 + q * .2} 117 ${166 + q} 142 ${203 + q * .25}`;
const blueOut = q => `M229 237 C252 ${266 + q} 277 ${270 + q * .3} 318 267`;
const redIn = q => `M49 265 C94 ${269 - q * .3} 113 ${257 - q} 143 ${225 - q * .45} C170 ${196 - q} 187 ${188 - q * .25} 211 ${211 - q * .15}`;
const redOut = q => `M240 179 C264 ${161 - q} 288 ${157 - q * .25} 317 159`;
const crossingMotion = (fn, direction, lag = 0) => ({
  idle: { path: bend(fn, [[0, 0], [.4 + lag, direction * 3], [1, 0]]) },
  hover: { path: bend(fn, [[0, 0], [.15 + lag, -direction * 3], [.48 + lag, direction * 10], [.8, -direction * 2], [1, 0]]) },
  tap: { path: bend(fn, [[0, 0], [.16 + lag, -direction * 5], [.42 + lag, direction * 17], [.69 + lag, -direction * 7], [1, 0]]) },
});

const mergeBlue = q => `M84 147 C126 ${155 - q * .2} 149 ${182 - q} 179 214`;
const mergeRed = q => `M272 146 C232 ${158 + q * .15} 208 ${190 + q} 179 214`;
const mergeBody = q => `M179 214 C151 ${242 - q * .12} ${137 - q * .25} 265 ${137 - q * .3} ${287 + q * .15} C136 ${309 + q * .3} 154 ${323 + q * .35} 182 ${323 + q * .35} C211 ${323 + q * .35} ${227 + q * .3} 308 ${222 + q * .25} ${283 + q * .15} C217 257 198 234 179 214 Z`;

const narrowLeft = q => `M125 87 C154 101 ${180 + q} 122 ${166 + q} 149 C${157 + q} 173 ${118 + q * .45} 185 98 209 C87 222 82 241 81 251`;
const narrowRight = q => `M256 87 C224 101 ${195 - q} 123 ${208 - q} 150 C${216 - q} 174 ${251 - q * .45} 182 278 204 C291 217 298 231 298 245`;
const gateMotion = (fn, delay) => ({
  idle: { path: bend(fn, [[0, 0], [.36 + delay, 2.5], [.72 + delay * .3, -1.5], [1, 0]]) },
  hover: { path: bend(fn, [[0, 0], [.12 + delay, -3], [.42 + delay, 9], [.8, -2], [1, 0]]) },
  tap: { path: bend(fn, [[0, 0], [.12 + delay, -5], [.38 + delay, 16], [.68 + delay * .3, -7], [1, 0]]) },
});

const upperWave = q => `M61 146 C100 ${127 + q} 117 ${164 - q} 157 ${162 - q * .4} C209 ${160 + q * .6} 224 ${102 + q} 305 135`;
const centerWave = q => `M93 177 C144 ${197 + q} 165 ${193 - q} 209 ${173 - q * .4} C232 ${164 + q * .4} 247 ${159 + q} 268 172`;
const lowerWave = q => `M62 214 C117 ${256 + q} 166 ${218 - q} 205 ${201 - q * .4} C242 ${184 + q * .6} 263 ${231 + q} 305 216`;
const waveMotion = (fn, delay) => ({
  idle: { path: bend(fn, [[0, 0], [.28 + delay, 4], [.64 + delay, -3], [1, 0]]) },
  hover: { path: bend(fn, [[0, 0], [.12 + delay, -3], [.38 + delay, 12], [.7 + delay * .5, -5], [1, 0]]) },
  tap: { path: bend(fn, [[0, 0], [.1 + delay, -6], [.31 + delay, 21], [.55 + delay, -13], [.81 + delay * .35, 4], [1, 0]]) },
});

const branchLeaf = (name, d, fill, pivot, direction, delay) => ({
  name, d, fill, pivot,
  idle: { r: [[0, 0], [.32 + delay, direction * 2], [.76, -direction * .8], [1, 0]] },
  hover: { r: [[0, 0], [.12 + delay, -direction * 3], [.44 + delay, direction * 10], [.85, -direction], [1, 0]] },
  tap: {
    r: [[0, 0], [.1 + delay, -direction * 6], [.34 + delay, direction * 19], [.65 + delay * .5, -direction * 4], [1, 0]],
    s: [[0, rest], [.1 + delay, [97, 97]], [.4 + delay, [109, 107]], [.82 + delay * .2, [99, 99]], [1, rest]],
  },
});

export const glyphsLast = [
  {
    id: '07', name: '交汇结', relation: '协商', verb: '相遇 · 改道',
    story: '两条路径先试探，在结的前后错身，让出一点空间，再回到各自的方向。',
    parts: [
      stroke('knot-lower', 'M143 239 C141 270 160 295 194 297 C217 299 237 284 247 263', BLACK, 20, {
        pivot: [192, 225], idle: { r: sway(-.6) }, hover: { r: sway(-2.5) }, tap: { r: sway(-5, .54) },
      }),
      stroke('blue-arrival', blueIn(0), BLUE, 17, crossingMotion(blueIn, 1, 0)),
      stroke('red-departure', redOut(0), RED, 17, crossingMotion(redOut, 1, .08)),
      stroke('blue-departure', blueOut(0), BLUE, 18, crossingMotion(blueOut, -1, .07)),
      stroke('red-arrival', redIn(0), RED, 18, crossingMotion(redIn, 1, .04)),
      stroke('knot-upper', 'M143 207 C149 167 175 142 205 152 C237 162 244 189 231 215 C223 231 210 242 194 251', BLACK, 20, {
        pivot: [192, 225], idle: { r: sway(.6) }, hover: { r: sway(2.5) }, tap: { r: sway(5, .48) },
      }),
    ],
  },
  {
    id: '08', name: '合生', relation: '共创', verb: '汇入 · 新生',
    story: '蓝与红依次汇入，黑色容器随之舒展，中心的第三个点迟半拍回应。',
    parts: [
      stroke('red-inflow', mergeRed(0), RED, 17, crossingMotion(mergeRed, -1, .09)),
      stroke('blue-inflow', mergeBlue(0), BLUE, 18, crossingMotion(mergeBlue, 1, 0)),
      stroke('third-body', mergeBody(0), BLACK, 20, {
        idle: { path: bend(mergeBody, [[0, 0], [.55, 3], [1, 0]]) },
        hover: { path: bend(mergeBody, [[0, 0], [.2, -3], [.62, 10], [.85, -2], [1, 0]]) },
        tap: { path: bend(mergeBody, [[0, 0], [.23, -5], [.57, 22], [.8, -5], [1, 0]]) },
      }),
      { ...dot('blue-source', 132, 124, 16, BLUE, .28), hover: { s: pulse(.3, 116), p: [[0, [0, 0]], [.3, [3, 5]], [1, [0, 0]]] }, tap: { s: pulse(.28, 124), p: [[0, [0, 0]], [.14, [-2, -3]], [.36, [7, 10]], [.67, [-1, -2]], [1, [0, 0]]] } },
      { ...dot('red-source', 236, 124, 16, RED, .4), hover: { s: pulse(.44, 116), p: [[0, [0, 0]], [.45, [-3, 5]], [1, [0, 0]]] }, tap: { s: pulse(.42, 124), p: [[0, [0, 0]], [.23, [2, -3]], [.47, [-7, 10]], [.73, [1, -2]], [1, [0, 0]]] } },
      { ...dot('third-response', 181, 271, 13, BLACK, .61), tap: { s: pulse(.64, 143), p: [[0, [0, 0]], [.32, [0, 0]], [.64, [0, 6]], [.85, [0, -2]], [1, [0, 0]]] } },
    ],
  },
  {
    id: '09', name: '争隙', relation: '竞争', verb: '收紧 · 让隙',
    story: '两侧轮流争取中间的空隙；节点受压错开，随后重新排成一线。',
    parts: [
      stroke('left-boundary', narrowLeft(0), BLACK, 19, gateMotion(narrowLeft, 0)),
      stroke('right-boundary', narrowRight(0), BLACK, 19, gateMotion(narrowRight, .13)),
      dot('upper-source', 189, 79, 17, RED, .28),
      ...[191, 224, 255].map((y, i) => ({
        ...dot(`passage-${i + 1}`, 189, y, 9, BLACK, .35 + i * .1),
        hover: { p: [[0, [0, 0]], [.33 + i * .08, [i % 2 ? 4 : -4, 0]], [.7 + i * .05, [i % 2 ? -1 : 1, 0]], [1, [0, 0]]] },
        tap: { p: [[0, [0, 0]], [.15, [0, 0]], [.36 + i * .08, [i % 2 ? 10 : -10, i * 2]], [.64 + i * .06, [i % 2 ? -4 : 4, -i]], [1, [0, 0]]], s: pulse(.43 + i * .1, 114) },
      })),
    ],
  },
  {
    id: '10', name: '共脉', relation: '共养', verb: '传递 · 回流',
    story: '蓝点发出一次脉冲，三条通道错峰传递，红点接住后让波动慢慢平息。',
    parts: [
      stroke('upper-channel', upperWave(0), BLACK, 16, waveMotion(upperWave, 0)),
      stroke('middle-channel', centerWave(0), RED, 15, waveMotion(centerWave, .09)),
      stroke('lower-channel', lowerWave(0), BLACK, 17, waveMotion(lowerWave, .17)),
      { ...dot('blue-sender', 55, 179, 13, BLUE, .25), tap: { s: [[0, rest], [.12, [80, 118]], [.28, [129, 94]], [.46, [96, 103]], [1, rest]], p: [[0, [0, 0]], [.12, [-3, 0]], [.28, [6, 0]], [.6, [0, 0]], [1, [0, 0]]] } },
      { ...dot('red-receiver', 305, 177, 16, RED, .7), hover: { s: pulse(.68, 120) }, tap: { s: pulse(.72, 143), p: [[0, [0, 0]], [.48, [0, 0]], [.72, [5, 0]], [.87, [-2, 0]], [1, [0, 0]]] } },
    ],
  },
  {
    id: '11', name: '断丝', relation: '疏离', verb: '靠近 · 放开',
    story: '两端轻轻靠近，三个红点接力传话；话到中间后，两端各自退回。',
    parts: [
      { name: 'left-reach', fill: BLACK, d: 'M68 123 C88 127 94 138 103 153 C111 166 117 168 132 167 C143 166 145 183 133 183 C116 181 109 184 99 195 C86 210 72 221 54 225 C43 228 39 214 51 210 C69 205 78 196 89 185 C96 178 101 173 106 172 C96 165 92 155 85 147 C78 139 72 139 64 138 C54 136 57 120 68 123 Z',
        idle: { p: [[0, [0, 0]], [.44, [2, 0]], [1, [0, 0]]] },
        hover: { p: [[0, [0, 0]], [.14, [-2, 0]], [.48, [8, 0]], [.83, [-1, 0]], [1, [0, 0]]] },
        tap: { p: [[0, [0, 0]], [.13, [-4, 0]], [.37, [15, 0]], [.58, [15, 0]], [.83, [-2, 0]], [1, [0, 0]]] },
      },
      { name: 'right-release', fill: BLACK, d: 'M236 169 C254 171 263 166 274 160 C283 154 291 149 305 148 C316 147 319 162 307 164 C292 164 281 173 274 178 C287 188 289 203 301 211 C307 215 314 218 320 218 C331 220 327 234 317 233 C299 232 285 222 277 211 C269 199 267 193 255 187 C250 184 243 184 236 185 C225 185 224 169 236 169 Z',
        idle: { p: [[0, [0, 0]], [.56, [-2, 0]], [1, [0, 0]]] },
        hover: { p: [[0, [0, 0]], [.21, [2, 0]], [.57, [-8, 0]], [.88, [1, 0]], [1, [0, 0]]] },
        tap: { p: [[0, [0, 0]], [.2, [4, 0]], [.45, [-15, 0]], [.64, [-15, 0]], [.9, [2, 0]], [1, [0, 0]]] },
      },
      ...[134, 168, 206].map((x, i) => ({
        ...dot(`message-${i + 1}`, x, 174, 9, RED, .3 + i * .16),
        hover: { s: pulse(.33 + i * .14, 119), p: [[0, [0, 0]], [.45 + i * .1, [(1 - i) * 4, 0]], [1, [0, 0]]] },
        tap: { s: pulse(.38 + i * .15, 138), p: [[0, [0, 0]], [.38 + i * .08, [(1 - i) * 10, -3]], [.67 + i * .06, [(1 - i) * 5, 1]], [1, [0, 0]]] },
      })),
    ],
  },
  {
    id: '12', name: '分叉', relation: '未定', verb: '展开 · 留白',
    story: '主干保持稳定，蓝与红沿不同分支依次展开；每片叶子保留自己的节奏。',
    parts: [
      branchLeaf('blue-upper-leaf', 'M145 186 C122 179 94 178 75 193 C91 204 118 195 145 186 Z', BLUE, [145, 186], -1, 0),
      branchLeaf('red-upper-leaf', 'M184 182 C211 177 238 171 256 183 C238 197 211 188 184 182 Z', RED, [184, 182], 1, .07),
      branchLeaf('blue-outer-leaf', 'M110 216 C86 215 58 228 53 248 C80 253 101 237 110 216 Z', BLUE, [110, 216], -1, .1),
      branchLeaf('blue-inner-leaf', 'M122 211 C116 235 129 251 147 255 C146 235 134 217 122 211 Z', BLUE, [122, 211], 1, .16),
      branchLeaf('red-outer-leaf', 'M236 213 C260 212 276 228 282 250 C261 253 243 236 236 213 Z', RED, [236, 213], 1, .18),
      branchLeaf('red-inner-leaf', 'M210 219 C193 235 190 253 194 270 C213 263 218 240 210 219 Z', RED, [210, 219], -1, .23),
      branchLeaf('blue-low-leaf', 'M105 241 C90 248 90 264 90 281 C111 280 114 256 105 241 Z', BLUE, [105, 241], -1, .27),
      stroke('root-left', 'M166 109 C166 147 165 165 145 186 C121 207 110 221 105 242', BLACK, 17),
      stroke('root-right', 'M166 148 C171 177 185 187 198 199 C223 222 237 246 234 274', BLACK, 17),
      dot('branch-origin', 166, 76, 16, BLACK, .25),
    ],
  },
];
