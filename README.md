# 谁在孕育谁？

完整工程交接见 [新电脑安装与合并](docs/HANDOFF.md)。本仓库同时保留主程序、生图算法、最新几何／有机标注作品模块、数字艺术 skill、原始素材及历史交付包。

首次运行请先执行 `python3 scripts/setup.py`，安装完整生图和 A4 排版依赖。数字艺术 skill 位于 [`.agents/skills/organic-data-annotation/`](.agents/skills/organic-data-annotation/SKILL.md)，含原图、认可示例及提示词。

《星环中的萌生》的实时互动代码原型。一个种子同时承担种子与养分的角色：观者移动光标改变观察环境，点击向红色核心输入养分，停下来等待声音与视觉回应，能量积累后种子向外释放，反过来改变光环。

## 运行

完整体验（主游戏、符号主控台、花园作品生成、3D 打印机）由一个本地 Python 服务提供：

```sh
./start.command
# 或：python3 printer/server.py（依赖见 printer/requirements.txt：numpy、Pillow、reportlab）
```

- <http://127.0.0.1:8765/>：主游戏（种子宇宙、十二节点轮盘）。
- <http://127.0.0.1:8765/prototype-3d.html>：符号主控台 `◒ → ✦ → ◇ → ◉ / ↯ → ▧ → ⟶ → ✓`。
- `prototype-3d.html?card=07`：带着主游戏抽到的卡进入，作品由这张卡与钥匙卡共同生成。

只看前端时仍可 `node server.mjs`，打开 <http://127.0.0.1:4187>。此时没有 `/api`，主控台自动退回原来的占位作品与模拟打印。无需网络、模型 API 或素材请求。可用鼠标、触控和空格键点击式互动；`nutrient` 自定义事件为后续 Arduino/传感器桥留出接口。声音由本地 Web Audio 生成，可静音。

符号设计规则见 [`SYMBOL-DESIGN-SYSTEM.md`](./SYMBOL-DESIGN-SYSTEM.md)，完整用户流程、状态机和手机/NFC/小米打印机技术边界见 [`ARCHITECTURE-AND-FLOW.md`](./ARCHITECTURE-AND-FLOW.md)。

## 打印后端（printer/）

`bridge.js` 把主控台接到 `printer/server.py`。视觉与交互仍以 `SYMBOL-DESIGN-SYSTEM.md` 为准。

| 符号 | 接入后 |
| --- | --- |
| `◒` `⋔` | 读取 RDK X5 骰子识别（`/api/dice`，左骰为成长，右骰为关系）；没有板子时仍是随机 |
| `✦` | 立即 `POST /api/jobs`，在本地生成花园作品与编号 PDF |
| `▧` | 显示真实作品，后台预载 3D 打印机场景 |
| `⟶` | 播放 3D 打印机组装与出纸，同时把作品页（A4 JPEG）直接发给米家喷墨打印机；`✓` 在打印机确认出纸后出现 |

作品算法需要两个模态数 m、n。一张卡时这张卡是 m，n 由种子随机抽取且不同于 m；两张卡时按两张卡。相同种子可复现同一个 n 与混合系数。卡片编号与名称以 `game-cards.js` 为准。

骰子：板子上运行识别，经 SSH 转给本机服务。

```sh
ssh sunrise@<board-ip> 'python3 ~/dice/dice_recognizer.py --camera 0 --stereo auto --json --no-window' \
  | python3 hardware/dice_push.py
```

服务启动后运行 `node printer/verify.mjs` 做接口回归。更多细节见 `printer/README.md`。
