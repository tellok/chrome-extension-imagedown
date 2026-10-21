# Proposal

## Why

[Issue #9](https://github.com/tellok/chrome-extension-imagetoken/issues/9) 要求图片与来源信息一起保存，便于下载后追溯。当前仅保存图片，缺少实际本地文件名与采集来源的对应记录；用户明确要求新增功能默认关闭。

## What Changes

- 在设置页新增“下载”分类和“同时下载图片清单”开关，默认关闭，本机持久化并同步视图，沿用七种语言和明暗主题。
- 开启时，每次单张或批量下载在同一个标题文件夹内生成一份文本清单（Text Manifest），文件名使用本批编辑/清洗后的安全标题加 `.txt`，已有同名清单保留并使用随机后缀。
- 清单记录图片实际本地文件名、远程地址、来源页面地址、图片原标题和采集时间；没有有效远程地址的内嵌 SVG、Blob、Data URL、Canvas 明确记录缺失与来源引用。
- 根据实际下载结果生成条目；同内容跳过的图片标明复用，失败与路径异常单列，清单失败独立提示且保留已保存图片。批次固定标题、位置、开关和元数据。
- 补齐采集溯源元数据，覆盖 iframe、跨文档合并和只有资源记录的图片；不改变已有发现、筛选、计数和原图读取策略。

## Capabilities

### New Capabilities

无，复用现有能力边界。

### Modified Capabilities

- [image-downloads](specs/image-downloads/spec.md): 可选文本清单、真实文件名映射、失败与重名处理。
- [image-discovery](specs/image-discovery/spec.md): 为已发现图片保存来源页面、原标题和采集时间。
- [user-preferences](specs/user-preferences/spec.md): 默认关闭的下载清单设置。

## Impact

预计涉及 `extension/collector.js`、`api.js`、`panel.js`、`settings.js`、`settings-page.js`、`settings.html`、`locales/catalogs.js`，新增清单模块；复用现有目录和浏览器下载机制，不新增权限、运行时依赖或服务。补充 README 简要入口、开发文档及 CI 专项验证入口。计划新增 20 项测试，逐项审批清单见 [test-review.md](test-review.md)；未修改任何测试或实现。

待审方案与实施清单：[design.md](design.md)、[tasks.md](tasks.md)。

## Audit

- OpenSpec: required。新增用户可见配置、输出文件及采集数据字段。
- 活跃变更基线：`main`（远程默认分支），开始时 `openspec list --json` 为空、工作区干净；本变更为唯一新建活动变更，无无关变更。
- 阅读证据与历史约束见 [design.md](design.md)；不修改旧归档。
- External-Skill: exempt。检索 `skills/`、`.agents/skills/`、README、打包脚本及分发清单：没有面向扩展用户/集成方的对外 Skill；`.agents/skills/openspec-*` 均为维护工作流，ZIP 仅分发 `extension/`，本次不引入对外自动化接口。
- README-Glossary: verified。核对 README 和三份相关主规格及文档基线归档；“文本清单”使用通用含义，未引入项目私域术语或改变映射，只补充简要使用说明，不新增术语条目。
