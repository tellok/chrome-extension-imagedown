# 实施与验证记录

## 审批及范围

有效审批见 approval.md。实际实现仅 `extension/enhanced-settings.js`、`extension/settings.css`；复用已有 HTML 区块，核验成功后才设置程序焦点能力，避免原生片段导航提前聚焦失败入口。design 已澄清赋值时机，不改变获批行为、风险或测试范围。README 同步使用说明，术语表不变。

为避免“归档前必须完成归档后提交”的循环，将原 tasks 4.3 的原文移入不计入实施任务数的 Workflow follow-up；归档、归档后验证和自动提交义务完整保留，不提前宣称完成。

## 已执行验证

- `npm run check` 通过：资源引用与 JavaScript 语法。
- `npm test` 通过：102 项，0 失败、0 跳过。
- `uv run --with-requirements tests/requirements.txt python tests/extraction_browser_test.py` 全部 EB01–EB15 通过；改为更直接的主题色断言后，使用 `EXTRACTION_TEST=EB09` 再次执行 EB09，通过。
- 同一 uv 依赖环境执行 `tests/theme_test.py`、`tests/language_test.py`，均通过，覆盖主题保存/跨页同步、系统主题、七种语言、自动语言回退、工作状态保留与布局。
- `npm run package` 通过，生成忽略目录 dist 内扩展 ZIP。
- `openspec validate highlight-enhanced-settings-block --strict`、`git diff --check` 通过。
- 目视检查 `test-results/extraction/settings-block-light.png` 和 `settings-block-dark.png`：320px下高亮包围标题、域名、开关和说明，开关不自动显示焦点环；原有边框加外轮廓不改变布局。检查七语言×两主题共14份既有区块截图的联系图，长域名/说明可换行，无截断或溢出。

## 测试审批一致性

使用 diff 核对仅 test_EB09 和 test_EB10 两个用例变化，与 test-review 的两项批准完整对应。EB09 用 Tab进入开关并以Space开启，保留授权、域名隔离、刷新恢复及直接关闭断言；EB10保留所有原错误与失效断言。共享夹具、CI、超时、其他用例及原EB14参数集均未改。新增两主题区块截图位于既有忽略输出目录，不作为Golden或快照断言。

## 审计及边界

- OpenSpec: required。本次改动属于 image-library / 图库呈现网站增强模式状态与入口，当前 delta 覆盖焦点及高亮行为；不修改权限、配置、构建、启动或部署。
- External-Skill: exempt。无 skills/ 对外入口或分发机制；内部 OpenSpec skills不参与消费方评估且未修改，无迁移或创建义务。
- README-Glossary: verified。增强模式的中英文与定义沿用 user-preferences，分类名“高级功能”不新增私域术语，README和主规格术语表映射保持一致。
- 仓库无 lint 或类型检查独立脚本，本次无 TypeScript 文件；运行既有 check 和完整单元测试。未启用 Changesets。
- 浏览器为本机已有 Chrome for Testing，临时独立资料与本地服务；未使用用户个人资料。没有实测最低兼容版本Chrome116、真实公网网站或系统读屏器，不将这些边界称为已验证。
- 排除继承的 `highlight-selected-source-images`：其 delta 是原页图片选择红框，与本次设置焦点不重合；未修改、归档或暂存其产物和实现。

## 归档后验证

已同步 image-library 的唯一修改块并验证其他内容逐字保留；已归档至当前目录。归档后 `openspec validate --specs --strict` 全部10份主规格通过，`npm run check` 与102项单元再次通过。测试AST对比确认仅两项获批用例变化；README私域术语行与规范逐字一致，新增文档相对链接有效，ZIP内修改资源与源码相同。归档后提取专项 EB01–EB15 全部再次通过，0失败。最终暂存范围仅本次两处实现、两项测试所在文件、README、image-library主规格和本归档；已逐项检查 cached 文件清单及完整 diff，无无关内容。提交页脚使用 OpenSpec-Change: highlight-enhanced-settings-block，待本地提交命令成功后由交付摘要报告提交号，不推送。
