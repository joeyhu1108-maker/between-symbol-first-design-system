# BETWEEN / Motion kit

12 个关系符号，71 个矢量部件。Lottie JSON 无位图依赖、无外部字体，可任意缩放；另含同源 SVG。

## 预览

唯一资源目录为 `seed-universe/motion/`。从项目根目录运行 `node seed-universe/server.mjs`，打开 [符号动效展示](http://127.0.0.1:4187/motion/)；启动完整作品服务后，也可在 [主作品服务](http://127.0.0.1:8765/motion/) 中查看。网页支持桌面悬停、键盘聚焦、点击和手机轻触，提供重播、暂停、1/4慢放及即时速度调节。

每个符号的动作从自身关系出发，完整说明见 [motion_spec.md](./motion_spec.md)。主作品与手机抽卡界面通过 `../symbol-interface.js` 共享同一组资源，表达承接、洗牌、交接、生成与融合等行为；符号编号不替代实体卡编号。旧 `4193/motion/` 地址由兼容服务读取本目录。

## 文件

- animations/01.json … 12.json：标准 Lottie JSON，60 fps、362×362 逻辑画布。
- vectors/01.svg … 12.svg：静态矢量母版，适用于印刷及高清输出。
- src/glyphs-first.mjs / glyphs-last.mjs：每个部件的原始曲线、支点与动作关键帧。
- src/build.mjs：从项目根目录运行 `node seed-universe/motion/src/build.mjs` 重建 JSON、SVG 与 manifest。
- player.mjs：使用本地 lottie-web 的分段交互控制器。
- vendor/：lottie-web 5.13.0 light build 与 MIT license。

下载包保留 `motion/` 子目录，并附带同层的 `symbol-interface.js` 与 `symbol-interface.css`。在解压根目录启动静态 HTTP 服务后打开 `/motion/`，即可独立检查动作；在该根目录运行 `node motion/src/build.mjs` 可重建矢量资源。完整作品的会话、卡牌与打印服务不包含在这个动画资源包中。

## 接入

作品界面优先使用 `seed-universe/symbol-interface.js` 的 `mountGlyph`、`mountSymbolState` 和 `actionGlyph`，配合共享样式 `symbol-interface.css`。桌面与手机都保留原有业务事件和无障碍标签，动画负责反馈；连接、匹配和生成状态由实际会话及任务结果决定。

引入 vendor/lottie.min.js 后：

```js
import { createSymbol } from './player.mjs';
const symbol = await createSymbol(container, '01', { ambient: true });
symbol.play('tap');
symbol.setSpeed(0.5);
// 卸载时
symbol.destroy();
```

每个 JSON 包含 idle / hover / tap 三个 marker，帧区间分别为 [0,240]、[240,288]、[288,396]；静态最终帧为396。也可直接用 lottie-web.playSegments 调用。

减少动态偏好时显示静态成品。后台和离屏暂停。组件必须在卸载时 destroy。新版是对参考图的平滑矢量重建，保留主要轮廓和黑/蓝/红关系，原图片的颗粒与棋盘格不进入动画。

## 检查

qa/frames.html 用实际 Lottie 渲染器展示 12 个符号的关键时刻。展示页可用 `?symbol=07&t=540` 定位点击动画毫秒时间，或 `?static=1` 查看静态。

浏览器检查范围为本地 Web；没有宣称已在原生 iOS/Android Lottie SDK 或 After Effects 中验证。
