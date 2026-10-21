# Design

## Context

动机与范围见 [proposal.md](proposal.md)。当前扩展使用原生 JavaScript 模块、零运行时依赖，最低 Chrome 116。后台自动徽标（Automatic Badge）和图库分别读取本机偏好，还没有远程规则源、定时刷新或离屏文档（Offscreen Document）。

已读实现：`extension/preferences.js` 的网站阈值、XPath、CSS、搜索与全局视图设置；`panel.js` 的刷新、筛选、输入草稿、下载忙碌状态及存储监听；`automatic-badge.js` 的后台页面快照与计数；`settings-page.js`、设置HTML/CSS、`background.js`、Manifest与七语言目录。既有 `loadThresholdState(domain)` 返回 values/defaults/overrides，宽高还原按钮在边框内部，不能破坏等宽布局。普通视图设置以一个全局对象保存，搜索空值原先删除键。

### 阅读证据与历史约束

按能力、配置键（filters:site、filters:view、xpath、excluded-selectors、image-query）、刷新/存储符号和预计修改路径检索主规格、归档与Git历史：

- `image-filtering`、`automatic-badge`、`user-preferences`、`extension-platform`：完整读取；本change以delta显式扩展继承、权限与生效条件，不直接修改主规格。
- `2026-10-21-document-existing-extension` 对应 `a7ce2fb`：相关proposal/design/specs/tasks建立既有行为基线；保持本机处理、原图与缩略图边界和徽标统一。
- `2026-10-21-site-specific-image-thresholds` 对应 `1d4b551`：相关proposal/design/specs/tasks确定字段独立、显式0和顶层hostname隔离；远程补充不能迁移或固化网站覆盖。
- `2026-10-21-gallery-threshold-reset-controls` 对应 `ea3a56f`：相关proposal/design/specs/tasks确定空输入为继承、单字段还原及数字校验。
- `fb1f4ef` 的等宽修复要求宽高、体积、格式边框对齐；新增来源说明必须保持此约束。
- `2026-10-21-add-download-text-manifest` / `adfa675`：清单默认关闭、下载批次固定来源与偏好。远程规则不控制清单，也不改变正在下载的批次。

测试盘点覆盖12个JS单元文件、6个Python浏览器脚本、`tests/requirements.txt`、`scripts/check.mjs`、打包脚本、CI工作流与现有夹具；详细影响及32项待审批新增见 [test-review.md](test-review.md)。

## Goals / Non-Goals

**Goals:** 在现有配置上增加可缓存、可解释的页面规则层；图库与未展开时的徽标共用相同解析逻辑；后台任务有界且不丢失本地覆盖。

**Non-Goals:** 不导入网站登录凭据，不上传当前页面地址，不执行远程脚本，不改变图片读取/下载机制、排序、主题或其他产品设置，不引入运行时依赖。演示订阅不写进出厂默认，也不通过用户Chrome配置文件或替代浏览器操作绕过已发生的安全拒绝。

## Decisions

### 1. 文件格式与来源识别

采用版本化JSON（JavaScript Object Notation）文档；顶层只允许 version、rules。每条只允许 id（可选，非空字符串且最多80字符）、pattern（必填，非空且最多256字符）、flags（可选，默认空）、options（必填对象，可为空）。id仅作来源说明，同文件非空id不能重复；未提供时以规则序号标识。

```json
{
  "version": 1,
  "rules": [
    {
      "id": "repository",
      "pattern": "^https?://github\\.com/tellok/chrome-extension-imagetoken(?:[/?#]|$)",
      "options": { "width": 80, "height": 80, "xpath": "//main", "excludedSelectors": ".avatar, .avatar-user" }
    }
  ]
}
```

文件名取原输入URL最后路径段，百分号解码后移除.json，交由URL主机名规范化（小写、国际化域名ASCII形式），拒绝路径分隔、端口、空主机、非主机名片段；域名匹配是精确的顶层源页面hostname，支持子域隔离。地址本身只接受HTTP(S)、不含用户名密码；去片段后作为唯一订阅键，保留查询参数。重定向不改变规则归属；Gist页面不是原始JSON源，需使用raw文件地址。

选择按文件名归属，符合Issue；不增加文档内第二个域名字段，避免互相矛盾。每个文件最多100条规则，空列表合法（可用于撤销远程规则）。先校验整份文件，任何未知字段、非法类型、正则或选择器均拒绝整次更新。

