# Design

## Context

动机见 proposal。Issue #9 已通过 GitHub CLI 读取正文和空评论集；本轮用户补充默认关闭。工作区位于 `main`，起始活动清单为空。OpenSpec: required，尚未修改业务实现或测试。

### 阅读与历史审计

检索维度：download/manifest/title/collected/timestamp/sourcePage/pageUrl、设置加载和存储监听、单张/批量入口、目录写入、实际路径、来源合并，以及对应测试、脚本与 CI。

- 主规格：完整核对 `image-downloads`、`image-discovery`、`user-preferences`，分别约束下载完成与去重、来源合并、默认值及跨视图配置。新增要求采用 ADDED，不删除既有场景；未发现需要改变现行契约才能实施的冲突。
- 归档：`2026-10-21-document-existing-extension` 的 proposal/design/tasks/evidence 与上述三份 delta：原文件优先复用、两类保存路径、标题固定和默认值均沿用。`2026-10-21-site-specific-image-thresholds` 的 proposal/design/tasks 及设置相关 delta：保留共享设置即时保存、网站阈值独立边界。宽高布局及还原归档不涉及此次输出能力，不修改。
- 实现：`collector.js` 当前只有 alt 截断值，扫描结果的页面 title/url 没有作为逐图片溯源字段保留；`api.js` 合并候选时的 origins 主要用于读取；`downloadImage` 已返回默认目录实际路径或自定义目录 savedName。`panel.js/runDownloads` 固定标题、格式和目录，两个 worker 并发，已分别统计成功、跳过和路径异常。
- 测试/交付：盘点 `tests/*` 全部用例入口、`package.json`、`scripts/check.mjs`、`scripts/package.py`、`.github/workflows/test.yml`、README 和开发文档。相关为 settings、image-data、destination、file-content、i18n 及 browser/language/theme；其余徽标、筛选和调试测试保留。完整测试变动审批见 test-review。
- External-Skill: exempt。无 `skills/` 消费方入口；`.agents/skills/openspec-*` 是维护工作流，无误置消费方技能。打包仅分发 extension，无对外 Skill 生成/分发要求。
- README-Glossary: verified。核对三份相关规范、README 与基线归档，文本清单、来源引用、采集时间均使用通义，无新增或变更项目私域术语；README 仅新增一条设置用途。未启用 Changesets，不引入新发布工具。

## Goals / Non-Goals

**Goals:** 使用实际落盘结果建立可读映射，在两类保存位置、格式转换、重名去重和无真实 URL 时行为一致；关闭时保持既有输出。

**Non-Goals:** 不创建 ZIP、不上传来源信息、不新增权限/依赖，不重新请求图片补元数据，不改变 SVG/Canvas 原文件与静态像素边界，不修改 Superdesign 项目。

## Decisions

### 1. 开关与批次快照

新增 `settings:download-manifest`，严格 `=== true`，在设置“下载”分类复用已有开关自动保存和监听模式，补齐七语言。面板同步此设置并在操作开始固定；初始读取未完成/失败时不默默按关闭处理，显示设置错误并阻止状态未知时启动下载，读取恢复后可继续。准备目录保持在用户下载动作中，以保留已有授权流程。批次开启后不受后续存储更新影响。

### 2. 元数据在所属文档采集

采集记录增加 `sourcePageUrl`、`originalTitle`、`collectedAt`、`sourceReference`。扫描时生成 UTC ISO 时间；title/alt/SVG title 按规范取值，缺失保持空值直到清单显式呈现。来源引用用元素标签与可用 id；无元素用资源类型。候选按原有 URL 合并策略保留首个来源记录，origins 保留各读取入口，不能混拼来源。Canvas 的伪 HTTP 片段地址不当远程图片地址。记录不写入设置存储。

替代方案“下载时重新查询 DOM”会受导航、标题清洗及页面改动影响，不能证明采集信息，故不用。

### 3. 独立清单模块与真实结果

新增 `extension/download-manifest.js`，负责批次快照、结果到条目的映射、文本序列化与本地 Blob 保存。成功采用 `actualPath` 的 basename 或 `savedName`，跳过复用对应真实名称。默认目录直接 URL 回退同样依实际返回路径生成，不猜测转换扩展名。保留批次输入顺序；所有 worker 完成后生成清单。失败和目录异常放独立失败区，不冒充同目录成功条目。

HTTP(S) 图片记录完整原地址；inline SVG/Data URL 只记录类型、元素引用或缺失占位，不将巨大的 Base64/XML 数据复制进清单。Blob 可记录原 Blob 引用，但明确不能作为远程地址。清单采用 UTF-8 `text/plain;charset=utf-8`，使用稳定字段标签；值中控制字符和换行转义，保留普通 Unicode。缺失字段明确写未提供。除逐图片采集时间外，文件头记录批次生成时间和唯一批次标识，区分内容相同的重复下载批次。

### 4. 复用保存管线，保留旧清单

文件名基名直接复用 `destination.folder`（已按编辑/清洗标题安全化），追加 `.txt`。自定义目录复用现有受锁保护的写入与重名处理，浏览器默认目录复用完成跟踪、实际目录核验和随机后缀策略；不通过新 URL 请求保存。批次标识确保每批清单内容不同，不把全重复图片批次的清单去重掉。完整图片 Blob 的本地复用保持不变；清单不读图片字节或触发额外权限申请。

### 5. 独立完成与错误呈现

`state.busy` 保持到清单保存结束，防止面板提示提前完成；图片处理计数不包含文本。图片全部失败但目录准备成功也输出清单，写目录准备失败则没有可用目标，不生成清单。清单失败单独报告，不覆盖图片已有错误、删除图片或回退目录。保留本批原有图片结果；浏览器清单成功后可作为最近下载定位目标，自定义目录不伪造下载记录。

## Risks / Trade-offs

- 来源 URL 可能含私有查询参数 → 仅由用户主动启用后写入本地文件，不上传；说明清单含来源信息，非公网链接使用显式占位。
- 远程地址相同但来自多个 iframe → 首个确定的完整来源记录作为单个候选的来源，保留其文档与标题关联；不改变已有去重行为。
- 清单写入晚于图片 → 无跨文件事务；如实提示清单失败并保留成功图片，不提供虚假的整体原子性承诺。
- 默认目录无法任意读取磁盘 → 延用现有下载记录/内容摘要的可验证边界，不宣称核验外部修改。
- 真实系统选择器无法被自动验收替代 → 浏览器专项用临时配置及真实沙盒文件句柄验证，系统对话框边界另行记录。

## Migration Plan

无需迁移旧数据，未配置的旧用户默认关闭；回退版本忽略新键。审批后实施、仅新增获批 20 项测试、执行既有回归与专项、严格校验并同步归档，按 AGENTS 自动提交；本轮没有推送授权，不推送。README 更新简要使用入口，开发文档补充模块和专项命令，CI 仅新增专项执行步骤，不放宽原步骤或断言。
