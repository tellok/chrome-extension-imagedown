# Proposal

## Why

Issue #15 要求将扩展源码迁移到 TypeScript，通过静态类型检查（Static Type Checking）明确图片、配置和浏览器通信的数据契约，减少重构造成的运行错误。当前 49 个 JavaScript 文件约 7188 行，开发和发布均直接使用源码，尚无编译步骤。

## What Changes

- 将全部 49 个扩展脚本迁入 `src/`，保留文件名和相对目录，使用 `.ts`；补充 Chrome、文档对象模型（Document Object Model, DOM）及共享数据类型。
- 引入严格 TypeScript 配置、固定开发依赖与锁文件，以本地编译器生成 `extension/` 中对应的 JavaScript；扩展继续零运行时依赖，最低 Chrome 116。
- 保留 Manifest、HTML、脚本注入和工作线程（Web Worker）的现有 `.js` 路径，以及单元和浏览器测试的读取路径。源码仓库首次加载扩展前改为安装依赖并构建；发布 ZIP 仍可直接加载。
- 将构建、类型检查、资源校验接入检查、测试、打包和持续集成（Continuous Integration, CI），更新 README、开发文档和 OpenSpec 开发上下文。
- 产品功能、权限、存储格式、默认值和版本保持既有约定；测试用例与夹具保留原样，发现必须修改时先提交完整审批清单。

## Capabilities

### New Capabilities

- `extension-build`：从严格检查的源码生成可加载扩展，保证失败构建不会被当作成功发布，定义开发与打包入口及本地资源完整性。

### Modified Capabilities

无。`extension-platform` 的兼容、权限和本机代码约定继续适用。

## Impact

涉及 `src/`、`extension/**/*.js`、`tsconfig.json`、`package.json`、依赖锁文件、`.gitignore`、构建/检查/打包脚本、CI、README、`docs/development.md` 和 `openspec/config.yaml`。Python 素材工具、现有 JavaScript 测试和 Node 维护脚本不属于扩展运行源码，无需仅为扩展迁移而改写。

## 审计与边界

- `OpenSpec: required`，change 为 `migrate-extension-to-typescript`：构建依赖、首次加载步骤和发布前置条件改变，属于 AGENTS.md 默认高风险范围；当前只生成规划文件，不修改业务代码或主规格。
- 阅读依据：已完整读取 `extension-platform/spec.md`，检索全部主规格与归档中的 TypeScript、构建、JavaScript、依赖和相关路径；完整读取归档 `2026-10-21-document-existing-extension` 的 proposal/design/tasks，保留其“产品规范与开发材料分离”和零运行时依赖的决策。未检索到既有 TypeScript 构建能力。实现检查覆盖 Manifest、49 个脚本清单、后台/采集/注入/线程入口、HTML 引用及构建脚本；另读 README 和开发文档。
- `External-Skill: exempt`：检索 `skills/`、`.agents/skills/`、Manifest、包清单、打包和对外文档，没有消费方 Skill 或分发机制；现有 `.agents/skills/openspec-*` 都是内部维护工作流，目录合规。迁移不新增消费方接口，不创建对外 Skill。
- `README-Glossary: verified`：核对主规格和 README 的项目私域术语表，保留增强模式（Enhanced Mode）的既有映射。本次 TypeScript、编译器、DOM、CI 均为行业通用概念，没有引入或更改项目私域概念，术语表不增加条目。
- 活跃清单与来源：工作起始 `openspec list --json` 为 `changes: []`，工作分支 `work`，基线提交 `3c7bdc4`，工作区干净；本次 change 是此工作上下文唯一新建活跃项，当时无无关活跃 change。按用户要求实施前快进合并默认分支至 `e01840b`，继承 `highlight-selected-source-images`；它后来作为独立修复的相关change完成验收与归档，修复提交70b7936已合入，本迁移以其作为行为基线。仓库未启用 Changesets。
- 测试盘点覆盖 `tests/` 全部 18 个 Node 测试文件、10 个 Python 浏览器脚本、requirements、夹具/内嵌脚本、`package.json`、`scripts/` 与 CI。拟修改测试用例总数为 **0**：保留现有导入、数据、断言、快照和浏览器查找逻辑。编译产物路径和翻译目录文本格式须兼容这些读取方式。部分浏览器脚本依赖 macOS 缓存路径，Linux 实跑限制须如实记录，不以修改测试规避；如确需变更，先重新盘点并单独审批。

合并后阅读补充：按提取、增强模式、设置同步与原页高亮检索并阅读当前主规格及其归档 proposal/design/tasks；沿用原有提取顺序、网站授权、配置同步和高亮行为。49 个脚本、18 个 Node 测试文件与 10 个浏览器脚本为合并后的实施清单；方案和零测试修改边界不变。

整合审计：用户按规格批准独立 fix-baseline-regressions 方案及完整7项测试清单；修复和继承高亮change已单独验证、归档、提交。本迁移只将修复后的行为映射到TypeScript，不新增产品变化；相对修复提交的测试diff为空。External-Skill: exempt、README-Glossary: verified，开发构建能力仍无消费方Skill或私域术语变化。
