# Tasks

## 1. 实施前置条件

- [x] 1.1 取得并记录用户对当前 proposal、两份 delta、design、tasks 和 test-review 全部16项新增测试的明确批准；重跑活动列表和 git status 并核对产物版本，无有效批准不得修改实现或测试。
- [ ] 1.2 在平台允许加载开发扩展的浏览器验证启动与 service worker，确保 Playwright/Pillow 可用；若管理员策略或下载网络仍阻塞，记录具体错误且继续独立工作，但不将浏览器验收或整体交付标记完成。

## 2. 页面元素映射与采集隔离

- [ ] 2.1 在 collector 保留同地址全部来源元素和验证信息，picture source 定位所属 img，保留首个溯源记录、读取 element 及 Canvas 独立候选；新增 HB05/HB06/HB07/HB09 验证多元素、框架、子树、非img来源及失效目标，既有 metadata/manifest 场景回归不变。
- [ ] 2.2 新增每文档原页绘制器的引用接入接口，活动会话独立持有已解析目标，不受其他视图三次历史淘汰影响；用 HB11 连续新扫描验证旧活动视图高亮仍在、释放后引用清理。
- [x] 2.3 在开发文档说明映射、来源验证、纯资源无位置及重复地址/响应式承载规则；核对与两份 delta 及 HB05–HB07 一致，不把 sourceReference 当成唯一选择器。

## 3. 非侵入原页绘制

- [ ] 3.1 实现独立临时宿主/ShadowRoot 和红色2px覆盖矩形、元素去重、可见性/来源有效性检查及按需动画帧几何跟随；新增 HB08/HB09 验证实际 computed styles、红框截图、滚动缩放、样式不变及交互不被拦截。
- [ ] 3.2 collector 跳过扩展覆盖层，badge-observer 仅忽略本功能自身变更且保留混合真实变更通知；新增 HB12 验证没有图片请求/像素导出/debugger/持续扫描，并验证真实图片增删仍计数。
- [ ] 3.3 补开发文档的几何、框架裁剪、临时资源清理和性能边界，用 HB08/HB12 截图与请求/观察器记录核对，不声称覆盖受保护页面或任意顶层内容。

## 4. 会话路由与图库选择接入

- [x] 4.1 新增图库客户端与后台协调模块，校验 sender/消息、按 documentId 批量路由、每会话递增序号及最新待发快照；新增 HU01–HU04 验证乱序、失效源文档、独立失败和伪造消息被拒绝，运行 npm test 验证全部旧用例保留。
- [ ] 4.2 从 selectionUI 提交完整实际选择，覆盖卡片/复选框/键盘/全选/框选/Esc、失败/忽略自动取消与普通筛选隐藏；新增 HB01–HB04 验证1秒内红框变化和既有选择语义，原 test_gallery_selection 不改。
- [ ] 4.3 接入 refresh、syncEffective origins更新、源页loading/切换/关闭、pagehide、端口disconnect，维护多视图并集及5秒续期/15秒失效兜底；新增 HB10/HB11 验证旧包不能复活、普通关闭及时释放及异常后最终清理。
- [x] 4.4 README 增加选择时的原页红框说明；开发文档记录会话、续期/清理和兼容限制，核对不新增设置、权限、持久化键或配置同步内容，文档术语表仍无新增项目私域条目。

## 5. 专项运行与整体一致性

- [ ] 5.1 完成独立 source_highlights_browser_test.py 的本地网页、临时配置、截图、页面/后台异常收集及 CHROMIUM_PATH，CI 新增专项入口，开发文档登记实际命令；确认12项全部执行并逐项输出结果，4项新增单元由 npm test 自动执行，旧脚本及夹具diff为空。
- [ ] 5.2 运行 npm run check、全部单元、原四组CI浏览器及新专项；对自动徽标、debugger、语言/主题原脚本在兼容环境补回归，确认预览、下载批次、来源元数据与计数保持不变。截图目视核对 HB01/HB06/HB08；未运行/失败/通过分别记录，不靠零用例或预期替身代替通过。
- [ ] 5.3 运行 npm run package、ZIP资源核对、git diff --check 和 openspec validate highlight-selected-source-images --strict；逐项核对16项测试审批、两份delta、实现和文档，复核 External-Skill 与 README-Glossary 审计；任何必需验证失败不标完成。

## Workflow follow-up

- 全部实施与验证完成后使用 openspec-archive-change 同步图库、采集两份主规格并归档，不修改旧归档或混入其他change。
- 归档后运行主规格严格校验和受影响回归，按 AGENTS 检查 staged diff、测试批准记录及文档一致性。
- 自动提交当前变更，使用中文 Conventional Commit，附 `Closes #12` 与 `OpenSpec-Change: highlight-selected-source-images`；不自动推送，不创建空提交。
