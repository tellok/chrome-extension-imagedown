# Design

## Context

动机及范围见 [proposal.md](proposal.md)。来源任务最后方案仅讨论，未建规格、未授权当前产物；提案建立时本 change 只有规划。工作区初始干净，分离 HEAD `5406e52`，默认 `origin/main`，共同基线 `3c7bdc4`，活动列表为空；本 change 为唯一新建项。

### 阅读与历史审计

按能力、Requirement/Scenario、`scanTab/readImage/downloadImage`、`browserData`、`read-browser-resources`、`debugger.attach`、`currentSrc`、Referer、`storage.local/sync`、设置跳转及预计路径检索：

- 完整读取直接变更的 image-data、image-discovery、image-library、user-preferences、extension-platform 主规格；核对 settings-sync、image-filtering、automatic-badge、image-downloads 的范围、允许表、原文件和被动计数边界。未命中既有 MHTML/来源请求管理能力或增强模式术语；五份 delta 复用现有能力目录。
- 读取 `2026-10-21-document-existing-extension` 的 proposal、design、相关五份 delta、tasks 和 evidence；基线 `ef31c0a` 及 `c9d7228` 确立短时调试、本机原图复用与静态像素隔离，不代表本次已获历史审批。
- 读取 `2026-10-22-chrome-settings-sync` 的 proposal、design、settings-sync/user-preferences/extension-platform delta 和 tasks，以及 `2026-10-22-simplify-settings-sync-ui` 对应全部规划产物与三份 delta。同步采用明确允许表，常态设置行精简；新权限不进入同步，不恢复被删除的同步诊断 UI。
- 检索全部归档的域名、范围、原图、权限及同步标识；其他阈值/清单/远程订阅归档未选为行为变更依据，现行主规格对应边界保持不变，不改旧归档。
- 读取 `api.js`、`collector.js`、`browser-resources.js`、`debugger-reader.js`、`previews.js`、`settings.js`、`settings-page.js`、`settings-sync-codec.js`、`badge-observer.js`，核对 panel 采集/存储事件/生命周期分支、Manifest、README、开发说明、打包及 CI。现有观察器已有性能、DOM、load/error 信号，可扩展复用；现有 scanTab 每次直接批量调试，需要改为普通提取及可选增强入口。
- 全量测试及 CI 盘点、稳定用例标识与拟改内容见 [test-review.md](test-review.md)。不把调研临时实验代码当生产实现，不更改或依赖原机器 `/tmp` 目录。

### 规格冲突：已获用户决策

`image-data / 静态缩略图不冒充原文件 / 预览和原图下载同时读取动图` 和原讨论要求原格式保留完整字节；但 `collector.js:read` 在 Blob 已撤销或页面请求失败时仍返回 `decoded-pixels`，`api.js:readImageData` 原样返回，`downloadImage` 的 original 转换直接返回 Blob。`tests/browser_test.py:main` 两次断言 Blob 集合包含 `decoded-pixels`（约 1084/1094 行），把该结果作为未标 preview 的完整读取成功。

这是既有实现/测试与原文件边界的差异，不是本提案已经实施的结果。停止该范围的实现、测试及主规格修改。当前 delta 明确覆盖原格式禁止替代的方向，等待用户选择：

1. **以规格为准（建议）**：保留完整原文件边界；普通预览仍可读像素；撤销 Blob 不能取得完整字节时原格式失败，明确格式转换可使用像素。修改这两处旧预期并新增回归；成功文件字节不变，但过去可能“成功”的静态替代现在失败。
2. **以已实现代码为准**：需修订当前 proposal/delta/design/tasks 和完整测试清单，显式允许原格式保存静态重编码数据，记录动画、编码与元数据丢失及命名影响，再重新审批；不能直接改主规格追认。
3. **暂不对齐**：该范围阻塞，不能完成或归档本 change。

2026-10-22用户对完整待审版本回复“批准”，选择方向1，详见approval.md。仓库 config 中“实现解决历史文档差异”不绕过 AGENTS 的冲突门禁。

## Goals / Non-Goals

**Goals:** 五种方式按需协作，普通使用零调试附加，成功原图统一复用，按网站授权可撤销，资源归属及完整性不确定时宁可保留失败。

**Non-Goals:** 不自动滚动、破解访问控制或恢复已释放字节；不新增后端、运行时依赖、云端授权、全局增强总开关及消费方 Skill。保持 Chrome 116+；独立跨进程框架调试沿用 Chrome 125+ 的兼容回退。

## Decisions

### 1. 统一原图任务，像素另行处理

新增原图协调模块，通过现有 api.js 接口连接预览和下载。以源标签页、文档标识、图片完整地址和代次标识任务，多个视图为订阅者；成功先复制完整 Blob 到视图可复用缓存，归档索引失效不使已取得数据失效。保留当前页面 Canvas 快照及内嵌 SVG 保存能力。

