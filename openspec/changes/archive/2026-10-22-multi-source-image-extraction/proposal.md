# Proposal

## Why

任务 `01a15ec6-f7c5-7bf2-ab4c-aa760a9c337e`「调研 Chrome 图片读取替代方案」确认采用多种方式协作提取图片，并把 Chrome 开发者工具协议（Chrome DevTools Protocol, CDP）读取改为按网站手动开启，避免日常扫描反复出现调试提示。当前实现默认使用调试读取，尚无网页归档或来源请求头回退。

## What Changes

- 统一完整原图任务：已有完整数据 → 多用途互联网邮件扩展网页归档（MIME HTML, MHTML）→ 普通 Fetch → 网页来源 Referer → 图片来源 Referer → 已启用时的 CDP。首个有效结果复用到预览、转换和下载，不继续无用请求。
- 后台串行管理同一图片地址的三种请求，精确限制临时请求头规则，结束及恢复时清理。来源使用包含协议及端口的源（Origin），不改写签名查询参数。
- 整页归档共享、合并动态资源完成事件，核对文档与图片加载状态，拒绝截断或无法可靠归属的部件；原文件与静态像素预览分离。
- 新增项目私域能力“增强模式（Enhanced Mode）”：按源网页主机名（Hostname）隔离、本机保存、默认关闭，不经配置同步或远程规则启用；后台附加前重新校验授权。
- 图库列表末尾始终提供设置跳转；开启后显示网站状态、顶部图标文字标记和直接关闭按钮。设置解释用途与 Chrome 调试提示，开启增量发现并重试未解决项，关闭取消本扩展的调试任务并丢弃迟到结果。
- CDP 可补充浏览器资源候选，仍遵守采集范围、筛选和忽略；被动徽标不触发原图提取。保留七种语言、明暗主题及窄屏访问。

## Capabilities

### New Capabilities

无；提取属于既有 image-data，增强模式开关属于既有 user-preferences。

### Modified Capabilities

- `image-data`：替换默认调试优先策略，增加多路径共享、Referer 隔离及归档完整性要求。
- `image-discovery`：动态增量发现及授权后的浏览器资源补充。
- `image-library`：增强模式提示、状态与直接关闭。
- `user-preferences`：网站本机授权、上下文设置跳转和项目私域术语定义。
- `extension-platform`：归档与请求头权限、有界资源和后台安全边界。

## Impact

预计涉及 `extension/api.js`、`collector.js`、`browser-resources.js`、`debugger-reader.js`、`background.js`、`badge-observer.js`、图库与设置 HTML/CSS/JS、七语言目录及新增提取/归档/网站授权模块；Manifest 新增 `pageCapture`、`declarativeNetRequestWithHostAccess`，保留安装声明的 debugger 权限。同步编解码器维持允许表，新增本机键不在既有网站键前缀下。同步 README、开发说明、配置同步排除项、主规格术语表及测试/CI。无运行时依赖；仓库未启用 Changesets。

完整实施设计见 [design.md](design.md)，测试逐项审批见 [test-review.md](test-review.md)，实施任务见 [tasks.md](tasks.md)。Proposal阶段只规划；两次审批及实施结果分别见approval.md和verification.md。

## Audit

- OpenSpec: required。读取顺序、默认调试行为、权限、配置及用户操作发生变化；change 为 `multi-source-image-extraction`。目标业务路径如 Impact 所列，本阶段仅在本 change 中写规划产物，不修改主规格。
- 初始工作区干净，HEAD 为 `5406e52`、分离 HEAD，默认 `origin/main`，分叉基线 `3c7bdc4`；首次活动清单为空，无继承或本地活跃 change。通过 CLI 创建本 change，未手工绕过单例门禁。
- 阅读与历史审计、发现的规格冲突及待决方向见 design；原任务最后一轮仅讨论，无当前产物审批，不能直接进入 Apply。
- External-Skill: exempt。检索 `skills/*/SKILL.md`、README、Manifest、`scripts/package.py` 和 CI：无对外 Skill 或分发要求；`.agents/skills/` 仅为内部 OpenSpec 流程，未见消费方内容误置。功能向扩展用户提供，通过文档同步，不凭空创建对外 Skill。
- README-Glossary: required。检索十份主规格术语表、相关历史与 README，既有私域术语集合为空；本次“增强模式 / Enhanced Mode / —”特指当前设备按源网站授权的 CDP 发现及读取能力，区别于泛指任意增强功能。将定义加入 user-preferences 主规格与 README，其他提取、归档、来源和协议名均为行业通义，不收录。


## 测试修订状态

2026-10-22原提案与46项清单已获批准。实施时核对出调试专项的零HTTP断言需要额外Fetch失败前置条件，详见design及test-review的完整修订版；测试总数和业务方案不变。本修订随后已获用户明确批准，详见approval.md；实现与测试按获批版本执行。
