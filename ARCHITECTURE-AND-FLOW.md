# BETWEEN · 流程与技术架构

这份文档对应电脑端原型 `prototype-3d.html`。视觉层使用符号，文档层保留完整流程、接口和硬件边界，便于协作开发。

## 用户流程

```mermaid
flowchart LR
  A[扫码 / 打开入口] --> B[◒ 成长骰]
  B --> C[⋔ 关系骰]
  C --> D[✦ 生成 JOB 与答案编号]
  D --> E[后台立即预生成作品并缓存]
  E --> F[◇ 展开 12 张实体卡]
  F --> G{实体卡输入}
  G -->|NFC 识别| H[◉ 确认卡号]
  G -->|NFC 未识别| I[↯ 电脑端手动确认]
  H --> J[▧ 展示缓存作品]
  I --> J
  J --> K[⟶ 发送小米打印机]
  K --> L[✓ 打印完成 / 取件]
```

## 状态机

```mermaid
stateDiagram-v2
  [*] --> input
  input --> key: makeKey()
  key --> cards: openCardWall()
  cards --> cards: 选择卡片
  cards --> printing: scan('nfc') / scan('manual')
  printing --> done: startPrint() 完成
  done --> input: roll()
  key --> key: generation progress 0..100%
```

`makeKey()` 先生成 `JOB-*`、答案编号和缓存图片，再切换到钥匙阶段。生成进度只是反馈层；打印动作直接复用 `generation.imageUrl`，不会再次等待生图。

## 技术架构

```mermaid
flowchart TB
  UI[prototype-3d.html + prototype-3d.css]
  STATE[prototype-3d.js\n状态机 / 事件 / 缓存]
  CARDS[game-cards.js\n12 张卡的编号与符号]
  ART[createArtwork + preGenerateArtwork\nCanvas PNG data URL]
  NFC[NFC 读卡器 / 手机 NFC\n当前为模拟入口]
  PLANB[↯ 电脑端按钮\n人工确认编号]
  PRINT[小米打印机适配层\n当前为模拟队列]
  UI --> STATE
  STATE --> CARDS
  STATE --> ART
  NFC --> STATE
  PLANB --> STATE
  STATE --> PRINT
```

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `prototype-3d.html` | 电脑端舞台、四个阶段面板、无障碍标签 |
| `prototype-3d.css` | 白色 UI、深色金属卡、符号动效与响应式布局 |
| `prototype-3d.js` | `input → key → cards → printing → done` 主循环、预生成、NFC/Plan B、打印进度 |
| `game-cards.js` | 12 张卡的数据、编号、颜色与机制 |
| `SYMBOL-DESIGN-SYSTEM.md` | 符号词典、视觉规则、状态顺序 |
| `server.mjs` | 本地静态服务器，默认端口 `4187` |

## 手机与电脑的连接边界

手机负责扫码进入同一个 `JOB-*` 会话；电脑端是现场主控，保存答案编号、卡片选择和缓存作品。正式接入时，手机和电脑之间需要一个局域网或云端会话服务：

1. 手机扫码 `sessionId`，向服务端写入 `input` 结果。
2. 电脑端通过 WebSocket/SSE 收到 `key`、`card`、`print` 事件。
3. NFC 读卡器把卡片 UID 映射到 `01—12`，服务端只接受当前 `JOB-*` 的目标编号。
4. 识别失败时，电脑端 `↯` 按钮走同一个 `scan('manual')` 接口。

## 小米打印机适配点

原型已把“发送到小米打印机”作为独立动作，打印内容来自预生成缓存。真实部署时只需替换打印适配层：把 `imageUrl` 转成小米打印机 SDK 或局域网协议需要的图片格式，并回传 `queued / printing / done / error` 状态；上层状态机不变。

