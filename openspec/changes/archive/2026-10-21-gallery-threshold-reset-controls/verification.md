# 实施验证记录

2026-10-21 用户在完整提案与五项测试清单提交后明确回复“批准”，原话见 approval.md。

## 审批与范围

实际测试修改为三个既有浏览器函数 main、test_preview_retries、test_site_threshold_settings，以及新增 test_threshold_override_controls 与一个 preferences 单元用例。使用语法树（Abstract Syntax Tree, AST）比对确认其余浏览器函数不变，既有单元用例内容保留。没有删除、跳过或放宽既有有效阈值、筛选、选择或下载行为断言。

## 归档前执行

- npm run check：通过。
- npm test：37 项通过，包含新增单项还原用例。
- uv run --with playwright --with pillow python tests/browser_test.py：通过，pageErrors 为空；继承提示、有效过滤、单项还原、错误反馈、输入限制及原有下载 / 重试 / 选择回归通过。
- 同方式执行 tests/automatic_badge_test.py、tests/language_test.py 与 tests/theme_test.py：全部通过。
- 新增浏览器用例另在临时配置中单独执行通过，截图人工查看浅色宽屏及 320 px 窄屏，保持细边框、中性小图标和可见焦点，长翻译截断且控件不重叠。最后微调数值框内边距，为常用中文占位多保留少量空间；归档后按最终版本重跑浏览器验证。
- openspec validate gallery-threshold-reset-controls --strict --no-interactive：通过；11 / 11 项任务完成。
- image-filtering 合并四项新要求，与 delta 逐块比对一致，原要求、Purpose 与空私域术语表保留。
- npm run package：扩展 ZIP 生成成功。

## 文档与边界

README 增补单项还原及继承提示，开发文档说明有效值与展示分离、空白草稿及体积不变。README-Glossary: verified，私域术语集合仍为空。External-Skill: exempt，无消费方技能，也未新增依赖或权限。

浏览器运行在独立临时配置及本地服务中；失败删除由扩展页面内替换存储 remove 注入错误，粘贴 / 输入法提交部分使用 DOM 事件验证，不冒充人工输入法或真实磁盘故障。目录选择器和 OS 权限本次未人工验证；原综合目录测试仍使用真实文件系统句柄与替代选择器。截图保存在被 git 忽略的 test-results/。

仅当前 change 相关文件纳入交付，无无关活跃 change 或排除项；无需 Changesets。归档后再执行严格主规格校验、相关测试与暂存区检查，通过后自动提交中文 Conventional Commit 并附 OpenSpec-Change: gallery-threshold-reset-controls，不自动推送。

## 归档后提交门禁

- 最终内边距版本再次执行 npm run check、npm test、npm run package，全部通过；37 项单元用例通过。
- 再次执行综合浏览器、自动徽标、七语言和明暗主题入口，全部通过；综合浏览器 pageErrors 为空。
- openspec validate --specs --strict：8 项通过；openspec validate --archived --strict：3 项通过；无活动 change。
- 对归档四项新要求、主规格和原有要求逐块比对通过，Purpose 与原有空术语表保持不变；README / 开发文档和归档本地链接有效。
- 再次核对暂存测试范围，只有确认的五项。暂存区产品路径均对应本 change 的四项新增要求：preferences 提供配置来源及单项删除，panel 实现继承提示、数字编辑和按钮，CSS / 翻译提供视觉与多语言；无其他能力或无关 change 混入。
- git diff --cached --check 通过，ZIP 不包含 OpenSpec、协作文件或内部技能。按中文 Conventional Commit 提交并附 OpenSpec-Change: gallery-threshold-reset-controls，不推送。
