# ImageTaken 规范导航

`specs/` 保存当前产品行为的要求与场景，是功能规范的主要入口。README 仅保留安装和使用介绍，开发操作见 [开发与验证](../docs/development.md)。

| 能力 | 当前规范 |
| --- | --- |
| 图片发现与页面范围 | [image-discovery](specs/image-discovery/spec.md) |
| 网站规则、筛选与忽略 | [image-filtering](specs/image-filtering/spec.md) |
| 原图读取、预览与重试 | [image-data](specs/image-data/spec.md) |
| 图库布局、选择与排序 | [image-library](specs/image-library/spec.md) |
| 下载位置、标题、格式与去重 | [image-downloads](specs/image-downloads/spec.md) |
| 远程规则订阅与刷新 | [remote-rule-subscriptions](specs/remote-rule-subscriptions/spec.md) |
| 工具栏自动计数 | [automatic-badge](specs/automatic-badge/spec.md) |
| 设置、语言与主题 | [user-preferences](specs/user-preferences/spec.md) |
| 平台、权限、隐私与运行边界 | [extension-platform](specs/extension-platform/spec.md) |

## 基线与归档

本次于 2026-10-21 将已实现的 0.4.3 行为追溯整理为规范，代码基线为 `ef31c0a`。这是文档迁移，不代表这些功能在迁移当天才完成，也未为过去的提交补造独立变更归档。

[document-existing-extension 归档](changes/archive/2026-10-21-document-existing-extension/) 包含提案、设计、任务清单与原始 delta；[证据映射](changes/archive/2026-10-21-document-existing-extension/evidence.md) 说明提交、实现、测试和本次校验的关系。

后续需求在 `changes/` 下提出和实现，通过验证后同步到 `specs/` 并归档；历史归档用于追溯，当前行为以主规范为准。项目配置见 [config.yaml](config.yaml)，Codex 工作流见 [生成的技能](../.agents/skills/)。
