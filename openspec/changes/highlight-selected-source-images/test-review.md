# 测试变更审批清单

本次拟新增 **16 项测试**：4 项协调单元用例、12 项浏览器验收用例。原有用例新增断言、输入、超时或夹具调整均为 **0 项**；不删除、跳过、重命名或移动既有测试。本轮未创建任何测试代码。

## 只读盘点范围与依据

- 检查 `tests/` 全部 16 份 `*.test.js`、8 份浏览器 Python 脚本及 `requirements.txt`；入口为 `package.json` 的 Node 测试通配符、`.github/workflows/test.yml` 的四个浏览器脚本，以及开发文档列出的其余脚本。`scripts/check.mjs`、`package.py`、`build-icons.py` 均已纳入生成/校验入口检索。
- 按 Requirement/Scenario、selected/selection/scan/origins/documentId/sourceReference、iframe/shadow、navigation/pagehide、outline/border/highlight、徽标变更与同步导入检索所有测试和内嵌网页/Mock。`browser_test.py/test_gallery_selection` 覆盖卡片、复选框、Space、框选/Esc/反选、隐藏选择；`test_preview_retries` 和 `test_site_scopes` 覆盖失败与范围；新用例补充原页效果，原用例不变。
- `manifest_browser_test.py/test_collected_metadata_survives_frames_and_navigation` 覆盖来源与导航；`remote_rules_browser_test.py` 的 RB06/RB07/RB09/RB12、`settings_sync_browser_test.py` 的 SB03/SB09/SB11 覆盖范围更新、有效选择、导航、并发视图及批次固定。徽标、debugger、语言及主题脚本是回归范围，新增高亮不放宽其契约。
- 检查所有本地文件名中的 test/spec/fixture/snapshot/golden、所有 CI 与脚本入口，夹具主要内嵌在 Python；仓库没有独立契约、容器验收、Golden 或快照运行器，也没有额外测试生成框架。测试截图是运行输出，不是需改写的预期快照。现有 diff 仅当前 change 的规划文件。
- 新单元测试的浏览器 API 替身仅用于事件乱序、消息验证与会话路由，不用其证明原页红框可见。新浏览器夹具使用真实扩展、真实 DOM、本地 HTTP 和临时配置，不修改或依赖个人浏览器资料；测试支持 CHROMIUM_PATH。
- 运行限制：当前管理员策略阻止系统 Chromium 加载未打包扩展，配套浏览器下载域名被网络拒绝。因此现有/拟新增浏览器用例可静态盘点但当前不能动态验收；并非遗漏未知测试范围。实施阶段必须在获准环境补跑，不将阻塞标成通过。

## 完整逐项清单

