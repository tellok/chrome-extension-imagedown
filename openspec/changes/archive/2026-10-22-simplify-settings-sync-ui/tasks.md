# Tasks

## 1. 审批与常态设置行

- [x] 1.1 记录当前proposal、三份delta、design、tasks及test-review完整5项测试变更的明确审批，重读活动清单确认仅本change；无审批不实施。
- [x] 1.2 精简settings.html与状态投影，常态仅显示本机开关，移除长说明和常驻检查；保持初始化/busy守卫，修改SB02验证真实首次发布及所有无冲突后台状态不展示诊断，同时更新docs/settings-sync.md常态描述。

## 2. 冲突与必要失败反馈

- [x] 2.1 冲突时才展示简短提示、双向选择、默认收起的差异；单候选隐藏随机标识，多候选编号/时间可区分且沿用真正令牌。修改SB03验证出现/解决及图库徽标，修改SB05保留全部七语言两主题/长值安全并核对候选标签；同步冲突使用说明。
- [x] 2.2 将读取初始化/用户主动操作失败反馈与后台状态分离，仅必要时出现简短提示和重试；新增SB13验证原始错误不暴露、无伪成功、重试先比较且不重放过期选择，恢复后收起。修改SB12保留全部真实Chrome配额/无截断断言，并通过既有自动重试恢复；文档保留诊断与故障处理边界。

## 3. 语言、视觉与集成

- [x] 3.1 补齐七语言新提示/操作/候选标签，沿用明暗Notion样式与键盘/读屏访问；通过SB05的320px截图和目视核对，确认紧凑开关与长值差异均无溢出，README不重复完整技术说明。
- [x] 3.2 核对测试diff仅4项修改与1项新增，无共享夹具/其他用例变化；运行npm run check、npm test、完整settings_sync_browser_test.py及相关browser_test.py/language_test.py/theme_test.py回归，记录未操作个人账户和Google送达验证边界。
- [x] 3.3 执行打包、当前change严格校验、文档链接与三份delta存续场景核对；确认后台引擎/权限/数据格式不变，复核External-Skill与README-Glossary审计。

## Workflow follow-up

- 按openspec-sync-specs同步三份delta，保留无关Requirement、Purpose和空术语表；按openspec-archive-change归档并复核主规格严格校验及受影响回归。
- 按AGENTS门禁检查暂存路径与diff，仅自动提交本change，中文Conventional Commit附OpenSpec-Change: simplify-settings-sync-ui；不自动推送。
