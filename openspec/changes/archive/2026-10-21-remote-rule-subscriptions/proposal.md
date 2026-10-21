# Proposal

## Why

[Issue #10](https://github.com/tellok/chrome-extension-imagetoken/issues/10) 要求通过远程规则文件独立维护不同域名、页面路径的图片采集和筛选配置，并支持订阅管理、缓存及刷新。用户还要求创建演示 GitHub Gist，已明确选择“本地配置优先，远程补充未配置项”和“仅配置到本机已加载的扩展”。

## What Changes

- 设置页新增“远程规则订阅”，支持多个 HTTP(S) JSON 文件的添加、删除、单项刷新、全部刷新和状态展示；新安装订阅列表为空，不内置演示订阅。
- 从 `<hostname>.json` 文件名确定精确目标域名，每个文件内按正则表达式（Regular Expression）匹配完整源页面 URL；同域多订阅按添加顺序、文件内按规则顺序取第一个匹配项。
- 为宽高、体积、XPath、CSS 排除、搜索、格式、发现来源及加载/忽略显示选项提供远程默认值。本地显式配置（包括 0、false、空字符串）优先，未配置字段依次使用远程值和现有默认值，不将远程值写成用户覆盖。
- 每6小时检查更新，启动恢复到期任务；刷新失败保留最后有效缓存。图库与自动徽标共用解析结果，并显示远程来源、默认继承与还原含义。
- 新增 `alarms` 与 `offscreen` 权限；后台定时刷新，离屏文档（Offscreen Document）承载本地工作线程（Web Worker）执行有时限的正则匹配，不下载或执行远程脚本，不上传当前页面 URL。
- 按 [演示文件](demo/) 创建一个不公开列出的 Gist，读取其真实 raw URL 并验证；不放进扩展默认配置。自动配置本机已被浏览器安全策略拒绝，交付可复制订阅地址与步骤，由用户在扩展设置中添加。

## Capabilities

### New Capabilities

- `remote-rule-subscriptions`: 域名文件格式、URL 匹配、订阅生命周期、缓存、定时/手动刷新、来源及错误展示。

### Modified Capabilities

- `image-filtering`: 本地/远程/全局继承、清除/还原语义、实际来源呈现。
- `automatic-badge`: 未展开图库时也使用相同远程匹配结果，订阅更新后同步计数。
- `user-preferences`: 全局默认最低宽高作为没有本地及远程对应值时的回退。
- `extension-platform`: 新权限用途及远程数据下载边界。

## Impact

预计涉及 Manifest、后台、新订阅与解析模块、离屏文档/线程、preferences、panel、automatic-badge、设置 HTML/CSS/JS 和七语言；补充规则格式文档、README 使用入口及 CI 专项。无新增运行时依赖，无网站配置迁移，不修改原图保存或清单默认关闭行为。完整方案见 [design.md](design.md)，实施步骤见 [tasks.md](tasks.md)，拟新增32项测试见 [test-review.md](test-review.md)；本轮仅规划，未改产品实现、现有测试或创建远程 Gist。

## Audit

- OpenSpec: required。新增配置格式、远程访问、权限、后台调度和规则继承，当前 change 为 remote-rule-subscriptions。
- 初始 `main` / `origin/main`、工作区干净、活动列表为空；本 change 是唯一新建活动变更，无无关 change。
- External-Skill: exempt。已检索消费方 `skills/`、内部 `.agents/skills/`、README、Manifest、打包脚本；没有已发布消费方 Skill、分发机制或新 Skill 的规范要求。新增的配置格式面向规则维护者，以独立格式文档和 Gist 示例说明；内部 OpenSpec 技能不作为消费方接口。
- README-Glossary: verified。核对筛选、徽标、偏好、平台主规格及相关归档和 README；订阅、缓存、优先级、规则继承均使用通义，没有新增项目私域概念或映射，保留空术语表。
- 本机自动配置限制：浏览器工具拒绝 `chrome://extensions/`，并明确禁止替代浏览器表面、原始调试协议或读取修改用户配置文件等绕过。此次只为产品验证使用临时测试配置，不把它声称成用户本机已配置；最终由用户手动添加 Gist 订阅。