| 测试文件 | 完整用例名称/稳定标识 | 变更类型 | 变更前行为 | 变更后行为 | 具体原因与证据 |
| --- | --- | --- | --- | --- | --- |
| tests/source-highlights.test.js | HU01 仅最新选择序号可更新活动会话 | 新增 | 无原页高亮消息协调 | 新快照先到后旧快照被拒绝，迟到异步注入不能恢复已取消高亮 | 图库“原页高亮按视图与文档清理”；现有 panel.generation 只保护图库结果，尚无高亮会话 |
| tests/source-highlights.test.js | HU02 按完整文档标识分组并隔离失败 | 新增 | origins 只用于读取数据 | 跨框架选择按 documentId 去重批量路由，一个文档拒绝不阻断其他文档 | 采集“保留候选与实际页面元素的对应关系”；api.js 已有 documentId/record id |
| tests/source-highlights.test.js | HU03 视图释放不清除其他会话并拒绝伪造消息 | 新增 | 无高亮会话并集 | 仅接受本扩展图库连接，释放一会话不影响另一会话；终止后旧消息无效 | 图库“两图库选择同一图片”；既有徽标端口已校验 sender |
| tests/source-highlights.test.js | HU04 源页切换使旧映射与续期失效 | 新增 | 无高亮的源页生命周期 | 切换/导航后旧文档更新和续期不作用于新目标，重新连接只提交新会话当前快照 | 图库“页面导航与延迟更新交错”；panel.js 可切换来源及固定源页 |
| tests/source_highlights_browser_test.py | test_HB01_click_checkbox_and_keyboard_red_border | 新增 | 卡片/复选框/Space 只更新图库 | 三种操作均使对应原页元素显示或移除红色 2px 实框；1秒内生效并留截图 | 图库“图库选择同步原页高亮”；现有 test_gallery_selection 只验证卡片状态 |
| tests/source_highlights_browser_test.py | test_HB02_multiple_select_all_and_deselect | 新增 | 全选/取消无原页反馈 | 同时选多图各有一框；逐项取消仅移除该图，全取消后宿主与活动循环释放 | Issue #12 多选/取消验收；图库“多选及逐项取消” |
| tests/source_highlights_browser_test.py | test_HB03_drag_toggle_and_escape_restore | 新增 | 框选/Esc 不映射原页 | 追加/修饰键反选跟随实际选择，Esc 后原页恢复手势前集合，拖动后的 click 不多取消 | 图库“框选被取消”；selection.js 已实现 sync/onChange 与手势恢复 |
| tests/source_highlights_browser_test.py | test_HB04_hidden_selection_and_automatic_deselection | 新增 | 隐藏选择和失败/忽略仅影响图库 | 普通筛选隐藏后高亮保留；取消可见列表仅移除实际取消项；失败和忽略导致取消时去框 | 图库“筛选隐藏或实际取消”；panel.js/selectionUI、applyIgnored 自动删除选择 |
| tests/source_highlights_browser_test.py | test_HB05_duplicate_urls_and_shared_elements | 新增 | 同地址仅保存一个 element，不能高亮全部 | 同一地址多元素均高亮；多个候选共用一元素只一框，最后引用取消后去框，首个溯源记录不变 | 采集“同地址存在多个图片元素”“多个候选共享承载元素”；collector.js byURL 提前返回 |
| tests/source_highlights_browser_test.py | test_HB06_open_shadow_and_cross_origin_iframe | 新增 | 无影子树或框架高亮 | 开放 Shadow DOM 与有权限跨域 iframe 中正确标记；无权限框架不误标其他框架或中断选择 | 采集映射与平台访问边界；scanTab 的 allFrames/documentId |
| tests/source_highlights_browser_test.py | test_HB07_picture_and_non_img_source_mapping | 新增 | 多类来源有候选但无位置标记 | picture 的 source 对应 img；背景/伪元素、Canvas/SVG/封面/图片链接对应宿主；纯资源记录无虚假框；不新增图片读取 | 采集“多个候选共享承载元素”“非普通图片与无元素资源”；collector.walk 已发现各来源 |
| tests/source_highlights_browser_test.py | test_HB08_geometry_style_and_pointer_preservation | 新增 | 无红框的几何与交互契约 | 滚动/窗口缩放/元素移动后框贴合，边框为2px红色；网站原样式及相邻布局不变，链接点击和键盘仍可用 | 图库“原页高亮不干扰页面”；Issue 明确不影响布局与交互 |
| tests/source_highlights_browser_test.py | test_HB09_hidden_removed_and_replaced_targets | 新增 | 原页动态变更没有高亮清理 | 元素隐藏、移除、资源更换后不在旧位置残留，替代节点不被猜测匹配；显式重扫建立新引用 | 图库“页面动态移除目标”、采集“原始元素已失效” |
| tests/source_highlights_browser_test.py | test_HB10_refresh_navigation_and_stale_updates | 新增 | 刷新/导航仅清图库结果 | refresh 清空会话，高亮不跨导航；延迟旧选择更新不能在新文档或范围更新后重现 | 图库“页面导航与延迟更新交错”；panel refresh/syncEffective 已有结果版本保护 |
| tests/source_highlights_browser_test.py | test_HB11_multiple_views_close_and_connection_expiry | 新增 | 无视图高亮所有权或兜底释放 | 两图库并集，一视图取消/关闭不影响另一；最后关闭及时清理，连接异常时无续期会话有界失效，另一视图新扫描不淘汰仍活动标记 | 图库“两图库选择同一图片”“关闭视图或扩展连接异常”；采集器仅保留三次扫描历史 |
| tests/source_highlights_browser_test.py | test_HB12_badge_observer_requests_and_runtime_errors | 新增 | 没有覆盖层与采集观察器协同检查 | 连续选择/绘制不新增图片请求、像素读取、debugger 或持续徽标扫描；真实页面增删图片仍更新徽标；页面和后台无未处理异常 | 图库“原页高亮不干扰页面”；automatic-badge“仅在数据或配置变化时更新”，badge-observer 监听 childList/style |

以上为本次需要修改的完整测试用例清单。仓库内静态检查无尚无法检查的测试路径；动态浏览器执行受上述环境限制。16项皆为新增，不修改任何旧用例、夹具或预期。若实施中出现额外测试变动或预期变化，按 AGENTS 重新提交含已批准项的完整修订清单，不能直接修改。

审批应明确覆盖当前 proposal、两份 delta、design、tasks 及本表全部16项新增；仅批准功能方案而未确认测试清单不构成测试修改批准。
