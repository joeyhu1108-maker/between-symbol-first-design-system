# 完整工程：安装、校验与合并

2026-09-13 整理。目标分支 `integrate-printer`，基础提交 `441e7b1`。

## 新电脑从这里开始

```sh
git clone --branch integrate-printer https://github.com/joeyhu1108-maker/between-symbol-first-design-system.git
cd between-symbol-first-design-system
python3 scripts/verify_manifest.py
python3 scripts/setup.py
.venv/bin/python printer/server.py
```

使用 Python 3.9–3.12；推荐 3.11/3.12。Node.js 22 或更新版本用于检查前端脚本；此次验证版本为 Node 24。Windows 使用 `py -3.12 scripts/setup.py` 和 `.venv\Scripts\python.exe printer\server.py`。虚拟环境在新机器上重建，不复制旧 `.venv`。

打开 `http://127.0.0.1:8765/prototype-3d.html`。macOS 完成安装后也可双击 `start.command`。完整后端必须由 Python 启动；`node server.mjs` 只提供前端模拟。默认端口 8765，可通过 `PORT` 改变。多套历史服务使用同一个默认端口，请一次只运行一套。

所有素材都是普通 Git 文件，无需 Git LFS，也不依赖本机图片缓存。仓库包含约 1.4 GB 的未压缩文件，请等待 clone 完成。大文件历史会增加下载量，后续修改尽量只提交实际改动。

## 代码、风格与资源的对应关系

| 路径 | 完整保留的内容 | 当前用途 |
| --- | --- | --- |
| 根目录 HTML/JS/CSS、`bridge.js`、`game-cards.js` | BETWEEN 主控台、12 张队友卡牌、交互与打印桥接 | 当前主程序 |
| `printer/server.py` | 两模态克拉尼场、单牌/双牌输入、种子、作品任务、PNG/PDF/JPEG、打印接口 | 当前本地生图与打印后端 |
| `printer/garden_style.py`、`garden_style.json`、`GARDEN_STYLE.md` | 粉/淡紫色板、透明色域、20%油画感、磨损、手工细节、排除项、统一 AI 提示词 | 当前基础 Garden |
| `printer/rarity.py`、`rarity.js`、`story.py` | 66 对组合概率与 BETWEEN 卡牌叙事 | 当前主程序 |
| `artwork/garden_geometry/` | 几何算法、玩家问题、牌义、随机布局、提示词、参考图、2 张 AI 成品、A4 排版 | 完整独立创作模块，尚未接入当前主程序 |
| `.agents/skills/organic-data-annotation/` | SKILL.md、agents/openai.yaml、示例提示词、原图和认可示例 | 可复用数字艺术 skill |
| `printer/assets/`、`printer/vendor/`、根目录 `vendor/` | GLB 模型、风格参考与本地 Three.js | 当前运行依赖，不依赖 CDN |
| `phone-link.js`、`tap.html`、`worker/`、`wrangler.jsonc`、`MAIN-FLOW.md` | 手机/NFC 中继完整本地源码与部署配置 | 单独部署后才有跨设备中继 |
| `nfc-print-agent-fix/` | 中文 macOS 队列与 User-Agent 修复、patch、配置模板、交接说明 | 外部服务器打印接收端；所需后台协议不在当前 Worker 内 |
| `3dmodel/` | 建模源码、Blender/GLB/STL、旧版打印体验、样张与全部交付 ZIP | 历史工程与可编辑模型来源 |
| `artwork/`、`photo/`、`output/`、`video/`、`卡片/` | 原图、卡牌文案/PDF、AI 成品、动画、制作要求及旧版本 | 原始素材与历史交付，含被否定草稿 |
| `rdk-x5/` | 骰子识别代码、模型、部署和板卡脚本 | 需实际 RDK X5 硬件 |
| `archive/between-jobs/` | 上传时 BETWEEN 作品文件及 SQLite 一致性备份 | 历史记录，不自动恢复打印任务 |

`3dmodel/printer_experience/jobs/` 也保留历史作品和数据库备份。不要把旧任务数据库覆盖到新安装的 `printer/jobs/`；新机器默认建立独立任务库，避免旧打印状态被当作待处理任务。

## 生图算法与随机变量

基础场：`a*cos(m*pi*u)*cos(n*pi*v) + b*cos(n*pi*u)*cos(m*pi*v)`。`m/n` 为 1–12 的不同模态，`seed` 是 32 位种子。单张 BETWEEN 卡固定 m，由种子选择不同的 n；两张卡则取两个卡号。θ 在 10°–80°，a=cosθ，b=±sinθ。`printer/server.py` 的 `card_params` 是主程序的规范来源，不能随意替换成另一套随机抽样顺序。

