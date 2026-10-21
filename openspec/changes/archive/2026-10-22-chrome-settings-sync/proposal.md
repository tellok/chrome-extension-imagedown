# Proposal

## Why

[Issue #11](https://github.com/tellok/chrome-extension-imagetoken/issues/11) 要求使用Chrome同步存储（Chrome Sync Storage）同步配置，并在本地与云端不一致时让用户选择保留版本。用户已确认：每台机器默认开启、可独立关闭，搜索词与图片忽略记录也同步。

## What Changes

- 设置页增加“配置同步”分类及仅属于本机的开关，默认开启；关闭后不启动新的同步读写，不应用云端变化，不影响其他机器或删除云端配置。重新开启先比较，不直接覆盖。
- 同步基础偏好、全局默认宽高、网站三项阈值、XPath/CSS、搜索词、忽略摘要、全局普通筛选和有序远程订阅地址；下载目录授权、图片/规则缓存、下载历史、页面标题草稿、标签页状态与同步开关留在本机。
- 本地修改自动合并写入，启动/恢复和云端事件触发比较。已知共同版本上仅本地改变时可自动发布；来自云端的不同配置与并发分支必须提示“使用本机设置 / 使用Chrome同步设置 / 查看差异”，未选择前保留本机并暂停上传，不自动合并或按时间覆盖。
- 完整快照（Snapshot）经过字段、版本、分片与摘要校验后才接受；保留显式0、false、空字符串与未设置的区别。使用每设备版本记录保留并发分支，防止两台机器同时上传时互相静默覆盖。
- 遵守Chrome约100 KB总量、每项8 KB等配额；超限、离线、权限/读写失败、缺片及损坏数据均可见，保留本机及最后有效数据，不截断搜索或忽略记录来假装同步成功。
- 同步选择生效时保持图库和徽标一致，不重新请求成功图片，不改变进行中的下载批次；设置、差异提示沿用七语言、深浅主题和Notion风格。状态区分“写入同步存储”与实际跨设备送达，后者由Chrome账户和同步状态决定。

## Capabilities

### New Capabilities

- [settings-sync](specs/settings-sync/spec.md): 每机开关、同步范围、自动协调、并发/冲突、完整性校验、配额、错误及差异选择。

### Modified Capabilities

- [user-preferences](specs/user-preferences/spec.md): 本机保存继续作为运行来源，增加可选跨设备复制及同步状态设置分类。
- [extension-platform](specs/extension-platform/spec.md): 允许通过Chrome同步明确列出的配置，保留图片、目录授权和运行数据的本机边界。
- [remote-rule-subscriptions](specs/remote-rule-subscriptions/spec.md): 仅同步有序订阅地址，缓存及刷新状态各机独立，不改变订阅规则优先级。

## Impact

新增配置编解码与后台协调模块、设置/图库提示，接入现有后台、偏好读写及共享配置锁、订阅串行修改、图库与徽标存储事件、七语言、文档及CI；复用已有storage/alarms权限，无新依赖、自有后端或系统应用。不发布新Gist、不修改上一功能的演示地址、不推送代码。

完整设计见 [design.md](design.md)，实施见 [tasks.md](tasks.md)，拟新增**30项测试**的逐项审批见 [test-review.md](test-review.md)。本轮仅形成待审产物，不修改实现或测试。

## Audit

- OpenSpec: required。改变跨设备数据传输、配置格式、冲突交互和默认行为，当前change为chrome-settings-sync。
- 开始时main、默认origin/main、工作区干净，活动change清单为空；唯一新建本change。既有Issue #10提交39ba42f保持不变，不混入或改写旧归档。
- 阅读证据与历史边界见design；本提案显式修改“配置只在本机”的原约定，不直接修改主规格。
- External-Skill: exempt。检查skills目录、内部.agents/skills、README、Manifest及打包清单，无已发布消费方Skill或分发要求；新功能面向扩展用户，由独立同步说明文档解释，不新建无分发机制的Skill。
- README-Glossary: verified。核对设置、平台、筛选、徽标、远程订阅主规格及相关归档和README；同步、快照、版本向量、冲突与基线沿用行业通义，无项目私域术语新增或映射变化，保留空术语表。
