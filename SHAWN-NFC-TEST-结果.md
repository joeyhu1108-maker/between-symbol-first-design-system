# Shawn · Mac NFC 与打印测试结果

对应 `SHAWN-NFC-TEST.md`。打印电脑：Shawn 的 MacBook Pro，队列 `Mi_All_in_One_Inkjet_Printer`（USB / IPP-USB，默认打印机）。

## 每轮记录

| 轮次 | 时间 | 手机网络 | Mac 网络 | 网址打开 | 触碰收到 | 队列提交 | 实际出纸 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 只测 NFC | 07:30–07:31 | 待确认 | — | ✅ | ✅ 3 次同一轮 | —（接收端未启动） | — | 停在「等待打印接收端」，已取消 |
| 2 真实打印 | 07:42–07:52 | 待确认 | Wi-Fi + TAG/mihomo TUN | ✅ | ✅ 1 次 | ✅ `…Printer-3` | ✅ 1 张 | 触碰→领取 5 s；PDF 5.45 MB 下载约 4 min |
| 3 Wi-Fi + 重复触碰 | 07:53–07:57 | 手机 Wi-Fi | 同上 | ✅ | ✅ 3 次同一轮 | ✅ 仅 `…Printer-4` 一次 | 待确认 | 触碰→领取 6 s；下载约 70 s；提交后第 2、3 次触碰未再领取、无新 CUPS 任务 |
| 4 手机移动流量 | 07:57–07:59 | 手机移动流量 | 同上 | ✅ | ✅ 1 次 | ✅ `…Printer-5` | 待确认 | 触碰→领取 3 s；下载约 80 s；CUPS 约 3 min 才清空 |
| 5 接收端离线 | 08:00 | — | — | — | — | — | — | 已停接收程序并备好一轮；用户判断 NFC 已无问题，未碰即取消 |

## 正式域名 https://between.zone-y.com（2026-09-13 09:50）

- 与临时隧道是同一套后台（状态、控制 token、接收端 token 相同）。接收端配置：`~/Downloads/between-print-config-zone-y.json`。
- 流程已变：NFC 标签只是手机入口（`nfc-tap.html` → `phone.html` 悬浮卡），**不再触发打印**；打印由电脑在作品生成后确认（`/api/nfc/arm` 绑定 → `/api/nfc/fallback` 确认 → 接收端领取）。
- 12 张标签地址：`https://between.zone-y.com/nfc-tap.html?card=01` … `card=12`，12 个 `nfc-tap` 与跳转后的 `phone.html` 均实测 HTTP 200。
- **新问题：服务器下发的接收程序在正式域名下完全连不上。** Cloudflare 以 error 1010 拦截 urllib 默认的 `Python-urllib/3.x` User-Agent（HTTP 403），换自定义 UA 即 200。本地副本已加 `User-Agent: BETWEEN-print-agent/1.0`；服务器原版需同步，或在该 zone 对 `/api/print-agent/*`、`/printer/jobs/*` 放开浏览器完整性检查。

| 轮次 | 时间 | 触发方式 | 确认收到 | 队列提交 | 实际出纸 | 备注 |
|---|---|---|---|---|---|---|
| Z1 打印机可行性 | 09:52– | 接口等效「电脑确认打印」 | ✅ 09:52:26（202） | ✅ `…Printer-6`，确认后 11 s（PDF 仅 0.7 MB） | ❌ 未出纸：打印机报 `media-empty-error, media-needed-error`（缺纸），任务卡在 CUPS | 接收端 `ready` 只看队列启用，缺纸时仍会领取并提交 |

| Z2 Mac 重试 | 10:20–10:35 | 接口等效「电脑确认打印」 | ✅ 10:20:11 | ✅ `…Printer-7`，确认后约 20 s | ❌ 未出纸：打印机硬件（IPP 直查）持续报 `media-empty-error`，装纸后仍未识别 | 打印机随后移到队友服务器；Mac 端接收程序已停、`Printer-6/7` 已取消 |

**手机提示「电脑上的本轮抽卡已结束」**：`/api/entry/current` 404 = 没有电脑发布抽卡轮次。抽卡页必须从控制台（带 `#control=`）同一标签页点「进入完整抽卡流程」打开，才会 `POST /api/sessions` + `/publish`；直接打开抽卡页不会发布。

**交接到服务器（中文 macOS）**：用修正版 `nfc-print-agent.py` + `between-print-config-zone-y.json`（不要用指向已断隧道的 `between-print-config.json`）；全场只运行一个接收程序；打印机需先解决缺纸识别并在系统里设为默认、确认队列未被暂停。

## 结论（2026-09-13）

NFC 触碰 → 后台 → 接收程序 → CUPS → 出纸 全链路通过；手机 Wi-Fi 与移动流量均可；同一轮重复触碰只提交一次。
下载慢归因于打印电脑不是服务器——正式部署时打印机接在服务器上即可。Mac 接热点、接收端离线恢复两项未测。

## 发现的问题

1. **接收程序在中文 macOS 上永远不领任务**：`nfc-print-agent.py` 用英文正则解析 `lpstat -p` / `lpstat -d`，本机输出中文且 `LC_ALL=C` 无效，`printer_status()` 返回 `('', False)`。
   已在 `~/Downloads/nfc-print-agent.py` 本地修正（`lpstat -e` 取队列名，`lpoptions -p <队列>` 的 `printer-state` / `printer-is-accepting-jobs` 判断可用，任务号用 `<队列>-<数字>` 匹配）。**服务器下发的原版仍需同步修改。**
2. **从触碰到提交约 4 分钟**：瓶颈是 Mac 从隧道下载作品 PDF（约 20 KB/s）。本机 TAG/mihomo 为 TUN 模式，trycloudflare 落入兜底分组「🐟 漏网之鱼」→ 代理节点 🙂 TAGSS。可试：该域名直连 / 关代理对比；或服务器改发 JPEG（约 0.6 MB）。
