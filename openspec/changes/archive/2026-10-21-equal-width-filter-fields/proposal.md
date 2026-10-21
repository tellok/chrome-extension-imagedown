# 统一图库筛选控件宽度

## Why

截图显示宽、高输入框比同列的体积与格式控件窄。当前还原按钮参与横向分配，挤占了宽高输入框的实际宽度，需要修正可见边框对齐。

## What Changes

- 将宽高还原按钮移到对应输入框边框内的右侧，宽高输入框占满所在网格列，与同列体积、格式控件等宽。
- 为单位、图标预留互不覆盖的区域，保持细边框、小圆角、中性图标、主题与键盘焦点风格。
- 保留数字输入、继承占位、单项还原与持久化行为；不改设置页或下载流程。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `image-filtering`：按钮由框外改为框内，明确同网格列控件边框等宽。

## Impact

预计仅修改 panel HTML / CSS、一个既有浏览器用例，以及必要开发说明和本 change。`OpenSpec: required`：改变既有按钮位置要求及布局验收，相关 change 为 equal-width-filter-fields；审批前不改产品文件或测试。

`External-Skill: exempt`：检查清单、打包脚本和目录，无对外 `skills/` 分发；内部 OpenSpec 技能未误置、不受影响。

`README-Glossary: verified`：核对当前主规格、README 与前次归档的空术语表；等宽、边框、网格、还原均为通用界面含义，不引入或改变私域术语，保留现有空表。
