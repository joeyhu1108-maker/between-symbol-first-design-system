# BETWEEN 云端作品服务

本目录把已有 Python 花园生成算法搬到 Cloudflare，供公网用户各自抽卡、生成、查看和下载作品。目标是 **200 人同时参与**；生成计算采用最多 20 个容器并行，其余任务排队。网页上的 AI 抽卡角色不等于调用外部 AI 生图接口；当前真实出图复用 `printer/server.py`、`garden_style.py`、`rarity.py` 和 `story.py`，**不需要 AI API key**。

## 交付状态 · 2026-09-13

最新交付与验收边界见 [DELIVERY-2026-09-13.md](./DELIVERY-2026-09-13.md)。云生成后端、独立网页预览与正式域名的云生成路由均已上线；正式域名单件生成及完整下载校验通过。**200 人完整出图下载验收未通过。**

| 项目 | 已核实的状态 |
| --- | --- |
| Worker / Queue / D1 / R2 代码 | 已实现；本地共 41/41 项通过：Worker 20/20、前端请求恢复 13/13、抽卡提前生成与会话隔离 8/8 |
| 工具链 | 锁定 Wrangler `4.131.1`、`@cloudflare/containers` `0.3.7`；dry-run 通过 |
| 镜像与原算法 | Linux `amd64` Docker 镜像已构建；本地限制 1 CPU 的真实渲染样例 `[12,1] / seed=12345` 用时约 10.94 秒，四种文件生成成功，卡片顺序保持 |
| 本地真实全链路 | Wrangler + Docker 原算法 + 本地 D1 / Queue / R2 已跑通 1 件独立创作；接收 65 ms、ready 21.612 秒、WebP / PDF 下载校验完成 21.775 秒，HTTP 错误 0；另外逐一 GET 四种文件均 200。报告见 `output/cloudflare-backend/local-stream-fixed.json` |
| Cloudflare 账户 | 已确认 Workers Paid，R2 已开通，staging 与 production 容器应用均已部署。旧 `cloudchamber/me` 探针的 401 不能作为当前套餐结论 |
| Staging D1 | `between-artwork-staging` 已创建，位置 APAC；ID `ac167554-d825-42bb-8602-4f2566da4006`；schema 已执行成功 |
| Staging Queue | `between-artwork-staging` 已创建 |
| R2 | 账户持有人已开通，`between-artwork-staging` bucket 已实际创建 |
| 云后端端到端 | Production 已部署至 `https://between-artwork.joeyhu1108.workers.dev`，版本 `f29440ec-6bad-4e2d-a011-5e0a95eca6d9`；真实 bridge 单用户 1/1 完整成功，ready 13.684 秒、WebP / PDF 下载校验完成 32.112 秒，无请求失败。报告：`output/cloudflare-backend/production-browser-one.json`。单件结果不能视作并发承诺 |
| 完整网页云预览 | `https://between-cloud-preview.joeyhu1108.workers.dev` 已部署，版本 `53aee6d6-ff74-482b-8e5f-7a736de639fb`，通过 service binding 接入 production。网页发布不等于完整浏览器交互与实体打印已验收 |
| 正式域名云生成 | `https://between.zone-y.com` 已切换，入口版本 `b8739427-3c92-456a-bfed-bb08baf452fa`，`ARTWORK_BACKEND` 绑定 `between-artwork`，现场路由使用恢复后的新 upstream。真实 bridge 单用户 1/1 通过：ready 12.875 秒、WebP / PDF 完整下载 14.983 秒，11 次请求无失败。报告：`output/cloudflare-backend/canonical-browser-one.json` |
| Staging 20 人基线 | 原 `load-test.mjs`：ready 20/20，p95 139.680 秒；WebP / PDF 完整下载 20/20，p95 141.485 秒，HTTP 错误 0。报告：`output/cloudflare-backend/staging-20-baseline.json` |
| Staging 20 人优化对照 | 同一旧工具：ready 20/20，p95 65.759 秒；完整下载仅 14/20，6 个 PDF 收到 HTTP 200 后响应体 `terminated`，另有 2 次网络失败。**本轮未通过**，断流原因仍在排查，不能用 ready 改善代替下载验收。报告：`output/cloudflare-backend/staging-20-optimized.json` |
| Staging 200 人真实 bridge 负载 | **未通过**：200/200 首次提交接收、200/200 ready，ready p95 186.866 秒；WebP / PDF 完整下载仅 96/200，104 人失败。99 次收到 HTTP 200 后响应体断流，5 次下载请求网络失败；状态轮询另有 82 次瞬时失败后恢复。报告：`output/cloudflare-backend/staging-browser-200-final-sanitized.json` |
| 200 人静态资源负载 | 同样未通过；每组 200 并发连接、共 600 GET 出现 44 次失败；改为每组 200 请求 / 最多 20 连接后仍有 12 次卡图下载失败。小并发两种网络路径各 10 次完整成功，暂未确定高并发断流的具体网络环节 |
| 国内外 / 微信 | 尚未完成国内外真实网络与微信群扫码、微信内浏览器真机验收；浏览器修改 UA 不能替代真机 |

