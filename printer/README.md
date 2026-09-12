# printer/ · 花园作品与 3D 打印机

本地后端与打印机场景。`server.py` 同时托管整个仓库，让主控台、主游戏和打印机场景同源，写接口只接受同源请求，并且只监听 127.0.0.1。

## 接口

| 路径 | 说明 |
| --- | --- |
| `GET /api/health` | 服务与风格版本 |
| `POST /api/jobs` | `{cards:[id]}` 或 `{cards:[id1,id2]}`；旧的 `{m,n,a,b,seed}` 仍然可用。可带 `seed` 与 `request_id`（幂等） |
| `GET /api/jobs/<id>` | 任务状态；`ready` 后含 `image`、`pdf`、`particles` |
| `POST /api/jobs/<id>/print` | 提交 CUPS 队列（纸张打印机接入后使用） |
| `POST /api/dice`、`GET /api/dice` | 骰子读数中转；5 秒内没有新读数视为离线 |

卡片输入的规则：一张卡时 m 等于这张卡，n 由 `seed` 驱动的随机数抽取（1–12 中除 m 以外）；两张卡时 m、n 取两张卡的较小、较大值。混合系数 a、b 按显影台规则（θ 在 10°–80°，随机正负号）由同一个种子决定。任务记录 `cards` 与 `n_source`，便于区分哪张是抽到的卡。

作品、PDF、粒子数据保存在 `printer/jobs/`（已加入 `.gitignore`）。本地生成器标记为 `local_garden`，没有调用在线 AI 图像服务。

## 打印机场景

`index.html` 可以单独打开（`/printer/?job=<id>`）。主控台通过 `bridge.js` 以 `?embed=1` 嵌入：页面只保留三维剧场、背景透明，由宿主发 `between-printer-start` 开始播放，场景回传 `ready / progress / complete / error`。场景使用自己的 Three.js r165（`vendor/`），与根目录主游戏的 r178 相互独立。

模型来自 `assets/printer.glb`；风格固定在 `garden_style.json` 与 `GARDEN_STYLE.md`，3D 效果约定见 `PRINTER_EFFECTS.md`。

## 验证

```sh
python3 printer/server.py &
node printer/verify.mjs
node printer/verify_printer_effects.mjs
```