字段约束：width/height为0至100000整数；minBytes为有限非负数，单位字节；xpath/excludedSelectors为最多4096字符的字符串；query最多512字符；type允许空字符串、jpg/png/webp/gif/svg/avif/bmp/ico/unknown；source允许空字符串、img/css/pseudo/canvas/svg/lazy/srcset/resource/poster/link；loaded/showIgnored必须为布尔值。宽高0、false、空字符串均为合法值。忽略摘要、下载路径/格式、语言/主题、清单、成功优先与脚本等都不在允许表内。XPath须能返回节点集合，CSS按现有多行/逗号规则验证，不在当前网站执行远程脚本。

### 2. 稳定优先级与本地存在性

用户已明确选择本地优先。先按订阅添加顺序找到首个同域且存在命中的文件，文件内使用首条匹配完整URL的规则；后续匹配不参与合并。该规则提供缺省项，再逐字段叠加有效的本地配置，最后回退既有默认。

| 配置 | 优先级与存在性 |
| --- | --- |
| 宽、高、体积 | 网站有效覆盖 → 当前匹配远程字段 → 全局宽高 / 2048字节 |
| XPath、CSS、搜索 | 本地字符串键存在（含空） → 远程字段 → 空字符串 |
| 格式、来源、loaded、showIgnored | 既有有效全局视图对象中的显式字段 → 远程字段 → 原默认 |
| 忽略规则及非匹配设置 | 始终沿用本地既有配置，不接受远程控制 |

有效本地视图对象按现有 `normalizeViewFilters` 接受；用户操作任一视图筛选会按原方式保存完整对象，该对象的空值和false均代表本地选择。无效存储内容不伪装成有效显式选择，仍遵循既有容错及错误反馈。比较是否配置必须看键/字段存在性，不看真值或是否等于默认。

保留现有本地读取API用于无订阅场景及兼容调用，新增共享的“按完整源页面URL获取有效配置”入口。纯解析模块负责合并及来源；后台协调缓存与有时限的匹配，面板通过消息调用，后台徽标直接调用同一协调器，避免后台向自身请求。不得只传hostname，因为远程按页面路径匹配。

本地清空XPath/CSS本来会保存空字符串，继续保留；搜索在有效远程query存在时清空须保存显式空字符串，否则保留原来的删除键语义。清除普通筛选保存三项0及本地视图清空选择，不删除远程订阅。还原阈值删除对应本地字段后采用远程默认，否则回退全局/出厂；新文案明确这一点。

不提供“一键删除所有本地覆盖”的新流程，避免扩大范围。规则编辑区展示有效XPath/CSS，用户应用才保存本地覆盖，读取与显示不保存。远程刷新保留未保存草稿，避免静默覆盖编辑。

### 3. 后台缓存与调度

新增订阅协调模块，以 `remote-rules:v1` 保存有序条目、稳定id、URL、域名、有效文档、最近尝试/成功时间及错误。增加语义revision，只在源增删或有效文档内容变化时递增；状态时间更新不触发重新采集。

获取使用 `credentials: 'omit'`、`referrerPolicy: 'no-referrer'` 和10秒中止；流式限制256 KiB，不信任Content-Length。总有效缓存最多4 MiB，最多20项。普通匹配立即读取本地缓存，不能为每次打开页面而下载订阅。

状态写入串行化，网络在锁外执行；同一源刷新合并为一个进行中任务，全量刷新并发2、按项结算。提交时核对条目id、来源URL及请求代次，删除中的响应不得复活条目。写入失败显示错误，既有缓存继续可用；只在完整校验且成功存储后更新最后成功时间。