`https://between.zone-y.com` 的静态页面和生成链路已在 Cloudflare；生成与作品读取通过 service binding 进入独立云后端，不再依赖现场电脑计算。现场 NFC、手机与大屏配对、CUPS / 小米打印机出纸仍依赖现场服务，不属于本 Worker。现场主控和打印接收端已恢复；用户手机最新反馈为浏览器无法打开网页，尚不能定位为应用 503，现场负责人正在核对实体 NFC 卡的实际 URL，最新云版本的实物闭环尚未验收。

本轮 GET 核对正式页面实际引用链为 `prototype-3d.html → prototype-3d.js?v=mobile-pairing-1 → bridge.js?v=card-fusion-3d-1`。版本化 `bridge.js` 返回 200，5574 字节，SHA-256 `b4d073d794af9fa74ee4c39a76b465fd65be1b274dbf035624c0ad5f511ae84c` 与本地一致；此项仅证明请求模块版本一致，不证明后端已切换。本文报告路径均相对项目上层目录。

## 流程与职责

```mermaid
flowchart LR
  U[用户网页：两张卡] --> E[正式域名入口 Worker]
  E -->|同源 service binding| A[作品 API Worker]
  A -->|保存卡片 / seed / 状态| D[(D1)]
  A -->|立即入队| Q[Cloudflare Queue]
  Q --> W[Worker 队列处理器]
  W -->|取得租约后渲染| C[最多 20 个渲染 Container]
  C -->|原 PNG / WebP / PDF / particles| W
  W -->|流式上传| R[(R2)]
  W -->|四文件上传成功才 ready| D
  U -->|轮询 job| A
  A -->|ready 后下载| R
```

绑定名称与配置来源均在 [wrangler.jsonc](./wrangler.jsonc)：

