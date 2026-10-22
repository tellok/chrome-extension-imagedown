# 高级功能区块定位实施任务

## 1. 审批与实施前复核

- [x] 1.1 记录用户对当前 proposal、image-library delta、design、tasks 及 test-review 两个既有用例修改的明确批准；运行活动清单并重读相关产物，确认继承 change 排除依据仍成立，审批前不得改实现或测试。

## 2. 区块焦点与边框

- [x] 2.1 利用 settings.html 既有高级功能区块，在 enhanced-settings.js 的成功初始化深链接分支提供程序焦点入口并改为滚动、聚焦区块；保留来源核验、授权读取及普通入口行为，按获批 EB09/EB10 验证自动落点和失败分支。
- [x] 2.2 在 settings.css 复用主题焦点色绘制完整边框，聚焦时显示、失焦后恢复，不增加布局尺寸或动画；按获批 EB09 检查浅/深主题、320px、几何尺寸和Tab/Space操作，并在真实浏览器目视确认标题至说明均被边框包围。

## 3. 测试与说明同步

- [x] 3.1 仅按 test-review 修改 test_EB09、test_EB10，保留各自现有授权及错误断言，不改共享夹具、超时和其他测试；用 diff 逐项核对审批清单，再运行提取专项全部15个场景。
- [x] 3.2 在 README 使用说明补充增强模式跳转后的区块边框与键盘操作；核对 README-Glossary verified 的术语映射及 External-Skill exempt 的目录/分发证据，确认无新增私域词、对外Skill或Changesets要求。

## 4. 验证、归档和提交

- [x] 4.1 运行 npm run check、npm test、python tests/extraction_browser_test.py、python tests/theme_test.py、python tests/language_test.py 和 npm run package；目视核对实际区块截图及七语言/两主题/窄屏结果，记录真实执行与未验证边界，不以静态检查代替浏览器结果。
- [x] 4.2 运行 openspec validate highlight-enhanced-settings-block --strict，检查实现、测试、delta及文档一致，记录验证结果；确认审批和测试diff对应后才允许归档。

## Workflow follow-up

使用 openspec-archive-change 同步 image-library delta，复核术语表及旧场景未丢失；归档后运行 openspec validate --specs --strict 及受影响回归，核对 staged diff 仅当前范围并自动提交中文 Conventional Commit，附 OpenSpec-Change 页脚；排除 highlight-selected-source-images，不推送。
