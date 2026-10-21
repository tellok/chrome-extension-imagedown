# ImageTaken Logo

当前 Logo 使用对话 [设计色块线条风格 Logo](codex://threads/01a15db3-f0cd-7193-a13b-a6df7d7848b3) 的最后生成产物：蓝色圆角画框、两个叠加山形，以及左下角的咖啡壶。

[原始产物](logo-source.png) 为 1315 × 1197 的透明 PNG，完整保留。部署时按可见图形范围去除多余透明留白，居中放置到透明正方形画布，保留原图造型、颜色和轻微渐变。

项目主图：[imagetaken-logo.png](../extension/assets/imagetaken-logo.png)，1024 × 1024。扩展图标：[16 px](../extension/icons/16.png)、[32 px](../extension/icons/32.png)、[48 px](../extension/icons/48.png)、[128 px](../extension/icons/128.png)，均使用 Lanczos 缩放并保留透明度。工具栏、扩展管理页、图片库、设置页、标签页及 README 共用这一版本。

使用 Pillow 重新生成全部尺寸及预览：

```sh
uv run --with pillow python scripts/build-icons.py
```

深浅背景预览，下排展示实际 16 / 32 / 48 / 128 px 尺寸：

![深浅背景预览](logo-preview.png)

原始文件来自该对话的最终图像 `exec-121a4718-d14b-498d-b6c5-1ca2f68fb77f.png`。
