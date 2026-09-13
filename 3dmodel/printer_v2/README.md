# 打印机 · 暖色亚克力新版

以 `photo/printer.png` 为造型参考，以 `photo/猫咪细线罗马数字版/总览.jpg` 为暖白、淡玫瑰粉、灰褐细线的配色与表现参考。新版独立保存在此文件夹，原版 `3dmodel/out/` 不变。

## 文件

- `printer_atelier.blend`：可编辑的实体材质版本，按外壳、金属框架、打印机构、五金、纸张、线条分成 6 个集合。内置 4 个相机与摄影棚灯光。
- `printer_atelier.glb`：可导入 Blender、Three.js 等软件的模型，带基础 PBR 材质及透射参数，不包含摄影棚。部分查看器对亚克力透射的支持不同；以 Blender 渲染为材质基准。
- `printer_illustrated.blend`：同一套三维几何的暖色手绘表现版本，使用表面色彩变化、灰褐色 Freestyle 轮廓与笔压变化。线稿需要在 Blender 中渲染，不会随 GLB 导出。
- `preview_hero.png`：实体材质预览。
- `preview_illustrated.png`：手绘表现预览。
- `preview_front.png`、`preview_detail.png`、`preview_rear.png`：正面、出纸机构特写及背面预览。
- `build_printer.py`、`render_illustrated.py`：可重复生成模型、材质与渲染的 Blender Python 脚本。
- `model_report.json`：部件数量、尺寸和参考说明。
- `geometry_validation.json`：实际应用修改器后的几何检查结果；实体材质模型共 371 个对象，87,574 个顶点、82,789 个面，无空几何。GLB 已重新导入检查。

## 设计与边界

主体宽约 236 mm、深约 180 mm，包含进纸的整体高约 248 mm；尺寸为从图片比例推定的设计尺寸。亚克力罩有 3 mm 实际厚度；金属支架、滚轴、轴承、齿轮、弹簧、切纸齿、紧固件、背部接口和电路板分别建模。进出纸保留空白。

只有正面参考图，因此背面、内部传动和具体尺寸属于合理补全。这是外观与视觉设计模型，没有经过机构运动、制造公差或真实打印机零件适配验证。

## 重新生成

在 macOS 上执行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python build_printer.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python render_illustrated.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python render_views.py
```

脚本在独立的 Blender 后台进程中创建新场景；不要在有未保存作品的交互场景中执行。
