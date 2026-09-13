# 花园 artwork：数字 × 牌义 × 几何 × 玩家问题

本分支仅在本目录生成作品、布局规则与交接文件。未修改打印机模型、动画、应用服务或主线程任务记录。

## 已完成的两张作品

| 作品 | 输入 | 关系内核 |
| --- | --- | --- |
| 是谁借谁抵达 | 恋人 × 皇帝；数字3、5；负向混合 | 吸引促成自愿的选择，承接逐渐形成依赖；谁看似掌握方向，谁又提供支撑 |
| 换一个方向看照料 | 皇后 × 倒吊人；数字4、9；正向混合 | 温柔的给予与接受，在倒置和错位中显露被分类、被消耗的另一面 |

两张均为真实 imagegen 输出。保留既有粉色、很淡紫色的花园底图及约20%油画感、磨损与非标准细节，增加少量有厚度的几何元素。图片、故事、完整提示词及输入记录位于 `outputs/`；打开 `gallery.html` 可以查看。

玩家问题尚未提供，两张样张的 `question` 都是 `null`，未代填个人问题。

## 四层信息怎样叠加

1. **底图与风格**：保持已有花园的色域、肌理、构图与空域，新增几何只覆盖少量区域。
2. **数字**：在克拉尼启发的模态场附近计算落点；数字和决定几何数量，差值影响偏转与错位，a/b影响模态交叠，seed决定具体随机布局。
3. **牌义**：从项目12张牌的故事中提取愿望、人的理解、种子／AI的理解与代价。每张牌至少有一种属于它的几何线索，再由交叠、承接、开口或牵制构成关系。
4. **玩家问题**：预留 `question`。问题全文进入图像提示词；已识别的语义提供额外几何关系提示；规范化文字的哈希参与随机种子计算。它既影响意义，也影响布局。问题不被当成人格测量或命运判断，图像不宣称给出了答案。

`card_ids` 与 `numbers` 分别保存，便于以后独立变化。当前显影台若数字等于牌序号，使用适配器默认映射即可。这里的1–12是项目卡片目录的叙事序号，不是传统塔罗牌原编号。

没有采集正逆位时，默认 `both`，保留文件中的双重观看方式；不会把b为负号当作抽到逆位。世界牌按项目设定没有逆位，记录为共同视角。

## 接入主线程

```python
from artwork.garden_geometry import compose_from_seed_plate, prompt_for, write_brief

brief = compose_from_seed_plate(
    {"m": 3, "n": 5, "a": 0.27576837112805397,
     "b": -0.9612241182395393, "seed": 333341133},
    question=None,  # 等玩家实际问题补充后传入
)
prompt = prompt_for(brief)
```

随后使用 `render_guide.py::render` 生成布局参考，把以下四张图依次交给图像服务：底图、几何布局图、几何风格参考、有机式数据标注参考（仓库根目录下 `.agents/skills/organic-data-annotation/references/approved-example.png`）。实际图像返回后保存完成状态，再由主线程自行接入其图片纹理和打印流程。本目录没有启动在线图像服务，也没有改动主线程的数据库。

可直接使用当前样张：读取 `samples.json`，再读取对应的 `manifest.json`。`image_path` 相对于该 manifest 所在目录；`artwork_id` 可作为作品追踪ID，由主线程关联自己的任务ID。

## 输入示例

```json
{
  "card_ids": [3, 5],
  "numbers": [3, 5],
  "a": 0.27576837112805397,
  "b": -0.9612241182395393,
  "seed": 333341133,
  "question": null,
  "orientations": ["both", "both"]
}
```

独立CLI：

```sh
.venv/bin/python artwork/garden_geometry/compose.py \
  --input artwork/garden_geometry/outputs/01_attraction_power/request.json \
  --out artwork/garden_geometry/outputs/new_brief
```

CLI生成的是可审阅的故事、几何计划和图像提示词，不会把布局示意图当作最终 artwork。缺省seed会创建新随机个体；给定相同seed和输入，可重现计划并重放已保存成品。再次调用AI不保证逐像素一致。

## 数据与验证

- `card_sources.json`：12张牌的来源、故事摘录和源文件SHA256。
- `card_roles.json`：愿望、双重视角、代价和几何语汇。
- `style_snapshot.json`：本次使用的花园风格快照，来源是主项目 `garden-v1.1`。
- `brief.json`：生成前计划；`manifest.json`：实际生成状态、图片哈希与视觉核对。
- `geometry_guide.png`：纯代码生成的布局控制图，不是最终绘画。

运行 `.venv/bin/python artwork/garden_geometry/test_compose.py`。已覆盖全部66种抽牌组合、相同数字和但不同牌义、数字和牌身份分离、问题的语义与随机影响、重复输入、无效输入及世界牌无逆位规则。

AI会艺术化理解几何布局。第一张保留了主要位置与关系，并额外生成一个小型缺口几何组；不能把规划坐标当作输出图像的精确检测结果。


## A4、等宽白卡与有机式数据标注

最终成品固定 A4 竖版 210 × 297 mm（含木框），木框框条6 mm，白卡上下左右均为12 mm。画面位于 (18,18) mm，内画幅174 × 261 mm，比例2:3。白卡宽度按画面边缘至木框内缘的垂直距离衡量，四边相同；底部无题字。PNG为2480 × 3508像素、300 dpi文档渲染，毫米尺寸以PDF页面为准，像素边界有不超过1像素的取整差。

采用用户指定的 `organic-data-annotation` 视觉规范：保留底图，用细引线、少量分支、微型标签与节点连接具体几何或肌理位置。标签内容由牌义、故事与几何关系选择；这些是艺术解释，不是测量数据。标注只在内画幅出现，白卡与木框内没有文字。玩家输入的 `question` 仍可影响内容；原30句题字资料保留，但不再渲染到画下方。

生成与排版分两步：`prompt_for` 请求2:3的内画幅及标注层；`layout_a4.py` 将图像放进固定毫米尺寸的PDF，再输出PNG。木纹来自真实生成的框体图像，仅用于文档外侧6 mm框条区域；中央底图不会混入最终作品。排版不依赖图像模型估计白卡宽度。

```sh
.venv/bin/python artwork/garden_geometry/layout_a4.py \
  artwork/garden_geometry/outputs/01_attraction_power/artwork_annotated.png \
  artwork/garden_geometry/assets/oak_frame_source.png \
  artwork/garden_geometry/outputs/01_attraction_power
```

交付文件为各作品目录中的 `artwork_A4.pdf`、`artwork_A4.png`，`layout_A4.json`记录版式与校验信息。原图、旧题字版本仍保留；`gallery.html`和`samples.json`只指向当前A4成品。打印PDF时选择实际大小/100%，具体打印机的无边距能力需在设备接入后确认。