Manifest增加 `alarms` 权限，使用360分钟周期；Service Worker（服务工作线程）启动检查并恢复调度、刷新到期条目。空列表删除调度且无远程请求。不依赖常驻轮询保持后台。休眠可能延后触发，不承诺准确到秒。使用Chrome116兼容API，不使用新版本专有的调度持久化参数。依据：[Chrome alarms文档](https://developer.chrome.com/docs/extensions/reference/api/alarms)。

### 4. 正则隔离与离屏单例

任意合法JavaScript正则也可能发生灾难性回溯；仅try/catch、Promise.race或长度限制无法终止同线程阻塞。选择本地打包的工作线程（Web Worker）执行编译和匹配，单任务1秒预算，超时终止线程，本页回退本地/全局并暴露错误，不清除有效缓存。允许flags为空、i、u、iu，拒绝g/y及其他标志，避免状态性匹配。

后台缺少DOM且不能直接承载所需Worker/选择器校验，增加 `offscreen` 权限及本地静态HTML/JS，以 `WORKERS` 理由建立离屏文档并承载本地Worker与脱离网页的选择器语法验证。用Chrome116的 `runtime.getContexts` 查询现有文档，创建过程共享Promise，所有调用复用唯一实例；不使用Chrome150才有的hasDocument。脚本和Worker均来自打包资源，遵循现有内容安全策略（Content Security Policy, CSP），无远程import/eval或Blob脚本。依据：[Chrome offscreen文档与单例示例](https://developer.chrome.com/docs/extensions/reference/api/offscreen)。

匹配并发上限2，完成或超时释放任务Worker。以来源语义revision与完整URL缓存匹配结果，避免面板与徽标重复匹配；修改规则失效相关缓存。无订阅不创建离屏文档。文档由浏览器生命周期管理，不添加高频保活。放弃限制为自造的弱正则子集，因为Issue要求正则，线程预算能保留常见表达式同时限制代价。

### 5. 图库与徽标同步

有效配置包含values、localOverrides、逐字段来源和remote source/rule定位。后台徽标和图库使用同一解析入口和URL/revision校验，旧异步结果不能写到新导航文档。后台仍按原页面快照成功状态计数，不改用面板预览进度。

远程普通筛选变化仅重新筛选已有候选，不请求原图、不导出像素、不启动debugger；XPath/CSS变化才重新采集，并在同一源文档内尽量复用同地址已有原图及有效选择，不能跨导航复用旧文档数据。有效选择是否保留沿用已有筛选规则。没有有效规则变化（只有时间/错误状态变化）不触发采集。

下载忙碌期间延后将远程变更应用到图库，下载使用开始时冻结的偏好/来源，不改变本批次文件、目录或清单。结束后应用最新有效revision；原导航待处理机制仍有效。

宽高空输入分别显示“远程默认({0})”或“全局默认({0})”，还原按钮名称/说明跟随有效默认来源，边框内位置及等宽不变。来源说明放在现有网站规则摘要及筛选帮助中，长源地址省略显示、完整内容可查看，不新增大型视觉区。设置沿用Notion中性色细边框、轻量按钮和错误反馈，七语言及320px可用。

### 6. 演示Gist与本机交付

审批后用 [demo](demo/) 下两份合成JSON创建一个不公开列出的GitHub Gist，不上传网页内容、凭据或Chrome数据。一个Gist内的 `github.com.json` 与 `example.com.json` 是两条独立订阅。创建后读取GitHub返回的真实raw_url，移除其版本段以获得跟随更新的raw地址，再实际获取并由产品解析器验证，不虚构地址。

用户明确只配置本机，不内置默认。浏览器安全审查已拒绝 `chrome://extensions/` 并禁止替代表面、原始调试协议、用户配置文件访问等绕过；改用Computer Use完成相同操作仍属绕过。交付实际raw地址与“设置→远程规则订阅→添加”步骤，由用户粘贴。不得声称已替用户配置。浏览器验证只使用临时独立配置，不访问真实用户Chrome资料。

## Risks / Trade-offs

- 新增权限可能导致Chrome要求确认更新 → 文档明确用途，继续支持Chrome116，不增加新主机权限。
- 不公开列出的Gist不是私密存储 → 示例仅合成规则，交付说明不应存放秘密。
- 远程规则可改变采集范围 → 来源可见、本地覆盖优先、移除立即失效、严格允许字段；无新增可执行能力。
- 正则超时或网络失败 → 有界工作线程/中止请求，保留最后有效缓存；页面匹配超时回退并可诊断。
- 本地覆盖会遮蔽远程更新 → UI说明优先级及实际来源，阈值可单字段还原，不自动删除用户配置。
- Chrome休眠与后台卸载 → 恢复调度与到期检查，离线从缓存应用，避免误承诺严格时间。

## Migration Plan

首次升级没有订阅、没有新存储键时完全沿用已有默认与网站设置，不迁移或复制旧值。实现后在临时配置验证新权限、无订阅回归、离线缓存及后台重启；真实Gist仅经批准后创建并验证。回退删除功能模块及新权限，保留旧偏好键，旧版忽略新订阅键即可；本次不改变既有数据格式。

文档新增 `docs/remote-rules.md` 记录格式、优先级、刷新/失败与示例，README仅新增使用入口及远程访问说明，开发文档记录新模块和验证命令。实现完成后同步主规格、归档并按仓库门禁自动提交。

## Audit

- OpenSpec: required；完整新行为由本change五份delta覆盖，当前仅规划，无实现或测试变更。
- External-Skill: exempt；检索 `skills/`、`.agents/skills/`、README、Manifest与打包清单，无已发布消费方Skill或分发要求，内部维护技能目录合规；配置格式由独立文档说明，无需凭空创建Skill。
- README-Glossary: verified；核对相关主规格、历史变更及README，远程订阅、缓存、继承、正则等沿用行业通义，无新增项目私域概念或映射，保留空表并在归档复核。
