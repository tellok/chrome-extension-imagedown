# 验证记录

## 实施与审批一致性

- 用户明确批准当前提案和全部20项测试新增，并再次要求默认关闭，见 approval.md。
- 新增 manifest.test.js 8项、settings.test.js 2项、manifest_browser_test.py 10项；逐个稳定名称与 test-review.md 的20行完全一致。原标题清洗测试正文原样保留，其他既有测试文件无修改，未放宽断言或超时。
- 使用默认关闭的 `settings:download-manifest`，仅布尔 true 开启；七种语言和两类目录保存均按原有机制实现，不增加 Manifest 权限或运行时依赖。

## 实际执行

| 检查 | 结果 |
| --- | --- |
| npm run check | Manifest 资源与 JavaScript 语法通过 |
| npm test | 47项通过，0失败、0跳过；包含10项新增单测 |
| tests/manifest_browser_test.py | 全部10项通过；额外用 CHROMIUM_PATH 指定 Chrome for Testing 路径运行亦通过 |
| tests/browser_test.py | 既有完整浏览器回归通过，页面脚本错误为空 |
| tests/language_test.py | 七语言、自动检测、即时切换、持久化、状态和布局通过 |
| tests/theme_test.py | 系统/浅色/深色、跨视图同步、状态与布局通过 |
| npm run package | dist/imagetaken-0.4.3.zip 生成成功，新增模块随 extension 打包 |
| openspec validate add-download-text-manifest --strict --no-interactive | 通过 |
| git diff --check | 通过 |

浏览器验证使用临时配置、本地 HTTP 服务、浏览器真实默认下载文件和 OPFS 沙盒句柄。已验证默认关闭无文本、真实文件名映射、转换、去重复用、随机后缀、全部失败、独立清单失败、目录拒绝、iframe/资源/SVG/Blob 元数据、批次快照与重复批次清单保留。320px 新设置分类截图经查看无溢出，默认关闭状态清晰。

测试编写中发现并修正了新夹具的 Chrome StorageArea 方法绑定、故意失败后即时回滚导致的 Playwright check 调用方式，以及懒加载图片未进入可见范围的等待；未改变任何批准用例的预期或旧测试。

## 文档与范围审计

README 仅增加清单开关简要用法，docs/development.md 增加专项命令与字段、输出、失败边界，CI 新增专项执行步骤，原步骤保持。External-Skill: exempt，未新增消费方 Skill；README-Glossary: verified，文本清单使用通义，没有新增私域术语。相关三份 delta 仅添加5项新 Requirement，既有要求不变。唯一活动变更为本 change，没有排除的无关改动。

## 验证边界

真实系统目录选择器与权限弹窗未做人工点击验证；自动化以真实文件句柄验证业务写入，以受控替身触发拒绝场景。默认目录去重继续依赖本扩展摘要和浏览器记录，未声称能核验外部任意磁盘修改。未改动 Superdesign，未向远程仓库推送。

## 归档后与提交门禁

- 11/11任务完成；同步5项新增要求到三份主规格，逐块核对与 delta 一致，原 Purpose 和所有旧 Requirement/Scenario 保留。相关下载/采集主规格补齐空私域术语表，README 仍明确无私域术语；没有扩大为行业词典。
- `openspec validate --specs --strict --no-interactive`：8份主规格通过；`openspec validate --archived --strict --no-interactive`：5份归档通过。
- 归档后重新执行基础语法检查、47项单元测试、10项清单浏览器专项、既有完整 browser/language/theme 专项，全部通过，页面脚本错误为空。
- 新归档 Markdown 本地链接有效，打包 ZIP 含 download-manifest.js，不含测试/规格；可执行文件和文档中的专项入口已实际运行。
- 审阅暂存区26个文件：运行时代码与七语言对应本 change 的采集、清单、设置要求；README/开发说明对应新开关和验证入口；CI 仅新增专项执行步骤，原 CI 步骤不变；三份主规格与本次归档及20项获批新增测试共同交付。无其他 staged/unstaged 内容，无无关 change。
- 按真实 diff 判定 OpenSpec: required，批准、实施、测试、定向严格验证、同步和归档证据齐全；未启用 Changesets，不修改权限、依赖、版本或运行环境默认值。提交使用中文 Conventional Commit，页脚为 OpenSpec-Change: add-download-text-manifest。
