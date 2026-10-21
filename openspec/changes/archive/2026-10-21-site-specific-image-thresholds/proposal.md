# 按网站保存图片阈值并提供全局宽高默认值

## Why

最低宽度、最低高度与最低体积目前全局共享，在一个网站修改会影响其他网站。需要按顶层网页主机名（Hostname）保存各网站的阈值，并允许用户通过设置页为尚未单独配置的网站设置全局默认最低宽高。

## What Changes

- 三项阈值按 hostname 分字段保存，不区分协议、端口和路径，不同子域名分别保存；跨域图片归所属顶层网站。
- 设置页新增“图片筛选”分类及全局默认最低宽度、最低高度，出厂值均为 50 px。网站未覆盖的字段继承全局宽高；最低体积未覆盖时使用 2 KiB。
- 全局值是可覆盖的默认值，不是网站阈值的强制下限。网站保存 0 表示取消对应限制。
- “清除筛选”只将当前网站三项阈值保存为 0；“恢复默认阈值”删除当前网站的阈值覆盖，重新继承默认值，不改搜索、网站规则或其他网站。
- 图库与未展开时的工具栏计数使用同一网站阈值解析结果；设置变化复用页面结果更新筛选计数。
- 兼容旧配置：沿用旧全局宽高作为新的全局默认；旧全局体积因没有网站归属不复制到网站，未配置网站使用 2048 字节。保留旧数据供回退，但新逻辑不读取旧全局体积。
- 七种界面语言提供对应设置与提示；设置自动保存、持久化并同步到已打开的相关视图。
- 将用户指定的协作规则原文保存为项目根目录 `AGENTS.md`；本次实现须在提案及测试修改得到明确批准后开始。

## Capabilities

### New Capabilities

无，复用现有能力。

### Modified Capabilities

- `image-filtering`：阈值按网站分字段保存、全局默认继承、清除与恢复语义及旧配置兼容。
- `user-preferences`：全局默认最低宽高的设置入口、校验、保存、错误和跨视图同步。
- `automatic-badge`：按源网站的有效阈值计数，网站设置与全局默认变化后保持计数一致。

## Impact

预计修改 `extension/preferences.js`、`metadata.js`、`panel.js`、`panel.html`、`automatic-badge.js`、`settings-page.js`、`settings.html`、`settings.css`、`locales/catalogs.js`；相关测试完整清单见 `test-review.md`。不增加权限、依赖或外部服务，不修改格式、来源等现有全局筛选的隔离方式。

`OpenSpec: required`：改变持久化格式、默认配置、重置语义、设置入口和徽标筛选；相关变更为 `site-specific-image-thresholds`。下载协作文件 `AGENTS.md` 属用户明确指定的原文引入，`OpenSpec: exempt`，不改产品行为；不改写远端规则。

`External-Skill: exempt`：仓库未发布 `skills/` 消费方技能；`.agents/skills/openspec-*` 均为内部开发流程，扩展打包仅包含 `extension/`，不存在误置的对外技能。

`README-Glossary: verified`：检索八份主规格、既有基线归档及 README，未发现需新增或改变的项目私域术语；“阈值”“主机名”“默认值”和“覆盖”均采用通用配置含义。Apply 为 README 和本次涉及主规格补齐空的“术语表（Glossary）”及无私域术语说明，不将通用术语收录为项目词典。

## 阅读与审批

已完整阅读 `image-filtering`、`user-preferences`、`automatic-badge` 主规格及基线归档 `2026-10-21-document-existing-extension` 的 proposal、design、tasks 和三份相关 delta，核对 `ef31c0a` / `a7ce2fb` 代码。主规格与实现的原有全局阈值一致；本提案明确改变该行为，不直接覆盖主规格或历史归档。

提案、三份 delta、design、tasks 与 `test-review.md` 组成同一待审版本。审批前不修改业务代码、现有测试、主规格或产品使用文档；测试计划共 11 个用例，须连同完整清单明确确认。
