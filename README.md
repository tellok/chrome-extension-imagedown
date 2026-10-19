# ImageDown

一个原生 JavaScript、零运行时依赖的 Chrome Manifest V3 图片下载扩展。参考 Imageye 的图片浏览和批量下载工作流，独立实现代码与界面。

核心原则：**发现图片与读取图片分开。页面已经展示的图片，不应因为扩展再次请求失败而从列表中消失。**

## 安装

需要 Chrome 116 或更新版本。

1. 克隆此仓库，或下载并解压打包后的 ZIP。
2. 打开 `chrome://extensions`，启用右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择仓库的 **`extension` 文件夹**，或包含 `manifest.json` 的 ZIP 解压目录。
4. 打开网页，点击 ImageDown 图标，在侧边栏查看图片。右上角 `↗` 可以打开独立标签页。
5. 选择图片并下载，文件保存到浏览器下载目录的 `ImageDown` 文件夹。

页面中的懒加载内容需要先滚动或展开，再点击 `↻` 重新扫描。批量下载期间保持侧边栏或独立标签页打开。Chrome 的下载询问、站点访问权限及企业策略可能影响下载。

## 已实现

- 页面图片 `currentSrc` / `src`、`picture` / `srcset` 候选、常见懒加载属性。
- CSS 背景、遮罩、边框图片、列表图片及 `::before` / `::after` 图片。
- Blob / Data URL、Canvas、内嵌 SVG、SVG image、视频封面、图片链接、资源时间线中的图片地址。
- 开放的 Shadow DOM；有权限访问的跨域 iframe。相同地址去重，保留各框架的读取入口。
- URL / 描述搜索，宽高、格式、来源及页面已加载状态筛选，按页面遍历顺序、面积、宽度排序。
- 网格 / 列表布局，单张或批量下载，复制原始链接，PNG / JPG / WebP 转换。
- 每张图片显示读取方式、下载后的文件大小或失败原因；预览失败的图片仍能选择和重试。

这是核心图片下载工作流的实现；不包含 Imageye 的反向搜图、选区截图、ZIP 合并下载及全部站点专用适配。

## 为什么可以显示，却读不出文件？

浏览器允许 `<img>` 显示很多跨域图片，但不一定允许脚本读取它们的响应字节或像素。跨域图片没有相应 CORS 授权时，画到 Canvas 会污染画布，`toDataURL()` 等读取操作会抛出 `SecurityError`。扩展具有站点权限也不会自动解除页面 Canvas 的限制。

另外，页面加载图片时可能带有登录 Cookie、来源 Referer、临时签名或特定缓存分区；扩展重新发起请求时上下文可能不同，原始地址也可能已经过期。浏览器没有提供一个通用 API，让普通扩展直接导出任意已渲染图片的原始压缩文件。

本扩展在用户下载时，按以下顺序尝试读取：

| 顺序 | 方法 | 输出 |
| --- | --- | --- |
| 1 | 直接使用 Data URL；在所属页面读取 Blob；导出扫描时的 Canvas 快照 | 内嵌数据、原 Blob，或 Canvas PNG |
| 2 | 同源 HTTP 图片使用 `only-if-cached`，不触发网络请求 | 缓存命中时保留原文件字节 |
| 3 | 在图片所属页面使用 `force-cache` 请求，带页面凭据与默认来源信息 | 优先命中缓存；未命中时可能访问网络 |
| 4 | 若图片元素仍持有相同地址的已解码图像，且画布允许读取，则导出像素 | 静态 PNG，明确显示「页面像素兜底」 |
| 5 | 扩展凭站点权限发起图片请求 | 成功时保留响应原文件 |
| 6 | 原格式下载仍失败时，交给 `chrome.downloads` 直接下载 HTTP(S) 地址 | 以浏览器实际完成 / 中断状态为准 |

缓存命中不保证总能发生。步骤 4 仍然受 Canvas 安全规则限制。普通跨域图片通常可以由步骤 5 读取，但依赖页面 Referer、受访问控制或地址过期的资源仍可能失败；失败原因会保留。

格式转换及像素兜底会重新编码，不能保留 GIF / WebP 动画、原始元数据或原文件编码。JPG 转换将透明区域填充为白色。Canvas 保存扫描时的快照。