`garden_style.py` 使用 NumPy RNG 控制色域位置、旋转、大小、透明度、纸纹、笔触和磨损；`garden_style.json` 固定色板、抽象度与风格尺度。数值计算和随机布局在相同输入与依赖版本下可复现；图片中的编号、时间、PDF元数据不同不属于画面随机变化。

最新几何模块把 card_ids 与 numbers 分开保存；规范化 question 的 SHA256 与完整输入一起派生随机种子。几何数量随数字和变化，模态场决定锚点，差值控制旋转范围，牌义决定形状与关系。详见 `artwork/garden_geometry/README.md`、`compose.py`、`card_roles.json`、`card_sources.json` 和 `style_snapshot.json`。

最终 A4：210×297 mm，木框6 mm、四边白卡12 mm，画面174×261 mm（2:3），底部无题字；文档排版由 `layout_a4.py` 保证。基础 Garden 仍为7:12画幅，不要把两个版本的排版规则混用。

## 合并时必须知道的事实

1. **代码完整保存不等于功能已经接通。** 当前 `printer/server.py` 自动生成的是 `local_garden`，没有在线 AI 调用。最新几何/标注样张是已保存的真实 AI 输出；模块能生成计划、提示词和布局参考，但在线图像服务仍需接入。不要把纯代码布局图标记为 AI 成品。
2. **两套卡牌含义不同。** 主程序使用 `game-cards.js` 的 BETWEEN 卡牌；`artwork/garden_geometry/card_sources.json` 来源于 `卡片/` 的旧叙事序号。不能仅凭相同的1–12数字就套用旧牌义。接入前按队友的卡牌定义明确映射或改写角色语义。
3. **主程序与独立作品入口分别保留。** 先拉取并验证完整工程，再在集成改动中连接 `compose → 图像服务 → 保存真实图片 → A4 → 打印纹理/文件`。本次交接不改变已认可的卡牌设计或主程序出图行为。
4. **实体打印需要设备。** macOS 当前实现依赖 CUPS、lpstat、lp、dns-sd/IPP-USB。无打印机时仍可生成文件及播放动画；Windows 的文件生成可用，但实体打印适配尚未验证。Linux CUPS 需现场适配测试；不要把模拟打印或提交成功等同于实际出纸。
5. **手机中继需要单独部署和配置。** 本次只上传源码，没有执行 Cloudflare 部署、NFC 写卡、外部服务器更新或实物打印。仓库中旧记录的域名/设备状态只是历史记录。
6. **历史工具按其 README 使用。** Blender 建模脚本需要 Blender/bpy；几何重建还需要 trimesh、scipy、scikit-image；RDK 模型需要板端依赖；旧 FDM 工具和被否定的视觉稿仅归档。它们不是启动主程序所需的依赖。

在已有队友工作目录合并时，先提交或暂存自己的修改，再运行：

```sh
git fetch origin
git merge origin/integrate-printer
```

新电脑首次运行优先完整 clone。不要把项目文件夹拖拽覆盖队友工作区，不要用 `reset --hard` 清除其修改。若双方改了相同文件，Git 仍可能产生正常的合并冲突；这份交接消除缺文件和本机路径依赖，不能保证未来并行修改完全无冲突。版本合并后若主动改动文件，原快照校验报 CHANGED 是预期行为。

## Skill 使用

支持项目 `.agents/skills` 的工具可直接读取本仓库 skill。其他工具把整个 `organic-data-annotation` 文件夹复制进自己的 skills 目录，保留 `references/` 与 `agents/`。其图像编辑执行依赖目标电脑的图像生成工具；skill 是视觉规范与参考素材，不包含图像模型权重或 API 凭据。

## 验证

```sh
python3 scripts/verify_manifest.py
.venv/bin/python artwork/garden_geometry/test_compose.py
.venv/bin/python artwork/garden_geometry/test_captions.py
node printer/verify_printer_effects.mjs
# 另一个终端保持 Python 服务运行；下面只用不存在的测试队列，不会出纸。
node printer/verify.mjs
```

校验清单 `upload-manifest.json` 覆盖发布快照，记录大小与 SHA256，自身不递归包含；`import-inventory.json` 记录从本地导入的来源哈希和排除项。少数移植修正（相对路径和文档）会与原始导入哈希不同，以最终 upload-manifest 为准。`portable-source-map.json` 保留原始来源到仓库路径的对应关系，成品 manifest 内的来源路径相对该 manifest。

排除内容仅为真实 `.env` 设备凭据、虚拟环境、缓存、编辑器本机配置、索引、日志和操作系统元数据；模板保留。活跃数据库用 SQLite backup 生成一致性副本。根目录原 AGENTS/CLAUDE 指令作为历史文档保存在 `archive/project-instructions/`，不会在新电脑自动运行本机钩子。
