# 开发与验证

扩展 TypeScript 源码位于 `src/`，静态资源与生成的原生 JavaScript 模块位于 `extension/`，无运行时依赖。首次加载源码版须执行 `npm ci` 和 `npm run build`；生成脚本不纳入版本控制，后续修改应编辑 `src/`。浏览器最低版本以 Manifest 为准；OpenSpec CLI 的开发环境需要 Node.js 20.19+，现有 CI 使用 Node.js 22。

## 常用命令

```sh
npm ci              # 依赖锁文件安装
npm run typecheck   # 全量严格类型检查和 AST 安全规则
npm run build       # 清理遗留脚本并编译到 extension/
npm run check       # 构建、语法和 Manifest/HTML/CSS/模块/注入/线程资源检查
npm test            # 先构建，再运行既有 Node 单元测试
npm run package     # dist/imagetaken-<manifest-version>.zip
```

ZIP 根目录包含 `manifest.json`，先执行完整检查和构建，再仅打包 `extension/` 的运行资源，不含 TypeScript 源码、声明、源码映射、规格、开发工具和测试资源。更新未打包扩展后，需在 `chrome://extensions` 点击 ImageTaken 的「重新加载」；仅修改磁盘文件不会自动更新已加载的 Manifest。

## TypeScript 构建约定

`tsconfig.json` 对全部扩展源码启用 `strict` 和 `noEmitOnError`，使用 ES2022 原生模块输出，保留 `.js` 导入路径。Chrome API 使用开发期类型声明，共享数据模型位于 `src/models.ts`，浏览器上下文补充声明位于 `src/environment.d.ts`。`scripts/build.mjs` 使用编译器抽象语法树（Abstract Syntax Tree, AST）禁止显式 `any`、类型断言、非空断言和关闭检查注释。外部数据先用 `unknown` 与运行时校验处理。

构建成功后清理旧生成脚本并输出；类型失败不会进入打包。采集器、徽标观察器与原页高亮脚本保持经典脚本形式，避免注入后出现模块闭包依赖。译文目录编译后继续保持可解析的数据导出文本。发布包解压即可加载，无需 Node 或编译器。

## 浏览器集成测试

```sh
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/browser_test.py
.venv/bin/python tests/manifest_browser_test.py
.venv/bin/python tests/debugger_test.py
.venv/bin/python tests/automatic_badge_test.py
.venv/bin/python tests/language_test.py
.venv/bin/python tests/theme_test.py
```

测试使用临时配置和本地 HTTP 服务，不访问个人浏览器配置。截图输出到被 git 忽略的 `test-results/`。`browser_test.py`、语言和主题测试可用 `CHROMIUM_PATH` 指定浏览器；`debugger_test.py` 与 `automatic_badge_test.py` 当前从 macOS ARM64 Playwright 缓存定位 Chrome for Testing，其他环境需先适配其浏览器路径。

目录测试以替代系统选择器的方式使用真实文件系统句柄、IndexedDB 和私有文件系统写入。真实 OS 选择器、Chrome 权限提示及其他下载扩展冲突需手动验证，不能仅由自动化结果替代。

## OpenSpec 工作流

当前 CLI 固定为 `@fission-ai/openspec@1.14.3`。通过 `npx` 使用开发工具，不给扩展增加运行时依赖。

```sh
npx --yes @fission-ai/openspec@1.14.3 list
npx --yes @fission-ai/openspec@1.14.3 list --specs
npx --yes @fission-ai/openspec@1.14.3 new change <change-name>
npx --yes @fission-ai/openspec@1.14.3 status --change <change-name>
npx --yes @fission-ai/openspec@1.14.3 validate --all --strict --no-interactive
npx --yes @fission-ai/openspec@1.14.3 archive <change-name>
```

