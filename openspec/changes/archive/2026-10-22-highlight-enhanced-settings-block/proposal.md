# 高级功能区块定位提案

## Why

图库“没有找到需要下载的图片？试试增强模式”的入口目前自动聚焦网站开关，视觉提示只圈住按钮。用户要求用“高级功能”整个区块的边框表达跳转落点，以便同时看到域名、用途和授权说明。

## What Changes

- 核实源网页后，将增强模式（Enhanced Mode）入口的滚动与焦点目标改为“高级功能”整个区块。
- 区块获得焦点时高亮完整边框，覆盖标题、域名、开关和说明；焦点离开后恢复普通边框。高亮不改变区块尺寸、不闪烁。
- 保留开关正常的键盘操作和焦点样式；普通设置入口不自动突出该区块，网站校验及授权流程保持既有语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `image-library`：修改“图库呈现网站增强模式状态与入口”的跳转落点，并补充区块边框和键盘访问场景。

## Impact

预计修改 `extension/enhanced-settings.js`、`extension/settings.html`、`extension/settings.css`、`tests/extraction_browser_test.py` 和 README 使用说明。同步 `image-library` 主规格只在实施验证后的归档阶段执行。无依赖、权限、配置格式、部署或原图提取改动；完整原文件与静态像素缩略图边界不变。

## Audit

- OpenSpec: required。目标路径及性质见 Impact；自动焦点和高亮范围属于可观察交互，关联 change 为 `highlight-enhanced-settings-block`。当前仅写规划文件，尚未改业务代码或测试。
- 初始 HEAD `3cad7e4`，分支 `main`，默认分支 `origin/main`，工作区干净。首次成功活动清单仅 `highlight-selected-source-images`，该项由 `608ef11` 首次引入，并经 `3cad7e4` 合并到默认分支，是继承 change；其原页图片高亮与本次设置区块定位无关，保持原样、排除交付。本次为当前工作上下文唯一新建活跃 change。
- 按增强模式、设置跳转、聚焦开关、高级功能、`enhanced-settings`、`enhanced-mode`、预计文件路径及 Requirement/Scenario 搜索主规格和全部归档。完整读取 `image-library`、`user-preferences` 主规格及直接相关归档 `2026-10-22-multi-source-image-extraction` 的 proposal、design、tasks 和 image-library/user-preferences delta。历史确立核实来源后聚焦开关；当前代码与 EB09 一致，无既有规格冲突。本提案明确提出修改这一行为；未发现其他规定跳转落点的归档。
- External-Skill: exempt。检索 `skills/*/SKILL.md`（目录不存在）、README、`extension/manifest.json` 的分发引用、`scripts/package.py` 和 CI，未发现对外 Skill 或分发机制；`.agents/skills/` 均为内部 OpenSpec 维护流程，无误置消费方入口。本次只改设置视觉定位，无对外 Skill 同步项。
- README-Glossary: verified。检查 README、相关两份主规格及上述归档；增强模式仍复用 `user-preferences` 的既有定义，“高级功能”仅是既有界面分类名，区块、焦点和边框为通用界面概念；项目私域术语集合、英文映射及定义边界均未变。README 只补充跳转行为说明，术语表保持原条目。
- 测试修改共 2 个既有用例，完整盘点和逐项审批清单见 [test-review.md](test-review.md)；需用户同时明确同意清单中的测试修改。
