用户在审阅当前四份产物后指示：“先合并默认分支上的最新改动再实施”。已按要求快进合并 origin/main 到 e01840b，无冲突。该指示批准合并后继续当前全源码迁移方案；新增模块仍按既定一对一严格编译方案处理，不改变产品行为或测试。合并后共有49个扩展脚本、18个Node测试文件和10个浏览器脚本。继承活跃 change highlight-selected-source-images 不修改、不归档、不混入本次提交。

用户在查看三处基线失败对照后选择：“以规格为准，另行准备这些已有问题的修复方案”。本次不接受基线失败例外，不修改主规格或测试追认现状；迁移保持待验收，不归档、不自动提交。独立修复提案放在 `/workspace/chrome-extension-imagetoken-regression-plan` 工作区、`codex/plan-baseline-regressions` 分支，避免违反活跃规格单例门禁。
