# 高级功能区块定位设计

## Context

动机、目标路径、阅读及历史证据见 [proposal.md](proposal.md)。已完整读取该提案。当前 `enhanced-settings.js` 在源网页核验和授权读取成功后对开关调用滚动与聚焦；`settings.html` 已有包含全部内容的 `#enhanced-settings` 区块及标题关联。主规格及 EB09 与现状一致，本次用规格增量明确修改自动落点，无存量冲突。

## Goals / Non-Goals

**Goals:** 将增强模式（Enhanced Mode）跳转定位到完整高级功能区块，保留上下文说明和键盘操作。设计明确焦点离开即结束边框提示，避免永久强调。

**Non-Goals:** 不改设置排版、文案翻译、网站授权、提取顺序、下载或配置同步，不引入图片素材或界面重设计。

## Decisions

1. 为 `#enhanced-settings` 增加 `tabindex="-1"` 的程序焦点能力，复用现有 HTML 的 `aria-labelledby`。具体在成功初始化且片段为 `#enhanced-settings` 时才设置 `tabIndex = -1`，避免浏览器原生片段跳转在来源校验或读取失败时提前聚焦；HTML 结构无需修改。随后滚动区块并用 `focus({ preventScroll: true })` 聚焦。区块只接受程序聚焦，不增加普通 Tab 顺序。下一次 Tab 进入其内网站开关。
2. 用区块自身的 `:focus` 规则和既有 `--focus` 主题变量表达整圈边框，采用不占布局的 2px 轮廓及适当轮廓偏移，必要时同时改变原边框颜色。使用 `:focus` 确保鼠标触发的程序聚焦也可见；不使用只覆盖键盘的 `:focus-visible` 或会使内层开关聚焦后仍强调区块的 `:focus-within`。失焦由浏览器自动恢复，无计时器和动画。
3. 保留所有控件现有焦点规则。网站校验和读取完成前不自动聚焦区块；普通设置入口无片段时不聚焦。无效来源、读取失败、保存失败和导航撤销继续走原逻辑。
4. 测试仅修改 EB09 和 EB10，清单见 [test-review.md](test-review.md)。EB14 仍主动聚焦开关验证正常键盘能力，原有七语言、两主题、320px截图流程无需改写。区块边框的两主题与几何检查在 EB09 完成。
5. README 使用说明同步区块定位与按 Tab 操作；不改命令或配置承诺。未启用 Changesets，不创建版本文件。

## Risks / Trade-offs

- 程序聚焦区块可能滚动两次 → 先滚动区块，再使用 preventScroll 聚焦；真实浏览器检查落点及标题可见性。
- 轮廓在窄屏可能被裁切或产生溢出 → 使用适当偏移并验收320px与现有区块尺寸，核对浅色和深色主题。
- 焦点离开后提示结束 → 这是本次明确交互；Tab 后开关以既有焦点环继续提供定位，不移除键盘可访问性。

## Migration Plan

用户审批当前 proposal、delta、design、tasks 及两项测试修改后才 Apply。完成后执行语法、单元、提取专项、设置主题语言回归及打包；严格校验后归档并自动提交。回退本次提交即可恢复开关自动聚焦，无配置迁移。

## Audit

- OpenSpec: required。只改 [proposal.md](proposal.md) 列出的交互范围。主规格和历史归档的完整阅读、继承 change 排除依据同提案记录；新增自动落点由本次 delta 覆盖。
- External-Skill: exempt。检查 `skills/`、README、Manifest、打包脚本及内部 skills；无对外 Skill 分发或误置内容，本次交互不产生消费方 Skill 同步义务。
- README-Glossary: verified。核对 README、image-library/user-preferences 及相关归档；增强模式保持既有私域映射，高级功能只是界面分类，焦点、边框和区块是通用界面术语，无新增或变更私域术语。
