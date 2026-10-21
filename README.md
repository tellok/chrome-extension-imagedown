# ImageTaken

<img src="extension/assets/imagetaken-logo.png" alt="ImageTaken Logo" width="144">

一个原生 JavaScript、零运行时依赖的 Chrome 图片下载扩展，支持侧边栏浏览、筛选、框选和批量保存图片。

[GitHub 仓库](https://github.com/tellok/chrome-extension-imagetoken)

## 安装

需要 Chrome 116 或更新版本，扩展无需构建。

1. 克隆仓库，或下载并解压扩展 ZIP。
2. 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择仓库的 **`extension` 文件夹**，或包含 `manifest.json` 的解压目录。
4. 打开网页，点击 ImageTaken 图标打开侧边栏；右上角 `↗` 可打开独立标签页。

更新本地代码后，在扩展管理页点击「重新加载」。

## 使用

- 点击图片卡片选择图片，也可以拖动鼠标框选；通过搜索、尺寸、格式和网站规则缩小范围。
- 编辑页面标题，选择下载位置，然后下载选中图片。图片保存在以页面标题命名的子文件夹中。
- 点击齿轮打开设置，调整语言、明暗主题、标题清洗和成功图片优先展示。
- 懒加载内容先在原网页滚动或展开，再点击扩展的刷新按钮。下载期间保持扩展视图打开。

扩展优先复用已有图片数据。读取浏览器保留的原始资源时，Chrome 会显示调试提示；无法读取时可能回退到图片 URL 请求。受浏览器权限、跨域限制或失效地址影响，部分图片可能无法保存。

设置和处理在本机完成，无遥测或后端；预览与下载可能访问原图片服务器。

## 开发

```sh
npm run check       # Manifest 引用与 JavaScript 语法
npm test            # 单元测试
npm run package     # 生成扩展 ZIP
```

## 文档

- [产品规范与归档导航](openspec/README.md)：现有功能要求、场景及历史变更。
- [开发与验证](docs/development.md)：代码结构、浏览器测试、故障定位和 OpenSpec 工作流。
- [Logo](docs/logo.md) / [插图](docs/illustrations.md)：素材来源与生成说明。

MIT License。项目独立实现，不包含 Imageye 的专有代码或标识。