| 绑定 / 配置 | 用途 |
| --- | --- |
| `DB` | D1 保存任务、幂等键、原始卡片顺序、seed、计算租约和最终 manifest |
| `GENERATION_QUEUE` | 消息只携带 job ID；每批最多 2 条，最大 consumer 并发 10；处理器每次并行处理 2 条，等待两条结束再处理下一组；队列投递重试配置 100 |
| `RENDERER` / `ArtworkRenderer` | job ID 稳定散列到 `renderer-0` 至 `renderer-19`，每个容器同时只渲染一件作品 |
| `ARTWORKS` | R2 保存四种成品；不公开 bucket，文件通过 Worker 按 job ID 读取 |
| `standard-2` / `max_instances:20` | 当前每槽配置 1 vCPU、6 GiB 内存、12 GB 磁盘；上限是最多 20 个按需启动实例，不是预先常驻 20 台。[官方规格与计费](https://developers.cloudflare.com/containers/platform/pricing/) |
| `sleepAfter:'60s'` | 无活动后休眠；SDK 保留在途请求，长渲染不会仅因超过 60 秒而作为闲置关停 |
| 每分钟 cron | 修复 D1 已写入但 Queue 发送中断，以及处理进程退出后失效的租约 |

任务状态为 `queued → generating → ready / failed`。`queued + generating` 总数最多 512，由一条 D1 `INSERT … SELECT` 原子检查；并发提交不能突破该上限。已完成与失败任务不占待生成容量。20 个计算槽和 512 件任务上限解决的是资源与排队边界，不能直接推导出每位用户的等待时间。

Queue 至少一次投递可能出现重复消息。Worker 通过 D1 原子租约取得唯一处理权，租约持续 6 分钟，每次文件上传前续租。`429 busy` 退避，不消耗业务失败次数；其他计算或上传错误最多尝试 5 次。任务从创建起超过 30 分钟仍未完成，下一次取得处理权时会进入可查询的 `failed`，而不是永远转圈。重试始终保留原 cards / seed / ID；容器暂存丢失后可按原输入重算。

四个文件每 2 个并行上传，全部写入 R2 后才发布 `ready`；一组出现错误时也等待同组另一项结束，再决定重试或清理，避免清理后又落入迟到的文件。Container 代理返回的流需按 Content-Length 包装 `FixedLengthStream`，恢复 R2 所需的已知长度标记；上传和传输同时等待，失败时取消管道，避免整图占用 Worker 内存。上传中断留下的部分文件不能通过公开接口读取；成功后清理容器暂存，最终失败也会尽力清理部分对象。D1 和 R2 是持久结果，容器磁盘不是归档。[FixedLengthStream 官方说明](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/)

生成优化只把花园循环中重复的位移计算移到循环外，并将成品 PNG 改为无损 `compress_level=4`，保留原合成数据类型、分辨率、粒子规则和 `guide.png`。离线固定的三组 cards / seed 对照中，粒子 JSON、guide 文件、PNG 像素、WebP 文件均完全一致；固定 PDF 元数据后 PDF 文件及嵌入 JPEG 也一致。PNG 压缩字节数会变化，此验证不表示所有输入都已穷举，也不是线上耗时承诺。证据：`output/performance/renderer-minimal-patch-profile.json`。

## 对外兼容契约

| 请求 | 返回与约束 |
| --- | --- |
| `GET /api/health` | `{ok, backend:"cloudflare", generator:"local_garden", max_concurrent_renders:20}`；检查 D1 与绑定存在，不启动付费渲染，也不证明容器和 R2 已完成真实读写验收 |
| `POST /api/jobs` | 仅接受 `{cards:[human,ai], request_id}`；首次 `201 queued`，相同输入重试 `200` 返回同一任务 |
| `GET /api/jobs/:id` | 返回持久状态；ready 时含原算法 params / story / rarity / style 与下载路径；失败时提供 `error` |
| `GET / HEAD /printer/jobs/:id/artwork.png` | 原始 PNG |
| `GET / HEAD /printer/jobs/:id/artwork.webp` | 网页预览 |
| `GET / HEAD /printer/jobs/:id/artwork.pdf` | 可下载 PDF；文件就绪不表示已经发送实体打印 |
| `GET / HEAD /printer/jobs/:id/particles.json` | 三维演出使用的原粒子数据 |

请求示例：

```json
{"cards":[12,1],"request_id":"95c940b7-d8f6-4676-820a-1f74b38df294"}
```

- cards 必须是两个不同的整数，范围 1–12。`params.cards` 保持 `[human,ai]` 原顺序；`params.m / n` 是算法使用的升序模态，不能用来反推是谁先抽卡。
- request_id 使用 `crypto.randomUUID()` 生成的 UUID v4，或 `crypto.getRandomValues()` 生成的 16 字节、32 位十六进制文本。重新请求同一创作必须沿用原 key。改变卡片后沿用旧 key 返回 409。不要用递增编号、时间戳或 `Math.random()` 替代随机能力标识。
- 浏览器只发两张卡和 request_id，不上传 m / n / a / b / seed。Worker 生成 128 位随机 job ID，以及 unsigned 32-bit seed；`0` 至 `4294967295` 都是合法 seed。任务 ID 兼容 `SG-YYYYMMDD-数字-8HEX`。
- `image / pdf / particles` 均为 `/printer/jobs/:id/...` 同源相对路径。最终 `style_version` 为原算法当前的 `garden-v1.1`，兼容现有打印场景的 `garden-v1` 检查。`print_status` 固定为 `not_submitted`。
- 请求 JSON 最大 4096 字节；额外字段拒绝。非法格式 400，内容过大 413，非 JSON 415；Origin 存在时必须与请求 URL 同源，不提供跨域 CORS 放行。
- 512 个名额已满时，新 key 返回 `429`、`Retry-After:30` 和 `retry_after:30`，不创建任务。已有 key 不受满队列影响。D1 已保存但暂时未能发入队列时返回 503 和原 ID，cron 会恢复；客户端重试保持相同 key。
- 状态 JSON 不缓存；成品当前按 `private, max-age=86400` 返回。请求编号和作品链接视作可访问该作品的能力信息，不应放入公开日志或共享测试截图。

主流程应等到 ready 才调用 `mountPrinterScene(job)`。本轮前端已将独立 `/printer/` 的创建格式迁移为 cards 契约，主流程与打印页补了 crypto 随机编号回退，`bridge.js` 等待窗口调整为 30 分钟。发布前仍需检查最终构建和浏览器完整流程，不能仅凭单元测试判断微信真机兼容。

AI 卡片一确定就提交生成，让计算与后续 2.2 秒抽卡展示、1 秒进入钥匙的动画重叠，相比原提交时机提前约 3.2 秒。钥匙阶段复用同 cards / request_id 的请求，不重复创建；NFC、符号目标和翻卡顺序仍按原时机出现。废弃会话的返回结果不会被新会话采用。提前提交不能保证每张作品的总等待恰好减少 3.2 秒。

## 本地验证

以下命令从 `seed-universe/cloudflare-backend` 执行。Node 24 可运行使用内置 SQLite 的测试；Docker 需要运行。

```sh
npm ci
npm test
npm run check
```

`npm test` 共 41 项。Worker 的 20 项使用真实 SQLite 执行生产 SQL，R2 / Queue / Container 是测试绑定，没有调用线上服务；包括 200 个独立请求、520 次并发提交中的 512 容量上限、同 key 幂等与冲突、uint32 边界、原序卡片、重复投递、上传中断、固定长度流的截断 / 超长拒绝、失效租约恢复和日志能力标识脱敏；并验证两条消息并行、失败互不阻塞、同批重复投递唯一租约，以及双文件上传结束后才 ready 或清理。前端的 13 项读取实际 bridge / printer 函数，验证断网与 503 后同 key / 同 job 恢复、30 分钟截止、UUID 兼容、采用真实参数，以及终态失败后新创作。另 8 项验证抽卡时立即提交、3.2 秒后才进入钥匙和 NFC 阶段、只提交一次、同编号重试、废弃会话的旧请求和轮询不能覆盖新会话。`npm run check` 是 Wrangler dry-run；编译成功不是实际资源已建好或已经上线。

可复验镜像：

```sh
docker build --platform linux/amd64 -f container/Dockerfile -t between-renderer:local ..
docker run --rm --platform linux/amd64 --cpus=1 -p 127.0.0.1:8080:8080 between-renderer:local
```

容器接口、原算法隔离和 Python HTTP 测试见 [container/README.md](./container/README.md)。Docker 的构建上下文明确排除真实作品目录、SQLite 数据库和凭证，不要改为 `COPY .`。

Worker 本地服务使用独立的模拟 D1 / R2 / Queue，以及本机 Docker：

```sh
npm run db:local
npx wrangler dev --local --port 8799 --test-scheduled
```

在第二个终端执行：

```sh
curl --fail http://127.0.0.1:8799/api/health
node load-test.mjs --base http://127.0.0.1:8799 --users 1 --output ../../output/cloudflare-backend/local-one.json
curl --get http://127.0.0.1:8799/__scheduled --data-urlencode 'cron=* * * * *'
```

以上是供接手人复验的操作步骤；本轮实际本地 Worker 全链路使用端口 `18887`，保存了表格中记录的 1 人报告。不能把本地结果写成“公网压测已通过”。

## Staging 部署与负载验收

1. 使用当前账户登录并核对 `npx wrangler whoami`。账户已经是 Workers Paid，无需因为旧 API 的 401 重复升级。协作者自行部署时使用自己的 Cloudflare 账户和资源 ID，仓库配置不包含登录凭证。
2. 当前账户的 R2、D1 和 Queue 均已创建，不要重复创建。以下命令仅供在协作者自己的账户中初始化新的独立环境。

   ```sh
   npx wrangler r2 bucket create between-artwork-staging
   ```

3. 检查 [wrangler.jsonc](./wrangler.jsonc) 四种绑定名称、D1 ID、Queue 名称、container class、迁移标签及每分钟 cron。D1 schema 已在 staging 执行；后续需要重建独立测试环境时才对正确目标执行 `npm run db:remote`，不要清空现有正式数据。
4. `npm run deploy` 部署 staging，保存 Wrangler 返回的实际 URL、版本 ID 和时间；不要预先假定 workers.dev 子域名。检查 Container 镜像发布、应用状态和所有资源绑定后，再 GET `/api/health`。
5. 用实际 staging origin 先生成 1 件，再逐级扩大到 20 / 200 件，保存各轮报告及部署版本。20 人优化对照保留旧工具以保持测试方法一致；200 人验收使用读取真实 `bridge.js` 的新工具。示例中的域名是占位符，必须替换；压测会真实计算、写 D1 / R2，产生相应用量。

   ```sh
   node load-test.mjs --base https://STAGING-ORIGIN --users 1 --output ../../output/cloudflare-backend/staging-one.json
   node load-test.mjs --base https://STAGING-ORIGIN --users 20 --output ../../output/cloudflare-backend/staging-20.json
   node load-test-browser.mjs --base https://STAGING-ORIGIN --users 1 --output ../../output/cloudflare-backend/staging-browser-one.json
   node load-test-browser.mjs --base https://STAGING-ORIGIN --users 200 --output ../../output/cloudflare-backend/staging-browser-200.json
   ```

两种工具默认 1 人，显式 `--users 200` 才生成 200 个独立任务，上限 200、整轮最长 10 分钟；均检查 ID / cards / seed 稳定与隔离，以及 WebP / PDF 的 MIME、文件头、长度和 SHA-256，不调用 NFC、会话或实体打印接口。

| 工具 | 请求策略与报告边界 |
| --- | --- |
| `load-test.mjs` | 原后端基线工具：单请求最长 30 秒，提交重试可持续到整轮 10 分钟截止，轮询基础间隔退避至 8 秒。不能将其成功率当作浏览器实际恢复策略的结果 |
| `load-test-browser.mjs` | 在 VM 中执行本地真实 `bridge.js` 的 `createJob / waitForJob`，不复制超时或重试实现，并记录源文件 SHA-256。当前提交 / 状态单请求最多 10 秒（health 15 秒）、提交最多重试 2 分钟、queued / generating 基础轮询间隔 2 / 1 秒、原等待窗口 30 分钟；验收工具额外在整轮 10 分钟强制停止并列出全部未完成用户。每位 ready 用户依次下载 WebP、PDF，各一次，不额外重试下载 |

新工具记录每个阶段、用户和 attempt 的请求，分别统计首次提交成功、重试后接收、网络 / 超时 / 响应体验证错误，以及 accepted / ready / downloaded 的 p50、p95、max。30 / 60 / 120 秒完成比例以全部请求用户为分母；耗时分位数只统计达到该阶段的用户，必须连同样本数报告。`passed:true` 表示本轮全部任务与下载校验最终完成，不表示无瞬时失败或无需等待；HTTP 200 后断流也算失败。先核对报告中的 bridge SHA 与实际发布引用，才可将它作为该前端版本的 HTTP 行为验收；它仍是一次并发突发测试，不是持续负载或真实浏览器渲染测试。

200 人验证至少保留：200 个独立任务 ID、200 份 WebP 与 PDF 的下载记录、没有卡片串号、队列排空、Cloudflare 错误与资源峰值、真实成品抽样。脚本不验证画面审美、手机帧率或实体出纸。国内外不同网络、iOS / Android 微信内点击、微信群二维码与回到页面后的恢复另行验收；本机命令行压测不能替代这些项目。

## 切换正式域名

现有入口 Worker 在项目上层的 `cloudflare/`，负责静态页面与正式域名。独立正式资源及 `between-artwork` 后端已部署，staging 数据与正式作品分开；不必重复创建资源。独立网页预览和正式域名均已接入正式后端，正式入口版本为 `b8739427-3c92-456a-bfed-bb08baf452fa`。以下保留配置与复验步骤供维护使用；200 人完整下载验收仍未通过，不能将一次单件通过当作该验收已完成。

在正式入口的 Wrangler 配置加入 HTTP service binding，例如：

```json
{"services":[{"binding":"ARTWORK_BACKEND","service":"between-artwork"}]}
```

在入口 Worker 的旧隧道分支前，使用明确路由表把以下请求转给云作品服务：`/api/health`、`/api/jobs`、`/api/jobs/:id` 和本 README 的四种作品文件路径。核心转发为：

```js
return env.ARTWORK_BACKEND.fetch(request);
```

保留原请求 URL、Origin、方法、body 与后端缓存头；不需要改成后端 workers.dev 域名，也不能沿用旧代理把 Origin 改成隧道域名，否则同源检查会拒绝。HTTP service binding 支持直接转发完整 Request。[官方写法](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)

`/api/sessions/*`、`/api/nfc/*`、`/api/printers`、`/api/jobs/:id/print` 及打印接收端仍属于现场设备服务，不能整体把 `/api/*` 都交给本 Worker。保留现场路由时，明确公开线上作品与现场旧任务使用哪个后端；两个独立数据库不会自动共享旧 job ID。正式入口必须保留 HTTPS 跳转，API 错误不缓存，未知 API 不应回落成 HTML。

从项目上层目录重建并发布入口，锁定同一 Wrangler 版本：

```sh
node cloudflare/build.mjs
seed-universe/cloudflare-backend/node_modules/.bin/wrangler deploy --config cloudflare/wrangler.jsonc
```

正式域名已完成 health、真实 bridge 建任务、ready 与 WebP / PDF 完整下载校验；完整浏览器中的抽卡、融合与 3D 演出视觉验收仍在进行。后续每次发布应从 `https://between.zone-y.com` 复验这些环节，核对 `/api/health` 显示 cloudflare。保存入口与后端版本 ID 便于回退；回退不要删除已经写入 D1 / R2 的作品。

## 费用与运维边界

当前没有外部 AI 按图收费。主要用量来自容器有效 CPU 时间、存活期间配置的内存 / 磁盘、Queue 操作、D1 读写、R2 存储及操作、Worker / Durable Object 请求与日志。容器休眠会停止相应计算资源计费；60 秒闲置窗口以及重试仍影响用量。20 个槽全部启动时配置合计为 20 vCPU / 120 GiB 内存 / 240 GB 磁盘；这是容量配置，不是承诺每月固定费用。CPU 按有效使用，内存和磁盘按配置资源及运行时间计费。[Containers 价格](https://developers.cloudflare.com/containers/platform/pricing/)

估算需要实际每张图的容器存活时间、CPU 用量、四文件总字节数、每天创作数、保存天数、轮询次数、重试与下载量。每个成品至少四次对象写入；忙碌退避和重复投递也会增加队列操作。[Queues 价格](https://developers.cloudflare.com/queues/platform/pricing/) D1 的状态轮询与租约续期会产生读写。[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/) R2 的 `$0` 开通金额不代表后续无限使用免费，应按当前存储及操作计费与账户剩余额度核算。[R2 价格](https://developers.cloudflare.com/r2/pricing/)

本地 1 CPU 的 10.94 秒样例不能线性推算成 Cloudflare 200 人承诺；冷启动、槽位散列碰撞、文件上传和地区网络都会影响最终等待。512 队列上限约束同时积压，不是月账单硬上限。目前没有自动删除已完成作品的保留策略，成品会持续占用存储；上线运营前确定保存周期和预算，后续删除策略必须同时处理 D1 状态与 R2 文件，避免发出已失效下载链接。

监控应区分请求被接受、真实出图 ready、文件可下载、三维演出完成和实体纸张打印。发现生成失败时查 Worker / Container 日志、队列积压与最老任务年龄；cron 是恢复机制的一部分，不能停用后仍宣称任务可自动恢复。若 R2 或渲染不可用，返回可见排队 / 失败状态，不能用固定样张伪装生产生成成功。
