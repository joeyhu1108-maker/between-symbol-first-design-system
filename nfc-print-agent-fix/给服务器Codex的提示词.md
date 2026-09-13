# 任务：在这台服务器（中文 macOS）上接好 BETWEEN 打印接收端

你在一台**系统语言为中文的 macOS** 上工作。小米喷墨一体机（Mi All-in-One Inkjet Printer，HP DeskJet 内核，USB 直连，macOS 用免驱 AirPrint / IPP-USB）已经接在这台电脑上。目标：运行 BETWEEN 的打印接收程序，让「电脑上确认打印」后的作品从这台打印机真实出纸。

## 链路（先理解，不要改后台协议）

后台是 `https://between.zone-y.com`（Cloudflare 后面）。接收程序 `nfc-print-agent.py` 每 3 秒：
`POST /api/print-agent/heartbeat` 上报队列 → `POST /api/print-agent/claim` 领取任务 → 下载 `/printer/jobs/<job_id>/artwork.pdf` → `lp -d <队列>` 提交 → `POST /api/print-agent/result` 回报。
本机状态文件 `~/.between-nfc-print-agent.json` 用于防重复打印。**不要删除它**，也不要为了「重试」手工改它。

## 附件（随本提示一起给你的）

1. `nfc-print-agent.py`：**已修正的接收程序**，直接使用。
2. `between-print-config-zone-y.json`：连接配置，内容是 `{"server": "https://between.zone-y.com", "token": "…"}`。token 是接入密钥：放好后 `chmod 600`，不要打印到日志，不要贴进聊天或提交到 git。
3. `nfc-print-agent.patch`：修正版相对原版的差异（22 行），仅供参考或合回上游。

**不要**从控制台页面重新下载 `nfc-print-agent.py`：那里是未修正的原版。**不要**使用名为 `between-print-config.json` 的旧配置：它指向一个已失效的临时隧道。

## 原版的两个已知问题（修正版已处理，别改回去）

1. **中文 macOS 下 `lpstat` 输出是中文**（例如「打印机…闲置」「系统默认目的位置：…」），而且 `LC_ALL=C` / `LANG=C` 都**无效**。原版用英文正则解析，结果永远识别不到队列，只会报 `Waiting: no selected/default enabled CUPS queue`。
   修正方式：用 `lpstat -e` 取纯队列名，用 `lpoptions -p <队列>` 里的 `printer-state` 和 `printer-is-accepting-jobs` 判断是否可用，CUPS 任务号按 `<队列名>-<数字>` 匹配。
2. **Cloudflare 以 error 1010 拦截 Python urllib 的默认 User-Agent**（`Python-urllib/3.x` → HTTP 403）。原版在正式域名下会一直报 `Receiver waiting: HTTP Error 403: Forbidden`。
   修正方式：所有请求都带 `User-Agent: BETWEEN-print-agent/1.0`。

自检：`grep -c USER_AGENT nfc-print-agent.py` 应输出 `3`，`grep -c "lpstat', '-e'" nfc-print-agent.py` 应输出 `1`。

## 步骤

1. 把三个附件放进同一个固定目录，例如 `~/between-print/`，然后执行 `chmod 600 between-print-config-zone-y.json`。确认 `python3 --version` 是 3.9 或更高版本。
2. **打印机队列**
   - 在「系统设置 → 打印机与扫描仪」里添加这台打印机，并设为默认打印机。
   - 运行 `lpstat -e` 列出队列名。可能会同时出现 `Mi_All_in_One_Inkjet_Printer` 和 `Mi_All_in_One_Inkjet_Printer_1E8A5E_` 两个队列：选一个，后面用 `--printer <队列名>` 固定下来，不要依赖默认值。
   - 运行 `lpoptions -p <队列名> | tr ' ' '\n' | grep -E '^printer-(state|state-reasons|is-accepting-jobs)='`。期望结果是 `printer-state=3` 且 `printer-state-reasons=none`。
   - 如果 `printer-state=5` 或原因里有 `paused`：打印机出错后 macOS 会**暂停队列，并且不会自动恢复**。先处理打印机本身的问题，再运行 `cupsenable <队列名>`。
3. **缺纸识别（重点）**：之前这台打印机两次都持续报 `media-empty-error, media-needed-error`，装纸后仍然如此，任务一直卡在「正在打印」，没有出纸。
   - 请现场人员重新装 A4 纸，推到底并贴紧导轨，然后按面板上的继续/确认键。
   - 用一份很小的 PDF 或测试页试打一张：`lp -d <队列名> <文件>`。确认真的出纸，且 `printer-state-reasons` 恢复为 `none`，再进入下一步。
   - 如果仍然报缺纸，先不要启动接收程序，把 `lpoptions` 的输出和打印机面板上的提示汇报回来。
4. **不打印的预检**：
   ```sh
   cd ~/between-print
   python3 nfc-print-agent.py --list
   python3 -c "import importlib.util as u;s=u.spec_from_file_location('a','nfc-print-agent.py');m=u.module_from_spec(s);s.loader.exec_module(m);print(m.printer_status('<队列名>'))"
   ```
   第二条命令应输出 `('<队列名>', True)`。
5. **启动**（整个现场只能有一个接收程序。Shawn 的 MacBook 上的那个已经停掉了，不要在别的机器上再启动）：
   ```sh
   cd ~/between-print
   caffeinate -i python3 -u nfc-print-agent.py --config between-print-config-zone-y.json --printer <队列名> 2>&1 | tee -a agent.log
   ```
   - 用 `caffeinate` 是为了防止电脑睡眠导致程序中断。终端窗口要一直开着。
   - 没有报错、只有安静的轮询，就说明已经连上。
   - `Receiver waiting: HTTP Error 403` 说明用错了程序版本。
   - `Waiting: no selected/default enabled CUPS queue` 说明队列不可用，回到第 2 步检查。
   - 正式运行时**不要**加 `--once`：它会真的领取并打印一个任务。
6. **端到端验证**：告诉 Shawn「接收端已启动」。他会在控制台看到「接收端在线 · <队列名> · 队列可用」，然后触发一次「电脑确认打印」。你这边的日志应该出现 `<run_id>: submitted …`，`lpstat -o` 里会短暂出现 `<队列名>-<数字>`，随后清空。最后必须由现场人员确认**实际出纸**：`submitted` 只代表系统收到了任务，不代表出纸。

## 已知限制（先知道，不要擅自扩大改动）

- 接收程序的「可用」判断只看队列是否启用，不看缺纸，也不看打印机是否离线：拔掉 USB 后，队列仍是 `printer-state=3`，只多一条 `offline-report`，预检照样返回 `True`。打印机没纸或断开时，它仍然会领取并提交任务，任务卡在队列里，后台显示「已提交」。所以第 4 步的预检只能证明队列存在，**不能证明打印机就绪**，以第 3 步的测试页出纸为准。可以考虑把 `media-empty`、`media-needed`、`offline-report` 也视为不可用，但**要等缺纸识别确认正常以后再改**，否则一次误报就会让它永远不领任务。
- 如果出现「提交结果不确定」（uncertain）：先检查 `lpstat -o` 和打印机，不要补印，也不要删除状态文件。
- 如果后台代码也在这台机器上，控制台提供下载的 `nfc-print-agent.py` 仍然是原版。请先征得后台负责人同意，再把 `nfc-print-agent.patch` 合进去，这样以后下载的就是修正版。

## 做完请回报

队列名；`lpoptions` 的 state 和 reasons；测试页是否出纸；接收程序日志的前几行；有没有 403 或 Waiting 报错。
