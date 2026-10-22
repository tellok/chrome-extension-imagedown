# 测试修改审批清单

## 只读盘点

需要修改测试总计**5项：4项修改、1项新增**。检索tests全部16个JavaScript单元文件、8个Python浏览器脚本，以及package.json、scripts/check.mjs、scripts/package.py和.github/workflows/test.yml；按sync-status、sync-retry、sync-conflict、sync-candidates、绑定函数、可见状态和文案检索。现有18项同步单元用例只验证后台，不改其期望。目录中无容器验收、快照/Golden基线或其他测试生成入口，浏览器截图为忽略产物，不是Golden。没有无法检查的仓库测试范围；Google实际跨设备传输仍不在临时浏览器测试环境内。

| 测试文件 | 完整用例名称/稳定标识 | 变更类型 | 变更前行为 | 变更后行为 | 具体原因与证据 |
| --- | --- | --- | --- | --- | --- |
| tests/settings_sync_browser_test.py | test_SB02_initial_native_storage | 修改 | 首次发布后要求可见“已写入Chrome同步存储” | 保留真实完整版本头及本机保存断言；断言同步区只有开关，无长说明/常驻检查和诊断。对checking/equal/pending/waiting-data/error等无冲突后台状态统一验证不展示诊断，开关仍表达本机选择 | 用户仅需开关；同步提示和应用保持工作状态、如实呈现Chrome同步可用性。各无冲突状态具有相同展示期望，非新增业务状态 |
| tests/settings_sync_browser_test.py | test_SB03_auto_publish_choose_and_badge | 修改 | 验证差异不覆盖本机、选择云端后图库与徽标变化 | 保留自动发布/未选不覆盖/图库徽标断言；额外验证冲突时才有简短提示、双向选择和按需差异，采用后冲突区隐藏，单候选无随机设备标识 | 冲突选择必须明确且针对当前版本；用户要求只在有冲突时展示 |
| tests/settings_sync_browser_test.py | test_SB05_diff_languages_and_layout | 修改 | 七语言、明暗320px差异布局及长值文本安全 | 保留全部语言、主题、长值和安全断言；通过在本机独立修改后桥接制造并发候选，补核对新文案、常态紧凑布局及多个候选的版本编号/时间，继续保留长值展开状态 | 新简洁文案与候选标签必须翻译且可区分，不以隐藏差异代替简化 |
| tests/settings_sync_browser_test.py | test_SB12_native_quota_recovery | 修改 | 配额失败内部状态可见，缩小配置后点击常驻sync-retry恢复 | 保留原生单项超额拒绝、总量超限不截断/旧版本不变及恢复断言；无冲突后台配额故障不出现技术诊断，缩小后由原有自动重试恢复，不依赖已删除的常驻按钮 | 配额与失败不损坏配置仍保留；只改变后台故障的界面投影，不放宽存储保护 |
| tests/settings_sync_browser_test.py | test_SB13_sync_action_failure_feedback | 新增 | 无精简界面的主动操作失败验收 | 初始化读取或用户主动操作失败后给出简短反馈及仅此时出现的重试；不显示原始Chrome错误、不伪报完成；重试先比较当前版本，不自动重放过期选择，恢复后提示收起 | 用户主动操作失败反馈；冲突选择的过期保护必须保留 |

以上为本次需要修改的完整测试用例清单。SB05仍使用同一完整七语言/两主题组合，所有组合的布局与文本安全期望不变；只是更新共同展示契约。SB13采用临时扩展页面的消息失败夹具，不操作个人Chrome或Google账户。共享session、bridge、后台存储、计时与配额夹具不改；其他用例保持原样。

实施阶段若发现其他测试必须改动，将提交包含以上条目的完整修订清单重新审批；本轮不新增或修改测试代码。
