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
