# 验证记录

2026-10-22，Issue #15 的类型迁移已完成验收。按用户要求先快进合并默认分支至e01840b；原基线暴露的三处问题按另行批准方案fix-baseline-regressions修复，七项必要测试修正有独立完整清单与明确批准。修复及相关高亮change已单独验收归档，提交70b7936先合入当前分支，本迁移相对该提交不再修改测试。

## 实施

全部49个扩展JavaScript模块一对一迁入src，增加models.ts、guards.ts和environment.d.ts，共52个类型源文件。固定TypeScript5.9.3和Chrome类型0.3.6为开发依赖，严格检查并以ES2022生成原extension路径，运行时依赖为零。第三方声明由锁文件安装，未手工修改，排除于项目源码禁用语法检查。

构建使用编译器语法树检查显式any、类型断言、非空/确定赋值断言和抑制注释；注入脚本保持普通脚本，无模块闭包。检查、测试、打包均依赖本次成功构建。生成JS不再跟踪，静态资源保留。CI先npm ci；README、开发文档和OpenSpec上下文已同步。

## 回归结果

| 入口 | 结果 |
| --- | --- |
| npm run typecheck / npm run check | 52个源文件严格检查、语法安全门禁与资源检查通过 |
| npm test | 102通过，0失败，0跳过 |
| browser_test.py | 完整通过，含图库选择、设置立即重载、下载、重试、目录和侧栏 |
| manifest_browser_test.py | 10项通过 |
| remote_rules_browser_test.py | 12项通过 |
| settings_sync_browser_test.py | 13项通过 |
| extraction_browser_test.py | EB01–EB15全部通过 |
| source_highlights_browser_test.py | HB01–HB12全部通过 |
| language_test.py / theme_test.py | 七语言、主题、实时同步与布局通过 |
| debugger_test.py / automatic_badge_test.py | 完整通过，原始动图、生命周期和请求计数保持 |

全部10份脚本使用原完整执行入口。基线修复后的7项测试文件内容与已批准修复提交一致；其他测试、超时、断言及夹具不变。类型源码在整合前后逐文件与已验收快照字节比较一致，生成文件的暂存冲突通过从该源码重新构建消除，没有保留双份维护实现。

## 干净安装和失败验证

临时干净副本移除全部旧JS后，npm ci、typecheck、build、check、test及package全部通过。发布包根目录包含Manifest，共77个运行资源，不含TypeScript、声明、源码映射、依赖目录或测试。

临时操作验证通过：删除源模块后清理旧输出且静态素材字节不变；保留旧JS/ZIP时类型错误仍阻止类型检查、构建、检查和打包；显式any、类型断言、非空断言及抑制注释被拒绝；缺失panel.css同时阻止检查和打包。操作仅在临时副本进行，不增加或修改测试用例。

## 环境和审计

Linux、Playwright1.64.0、Chromium151.0.7922.34，临时浏览器配置与本地HTTP夹具。四个原脚本硬编码macOS路径，通过环境符号链接运行同一Linux浏览器，不代表macOS实机验证。Chrome116兼容性按ES2022输出及现有API/Manifest约定核对，没有声称在116实机运行。

Manifest、HTML入口、权限、版本及存储格式保持不变。README本地链接与构建命令核对通过；External-Skill: exempt，无消费方Skill或分发变化；README-Glossary: verified，增强模式沿用主规格，未新增项目私域术语。仓库未启用Changesets。相关基线修复与高亮已独立归档，无排除的未完成相关change或无关用户改动。

## 归档后提交门禁

11份主规格严格校验通过；102个Node测试与完整主浏览器脚本再次通过，页面错误为空。最终ZIP解压后后台、采集、图库和设置入口通过，77个资源CRC及Manifest一致性通过。暂存内容仅包含迁移源码、构建/检查/打包/CI、文档、构建主规格与本change归档；相对修复基线测试diff为空，无生成JS被跟踪。全部相关change已归档，没有无关活跃change或排除项。
