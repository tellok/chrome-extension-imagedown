# ImageDown 黑白插图

为 0.3.0 界面独立生成的原创黑白线描插图。生成方式：Codex 内置 Imagegen 工具，透明背景；未使用 CLI/API 备用模式。没有复制或引用 Notion 官方插图或标识。

## 素材

| 文件 | 用途 | 尺寸 |
| --- | --- | --- |
| `extension/assets/collecting-pictures.png` | 图片库标题区：人物整理照片 | 1536 × 1024，RGBA |
| `extension/assets/finding-pictures.png` | 空状态：纸盒、照片框与放大镜 | 1448 × 1086，RGBA |

两个文件均随扩展打包，从本地加载。界面通过 CSS 按比例缩放；原始透明像素保留。ImageDown 原有图标在顶部以 CSS 灰度显示；没有采用 Notion 的品牌标识。

## 人物插图提示词

```text
Create one original black-and-white editorial ink illustration for ImageDown, a refined image-collecting Chrome extension redesigned with the calm paper-document feel associated with Notion. Transparent background. Horizontal composition about 3:2, centered isolated subject with breathing room around all edges: a thoughtful person in a simple loose white shirt, with solid-black short hair, quietly sorting three small framed landscape photographs into an open paper album; one free-floating picture card and a small hand-drawn sun make the image collection idea immediately legible. Contemporary monochrome hand-drawn linework, slightly irregular confident pen strokes, few solid-black areas, no shading gradients, no gray canvas, no texture overlay, no 3D, no color. Charming intelligent editorial simplicity, expressive hands but no tiny fussy detail. The drawing must remain readable at 110 pixels wide as a small UI decoration. No words, letters, numbers, logos, watermarks or brand marks. Do not reproduce any existing Notion illustration; create an original composition.
```

## 空状态插图提示词

```text
Create one original black-and-white editorial ink illustration for the empty state of ImageDown, an image-collecting Chrome extension with a calm Notion-inspired document interface. Transparent background. Isolated centered 4:3 composition with broad negative margins: an open empty paper archive box, two small blank photo frames leaning against it (one has a tiny simple mountain outline), and a hand holding a round magnifying glass above the frames, as though thoughtfully looking for images. No human face needed. Minimal slightly imperfect hand-inked black linework, expressive confident strokes, sparse solid-black accents and white interiors, lots of breathing room. Sophisticated friendly editorial illustration that reads clearly at 180 pixels wide. No color, gradients, rendering, shadows, gray background, words, letters, numbers, logos or watermarks. Original artwork, not a copy of an existing Notion illustration.
```
