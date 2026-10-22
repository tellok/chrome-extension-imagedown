# Proposal

## Why

[Issue #12](https://github.com/tellok/chrome-extension-imagetoken/issues/12) 要求在原网页用红色 2px 边框标记图库选中的图片，让用户能对应图库与网页中的位置。当前选择只改变图库卡片，缺少原页反馈。

## What Changes

- 侧栏或独立图库中的单选、多选、全选、框选及取消操作，自动同步原页的红色 2px 高亮；筛选隐藏但仍选中的图片继续高亮。
- 保留同一候选的全部可用元素引用，覆盖重复图片、开放影子树（Shadow DOM）及有权限的内嵌框架（iframe）。背景与伪元素图片标记承载元素；只有资源记录且没有元素的候选不猜测页面位置。
- 使用不参与布局、不接收鼠标事件的临时覆盖层（Overlay），不改写网站已有边框、轮廓或元素结构；滚动、尺寸变化后跟随目标，取消选择、导航和关闭图库后清理。
- 多个图库分别维护选择，原页显示各活动视图选择的并集；关闭其中一个不清除其他视图的标记。拒绝旧文档和过期选择更新。
- 高亮只处理页面元素与几何位置，不请求图片、不启动调试读取，不新增权限、设置、依赖或持久化数据。

## Capabilities

### New Capabilities

无，扩展既有图库与采集能力。

### Modified Capabilities

- `image-library`：新增原页选择高亮、非侵入显示与多视图生命周期要求。
- `image-discovery`：新增候选与多个实际页面元素的映射要求，保持去重和采集元数据契约。

## Impact

预计修改 `extension/collector.js`、`api.js`、`panel.js`、`background.js`、`badge-observer.js`，新增原页绘制与会话协调模块；`selection.js` 的既有回调可复用。更新 README、开发文档和 CI 专项入口。具体设计与任务见 [design.md](design.md)、[tasks.md](tasks.md)。拟新增 **16 项测试**，完整逐项清单见 [test-review.md](test-review.md)；不修改原有测试。

## Audit

- OpenSpec: required。新增图库选择引发的原页可观察行为；当前仅创建待审规划，不实施代码或测试。
- 初始分支 `work`，用户指定仓库基于 `main`，本地 `origin/main` 与 HEAD 同为 `3c7bdc4e101cf80ef5193fb69ede66df4c82631a`；未配置 origin/HEAD 符号引用。工作区干净，首次活动清单为空，本 change 是唯一新增活动变更；不创建 worktree。
- 阅读、历史约束、完整测试盘点与当前浏览器验证阻塞见 design；不改旧归档。
- External-Skill: exempt。检索 `skills/`、`.agents/skills/`、README、Manifest、打包脚本：没有消费方 Skill 或对应分发机制，内部 OpenSpec skills 属维护流程，无误置对外 Skill；ZIP 仅分发 extension。本次不新增消费方自动化接口。
- README-Glossary: verified。核对图库、采集、平台、徽标主规格及相关归档和 README，选择、高亮、覆盖层、会话均使用行业通义，没有项目私域术语新增或映射变化；README 只补充使用行为，保留现有空术语表。
