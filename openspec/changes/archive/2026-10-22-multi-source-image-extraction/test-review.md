# 测试修改审批清单

本修订版需要修改的完整测试用例共 **46 项**：既有逻辑用例/参数组合 **18 项**，新增 **28 项**。无删除、移动、跳过或放宽安全断言。浏览器顺序脚本按稳定子场景计数，不把一个文件视为一个用例；表内名称标识实际断言位置，并非声明现有函数已经具有新名称。

## 只读盘点范围与命中依据

- 搜索整个仓库（含隐藏 CI/内部技能目录）的 test/spec/fixture/mock/snapshot/golden/生成及容器入口；检查 tests 下全部 JavaScript 单元文件、八个 Python 浏览器脚本及 requirements，解析全部 Python 测试函数并检索全部断言与夹具。命中 api.scanTab/readImage/downloadImage、browserData、decoded-pixels、debugger-resource、预览来源、Referer、设置键、同步导出、被动计数、文档身份和导航。
- 完整读取直接受影响的 image-data/previews 单元、debugger 顶层脚本，以及 browser_test 中 main 的读取/来源/Blob 断言、test_preview_retries；检索其他浏览器和单元文件的上述接口/配置依赖。其余设置/同步/远程订阅/清单/语言/主题及徽标测试保留内容，仅作回归。
- 检查 package.json 的 test/check/package、scripts/check.mjs/package.py、.github/workflows/test.yml、README 和开发文档测试入口。没有额外独立容器验收、契约测试、快照/Golden 文件或其他测试生成器；图片及 HTML 夹具在 Python 脚本内，新增夹具只位于新专项脚本。新增专项脚本接入 CI，不更改旧测试筛选范围。
- 当前初始 diff 为空，未执行实现，无失败输出；依据是现行断言与五份 delta，而非据失败倒推放宽测试。原图像素冲突位于 design 的待决节，相关两行和 EX12 需明确选择“以规格为准”才可修改。

## 修订原因与审批边界

原版本只计划显式开启网站授权并使归档不可用，同时要求旧调试专项保持图片服务器计数不增加。按五路径顺序，普通和两种来源Fetch必须先尝试；对于已过期资源，这些真实403请求仍会增加服务器计数，因此仅上述前置条件不能保证该专项的零请求断言。

修订仅扩展 `tests/debugger_test.py` 自有夹具：在需要验证真实CDP读取的场景，先使后台Fetch在请求发出前失败；不替代chrome.debugger或图片原字节读取。验证 `/url-only.gif` 普通回退时恢复真实Fetch。保留全部两帧动画、字节、源文档、连接所有权及CDP阶段零HTTP请求断言。EX/EB中的真实Fetch和服务器实收Referer测试不使用这一替身，不因此缩减真实网络验收。

这改变了七项用例前置条件，原审批不覆盖。业务方案、五份delta和其他39项测试的目标不变；以下仍提供包含原批准项的完整46项清单，不能只批准七行的摘要。

## 逐项清单

