# Proposal

## Why

同步设置现在常驻展示范围、账户依赖、内部状态和重新检查，用户难以快速找到开关。用户要求只关心同步是否开启，以及发生冲突时如何选择版本。

## What Changes

- 无冲突时同步分类仅显示“在此机器同步配置”开关；移除长说明、后台进度/成功/失败状态及常驻“重新检查”。开关代表本机参与选择，不宣称Google已经送达其他设备。
- 仅有冲突时展开一句提示、使用本机设置/使用同步设置以及按需查看差异；单候选不展示设备随机标识，多候选按版本编号与时间区分。
- 自动检查、等待数据和后台失败由既有后台逻辑处理，诊断留存于内部状态，技术范围与浏览器依赖保留在文档。用户主动操作失败时仅显示简短提示和按需重试，不暴露原始错误。
- 不改变同步默认开启、每机独立选择、数据范围、版本/分片格式、并发与校验策略、自动重试、备份、图库和下载保持，也不增加权限或依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- settings-sync：精简状态展示、冲突选择文案及主动操作错误反馈，技术说明移到文档。
- user-preferences：同步分类常态只保留开关，后台故障不增加常驻状态说明。
- extension-platform：数据范围和Chrome依赖通过文档说明，不再要求同步设置行常驻解释。

## Impact

预计修改extension/settings.html、settings-sync-ui.js、settings.css、locales/catalogs.js及docs/settings-sync.md，必要时准确同步README/开发说明；不改后台引擎、权限、存储结构或CI入口。测试只拟修改现有SB02、SB03、SB05、SB12并新增SB13，完整5项清单见[test-review.md](test-review.md)。本轮不改实现和测试。

## Audit

- OpenSpec: required，用户可见状态、冲突操作及错误展示契约改变，change为simplify-settings-sync-ui。
- 本轮初始main与origin/main均为3c7bdc4，工作区干净，活动清单为空；无继承活动change，只创建本change。历史审批不作为本轮审批。
- 已按sync-status/sync-retry、冲突、配额、设置分类及预计路径读取settings-sync、user-preferences、extension-platform主规格，完整核对3c7bdc4归档chrome-settings-sync的proposal、design、三份相关delta及tasks。此前要求常驻诊断；当前通过delta显式按用户新要求调整，不静默追认。
- External-Skill: exempt。检查skills目录、.agents/skills、README和打包/CI清单；没有已发布的消费方Skill或分发机制，内部目录仅维护OpenSpec流程，本次不新建消费方Skill。
- README-Glossary: verified。上述主规格、相关归档及README术语表无项目私域词新增；同步、冲突、版本沿用行业通义，版本编号只是展示标签，保持空术语表。