技术参考：[Chrome 跨域请求与权限](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[MDN 跨域图片与 Canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)。

## 边界与性能

- 只支持 HTTP(S) 网页；浏览器内部页、Chrome 商店、内置 PDF 阅读器等受限制页面不支持。
- 无法访问关闭的 Shadow DOM、没有权限或受浏览器保护的框架；没有重放图片加载前的网络流量，也不绕过访问控制。
- 只扫描当前 DOM 和仍可查询的资源条目，不自动滚动页面，也不保证发现尚未创建的懒加载元素。
- 「页面已加载」指图片元素已解码或画布 / SVG 已渲染，不代表元素在当前视口可见；CSS 图片没有相同的解码状态接口。
- 列表顺序为主框架 DOM 遍历顺序，再加其他框架；不是不同框架之间的全局视觉坐标排序。
- 每框架最多 4000 个唯一地址、12 MiB 地址数据；缩略图预算约 6 MiB。达到上限会提示。
- 保留最近 3 次扫描的读取入口，避免侧边栏和独立标签页互相使读取入口失效；更旧的列表需要刷新。每次扫描的 Canvas 快照数据预算为 32 MiB。
- 原文件数据读取限制 20 MiB；像素导出和格式转换限制 2400 万像素。过大 HTTP(S) 文件可回退到浏览器原格式直接下载。
- 下载并发为 2；单个浏览器下载超过 120 秒会取消并报告超时。未完成的任务不会显示成功。
- 地址缺少扩展名且尚未读取时显示「未知格式」，尺寸未知时显示「尺寸未知」。设置格式或尺寸筛选会排除不匹配 / 未知项。下载后才有准确文件大小，不额外发送 HEAD 请求。
- 关闭面板会结束其中的任务及 Blob 生命周期。需要长时间下载时使用独立标签页。

## 权限与隐私

无遥测、无后端、无外部脚本或运行时依赖，不上传图片或浏览记录。扫描及转换在本机执行。预览与回退下载可能访问原图片服务器。

| 权限 | 用途 |
| --- | --- |
| `activeTab`、`scripting` | 在用户打开面板、切换页面或重新扫描时读取页面图片；读取时按 documentId 定位原文档，避免页面导航后误用框架 ID |
| `http://*/*`、`https://*/*` | 访问跨域 iframe 及跨域图片；若收窄站点访问范围，对应来源可能不可用 |
| `downloads` | 保存文件并跟踪实际完成或中断状态 |
| `sidePanel` | 保持图片浏览和批量下载界面打开 |

没有常驻网页内容脚本、请求拦截、Debugger、Cookie API 或页面主世界脚本。采集器只在需要时注入扩展隔离世界；页面脚本无法调用扩展的任意 URL 下载代理。

## 开发与验证

扩展本身不需要构建或安装 npm 依赖。

```sh
npm run check       # manifest 引用和 JS 语法
npm test            # 筛选、类型识别与文件名安全
npm run package     # dist/imagedown-0.1.0.zip，manifest 位于 ZIP 根目录
```

真实 Chromium 集成测试：

```sh
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/browser_test.py
```

可设置 `CHROMIUM_PATH` 指定支持加载未打包扩展的 Chromium / Chrome for Testing 二进制。测试使用临时浏览器配置及两个本地 HTTP 服务，不访问个人浏览器配置。

覆盖原始缓存字节、过期图片像素兜底、Cookie、跨域请求、有效 / 已撤销 Blob、Canvas / 受污染 Canvas、跨域 iframe、Shadow DOM、懒加载 / srcset / 背景 / 伪元素 / SVG、格式转换、真实下载完成、失败保留、筛选及页面导航。截图输出到 `test-results/`。

## 代码结构

```text
extension/
  manifest.json       MV3 权限与侧边栏配置
  background.js       工具栏图标打开侧边栏
  collector.js        每个框架隔离世界内的检测、缓存和像素读取
  api.js              扫描聚合、扩展请求、转换和下载
  lib.js              筛选、文件类型和安全文件名
  panel.html/css/js   原生侧边栏与独立标签页界面
scripts/              校验与打包
tests/                单元测试和真实浏览器集成测试
```

MIT License。Imageye 名称、标识和专有代码不包含在本项目中。
