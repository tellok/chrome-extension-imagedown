# 实施与验证记录

2026-10-22，基于用户批准当前方案及16项新增测试实施，批准见 approval.md。功能代码已落盘，浏览器验收受环境阻塞；未归档、未同步主规格，不宣称 Issue #12 已完成。用户在获知浏览器验收阻塞、尚未归档或提交后明确要求“提交并推送”，因此按用户指令提交当前未完成验收的实现并推送独立功能分支；本次提交不表示通过原有验收/归档门禁，不关闭 Issue。

## 实施范围

- collector 为候选保存全部元素出现记录，元素/验证函数仅留原文档隔离执行环境，不序列化、不持久化；picture source 映射 img，同地址去重、首份溯源元数据及既有读图 element 保留。活动会话持有已解析引用，不受其他视图扫描历史淘汰影响。
- source-highlights.js 每文档维护视图并集，以封闭 ShadowRoot 的临时固定覆盖层绘制2px红框，批量更新几何，不改网站样式或事件，不接收交互。断开/隐藏/来源变化后不画旧目标；正常释放与15秒失效兜底清理。
- source-highlights-background.js 与 selection-highlights.js 提供端口会话、sender校验、完整文档目标、递增序号、最新快照及跨文档失败隔离；空集或视图清理断开端口，非空选择5秒续期。旧会话终止后不能由旧包恢复。
- panel.js 接入统一选择回调、刷新、导航、源页关闭和pagehide；普通筛选隐藏的选择仍发往原页。结构范围变化保留的选择提交新origins。background.js注册独立协调器，不改变徽标端口协议。
- badge-observer 排除绘制宿主的自身变更，混合真实变更仍通知；collector 不采集扩展覆盖层。高亮不发图像请求、读像素或启动debugger。
- README补使用说明；docs/development.md补映射、会话、几何、失效边界与专项命令；CI在原四组浏览器测试之外添加专项，不替换既有检查。

## 已验证

- `npm run check` 通过：Manifest资源及全部扩展JavaScript语法。
- `npm test`：**89项通过，0失败、0跳过**。包含原有85项与新HU01–HU04四项，针对最新序号、精确文档分组/失败隔离、会话释放/sender拒绝、源页切换/旧续期拒绝。
- 新Python脚本编译通过；静态盘点确认恰有HB01–HB12十二项及独立临时网页/配置/服务/异常收集/CHROMIUM_PATH，不把编译通过表述为功能通过。
- `npm run package` 通过，生成 `dist/imagetaken-0.4.3.zip`；ZIP CRC完整性通过，三份新模块逐字节与源文件一致。Manifest、package.json、依赖与版本未改。
- `openspec validate highlight-selected-source-images --strict` 通过；`git diff --check` 通过。两份主规格与旧归档未改。
- 现有16份Node测试文件和8份Python浏览器脚本内容未改；仅新增批准的两份测试文件，共4+12项，未跳过、删除、重命名、放宽旧断言或修改旧夹具。

## 浏览器验收阻塞

本轮实际运行：

```sh
CHROMIUM_PATH=/usr/bin/chromium .venv/bin/python tests/source_highlights_browser_test.py
```

结果为退出码1，在首项HB01的启动夹具等待 `/background.js` serviceworker 时超过30000ms，**0项功能场景完成**；HB01未进入功能断言，HB02–HB12未运行，无可验收截图。未跳过用例或关闭断言。

系统Chromium 154.0.8037.57 的 `/etc/chromium/policies/managed/extensions.json` 明确设置 `ExtensionInstallBlocklist: ["*"]`；此前带启动日志的探测明确报告 `Loading of unpacked extensions is disabled by the administrator`。本轮复核该策略仍存在，Playwright 1.64.0/Pillow 13.0.0已安装。未修改或绕过管理员策略；没有用DOM替身或其他浏览器规避策略来宣称扩展验收成功。

