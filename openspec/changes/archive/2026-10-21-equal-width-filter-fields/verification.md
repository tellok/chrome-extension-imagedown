# 实施与验证记录

2026-10-21 用户明确批准当前提案与一项测试修改，原话见 approval.md。实施只调整 panel.css 的布局：复用现有标记，将按钮绝对定位在边框内、移除外部宽度占用，并为单位 / 按钮保留文本内边距；没有修改逻辑或 HTML 的必要。

## 归档前验证

- npm run check：通过；npm test：37 项通过。
- uv run --with playwright --with pillow python tests/browser_test.py：完整综合验证通过，pageErrors 为空，原输入 / 还原 / 持久化 / 下载 / 选择 / 重试断言保留。
- 同方式运行 tests/language_test.py 和 tests/theme_test.py：通过，覆盖七语言及明暗主题。
- 定向单独执行 test_threshold_override_controls：通过；320 / 900 px 与明暗主题组合中，实际宽 / 高 / 体积 / 格式控件宽差不超过 1 px，按钮被包含且单位不相交。人工查看深色窄屏及浅色宽屏截图，边框对齐，保持原线条样式和键盘焦点。
- AST 比较完整浏览器函数集合：只有已批准的 test_threshold_override_controls 函数变化，无新增、删除或其他用例修改；所有单元测试保持原样。
- openspec validate equal-width-filter-fields --strict：通过；任务 5 / 5 完成。
- 主规格两项修改与 delta 逐块一致，Purpose、原有场景、其余要求和空私域术语表保留；历史归档未改。

## 范围与文档

开发说明记录框内按钮和边框等宽。README 原有“输入框旁还原”的简述仍适用，无须新增操作说明；README-Glossary: verified，私域术语映射未变化。External-Skill: exempt，无消费方技能与误置入口。无新权限、依赖、发布格式或配置迁移；未启用 Changesets。

真实浏览器使用临时配置及本地服务，未访问个人浏览器配置。截图位于 git 忽略的 test-results/。原保存失败、输入法等测试含事件 / 存储替身，不冒充真实磁盘故障或人工输入法验证；本次仅修改几何断言。后台读取及自动徽标代码未改，未单独重跑徽标 / 调试专项；综合测试仍覆盖既有行为。

只有当前 equal-width-filter-fields 相关代码、测试、主规格、归档与文档进入提交，无无关活跃 change 或排除项。归档后执行主规格严格校验和受影响回归，再按中文 Conventional Commit 自动提交，页脚 OpenSpec-Change: equal-width-filter-fields，不自动推送。

## 归档后与提交检查

- 再次执行 check、37 项单元、完整浏览器、语言和主题测试，全部通过；浏览器 pageErrors 为空，原功能断言保留。
- 主规格严格验证 8 项通过，归档严格验证 4 项通过，活动 change 为空；当前归档任务 5 / 5 完成。
- 两项 delta 与主规格一致，未改其他要求、Purpose、术语表和历史归档；文档本地链接有效，打包成功。
- 已检查 git diff --cached --name-only、暂存 diff 及一项测试的 AST 差异。产品实现仅 panel.css，精确对应框内按钮及等宽视觉要求；其余为确认的几何测试、开发说明、主规格和本次归档，无无关文件或排除项。
- git diff --cached --check 通过。按中文 Conventional Commit 提交，页脚 OpenSpec-Change: equal-width-filter-fields，不推送。