- 产品当前约定维护在 [`openspec/specs/`](../openspec/specs/)，通过能力目录中的 `spec.md` 阅读。
- 行为变化先记录 proposal、design、delta specs 和 tasks，完成实现与验证后同步主规范并归档。
- 归档保存在 [`openspec/changes/archive/`](../openspec/changes/archive/)，记录当时的变更与证据，不随新功能重写。
- 本次追溯基线是 [`document-existing-extension`](../openspec/changes/archive/2026-10-21-document-existing-extension/)，其 `evidence.md` 将历史提交映射到实现与测试。
- 项目 Codex 工作流由初始化生成的 [`.agents/skills/`](../.agents/skills/) 提供。结构性英文标题及 SHALL / MUST 保留，正文使用中文。

## 模块索引

| 模块 | 职责 |
| --- | --- |
| `collector.js`、`api.js` | 页面候选采集、扫描合并、数据读取和保存协调 |
| `debugger-reader.js`、`browser-resources.js` | 后台调试通信、源文档验证、浏览器原始资源与已取得数据取用 |
| `previews.js`、`selection.js` | 预览解码与重试、卡片和框选交互 |
| `automatic-badge.js`、`badge-observer.js`、`badge.js` | 被动页面快照、规范化过滤计数与视图镜像 |
| `destination.js`、`title-editor.js` | 目录授权和持久化、标题编辑、下载子目录准备 |
| `browser-downloads.js`、`download-hashes.js`、`file-content.js` | 浏览器完成跟踪、目录核验、内容去重和重名处理 |
| `lib.js`、`metadata.js`、`preferences.js` | 筛选、排序、文件名、体积、稳定标识与配置保存 |
| `settings*.js`、`i18n.js`、`theme.js` | 分类设置、默认值、离线多语言与主题 |
| `panel.html/css/js` | 侧栏和固定源页面的独立图片库 |
| `selection-highlights.js`、`source-highlights-background.js`、`source-highlights.js` | 选择快照、按文档路由的视图会话及原页临时红框 |

以上脚本的可维护源码均位于 `src/`，使用 `.ts` 后缀；表内 `.js` 是编译后运行路径，生成脚本位于 `extension/`。底层文件划分是开发索引，不是稳定的产品 API；验收依据以主规范为准。

## 选中图片的原页红框

图库所有选择入口经同一个状态回调发送完整选择，包含被普通筛选隐藏的选择；取消、失败或忽略导致的实际取消同步去框。`collector.js` 为每个候选保存本次扫描中的全部元素出现记录，引用仅留在源文档隔离执行环境中；传输仍使用 `documentId` 与记录 id。候选按地址去重、Canvas 独立、首个完整溯源记录及原图读取入口保持原规则。`sourceReference` 是描述文本，不作为唯一元素选择器。

重复地址可对应多个元素；picture 的 source 候选对应所属 img，CSS 背景与伪元素对应宿主，Canvas、SVG、封面及图片链接对应自身元素。只有资源记录的候选无虚假位置。元素断开、来源声明改变或文档导航后旧引用不标记替代节点；新节点需要重新扫描。活动会话独立持有已解析目标，不会被另一图库的三次扫描历史淘汰。

每文档一个临时宿主及封闭 ShadowRoot，以 `border:2px solid #ff0000` 绘制元素可视矩形，不改写网站 border、outline、class、style，不包裹网站元素。覆盖层固定定位、不占布局、不可聚焦且 `pointer-events:none`。活动目标使用动画帧批量读几何、写实际变化，滚动、缩放、位置与尺寸变化后跟随；最后释放后清理覆盖层、动画帧与失效定时器。框架内绘制受框架视口裁剪，不承诺跨越浏览器界面、受保护页面或网页顶层遮挡。

每个图库以独立运行时端口维护会话；后台校验扩展及图库来源，按完整文档 id 分组，序号拒绝过期更新，跨文档失败独立处理。多个图库以元素引用并集显示，一视图取消或关闭不清除其他视图仍持有的选择。刷新、源标签 loading/切换/关闭、图库 pagehide 或端口断开立即释放旧会话；非空选集每5秒续期，源文档15秒无续期失效用于异常兜底。浏览器冻结期间不承诺固定墙钟时限，恢复执行后清理；失效会话不可由旧包复活，重新连接提交当前完整状态。

覆盖层不参与 collector 采集，徽标观察器忽略扩展自生变更；混合真实页面变更仍通知。高亮不请求图片、不导出像素、不启动 debugger，也不持久化或同步选集。页面访问失败不改变图库选择、预览和下载结果。