顺序：完整内嵌/Blob/已有缓存 → 当前有效 MHTML 资源（需要时共享新归档）→ 普通 Fetch → 网页 Origin Referer → 图片 Origin Referer → 已获准的批量 CDP。已持有的完整 Blob/Data URL 缓存优先取用；未持有字节的 HTTP 缓存由后台 Fetch 尝试命中，不隐式插入页面 HTTP 请求。Referer 依据图片所属文档（可为 iframe），授权归属仍按顶层网站；Origin 包含协议、主机、端口，序列化加尾斜杠。重定向只使用已观察的最终地址，不猜测域名，不改变签名 URL。

已有静态预览可先显示，不能使原图任务被标为成功。原图有效性校验非空、预算、完整读取、图片类型与格式基本结构/浏览器解码，SVG 单独校验根元素；浏览器能宽容解码截断数据不算完整证明。原格式没有完整数据时执行原有默认目录直接 URL 下载条件，否则失败；用户明确选择转换时允许像素重编码并保留来源说明。

预览和下载共享完整任务；像素预览另行存储。每路径每代次至多尝试一次；删除 loadPreview 的隐式整链二次刷新，主动重试才建新代次。方法标识保留 debugger-resource、extension-fetch、page-blob 等并扩展 mhtml-resource、page-referer-fetch、image-referer-fetch，UI 映射来源，不仅凭 browserData 推断 CDP。失败按路径汇总而不固定旧的“页面/扩展”二段错误模板。

### 2. 后台请求管理与临时规则

使用 `declarativeNetRequestWithHostAccess`（复用现有 HTTP(S) 站点权限）和会话规则（Session Rule）。同 URL 的普通和两类 Referer 请求进入同一锁队列，不只锁带头请求；不同 URL 全局并发 2。规则匹配以转义、锚定的完整 URL 正则、大小写敏感、类型 xmlhttprequest、本扩展 initiatorDomains 约束。创建前检查正则支持；不能精确匹配时跳过来源回退并解释，不能放宽匹配。

后台所有经过同一 URL 的扩展 Fetch 均须协调，包括可能重合的订阅请求：订阅继续 credentials: omit、不带 Referer，通过共享请求锁确保不被临时规则污染，不更改订阅契约。重定向到其他 URL 时不扩大规则；普通 Fetch 的默认重定向行为保留，需另一 Origin 重试只采用经过核实的最终图片 URL，并保留原采集地址。

每步创建/移除均 await；finally 移除规则，清理失败使对应队列失败关闭，后台恢复先 getSessionRules 清理本功能预留 ID 范围。新任务等待恢复完成；不删其他用途规则。消息只接受真实扩展 panel 视图，不能由网页指定任意头或域名；后台核对当前标签页、文档和已采集地址后自行推导 Referer。12 秒单请求超时，20 MiB 流式上限，取消时中断并清理。

依据 2026-10-22 核对的 [Chrome 请求头规则文档](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)：站点访问型权限和会话规则可用于这一实现；服务器实收 Referer、普通请求隔离及订阅零头由真实浏览器测试验证，不把官方 API 存在当成功证据。

### 3. 归档宿主、解析和完整性

`pageCapture.saveAsMHTML` 使用扩展页面上下文获取归档 Blob，避免假设 Service Worker 支持 DOM/FileReader 或 Blob 消息直接传输。后台登记每个 tab/document 的唯一任务并选举仍有效图库作为宿主；其他视图共享有界结果，宿主关闭撤销并允许剩余订阅者重新选举。不为被动徽标创建宿主。沿用现有 offscreen 规则校验单例，不另起冲突离屏页面。

原生 MIME 解析器按字节处理边界、折行头、Content-Location、Content-ID、Base64 及 quoted-printable；拒绝非法编码、超预算和不完整结束边界。归档最多 64 MiB，图片最多 20 MiB，索引保留资源总量最多 32 MiB、同一 tab 一个有效代次，归档/解析总等待 20 秒；超过限制则走后续路径，不截取成成功。归档原文解析后释放，索引在导航、最后订阅者关闭及 30 秒闲置后释放。

归档前后由 collector 返回 documentId、frame、实际 currentSrc、complete、naturalWidth 和资源完成证据。必须匹配同一文档和实际地址且归档前后均成功加载。对非 IMG 的 CSS 等，仅在有完成及文档归属证据、图片结构完整时接受；含同地址歧义时不强行使用。尚未完成、未知来源、重定向无法核实及格式完整性不确定时转后续路径或等待完成事件；不把解码成功当完整性证明。

