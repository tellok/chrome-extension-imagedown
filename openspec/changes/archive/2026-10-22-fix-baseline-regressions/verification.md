# 实施与验证记录

2026-10-22，按用户批准的修复方案及完整7项测试清单完成实施。全部102个Node测试、10份完整浏览器脚本通过，未跳过用例。类型迁移在原工作区另行验收，本记录不代替迁移结果。

## 根因与实现

- 设置页持有异步配置锁的写入可能被重载取消；共享布尔开关改由后台校验设置页来源、配置键和值，在既有锁中完成写入。原立即重载断言通过，保存失败仍恢复开关并反馈。
- 请求追踪确认额外普通请求来自图库直接URL预览。无本地数据的HTTP预览改用共享完整读取任务，保留可见性/显式eager加载，预览与下载复用原文件，静态像素不冒充原图。
- 原页快照等待使图库进入后台，动画帧暂停导致空选择未发出。选择通知改微任务，正常去框仍按一秒断言，续期与异常清理不变。
- 外部结构规则原走refresh清空选择；改用既有syncEffective保留有效选择并重绑origins。HB10覆盖旧包拒绝、导航与关闭释放。

## 验证结果

| 入口 | 结果 |
| --- | --- |
| npm run check / npm test | 通过；102通过，0失败，0跳过 |
| browser_test.py | 完整通过；含立即重载、拖动中筛选、预览重试和下载 |
| manifest_browser_test.py | 10项通过 |
| remote_rules_browser_test.py | 12项通过 |
| settings_sync_browser_test.py | 13项通过 |
| extraction_browser_test.py | EB01–EB15全部通过 |
| source_highlights_browser_test.py | HB01–HB12全部通过 |
| language_test.py / theme_test.py | 七语言、主题与状态保留全部通过 |
| debugger_test.py / automatic_badge_test.py | 完整通过，原始动图与零额外徽标请求保持 |
| npm run package / 解压入口 | 通过；临时配置实际启动后台、采集、图库、设置，无页面错误 |
| 两份相关change严格校验 / 主规格严格校验 | 通过；主规格10项通过 |

HB01/HB06/HB08截图已目视核对：顶层重复图片与开放子树红框、跨域同图红框、滚动位置正确，网站蓝边框与焦点轮廓保留。高亮脚本检查页面/后台错误为空，未产生额外图片请求或持续扫描。

测试diff经Python语法树逐函数核对，仅含获批的清单保存、EB02/EB03/EB04、HB03/HB05/HB06七项。完整变更前后与批准见test-review.md、approval.md；不改超时、跳过项或功能断言。EB02/EB03此前偶尔通过而完整复验暴露计数窗口竞争，批准后提前到建立会话之前计数，仍严格验证一次普通请求及各来源回退。

## 运行环境与边界

Linux、Playwright1.64.0、Pillow13.0.0、获准Chromium151.0.7922.34；使用临时配置及本地HTTP夹具。四个硬编码macOS路径脚本通过环境符号链接指向同一Linux原生浏览器，不代表macOS实机验证。权限、版本、存储键未变。无Changesets机制；External-Skill: exempt；README-Glossary: verified，增强模式映射保持，无新增私域术语。开发文档同步保存、预览和高亮生命周期。

## 迁移与提交范围

修复对应settings/settings-page/background、previews/panel、selection-highlights/panel，同名src/*.ts已按严格类型映射并通过52个源文件检查和102个Node测试。当前修复提交只包含JavaScript基线修复、七项批准测试、文档及本change和继承高亮change的同步归档；没有无关change。原迁移仍在独立工作区完成全量验收，不重新跟踪生成JS。

归档后复验：主规格严格校验10项通过，102个Node测试及完整HB01–HB12再次通过。暂存diff与批准清单、主规格、文档逐项核对通过，未纳入权限、版本、无关change或生成文件。
