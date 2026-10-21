# 测试修改审批清单

本次需要新增或修改测试用例共 **11 项：8 项单元用例新增、1 项浏览器用例新增、2 项既有浏览器用例修改**。本清单已于 2026-10-21 获用户逐项范围的明确批准，原话见 approval.md；实施限定在本清单。

## 只读盘点范围与依据

检索全部 `tests/`、`scripts/`、`.github/workflows/`、`package.json`，按 `loadThresholds`、`saveThresholds`、`THRESHOLD_KEYS`、`filters:*`、`min-width`、`min-height`、`min-size`、设置及徽标标识定位。读取现有单元测试、`browser_test.py` 的阈值 / 设置 / 搜索 / 网站规则 / 重试相关段落，自动徽标脚本与语言、主题专项脚本，核对相关源码调用和新 delta 的所有场景。

CI 入口是 `.github/workflows/test.yml`，执行 npm check / test、`tests/browser_test.py` 与打包；调试、自动徽标、语言、主题另有浏览器入口。未发现契约测试目录、容器验收、黄金快照断言或测试用例生成器；现有截图为输出产物，不更新图片快照预期。所有仓库内入口可检查，无无法检查的测试范围。下列用例为独立用例，不采用需区分不同原因的参数化身份。

## 逐项确认

| 测试文件 | 完整用例名称 / 稳定标识 | 变更类型 | 变更前行为 | 变更后行为 | 具体原因与证据 |
| --- | --- | --- | --- | --- | --- |
| `tests/preferences.test.js` | `unconfigured sites use factory threshold defaults` | 新增 | 没有网站阈值解析用例 | 无全局和网站配置时返回 50 / 50 / 2048，不把读取写成网站配置 | 筛选“默认阈值与普通筛选”：无配置默认值及纯读取边界 |
| `tests/preferences.test.js` | `threshold overrides are isolated by top-level hostname` | 新增 | 仅元数据层验证 hostname 提取，未覆盖阈值存储隔离 | 同 hostname 跨协议 / 端口 / 路径复用，不同子域名和其他网站隔离；无有效域名不能写空网站配置 | 筛选“不同网站独立且同主机名复用”“没有网站上下文或存储不可用” |
| `tests/preferences.test.js` | `partial site overrides preserve explicit zero and inherit other fields` | 新增 | 无继承 / 显式零的持久化用例 | 只保存网站宽度 0 时高度仍继承全局、体积仍为 2048；保存高度或体积不覆盖宽度 | 筛选“未配置字段继承全局默认”，防止误把 0 当缺失 |
| `tests/preferences.test.js` | `concurrent threshold writes preserve separate fields and sites` | 新增 | 没有阈值多字段并发覆盖检测 | 同网站不同字段和不同网站同时保存均保留，不写整个共享对象造成丢失 | 按字段保存方案与多面板同步契约 |
| `tests/preferences.test.js` | `global dimensions affect only inherited site fields` | 新增 | 没有全局默认与网站优先级用例 | 修改全局默认只影响未覆盖字段，网站显式值含 0 保持；体积不随全局宽高改变 | 筛选“全局默认变更只影响继承字段” |
| `tests/preferences.test.js` | `clearing site thresholds stores zeros and reset restores inheritance` | 新增 | 清除 / 恢复只在旧浏览器全局路径间接覆盖 | 清除写当前网站三项 0，恢复删除当前网站覆盖并重新继承；其他网站及全局值不变，搜索 / 规则 / 忽略键保留 | 筛选“区分网站规则和普通筛选清除”完整约束 |
| `tests/preferences.test.js` | `legacy global dimensions survive while legacy size is not inherited` | 新增 | 全局三键一起读取，无升级兼容用例 | 旧宽高 320 / 180 沿用作默认，旧体积 8192 不进入新网站，网站采用 2048；不破坏旧键 | 筛选“已保存全局筛选的用户升级” |
| `tests/preferences.test.js` | `threshold storage failures propagate without persisting fallback values` | 新增 | 没有阈值存储错误的定向用例 | 读取 / 写入拒绝对调用方可见，读取失败不再写出厂值，不伪造保存成功 | 筛选“阈值保存与读取失败可见” |
| `tests/browser_test.py` | `main / threshold persistence block`（当前约 826—842 行） | 修改 | 填 321 / 123 / 2.5 后断言三项写全局键，重开恢复，恢复固定 50 | 断言三项写当前源网站键，重开恢复，另网站不受影响；保留初始 50 / 50 / 2 与边界、未知和后续全部原断言；恢复验证继承当前全局值 | 原断言与新域名隔离持久化契约直接冲突，须改存储归属而非放宽行为验证 |
| `tests/browser_test.py` | `test_site_threshold_settings` | 新增 | 现有设置用例只覆盖标题清洗、成功优先及布局 | 覆盖设置页全局宽高、200 / 100 持久化、两域继承 / 覆盖、跨视图同步、清除 / 恢复、导航输入归属、无效输入及写入失败反馈，检查窄屏与原预览 / 选择保留 | 三份 delta 的用户路径；单元存储替身不能替代真实扩展 UI / storage 事件验收 |
| `tests/automatic_badge_test.py` | `module / configured threshold badge checks`（当前约 99—103 行） | 修改 | 修改全局 `filters:width` 检查当前徽标 0 / 3 | 保留全局默认更新覆盖，再增加网站覆盖与另一主机名计数隔离，验证配置变化复用已有页面快照及无额外图片请求；其余展开稳定 / 导航断言保持 | 徽标“未展开时使用各网站阈值”“网站覆盖和全局默认先后变化”；仅改图库不能满足后台计数 |

**以上为本次需要修改的完整测试用例清单。** 没有尚无法检查的仓库测试范围。若实施期间发现遗漏、用例身份或预期需变更，须停止该部分并重新提交包含全部条目的完整修订清单。

## 保持原样的回归范围

- `metadata.test.js` 的出厂边界、零值、hostname 提取仍有效；不改默认常量来迁就网站配置。
- `i18n.test.js` 已校验七种目录键与占位符完整性；新增翻译运行原用例，不修改其断言。
- `language_test.py`、`theme_test.py` 已验证所有语言切换和 320 px 布局；新控件进入原回归范围，不改变已有预期。
- `badge.test.js` 只负责徽标格式，不改用例；新解析路径由上述定向单元 / 浏览器场景覆盖。
- `browser_test.py` 其他预览重试、网站规则、搜索、设置、下载及选区函数保持原样；新增用例自行恢复全局与网站键，避免影响后续既有场景。
- `debugger_test.py` 不涉及新配置路径，保持原样。新增测试不得删除、跳过或放宽现有断言。