此前配套浏览器下载对 `cdn.playwright.dev` 返回403 Domain forbidden；所需域名已在环境设置草稿中提出，草稿不等于当前运行配置。管理员需提供获准加载开发扩展的浏览器，并保证相应安装网络可用；单纯下载一个浏览器不能证明管理员策略允许加载。

原四组CI浏览器入口在本轮代码上另行尝试，全部退出码1、未进入功能验收：

| 入口 | 实际结果 | 当前实例日志 |
| --- | --- | --- |
| tests/browser_test.py | 等待serviceworker超过30000ms | /tmp/imagetaken-regression-browser.log |
| tests/manifest_browser_test.py | 等待serviceworker超过30000ms | /tmp/imagetaken-regression-manifest.log |
| tests/remote_rules_browser_test.py | 等待serviceworker失败，既有finally又抛出s未初始化的UnboundLocalError | /tmp/imagetaken-regression-rules.log |
| tests/settings_sync_browser_test.py | 复用远程规则session，出现相同启动/清理错误 | /tmp/imagetaken-regression-sync.log |

专项日志为 `/tmp/imagetaken-highlights-browser.log`。这些临时路径仅供当前实例诊断，不作为长期保留的验证产物；上述结果已记录在本文件。未更改旧测试清理逻辑以掩盖环境问题。

其他自动徽标、debugger、语言/主题脚本尚未在本轮运行；部分旧脚本还固定macOS浏览器路径，不在本次获批测试修改范围内。不得将这些检查报告为通过。

## 后续与任务状态

实现和已批准新测试均已编写；需要浏览器结果或截图证明的任务保留未完成，不能把代码落盘等同于验证通过。环境解阻后按 tasks 运行新十二项及原有回归，修复经证实的问题、目视核对截图，再完成一致性校验/主规格同步/归档和正常提交门禁。本次按用户明确指令先提交并推送现状，保持活动 change、未完成任务及阻塞记录，不提前归档。

External-Skill: exempt，面向消费方的Skill及分发无变化；README-Glossary: verified，选择、覆盖层、会话和租期均沿用通义，无项目私域术语新增或映射变动。文档已同步功能说明与验证边界，没有无关change或排除的用户改动。

## 后续完整验收（2026-10-22）

本 change 的浏览器阻塞已在当前获准的Linux开发浏览器环境解除；使用Chromium151.0.7922.34、Playwright1.64.0与Pillow13.0.0，临时配置及本地HTTP夹具。完整HB01–HB12全部通过，包括HU01–HU04在内的102个Node测试通过。HB01/HB06/HB08截图已目视检查：顶层重复与开放子树红框、跨域同图红框、滚动几何正确，原蓝边框/焦点样式保留。HB12确认无额外图片请求、调试或持续扫描，页面与后台错误收集为空。

修复与测试批准归属 fix-baseline-regressions：微任务通知避免隐藏图库暂停选择发送，外部结构变化使用syncEffective保留有效选择并更新origins；HB03等待过滤并前置图库，HB05按完整URL去重，HB06跨域文档使用同一完整图片地址。全部16项最初批准用例仍存在，三项修正有单独明确批准，不改超时或功能标准。

已通过主浏览器、清单10项、远程规则12项、配置同步13项、语言、主题、debugger、自动徽标回归；原硬编码macOS路径脚本通过环境符号链接运行Linux浏览器，不声称macOS实机验收。npm run check、打包和解压后后台/图库/设置实机入口通过。提取脚本最终结果随相关修复一并记录，全部通过后方可归档。External-Skill及README术语复核见最新proposal/design补充。

最终结果：提取EB01–EB15整组通过；全部10份浏览器脚本均完成，102个Node测试通过，0跳过。严格change校验通过。此次修复涉及三个行为增量及相关高亮要求，二者均相关并同步归档；类型迁移在另一工作区单独验收，不混入本次修复提交。

归档后复验：主规格严格校验10项通过，102个Node测试及完整HB01–HB12再次通过。暂存diff与批准清单、主规格、文档逐项核对通过，未纳入权限、版本、无关change或生成文件。
