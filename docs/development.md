# 开发与验证

扩展位于 `extension/`，使用原生 JavaScript 模块，无运行时依赖，不需要构建或执行 `npm install` 才能加载。浏览器最低版本以 Manifest 为准；OpenSpec CLI 的开发环境需要 Node.js 20.19+，现有 CI 使用 Node.js 22。

## 常用命令

```sh
npm run check       # JavaScript 语法、Manifest 引用资源
npm test            # Node 单元测试
npm run package     # dist/imagetaken-<manifest-version>.zip
```

ZIP 根目录包含 `manifest.json`，仅打包 `extension/` 文件，不含规格、开发工具和测试资源。更新未打包扩展后，需在 `chrome://extensions` 点击 ImageTaken 的「重新加载」；仅修改磁盘文件不会自动更新已加载的 Manifest。

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

以上模块均位于 `extension/`。底层文件划分是开发索引，不是稳定的产品 API；验收依据以主规范为准。

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