| 测试文件 | 完整用例名称/稳定标识 | 变更类型 | 变更前行为 | 变更后行为 | 具体原因与证据 |
| --- | --- | --- | --- | --- | --- |
| `tests/image-data.test.js` | `concurrent and subsequent reads reuse the original downloaded blob` | 修改 | 扩展页面 fetch 夹具返回 GIF，统计单次请求 | 后台普通提取消息夹具返回同一 GIF，仍断言并发及后续读取同一 Blob、请求一次 | 原图任务共享；普通网络移入后台，不能把消息空结果当正式成功 |
| `tests/browser_test.py` | `test_preview_retries / retry-never.png 持续失败错误` | 修改 | 精确断言“页面：HTTP 403；扩展：HTTP 403” | 断言普通及两类 Referer 等实际尝试路径与 HTTP 403 原因，保留失败、重试、禁选、数量全部断言 | 提供原图读取回退并呈现来源；旧二段错误模板无法描述新路径 |
| `tests/browser_test.py` | `main / boundary.png 来源` | 修改 | 浏览器资源 | 归档资源且精确2048字节不变 | image-data；默认归档优先 |
| `tests/browser_test.py` | `main / once.png 预览` | 修改 | debugger-resource，零新请求 | mhtml-resource，原尺寸及零新请求不变 | image-data；归档复用已加载一次性资源 |
| `tests/browser_test.py` | `main / cached.png 完整读取` | 修改 | debugger-resource，字节等于 PNG | mhtml-resource，字节等于 PNG | image-data；普通已加载资源使用归档 |
| `tests/browser_test.py` | `main / once.png 完整读取` | 修改 | debugger-resource，640×420 | mhtml-resource，原文件及尺寸不变 | image-data；不能为过期地址重发请求 |
| `tests/browser_test.py` | `main / cross.png 完整读取` | 修改 | debugger-resource，字节等于 PNG | mhtml-resource，字节等于 PNG | image-data；无 CORS 资源的归档原字节 |
| `tests/browser_test.py` | `main / denied.png 完整读取` | 修改 | debugger-resource，字节等于 PNG | mhtml-resource，字节等于 PNG | image-data；防盗链已加载资源不用调试也可复用 |
| `tests/browser_test.py` | `main / frame-only.png 完整读取` | 修改 | debugger-resource | mhtml-resource，保留跨框架归属 | image-data；归档子文档原图 |
| `tests/browser_test.py` | `main / blob_items 首次读取` | 修改 | 活跃 page-blob 与撤销 decoded-pixels 都算完整成功 | 活跃原字节成功；撤销若无完整归档/缓存则明确失败，另行 preview 可读像素 | image-data；规格冲突方向1，原文件不被像素替代 |
| `tests/browser_test.py` | `main / blob_items 第二次扫描读取` | 修改 | 第二次仍接受撤销 decoded-pixels | 仍保留其他视图活跃 Blob 入口；撤销无完整数据明确失败 | image-data；规格冲突方向1，不删除多视图读取保护 |
| `tests/debugger_test.py` | `顶层 / 跨域和框架原图预览` | 修改 | 默认扫描直接 CDP 并显示浏览器资源 | 仅本测试显式开启目标网站，并令归档返回不可用后验证 CDP 预览，保留两框架及零新请求断言；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 调试仅用于获准且常规未解决目标；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/debugger_test.py` | `顶层 / 动画原图写入` | 修改 | 默认 CDP 下载并校验 GIF 两帧和原字节 | 继承上述显式授权及归档不可用夹具，仍严格校验原字节、两帧、下载方法和零新请求；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 保留真实 chrome.debugger 的原图验收；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/debugger_test.py` | `顶层 / 会话释放` | 修改 | 默认调试批次后能再次 attach/detach | 授权批次后仍能再次 attach/detach；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 短时自有连接必须释放；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/debugger_test.py` | `顶层 / url-only.gif 回退` | 修改 | 不在资源树，extension-fetch 成功 | 授权存在但普通后台 Fetch 先成功，仍为 extension-fetch 且大小不变；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 成功后停止多余 CDP 读取；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/debugger_test.py` | `顶层 / 调试器占用` | 修改 | 外部已 attach 后 browserResources 返回空，连接仍可用 | 显式授权及归档不可用上下文下验证相同结果；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 不因新默认关闭使占用测试虚假通过；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/debugger_test.py` | `顶层 / 过期文档` | 修改 | 旧 documentId 返回空 | 保留显式授权，导航后旧 documentId 仍返回空；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 不因缺授权掩盖文档校验；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/debugger_test.py` | `顶层 / 关闭源页后本地下载` | 修改 | 已取得调试及 Fetch 原字节无需源页仍可保存 | 上述显式授权场景取得数据后，原字节/零访问/两帧断言全部保持；测试真实CDP的阶段由本脚本将后台Fetch设为发出前失败，普通回退阶段恢复真实Fetch | 本地原图复用不依赖仍有网站上下文；修订的本脚本前置条件使CDP路径可达且保留零HTTP断言；真实网络由EB01至EB05独立验证，不修改其他用例夹具 |
| `tests/extraction.test.js` | `EX01 完整原图任务共享` | 新增 | 无对应专门覆盖 | 预览/下载/多个订阅者复用一次成功任务，像素结果独立 | 原图任务共享与有效结果判定 |
| `tests/extraction.test.js` | `EX02 阶段成功短路` | 新增 | 无对应专门覆盖 | 归档成功不 Fetch；普通成功不继续来源或 CDP；失败才推进 | 优先尝试浏览器保留的原始资源 |
| `tests/extraction.test.js` | `EX03 同源去重及签名地址` | 新增 | 无对应专门覆盖 | 两类 Origin 相同仅一次，保留端口与完整签名查询串 | 提供原图读取回退并呈现来源 |
| `tests/extraction.test.js` | `EX04 非图片及中断拒绝` | 新增 | 无对应专门覆盖 | 200 HTML、空体、超20MiB和中断不缓存，分别保留原因 | 原图任务共享与有效结果判定 |
| `tests/extraction.test.js` | `EX05 失败代次与主动重试` | 新增 | 无对应专门覆盖 | 同代次失败不重复请求，主动重试创建新代次 | 原图任务共享与有效结果判定 |
| `tests/extraction.test.js` | `EX06 多视图取消隔离` | 新增 | 无对应专门覆盖 | 单订阅者关闭不取消其他视图任务，最后离开清理 | 后台核实来源与增强模式撤销 |
| `tests/extraction.test.js` | `EX07 MIME 编码字节解析` | 新增 | 无对应专门覆盖 | Base64/quoted-printable、折行头、边界保持二进制内容 | 归档共享且只接受完整对应资源 |
| `tests/extraction.test.js` | `EX08 MIME 损坏与预算拒绝` | 新增 | 无对应专门覆盖 | 缺末边界、坏编码、超预算及歧义归属不当成功 | 归档共享且只接受完整对应资源 |
| `tests/extraction.test.js` | `EX09 网站授权值及隔离` | 新增 | 无对应专门覆盖 | 仅 true 开启，规范化 hostname、子域分离、读取错误不授予 | 增强模式按网站仅在本机授权 |
| `tests/extraction.test.js` | `EX10 授权不参与同步` | 新增 | 无对应专门覆盖 | 真实 codec export/payloadWrites 不导出、修改或删除本机键，远程未知字段拒绝 | 增强模式按网站仅在本机授权 |
| `tests/extraction.test.js` | `EX11 来源展示` | 新增 | 无对应专门覆盖 | 归档、普通、两类来源请求和 CDP 的实际方法映射正确，不靠 browserData 猜测 | 提供原图读取回退并呈现来源 |
| `tests/extraction.test.js` | `EX12 原格式拒绝静态替代` | 新增 | 无对应专门覆盖 | 完整数据失败而像素成功时 original 拒绝，明确转换才重编码；Canvas 快照保持 | 冲突方向1，静态缩略图不冒充原文件 |
| `tests/extraction.test.js` | `EX13 临时规则清理失败关闭` | 新增 | 无对应专门覆盖 | finally/恢复只删自有规则，清理失败不发后续可能污染请求 | 来源请求不能相互串扰 |
| `tests/extraction_browser_test.py` | `EB01 默认提取零调试` | 新增 | 无对应专门覆盖 | 真实 MHTML/普通原图成功；监测真实 attach 次数为0，原字节和 GIF 帧保持 | 默认网站没有启用增强模式 |
| `tests/extraction_browser_test.py` | `EB02 网页源 Referer` | 新增 | 无对应专门覆盖 | 本用例归档不可用，普通403后服务器实收网页 Origin 加尾斜杠（含端口），图片成功 | 第二种来源请求成功的网页来源阶段 |
| `tests/extraction_browser_test.py` | `EB03 图片源 Referer` | 新增 | 无对应专门覆盖 | 归档不可用、普通/网页源403，服务器实收图片 Origin，最终图片成功 | 第二种来源请求成功 |
| `tests/extraction_browser_test.py` | `EB04 同地址跨站并发` | 新增 | 无对应专门覆盖 | 两个站点同 URL 的三种请求分别拿到正确头，网页及订阅请求无临时 Referer | 来源请求不能相互串扰 |
| `tests/extraction_browser_test.py` | `EB05 后台恢复清理` | 新增 | 无对应专门覆盖 | 种入自有残留规则并重启后台，新普通请求前清理且保留非自有规则 | 后台在请求期间重启 |
| `tests/extraction_browser_test.py` | `EB06 归档批次共享` | 新增 | 无对应专门覆盖 | 多图、多视图和动态完成合并批次；统计 saveAsMHTML 数及原始请求无重复 | 归档共享且只接受完整对应资源 |
| `tests/extraction_browser_test.py` | `EB07 加载中与导航换源` | 新增 | 无对应专门覆盖 | 慢图片部分可解码时不接收原文件，加载完成才补充；导航及 currentSrc 换源拒绝旧结果 | 图片在归档期间仍在传输 |
| `tests/extraction_browser_test.py` | `EB08 框架及 CSS 归属` | 新增 | 无对应专门覆盖 | 真实跨域 frame 原文件正确；同 URL 歧义或 CSS 完成无法证明时不用归档结果 | 同地址出现在不同框架 |
| `tests/extraction_browser_test.py` | `EB09 网站开关与深链接` | 新增 | 无对应专门覆盖 | 空列表可跳转并聚焦，解释 Chrome 提示；开关只授权顶层源网站，本机重开恢复 | 图库呈现网站增强模式状态与入口 |
| `tests/extraction_browser_test.py` | `EB10 过期设置及存储错误` | 新增 | 无对应专门覆盖 | 源页关闭/跨站导航禁用保存；读写失败有反馈，不伪报授权或关闭 | 高级功能解释增强模式并验证网站上下文 |
| `tests/extraction_browser_test.py` | `EB11 增强资源补充` | 新增 | 无对应专门覆盖 | 真实资源树图片从普通漏项加入，开启后保留选择/过滤/标题；XPath/CSS排除及忽略不绕过 | 增强模式补充浏览器资源候选 |
| `tests/extraction_browser_test.py` | `EB12 撤销导航及迟到` | 新增 | 无对应专门覆盖 | 真实调试过程中关闭/跨站导航取消自有工作，不写迟到结果，普通读取与缓存仍可用 | 后台核实来源与增强模式撤销 |
| `tests/extraction_browser_test.py` | `EB13 用户取消不自动重连` | 新增 | 无对应专门覆盖 | onDetach 用户取消后连续候选不重连，主动重试仍需网站许可，别人的连接不被释放 | 调试连接不可用 |
| `tests/extraction_browser_test.py` | `EB14 七语言主题窄屏` | 新增 | 无对应专门覆盖 | 七语言×两主题下320px长域名、图标文字、键盘聚焦/开关和下载区不溢出，截图目视核对 | 增强模式界面保持可访问与已有工作 |
| `tests/extraction_browser_test.py` | `EB15 被动徽标与视图生命周期` | 新增 | 无对应专门覆盖 | 无图库时 DOM/资源变化零归档/Fetch/CDP，图库关闭后清理；另一个视图和计数不被取消 | 已打开图库动态补充候选 |

以上为本次需要修改的完整测试用例清单。

尚无法检查的仓库测试范围：无。真实用户 Chrome 调试横幅的具体文案/外观、Chrome116真实环境及公网 Cookie 分区、Google 实际跨设备送达不属于已存在而无法读取的测试；这些环境边界需在验证记录明确，不把 headless 的接口验收或受控同步检查称为真实用户界面/云端送达验证。

审批涵盖当前全部清单、其中前置夹具和预期；如实施发现其他测试或共享夹具受影响，立即停该部分，提交含原批准项的完整修订清单重新确认。不能仅凭提案业务审批推定同意这些测试修改。原46项清单已于2026-10-22获批；本版仅修订debugger_test.py七项的Fetch失败前置条件，当前修订版随后已获用户批准，实施核对见verification.md。