```sh
npm test
.venv/bin/python tests/source_highlights_browser_test.py
```

专项包含 HU01–HU04 四项协调单元用例（由 npm test 自动发现）及 HB01–HB12 十二项真实扩展浏览器用例。浏览器脚本自带本地 HTTP 服务、一次性配置和页面/后台异常收集，支持 `CHROMIUM_PATH`；截图写入 `test-results/source-highlights/`。需使用管理员允许加载开发扩展的浏览器；启动被策略拒绝不能当作功能通过，也不能用仅有 API 替身的单测证明原页红框可见。

## 原图读取与排错

已有完整原图首先复用本地 Data URL / Blob。未取得原图时，尝试浏览器保留资源，再用所属页面的内嵌数据、快照、缓存与页面读取；像素导出和扩展请求是后续回退。预览重试允许先使用已解码像素，原文件保存不能将缩略图当成原始动图。

网页显示成功与脚本能读取原始字节是两件事。跨域 Canvas、Cookie / Referer、签名过期及缓存分区可能影响后续读取。`chrome.debugger` 提供原始资源读取机会，但资源释放、DevTools 占用或用户取消仍需回退。参考 [Chrome 跨域请求文档](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) 和 [调试 API](https://developer.chrome.com/docs/extensions/reference/api/debugger)。

在扩展 Service Worker 控制台使用 `__imageTakenBadgeDiagnostics.get(tabId)` 检查最后一次徽标状态、数量或失败原因。先确认实际加载目录与 Manifest，再判断代码是否生效；不要将其他扩展的 offscreen 错误当成 ImageTaken 的后台错误。

素材源文件及生成说明见 [Logo](logo.md) 和 [插图](illustrations.md)。

## 网站阈值与默认配置

宽高体积按顶层 hostname 分字段保存在 `filters:site:v1:<hostname>:width|height|minBytes`，不含协议、端口或路径；不同子域名独立。未保存的宽高字段继承 `filters:width` / `filters:height` 的全局默认值，未保存体积使用 2048 字节。三个字段均以显式 0 表示取消限制。

设置页只提供全局默认宽高；沿用旧全局宽高键兼容升级。旧 `filters:minBytes` 保留供回退，新逻辑不读取它，也不将其分配给首次打开的网站。恢复默认删除当前网站三个覆盖键；清除筛选则保存当前网站三个零值。读取设置不会创建覆盖键。图库与后台徽标共用同一个有效阈值解析器。

图库宽高的空 value 表示继承显示，通过动态 placeholder 提示全局默认；筛选读取独立有效值，不将空串转换为零。配置来源与有效数值来自同一次存储读取。单项还原只删除对应网站字段，原三项恢复入口保留。图库宽高编辑接受 0..100000 的纯数字整数，空白仅为草稿，失焦恢复配置；最低体积仍允许小数 KiB。

图库宽高还原按钮位于输入边框内部右侧，采用定位布局而不占用外部列宽；单位与按钮保留独立空间。相同网格跨度的宽、高、体积和格式控件以实际边框宽度对齐，窄屏独占整行的来源下拉仍按自身跨度布局。

## 图片来源文本清单

`settings:download-manifest` 为本机共享布尔设置，仅 `true` 开启，默认关闭。设置“下载”分类可切换；面板固定每批的开关、标题、目录和采集元数据，切换只影响下一批。初始设置读取失败可见，配置未知时禁用下载，可重新扫描或重开面板恢复读取。

`collector.js` 在所属文档扫描时保存 `sourcePageUrl`、`originalTitle`、`collectedAt`、`sourceReference`。原标题取非空 title、alt 或内嵌 SVG title，缺失不以页面标题替代；采集时间为 UTC ISO 8601 字符串。同 URL 合并保留首次发现的完整溯源记录与全部读取入口，iframe 与资源记录保留所属文档地址。重新扫描生成新采集记录；下载不重新读取 DOM 补信息。

`download-manifest.js` 负责批次快照、UTF-8 文本序列化及两类目录保存。字段标签使用稳定英文，值保留原文、转义换行和控制字符，缺失字段显示 `Not provided`。内嵌 SVG、Data URL、Blob 与 Canvas 明确显示 `No valid remote URL`，保留来源类型/元素引用；Blob 原引用不被当成远程地址，完整 Base64/XML 载荷不复制到文本。HTTP(S) SVG 仍有真实远程地址。

清单采用实际完成结果中的 `savedName` 或 `actualPath` 文件名，记录转换和随机后缀后的名称，按输入顺序列出新保存/内容复用项目。失败及目录异常放入单独失败区，不冒充已归档图片。每批一份 `<安全标题>.txt`，已存在的同名文本使用随机后缀保留；批次标识区分图片全部去重复用的重复下载。清单不计入图片成功/跳过/失败数量。

图片全部失败但目标目录准备成功时仍输出清单；目录准备失败不输出、不更换位置。清单保存失败单独提示并保留图片。两类保存继续沿用原有目录授权、实际路径核验及默认目录去重的可验证范围，无额外权限、后端或来源信息上传。

`manifest_browser_test.py` 独立运行20项获批测试中的10项浏览器验收，使用临时配置、本地 HTTP 服务与真实沙盒文件句柄，支持 `CHROMIUM_PATH`；真实系统目录选择器及权限弹窗不由自动化替身证明。其余10项为 Node 单元测试，随 `npm test` 运行。

## 远程规则开发与验证

`remote-rules.js` 提供数据格式校验与合并，`remote-subscriptions.js` 管理本机 `remote-rules:v1` 缓存和调度。`remote-rules-background.js` 协调后台共享有效配置；图库经消息、徽标直接调用。`rules-host.js` 通过离屏单例承载选择器校验与 `rules-worker.js` 的有时限正则匹配，所有执行代码随扩展打包。设置动态列表位于 `remote-rules-settings.js`，格式见[规则文档](remote-rules.md)。

`npm test` 包含规则与订阅单元测试；`python tests/remote_rules_browser_test.py` 使用独立临时配置及本地HTTP服务验证真实设置、离线、徽标、范围、线程、导航与下载更新。无需用户Chrome资料、真实Gist或额外运行时依赖。

## 配置同步开发与验证

同步范围、格式和容量见[配置同步](settings-sync.md)。`settings-sync-codec.js` 定义允许表、版本向量、摘要、分片及预算；`settings-sync.js` 为可注入存储的协调器，`settings-sync-background.js` 接入生命周期、消息及5分钟alarm，`settings-sync-ui.js` 为设置页差异与选择界面。

`config-lock.js` 对所有配置写入提供共享Web锁。订阅必须先进入其修改队列、再取得配置锁；不得在配置锁内等待订阅队列或网络。完整导入由订阅管理器对账后一次写入，包括内部null继承墓碑与导入事件。图片库仅对有效范围变化采集，普通变化复用已有预览及徽标快照。

```sh
python tests/settings_sync_browser_test.py
```

专项浏览器测试支持 `CHROMIUM_PATH` 和 `SYNC_TEST=SBxx`，用两个临时配置及仅测试使用的复制桥验证原生存储、冲突、UI和配额。Google云端实际传输未由此证明，不要求个人账户或新增权限。现有七个浏览器脚本及67项单元用例保持原样回归。

## 多方式原图提取与网站授权

`extraction-tasks.js` 管理完整原图共享及失败代次；`extraction-background.js` 协调文档身份、图库端口、归档宿主和跨视图任务。预览、转换和下载复用完整原图；静态像素独立，原格式下载不能以静态 PNG 代替。Canvas 自身快照仍可保存。失败在同一次任务中不重复请求，主动重试才创建新代次；已持有完整原图始终直接复用。

顺序为本地完整数据、MHTML 归档、普通 Fetch、网页 Origin Referer、图片 Origin Referer、获准 CDP。`mhtml.js` 只接受归档前后文档及实际地址一致、已完成加载且结构完整的图片；同地址跨文档归属不明确时放弃归档结果。动态性能、DOM 和 load/error 事件按批补充打开的图库，不为被动徽标提取原图，不自动滚动。

归档通过一个有效图库页面调用 `pageCapture.saveAsMHTML`，多个视图共享任务，宿主关闭后由其他有效视图重新承担；归档原文最大64 MiB、索引32 MiB、单图20 MiB，归档及解析等待20秒，索引闲置30秒释放。单标签页最多一份有效归档索引，导航和最后视图关闭清理；已交付完整字节不依赖索引仍有效。超限、加载中、未知格式完整性、MIME截断和来源歧义都回退，不截取成成功。图片预览标记区分归档与调试资源，下载完成摘要统称浏览器资源原文件。

`image-requests.js` 统一后台三类Fetch与订阅请求的同URL队列，最多两个不同URL并发。临时会话规则精确匹配完整目标和本扩展发起的请求；规则建立、请求、清理均串行，普通及订阅请求也等待相同URL的规则移除。订阅仍不带Cookie/Referer，订阅队列→配置锁的既有顺序不变，配置锁内不等待网络。正则不能精确匹配、规则清理失败或后台恢复清理失败时关闭该路径，不扩大匹配或删除其他规则。每个图片请求12秒、20 MiB流式上限，不通过随机查询串刷新签名地址。

`enhanced-mode:v1:<hostname>` 只存本机，只有true授权；不属于同步codec允许表或远程规则格式。调试附加前后由后台核实网站、文档和授权，关闭/导航取消自有任务并丢弃迟到结果，不断开他人连接。用户取消Chrome调试后当前文档不自动重连，主动重试仍需网站许可。设置深链接携带并核实源标签页、文档和hostname，失效时须重新从图库进入。

新增 `pageCapture` 用于本机网页归档，`declarativeNetRequestWithHostAccess` 用于上述有界请求头修改；debugger仍是安装声明权限，增强模式只控制实际使用。回退到旧实现会恢复默认调试读取行为，回退前须清理本功能临时规则；保留本机授权键不会改变旧版其他设置。

专项验收：`python tests/extraction_browser_test.py`，可用 `EXTRACTION_TEST=EBxx` 定向运行；13项EX单元随 `npm test` 执行。15项EB使用临时Chrome配置与本地服务器，真实验证归档、Referer、会话规则和CDP。原调试专项为隔离CDP路径，按批准夹具在该阶段让Fetch于发送前失败；普通回退及新Referer专项仍使用真实Fetch。测试不证明Chrome116真实环境、公网认证/Cookie分区、用户调试横幅外观或Google跨设备实际送达。

来源头规则生效期间使用跨URL的独占网络租约，普通/订阅请求平时可读共享；这避免未知重定向进入另一个URL时误用临时Referer。实际完整原图缓存指扩展已持有的Blob/Data URL；新的HTTP读取统一交给后台，页面读取仅处理内嵌数据、Blob、画布及像素。后台共享结果缓存有64MiB编码预算，扫描交付原图总量32MiB、调试原图8MiB，超出预算保留候选供按需处理。

图库搜索写入由可信图库消息交给后台排队并取得共享配置锁，避免增量工作期间刷新或关闭视图取消尚未取得锁的保存；搜索仍按源网页hostname隔离，未完成输入不由其他视图的保存覆盖。

## 设置与预览生命周期

标题清洗、成功图片优先和下载清单开关的写入由后台校验设置页来源、配置键及布尔值，并在既有配置锁中完成；设置页重载不会取消已发起的写入。保存反馈仅在实际写入完成后显示，错误时保留原值。

没有本地数据的 HTTP 图片预览按可见范围或显式 eager 加载，通过与下载共用的完整原图任务获取数据，再使用本地对象地址展示；不另用图库图片元素直接请求远程地址。主动重试保留原有独立代次，静态像素缩略图不进入原文件缓存。

图库选择快照通过微任务发送，确保图库退到后台时取消操作仍能到达后台协调器；原页矩形绘制仍按动画帧更新。外部 XPath/CSS 范围更新复用有效配置更新路径，为仍有效的选择更新来源标识，移除范围外的选择；手动刷新和导航仍清空失效选择。