[Chrome 归档文档](https://developer.chrome.com/docs/extensions/reference/api/pageCapture)明确 permission 和 Chrome 116+ Promise 接口，未承诺部件完整性；原任务实测曾有加载中截断，因此生产必须独立验收。临时实验的耗时不作为性能承诺。

### 4. 动态增量与增强发现

复用 badge-observer 的 PerformanceObserver、MutationObserver、load/error 信号，后台只向订阅该源页的打开图库发增量失效通知；500 ms 合并，连续变化最长 2 秒触发一批，同 tab 同时最多一个归档，完成后如有新资源再补一批。被动徽标沿用只读计数，绝不借通知触发数据提取。

同文档按稳定地址合并，Canvas 继续独立；保留原图、选择、标题及下载结果。真实换源或导航使相关代次失效；采集时间只为新候选生成，旧来源记录不拼接。开启增强模式执行一次增量扫描，资源树中仅在无范围限制时加入可验证的新资源；有 XPath/CSS 时只能补充允许 DOM 候选的数据。资源发现与读取共用短时会话，但常规路径成功的文件不重复读 CDP；开启的增量发现仍可能单独附加一次，并明确显示正在增强提取。

### 5. 本机网站授权与撤销

拟用 `enhanced-mode:v1:<hostname>` 保存布尔值，避免命中同步 codec 的 settings 或网站前缀允许表。默认关闭、无效关闭，读取错误 fail closed 且显示反馈；不写默认 false 覆盖读取失败值。`saveConfig` 共享锁用于网站开关保存，storage 事件通知相关视图；sync payloadWrites 不触及该命名空间，远程结构无对应字段。

后台附加前读取当前 tab 的顶层 hostname 和 document 代次；授权撤销/导航立即使 CDP 操作令牌失效，取消队列、释放自有连接，不等下载空闲；迟到结果不交付。普通数据任务可继续。用户从 Chrome 取消时本 document 标为已停止，不因下一张图片自动重连；主动重试可以再次尝试但仍要核实本机授权。[调试 API](https://developer.chrome.com/docs/extensions/reference/api/debugger)权限仍在 Manifest，产品开关不伪装成浏览器权限撤销。

### 6. 设置跳转与图库状态

图库末尾保留现有 XPath/CSS 摘要，新增轻量提示，下载区独立。深链接携带 tabId、documentId、hostname 并指向高级功能位置；设置核对当前源网页后聚焦开关，每次保存前再校验，关闭或跨站导航要求重新从图库进入。普通齿轮保持 openOptionsPage；未携带可验证源页时展示从图库进入的提示，不根据当前扩展页猜来源。

开启后用图标+紫色文字状态表示许可，活动读取额外显示进行中；不是保持永久连接。关闭保存失败保留旧状态。开启增量工作遵循忙碌延后，关闭立即取消 CDP；保留现有筛选和下载批次冻结。七语言、深浅主题、键盘焦点和320 px检查由新浏览器用例覆盖，现有语言/主题用例原样回归。不新建完整页面视觉稿或改版。

## Risks / Trade-offs

- 默认不再自动 CDP，少数图片需用户手动开启 → 底部可见入口、清楚说明及开启自动补充，不迁移成自动授权。
- 同 URL 规则影响扩展内其他 Fetch → 统一 URL 锁包含普通/订阅请求，真实服务器记录验证；正则或清理失败关闭此路径。
- MHTML 无完整性保证、整页内存成本高 → 有界解析、加载前后检查及保守拒绝；支持格式以可验证完整性为准，未知回退。
- 原格式拒绝像素替代可能使旧 Blob 测试失败 → 先由用户选择冲突方向，完整列出预期变化，禁止隐式修测试。
- 开启增强会补充发现，即使现有图片已成功也可能出现一次提示 → UI 区分许可与活动，释放短时连接，不承诺授权后零调试提示。

## Migration Plan

审批五份 delta、当前 design/tasks、完整测试清单，并明确选择冲突方向后才能 Apply。无原授权可迁移，全部网站默认关闭；新增本机键不改变同步载荷版本。先实现纯提取和解析，再接后台管理、授权及 UI，补齐批准测试和文档，验证后同步五份主规格和术语表，Archive 并自动本地提交，不推送。

回退实现提交会恢复旧默认调试行为；必须在回退说明提醒这一行为差别。新增本机键可保留供重新升级；清理本功能规则后回退，不删除用户其他配置。

## Audit

OpenSpec: required，范围见 proposal 和五份 delta。External-Skill: exempt，skills/无对外分发及契约，内部 OpenSpec skills 无误置。README-Glossary: required，新增唯一项目私域词“增强模式 / Enhanced Mode / —”，同步 user-preferences 与 README，并复核其余九份主规格无重复或冲突映射；MHTML、CDP、Origin、MIME 等为行业通义。


## 测试前置条件修订（已批准）

实施核对发现旧调试专项的“全部阶段零图片请求”与“先真实Fetch再CDP”不能由原计划仅关闭MHTML的前置条件同时保证。完整修订清单见test-review.md：46项总数不变，七项调试场景明确在CDP路径验收时将后台Fetch设为发送前失败，在普通回退时恢复真实Fetch。CDP接口、原字节、动画和零HTTP断言全部保留，新EB场景继续真实网络验收。该修订涉及用例前置条件，原审批不覆盖，暂停相关测试及依赖验证，用户已再次批准后继续；不缩短五路径顺序。

External-Skill: exempt，修订仅测试前置条件，既有对外Skill审计不变。README-Glossary: required，仍仅新增增强模式，术语集合与映射不变。
