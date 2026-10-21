# 0.4.3 基线证据

这是在 2026-10-21 追溯建立的文档基线，核对截止提交为 `ef31c0a`。下列历史提交没有被重新命名成旧日期的 OpenSpec 归档；提交日期来自 git，归档日期是本次文档整理日期。

## 提交到能力的映射

| 原提交日期 | 提交 | 已交付行为及现行规范归属 |
| --- | --- | --- |
| 2026-10-19 | `b6df6fb` | 页面优先发现和下载；image-discovery、image-data、image-downloads、extension-platform |
| 2026-10-19 | `7215b8c` | 重新扫描时重置旧下载进度；image-library |
| 2026-10-19 | `2e1fca5` | 并行扫描保留页面读取入口；extension-platform、image-data |
| 2026-10-19 | `bf32eec` | 默认阈值、体积显示、按网站忽略；image-filtering |
| 2026-10-19 | `dfe7dbc` | 单张及批量失败预览重试；image-data |
| 2026-10-20 | `d63ecc1` | 图库网格 / 列表和响应式界面；image-library |
| 2026-10-20 | `7551744` | ImageTaken 命名、XPath 与 CSS 排除；image-filtering、image-library |
| 2026-10-21 | `2c736bb` | 卡片与框选、目录与标题、内容去重、设置、语言和主题；image-library、image-downloads、user-preferences |
| 2026-10-21 | `c9d7228` | debugger 原始资源读取和所选山形 / 咖啡壶 Logo；image-data、extension-platform |
| 2026-10-21 | `3821042` | 未展开时自动徽标、工具栏图标尺寸调整；automatic-badge |
| 2026-10-21 | `4268f14` | 整页加载完成前统计图片、工具栏专用图标；automatic-badge、image-library |
| 2026-10-21 | `5570a50` | 展开前后稳定的过滤计数、精简标题区、破碎占位图标；automatic-badge、image-library |
| 2026-10-21 | `ef31c0a` | 原图 Blob 复用、并发缩略图与原图隔离、成功优先默认开启；image-data、image-downloads、user-preferences |

提交范围核对命令：`git log --reverse --format='%h %ad %s' --date=short`、`git show --stat <commit>`，并结合以下当前源码确认最终行为。合并提交与 CI runner 配置不作为独立产品能力。

## 当前实现与验证入口

下列文件是证据位置，不是主规范对内部实现的强制约束。测试映射表示存在对应验收覆盖，不代表本次文档迁移重新执行了每个真实浏览器场景。

| 能力 | 当前代码 | 已有验证入口 |
| --- | --- | --- |
| image-discovery | `extension/collector.js`、`extension/api.js` | `tests/browser_test.py`：iframe、Shadow DOM、Canvas、SVG、srcset、懒加载候选及失效来源 |
| image-filtering | `extension/lib.js`、`extension/metadata.js`、`extension/preferences.js` | `tests/lib.test.js`、`tests/metadata.test.js`、`tests/browser_test.py`：边界、忽略、XPath / CSS 及 hostname 隔离 |
| image-data | `extension/api.js`、`extension/debugger-reader.js`、`extension/browser-resources.js`、`extension/previews.js` | `tests/image-data.test.js`、`tests/previews.test.js`、`tests/debugger_test.py`：本地 Blob、动图原字节、零额外图片请求、过期文档与连接释放 |
| image-library | `extension/panel.html`、`extension/panel.css`、`extension/panel.js`、`extension/selection.js` | `tests/browser_test.py`：点击 / 框选 / 取消 / 自动滚动、失败禁选、排序、窄屏、标题区和规则摘要 |
| image-downloads | `extension/destination.js`、`extension/browser-downloads.js`、`extension/download-hashes.js`、`extension/file-content.js`、`extension/title-editor.js` | `tests/destination.test.js`、`tests/file-content.test.js`、`tests/browser_test.py`：授权失败、标题目录、重复内容与路径异常 |
| automatic-badge | `extension/automatic-badge.js`、`extension/badge-observer.js`、`extension/badge.js` | `tests/badge.test.js`、`tests/automatic_badge_test.py`：过滤、加载中网页、稳定展开计数、缓存筛选与跨页隔离 |
| user-preferences | `extension/settings.js`、`extension/settings-page.js`、`extension/i18n.js`、`extension/theme.js` | `tests/settings.test.js`、`tests/i18n.test.js`、`tests/theme.test.js`、`tests/language_test.py`、`tests/theme_test.py`；默认成功优先直接核对加载及实时变更分支 |
| extension-platform | `extension/manifest.json`、`extension/collector.js`、`extension/api.js`、`extension/debugger-reader.js` | `scripts/check.mjs`、`tests/browser_test.py`、`tests/debugger_test.py`；真实系统目录选择器仍需手动验证 |

## 校正的旧描述

- 成功图片优先当前默认开启，但保留已保存的关闭值。
- 徽标不再改用侧栏预览进度；它统一基于过滤后的页面结果。
- 取得的完整原图可本地复用；只有尚未取得的数据读取才需要校验源文档身份。
- 预览重试可先用像素缩略图，不能把这一策略写成原文件下载优先使用缩略图。
- 当前标题区没有图片库大标题、总数或标题插画；域名移到顶部面包屑。
- `browser_test.py` 支持 `CHROMIUM_PATH`；调试和徽标专项脚本当前使用 macOS ARM64 Playwright 缓存路径，不能将其描述为全部支持该变量。

## 验证记录

本次文档迁移实际执行：

- `openspec validate document-existing-extension --strict --no-interactive`：通过。
- `npm run check`：Manifest 资源引用与 JavaScript 语法通过。
- `npm test`：28 项通过，0 项失败。
- 八份主规范逐份比对：Purpose、要求和场景与 delta 一致，主规范使用标准 Requirements 章节。

本次未重新运行真实浏览器集成测试；未修改扩展运行时代码。归档后完成以下复核：

- `openspec validate --all --strict --no-interactive`：8 份主规范通过。
- `openspec validate --archived --strict --no-interactive`：1 份归档通过，7 / 7 项任务完成。
- `openspec list --json`：无未完成的活动变更。
- 23 份迁移相关 Markdown 的本地链接全部有效；8 份归档 delta 与主规范内容一致。
- `git diff --check`：通过。

CLI 提示该基线包含较多 delta，建议拆分变更。此处保留为单次追溯基线，能力已拆成八份主规范；后续行为变更分别建档。
