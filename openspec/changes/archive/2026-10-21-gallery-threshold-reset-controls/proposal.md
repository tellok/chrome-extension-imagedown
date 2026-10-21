# 图库宽高阈值的继承提示与单项还原

## Why

图库目前将继承的全局默认宽高与网站手动配置都显示为相同数字，用户无法直接区分，也不能只还原其中一项。需要在非设置页的宽高控件旁提供单项还原，并明确展示当前默认值。

## What Changes

- 未配置网站宽度或高度时，对应输入框为空，通过占位提示（Placeholder）显示“全局默认(50)”等当前值；筛选实际仍使用继承的数值，不将空输入误当成 0。
- 宽、高输入框各自在外部右侧放一个轻量还原图标按钮，悬停及无障碍名称说明“还原全局默认”；只删除该网站对应字段的覆盖，不改另一个维度、体积或全局值。
- 网站手动设置包含 0 时直接显示数字；即使数字恰好等于全局默认，也仍属于网站覆盖，可以还原。没有覆盖时按钮保留位置并禁用。
- 仅限制图库宽高编辑：接受 0..100000 的十进制非负整数，不接收字母、正负号、小数点、指数或含这些字符的粘贴；空白为编辑草稿，不保存为 0，失焦恢复当前配置状态。最低体积及设置页不改变。
- 沿用现有 Notion 风格：细边框、小圆角、灰色线条图标、轻微悬停底色和键盘焦点提示；不扩大筛选区层级，适配深浅主题、七语言及窄侧栏。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `image-filtering`：图库宽高继承状态、单项还原、数字编辑约束及控件呈现。

## Impact

预计修改 `extension/panel.html`、`panel.css`、`panel.js`、`preferences.js`、`locales/catalogs.js` 和相关文档；图标若需扩充使用已有本地矢量图标机制。不改下载、权限、依赖、Logo 或全局设置页，不改按主机名（Hostname）隔离和徽标计算规则。测试清单共 5 项，详见 test-review.md。

`OpenSpec: required`：改变筛选控件的可观察行为与单字段配置删除入口，相关 change 为 gallery-threshold-reset-controls。

`External-Skill: exempt`：检查包清单、Manifest、打包脚本及文档，未发布 `skills/` 消费方技能；`.agents/skills/` 仅内部 OpenSpec 流程，无误置对外技能或需要新增的分发入口。

`README-Glossary: verified`：检查当前主规格、README 空术语表和两次历史归档；继承、覆盖、默认值、还原均使用通用配置含义，不引入或改变项目私域术语，保持现有空表，不添加行业名词。

## 审批范围

首次修改产品文件前已完成只读调查；当前只生成规划文件。用户需批准 proposal、design、delta、tasks 及 test-review.md 全部 5 项测试修改后才进入 Apply。前一个 change 的审批不复用于本次。
