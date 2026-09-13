# 2026-09-13 集成状态：保留现有主流程

合入来源：Shawn 的 `98b46bfffa6798229673c3dcf5fe23921d364a0a`，分支 `integrate-printer`。用户确认先保留当前实现，优先完成主流程。

## 当前运行内容

主入口仍是 `/prototype-3d.html`（根目录重定向同一入口），参与者抽一张，AI 抽一张，确认目标符号，生成 Garden，再进入同一任务的两张实体卡融合与 Shawn 3D 打印场景。保留本地当前 NFC/手机/匹配引导、12 个 Lottie 符号、加载轮播、任务幂等、生成队列、性能优化及云容器代码。

本次没有更换 `printer/server.py`、`garden_style.py/json`、`rarity.py`、`story.py` 的运行算法，没有重新安装依赖、部署网站、重启打印服务或恢复历史数据库。纸张打印由当前 NFC 接收端或明确的打印操作发起；3D 动画完成仍不等于实物出纸。

## 新资料的使用范围

- `artwork/garden_geometry/`：完整独立创作模块，包含几何计划、问题和随机变量规则、风格快照、布局参考、各阶段完整提示词、两张真实 AI 样张及 A4 排版文件。保持独立，不自动接入在线任务。
- `.agents/skills/organic-data-annotation/`：数字艺术 Skill、原图、认可样例、完整提示词。代码合入不等于安装图像模型或配置在线图像服务。
- `卡片/`、`photo/`、`output/`、`3dmodel/`、`video/`、`archive/`：原始资料和历史工程，包含草稿及旧数据库；不恢复到活动的 `printer/jobs/`。
- `docs/HANDOFF.md`、`VERIFICATION.md`、`upload-manifest.json`：Shawn 上传时的历史快照。其旧主入口、打印行为及部署说明不能替代本次集成状态。

几何模块的编号属于旧牌义，不能与主站 `game-cards.js` 按编号直接映射。例如主站 03/05 为土壤/河流，旧资料 03/05 为恋人/皇帝。新模块目前生成计划和提示词，没有在线图像生成 API。当前 `style_snapshot.json` 与主站风格 JSON 一致；其中 `assets/garden_refs/` 的路径以 `printer/` 为根。

样张入口以 `samples.json` 指向的 `artwork_A4.png/pdf` 为准。两张成品的文档为 2480×3508，内画源图为 1024×1536；保留历史题字、白卡和叠加过程，不以旧 prompt 覆盖新版生成器。根 `requirements.txt` 为独立完整创作依赖，A4 工具需要 PyMuPDF；当前运行环境和容器依赖保留原版本。

## 合并取舍

保留完整远程资料和历史，但涉及 `bridge.js`、`prototype-3d.*`、`printer/app.js`、`printer/server.py` 及 3D 时间线的分歧，采用本次已验证的主站版本。远程早期 IPP 自动打印与另一套手机中继未启用，避免改变当前实物打印路径。

根目录新增的 `wrangler.jsonc` 属于旧中继，与正式配置同名；部署须沿用当前文档里的显式 `--config` 路径，不能在本目录直接运行无配置参数的部署命令。现行前端构建使用复制白名单，大归档不会进入发布包。

原上传 manifest 针对 `98b46bf`，因此主站文件经集成后显示 CHANGED 是预期行为。新资料完整性以同一 manifest 的对应路径校验；本次集成验证结果单列在 `integration-verification.json`。
