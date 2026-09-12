# 谁在孕育谁？

《星环中的萌生》的实时互动代码原型。一个种子同时承担种子与养分的角色：观者移动光标改变观察环境，点击向红色核心输入养分，停下来等待声音与视觉回应，能量积累后种子向外释放，反过来改变光环。

## 运行

```sh
node seed-universe/server.mjs
```

打开 <http://127.0.0.1:4187>。无需网络、模型 API 或素材请求。可用鼠标、触控和空格键点击式互动；`nutrient` 自定义事件为后续 Arduino/传感器桥留出接口。声音由本地 Web Audio 生成，可静音。

符号设计规则见 [`SYMBOL-DESIGN-SYSTEM.md`](./SYMBOL-DESIGN-SYSTEM.md)，完整用户流程、状态机和手机/NFC/小米打印机技术边界见 [`ARCHITECTURE-AND-FLOW.md`](./ARCHITECTURE-AND-FLOW.md)。
