# 实施验证记录

## 范围与审批

用户于 2026-10-21 明确批准当前提案与全部 11 项测试修改，原话见 approval.md。实际测试 diff 为 test-review.md 的 8 项新增单元测试、1 项新增浏览器用例、2 项既有浏览器块修改。未删除、跳过或放宽既有用例；未修改语言、主题、调试或其他单元测试。新用例编写过程修正了脚本注入返回值及非目标网站图标干扰，最终断言符合已批准的零阈值与目标图片语义。

本次唯一相关 change 为 site-specific-image-thresholds，无无关活跃 change 或排除文件。AGENTS.md 为用户指定来源的原文，252 行 / 27307 字节；协作文件引入不改变产品行为，其余行为修改均由本 change 覆盖。未启用 Changesets，未增加消费方技能或权限、依赖。

## 归档前执行

- npm run check：Manifest 资源引用和 JavaScript 语法通过。
- npm test：36 项单元测试通过，包含 8 项新增阈值测试。
- uv run --with playwright --with pillow python tests/browser_test.py：完整综合测试通过；网站默认 / 覆盖 / 重置 / 切换来源 / 持久化 / 输入校验 / 保存失败通过，pageErrors 为空。
- 同方式执行 tests/automatic_badge_test.py：未展开时的网站阈值和全局默认计数、跨网站隔离、展开稳定、无额外图片请求通过。
- 同方式执行 tests/language_test.py 与 tests/theme_test.py：七语言、实时切换、自动识别、持久化、系统与手动主题、320 px 布局和工作状态保留通过。
- 新增网站设置用例另外在全新临时配置独立执行通过。
- openspec validate site-specific-image-thresholds --strict --no-interactive：通过。
- 三份主规格合并比对：修改及新增要求与 delta 一致，未涉及的要求、已有场景和 Purpose 保留，未保留 delta 操作标题；已补齐空私域术语表并与 README 核对。
- openspec validate --all --strict --no-interactive：8 份主规格和当前 change 通过。
- npm run package：扩展 ZIP 生成成功。

## 边界

真实浏览器采用独立临时配置及本地 HTTP 服务。新增保存失败验证仅在设置页面替换存储写入以注入错误，不能代表真实磁盘故障。现有目录测试替代系统选择器使用实际文件系统句柄；本次未人工操作系统目录选择和权限提示。调试专项未单独重跑，图片读取未修改且综合测试已覆盖。截图输出在 git 忽略的 test-results/，未将个人浏览器配置或下载文件提交。

## 文档与术语

README 已说明网站保存、全局继承及旧全局体积兼容；开发文档记录键与回退边界。README-Glossary: verified，三个相关主规格与 README 的私域术语集合均为空，无行业通用词条混入。External-Skill: exempt，项目没有消费方技能，内部 OpenSpec 技能保持不变。

## 归档后与提交门禁

- 主规格严格校验：8 项通过；归档严格校验：2 项通过，当前变更任务 12 / 12 完成；活动 change 清单为空。
- 再次执行 npm run check、npm test：通过，36 项单元测试全绿。
- 再次执行综合浏览器、自动徽标、语言及主题四个入口：全部通过，综合浏览器 pageErrors 为空。
- 再次逐项比较三份归档 delta 与主规格；9 个新增 / 修改要求一致，其余要求和 Purpose 保留。README 与相关主规格私域术语均为空，链接有效。
- ZIP 根目录包含 Manifest，未包含 AGENTS、内部技能或 OpenSpec 文件；git diff --cached --check 通过。
- 暂存区仅包括本次 AGENTS 引入、网站阈值解析、图库同步、设置 / 翻译、11 项确认测试、三份主规格及本次归档 / 文档。没有无关 change 或需要排除的改动。
- 行为路径映射：preferences / metadata / panel 对应 image-filtering 的网站阈值、默认继承、兼容及清除要求；settings 页面和翻译对应 user-preferences 的三项新增要求；automatic-badge 对应徽标阈值解析与配置更新要求。AGENTS 引入为用户指定协作原文，不修改产品行为。相关实现已通过批准、Apply、测试及归档门禁。
- 提交信息使用中文 Conventional Commit，并以 OpenSpec-Change: site-specific-image-thresholds 标识本次归档。用户未请求推送，不自动推送。
