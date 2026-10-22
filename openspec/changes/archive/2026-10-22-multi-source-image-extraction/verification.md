# 验证记录

## 审批与范围

- 用户先批准完整proposal、五份delta、design/tasks及46项测试修改，并采用原格式保留完整字节的规格方向；七项调试专项Fetch前置条件的完整修订版也获得第二次明确批准，见approval.md。
- 测试diff逐项对应test-review：修改image-data单元1项、browser_test的10个逻辑场景、debugger_test的7个逻辑场景，新增13项EX单元及15项EB浏览器场景；未修改清单外的其他用例、共享夹具、断言、超时或CI原有筛选范围。没有删除、跳过或放宽安全检查。
- 所有新测试夹具仅在新专项内或获批调试专项内；EB13的临时扩展副本记录onDetach监听器，在真实detach后投递canceled_by_user事件，验证停止后不自动重连及主动重试仍需许可。这不是Chrome调试横幅点击的真实UI验收。

## 归档前验证

- npm run check：Manifest资源与全部JavaScript语法通过。仓库为原生JavaScript，无TypeScript、单独lint或类型检查入口；没有新增依赖、放宽检查或修改生成/第三方文件。
- npm test：98项通过，0失败、0跳过；其中原85项和新增13项EX。
- tests/extraction_browser_test.py：EB01至EB15全部通过。真实归档原字节及两帧GIF、默认零CDP、服务器实收两类Referer、签名地址不变、同地址并发/订阅零来源头、后台重启清理、共享归档、加载中及导航换源、框架歧义、设置与保存/读取错误、增强发现与范围/忽略、关闭/导航迟到结果、用户取消事件和被动徽标均有覆盖。
- 八个原浏览器脚本通过：browser_test.py、debugger_test.py、manifest_browser_test.py、automatic_badge_test.py、language_test.py、theme_test.py、remote_rules_browser_test.py、settings_sync_browser_test.py。浏览器主回归先发现增量扫描期间阈值事件被丢弃，已在扫描完成时补读阈值和待处理有效配置，原断言不变并重跑通过。随后复现重置搜索后立即重载会取消视图中尚在等待配置锁的写入，现由可信图库消息交给后台排队保存；未修改该旧用例，正式完整browser_test及98项单元重新通过。
- debugger_test.py使用真实chrome.debugger：跨域和框架GIF逐字节一致、各2帧、原始页面请求仍分别1次，验证连接释放、占用不误断、过期文档拒绝及关闭来源后原数据继续保存。受控Fetch发送前失败只隔离这条专项的CDP路径；普通回退及EB Referer场景为真实Fetch。
- 七语言×两主题、320像素截图已目视核对，设置说明/开关、图标文字状态、键盘焦点及长域名布局无溢出。长域名文本是布局夹具，真实网站授权与导航身份另由EB09/EB10/EB12核实。截图在忽略的test-results/extraction，含settings/gallery及contact-sheet。
- npm run package：生成dist/imagetaken-0.4.3.zip，根目录Manifest及新模块存在，不含测试、规格或内部Skill，权限为已审pageCapture和declarativeNetRequestWithHostAccess，debugger保留。
- openspec validate multi-source-image-extraction --strict --no-interactive通过；五份delta同步为4项修改、10项新增，保留原Purpose及未涉及的Requirement/Scenario。openspec validate --specs --strict --no-interactive：10份主规格全部通过。
- 本次Markdown本地链接、README和主规格的增强模式唯一映射、46项清单、13 EX / 15 EB及ZIP边界检查通过；git diff --check通过。

## 实施边界与审计

- 原文件任务共享完整数据；静态像素只供预览或明确转换，原格式不能替代为静态PNG；显式转换读取完整像素而非缩略预览，保留原尺寸。所有新HTTP读取经后台统一管理，既有完整Blob/Data URL直接复用；不在页面内另发HTTP请求。
- MHTML前后校验文档、实际地址、成功状态及资源完成签名；未知完整性或同地址多文档歧义回退。归档/索引/文件、任务等待和共享结果均有预算；动态失效不会并发生成同一标签页的第二份归档。
- 来源规则匹配完整地址、本扩展发起者及Fetch类型；同URL串行，修改头时独占跨URL网络租约，防止未知重定向误中其他临时规则；普通及订阅请求等待规则清理。仅在观察到最终地址后使用其Origin，保留采集原地址和签名。
- 网站授权默认关闭、仅本机明确true、子域隔离；同步及远程配置不授予、不删除本机许可。附加前后及导航/撤销时核实代次，只清理自有连接和规则；用户取消后的本次文档不自动重连。
- External-Skill: exempt。skills/无消费方分发，.agents/skills仅内部流程，打包只含extension，无误置或需要同步的对外Skill。
- README-Glossary: required已完成。仅新增“增强模式 / Enhanced Mode / —”，定义在user-preferences独立术语表，README逐字同步，其余相关能力交叉引用；没有把MHTML/CDP/Origin等通用词列入术语表。主规格中的归档操作说明移为真正术语表，不作为产品要求发布。
- 仓库未启用Changesets；无版本发布或推送请求，不引入Changeset或消费发布版本。文档已同步读取策略、权限、网站流程、同步排除项、预算、故障与测试命令；远程规则格式和目录授权契约未改。
- 当前只有multi-source-image-extraction相关change，无无关活跃change或工作区改动需要排除。

## 验证边界

实际运行本机Chrome for Testing 149、临时配置和本地HTTP服务器。未操作个人Chrome配置或Google账户；未验证真实Chrome116、公网Cookie分区/认证、Chrome调试横幅文案/外观或Google跨设备实际送达，不将受控事件、布局文本或接口结果等同于这些验证。

## 归档后门禁

- 五份delta已同步，归档位于2026-10-22-multi-source-image-extraction；19/19任务完成。归档后10份主规格严格校验通过，活动清单为空，无需排除无关change。
- 归档后npm run check及npm test通过（98项，0失败/跳过），最终ZIP逐文件匹配extension目录72个文件；未混入测试、规格和内部Skill。
- 暂存审计覆盖50个文件：实现、权限/CI、相关文档、已批准46项测试、五份主规格和本次归档。所有行为归属本change的14项新增/修改需求；新权限对应extension-platform，读取顺序/预算/来源隔离对应image-data，增量候选对应image-discovery，状态/入口对应image-library，本机授权对应user-preferences。Apply及定向严格校验均通过；External-Skill exempt、README术语同步、无Changesets的判定均与最终diff一致。
- 测试diff与test-review当前获批清单逐项对应，旧搜索重置回归未修改。新专项启动器在没有macOS缓存路径时使用Playwright默认安装路径，保留CHROMIUM_PATH；只是获批新专项的跨平台启动实现，不改变用例输入、断言、覆盖或超时。macOS重跑15项全部通过；Linux实际执行尚未验证。
- README与主规格术语定义一致，暂存Markdown本地链接和git diff --cached --check通过。未新增第三方依赖、真实凭据、版本发布或推送。
- 归档后九个浏览器脚本全部正常退出（退出码0）：browser_test、extraction_browser_test、debugger_test、manifest_browser_test、automatic_badge_test、language_test、theme_test、remote_rules_browser_test、settings_sync_browser_test；分别覆盖新15项EB、旧主回归、真实CDP、清单、徽标、七语言、主题、12项远程规则及13项配置同步。启动器修正后的15项EB再次全部通过。
- openspec validate --all --strict --no-interactive再次通过（10/10），git暂存无无关改动，满足自动本地提交门禁；提交信息使用中文Conventional Commits及OpenSpec-Change: multi-source-image-extraction。
