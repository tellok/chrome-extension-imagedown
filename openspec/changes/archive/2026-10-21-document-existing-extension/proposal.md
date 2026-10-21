## Why

README 已承载大量验收规则、内部实现和历史改动，用户入口难以阅读，功能约定也没有独立维护位置。项目已发布到 0.4.3，需要基于现有实现和提交记录建立可追溯的 OpenSpec 基线。

## What Changes

- 初始化 OpenSpec 1.14.3 的 spec-driven 工作流及 Codex skills。
- 将已交付行为整理为八项能力，每项提供规范要求与可验证场景。
- 记录提交、代码及测试的对应关系，明确这是追溯建档，而非新功能交付。
- 将开发命令与模块说明移到开发文档；README 只保留简介、安装、基本操作和文档入口。
- 验证、同步主规范，并归档本次文档基线。扩展运行行为、权限和版本不变。

## Capabilities

### New Capabilities

以下是新增的规范文档能力，产品功能均已存在。

- `image-discovery`: 页面图片来源、范围、去重和发现边界。
- `image-filtering`: 网站规则、普通筛选、搜索记忆和忽略规则。
- `image-data`: 原始资源读取、本地复用、缩略图边界和预览重试。
- `image-library`: 图库布局、选择、排序及页面标题呈现。
- `image-downloads`: 保存目录、标题编辑、文件去重、转换与完成状态。
- `automatic-badge`: 未展开时的自动计数、筛选一致性和展开稳定性。
- `user-preferences`: 标题清洗、成功优先、多语言与明暗主题。
- `extension-platform`: 浏览器兼容性、权限、隐私及资源限制。

### Modified Capabilities

无既有 OpenSpec 能力。

## Impact

新增 `openspec/` 和 `.agents/skills/openspec-*`；重组 README 并新增开发文档。后续行为变更以主规范为依据，通过 change delta 更新。提交追溯见本变更的 `evidence.md`。
