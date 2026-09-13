# 谁在孕育谁？

当前集成状态见 [2026-09-13 主流程与艺术资料](docs/INTEGRATION-2026-09-13.md)。Shawn 的算法、Skill、完整提示词与样图已保留为独立创作资料，当前主站出图和打印流程继续沿用现有实现。

《星环中的萌生》的实时互动代码原型。默认由现场大屏显示二维码：参与者在手机上洗牌、亲手抽一张，再把另一次抽卡交给 AI；两张卡共同生成花园作品，并接入 3D 打印预演。

## 运行

完整体验（扫码抽卡、符号主控台、花园作品生成、3D 打印机）由一个本地 Python 服务提供：

```sh
./start.command
# 或：python3 printer/server.py（依赖见 printer/requirements.txt：numpy、Pillow、reportlab）
```

- <http://127.0.0.1:8765/> 或 <http://127.0.0.1:8765/prototype-3d.html>：默认显示扫码开场。手机与大屏连接同一 Wi-Fi，扫描屏幕二维码后洗牌并抽取一张卡；确认交给 AI 后，大屏从剩余 11 张中抽取另一张，再继续生成作品。
- <http://127.0.0.1:8765/prototype-3d.html?local=1>：电脑直接演示，同样由用户抽一张、AI 抽另一张。
- `prototype-3d.html?card=07`：带入用户的第 07 张卡，确认后由 AI 抽另一张。
- <http://127.0.0.1:8765/printer/>：独立作品与打印页面，可查看设备并明确发起纸张打印。

`node server.mjs` 提供 <http://127.0.0.1:4187> 本机兼容入口，`/api` 与 `/printer` 代理到 8765，仍需启动上述 Python 服务。完整扫码入口使用 8765 的局域网地址；手机只能访问抽卡页面、卡面和会话接口，打印仍需在本机独立操作。当前 AI 抽牌采用随机抽取，扫码流程由后端锁定结果；未调用模型。花园作品也在本地生成，无需模型 API。

符号设计规则见 [`SYMBOL-DESIGN-SYSTEM.md`](./SYMBOL-DESIGN-SYSTEM.md)，完整用户流程、状态机和手机/NFC/小米打印机技术边界见 [`ARCHITECTURE-AND-FLOW.md`](./ARCHITECTURE-AND-FLOW.md)。

## 打印后端（printer/）

`bridge.js` 把主控台接到 `printer/server.py`。视觉与交互仍以 `SYMBOL-DESIGN-SYSTEM.md` 为准。

| 步骤 | 当前流程 |
| --- | --- |
| 两张种子 | 用户洗牌并亲手抽一张，确认将另一次抽卡交给 AI；AI 从剩余 11 张中抽取一张，大屏展示结果 |
| 钥匙 `✦` | 根据两张卡生成钥匙，创建一个作品任务，在本地生成花园图像与编号 PDF |
| 答案卡 `◇` | 找到钥匙对应的答案卡，通过电脑确认或 NFC 模拟匹配后确认融合 |
| 作品 `▧` | 等待作品生成完成，显示该任务的图像与 PDF，并准备 Shawn 的 3D 场景 |
| 3D 预演 `⟶ → ✓` | 播放组装、造纸与出纸，使用同一个任务编号和作品；结束后可下载 PDF 或打开该任务的独立打印页 |

3D 预演不会自动向纸张打印机发送任务。物理打印需在独立打印页查看可用设备并主动点击打印；没有可用设备时，作品仍可下载。预演完成不表示纸张已经打印，NFC 模拟匹配也不表示真实读卡器已接通。

作品算法需要两个模态数 m、n。一张卡时这张卡是 m，n 由种子随机抽取且不同于 m；两张卡时按两张卡。相同种子可复现同一个 n 与混合系数。卡片编号与名称以 `game-cards.js` 为准。

骰子是可选硬件接口，不是当前默认选卡入口。板子上运行识别后，可经 SSH 转给本机服务（`/api/dice`）：

```sh
ssh sunrise@<board-ip> 'python3 ~/dice/dice_recognizer.py --camera 0 --stereo auto --json --no-window' \
  | python3 hardware/dice_push.py
```

服务启动后运行 `node printer/verify.mjs` 做接口回归。更多细节见 `printer/README.md`。
