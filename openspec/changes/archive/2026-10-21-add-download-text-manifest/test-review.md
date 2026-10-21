# 测试变更审批清单

本次需要新增 **20 项用例**，不修改、删除、跳过或放宽任何现有用例。新增测试专用夹具和模拟均放在新测试文件内部，不修改现有共享夹具。当前未写入任何测试代码，等待用户明确批准本清单。

## 检索范围与依据

已检查 `tests/` 所有 11 个 JavaScript 单元测试文件、5 个 Python 浏览器脚本及 requirements，按 `downloadImage`、`runDownloads`、`scanTab`、`writeImage`、`saveBrowserDownload`、清单/manifest、title/alt、timestamp、设置存储和文件名去重检索；检查 `package.json`、`scripts/`、`.github/workflows/test.yml`、README、开发文档和全部主规格/归档入口。

命中：`tests/settings.test.js` 当前仅有标题清洗测试；`tests/image-data.test.js` 覆盖已取得原图复用；`tests/destination.test.js` 与 `file-content.test.js` 覆盖目录和重名基础能力；`browser_test.py` 的 settings/title/download_locations/default_hash_duplicates 及主入口覆盖原流程；`i18n.test.js` 自动核对所有词条，language/theme 专项覆盖样式与语言。现有脚本没有清单覆盖。仓库无独立契约、容器、快照/Golden 测试框架；现有截图是验收输出，不是比对快照。

新增 `tests/manifest.test.js`（8项）、在 `tests/settings.test.js` 追加用例（2项）、新增 `tests/manifest_browser_test.py`（10项）。后者独立临时配置、本地 HTTP 夹具及沙盒目录，不通过修改 `browser_test.py/main` 调用；CI 新增一行专项执行入口。除新增用例及其局部夹具外，不改变任何既有测试输入、参数、断言、超时或入口语义。

| 测试文件 | 完整用例名称/稳定标识 | 变更类型 | 变更前行为 | 变更后行为 | 具体原因与证据 |
| --- | --- | --- | --- | --- | --- |
| tests/manifest.test.js | manifest uses sanitized edited title and UTF-8 text output | 新增 | 无文本输出测试 | 编辑标题安全化后作为 txt 基名；UTF-8 保留中文 | 下载“每批可选下载一份文本清单”；复用 folderName |
| tests/manifest.test.js | HTTP image entries preserve remote URL and original metadata | 新增 | 无来源清单测试 | 保留完整 HTTP 图片地址、原标题、所属页面和采集时间 | 下载“清单记录真实保存结果与采集来源” |
| tests/manifest.test.js | inline SVG entries have no remote URL and retain source reference | 新增 | 无内嵌 SVG 清单测试 | 明确无有效远程地址，保留元素引用，不包含 SVG 数据正文 | 下载“没有真实远程地址”场景 |
| tests/manifest.test.js | Blob entries retain an explicit non-remote source reference | 新增 | 无 Blob 清单测试 | Blob 引用仅作来源，远程地址明确缺失 | 同场景，避免 blob: 被当作远程地址 |
| tests/manifest.test.js | Data URL entries omit encoded image payload | 新增 | 无 Data URL 清单测试 | 输出类型/引用占位，不复制 Base64 载荷 | 同场景，避免大体积内嵌数据进入文本 |
| tests/manifest.test.js | Canvas synthetic URLs are not remote image URLs | 新增 | 无 Canvas 清单测试 | 伪 HTTP 片段标为无远程图片地址，保留画布引用 | collector 当前 Canvas 使用页面地址加片段 |
| tests/manifest.test.js | manifest values escape line breaks without losing Unicode | 新增 | 无文本边界保护测试 | 换行与控制字符转义，Unicode 保留、缺失标题明确标记 | 下载“元数据包含特殊字符”场景 |
| tests/manifest.test.js | manifest maps actual converted and reused filenames in input order | 新增 | 无结果映射测试 | 使用真实 JPG/随机后缀/复用名称；逆序完成仍按输入顺序；失败不进入成功区 | api 已有 actualPath/savedName，不能猜文件名 |
| tests/settings.test.js | download manifest defaults off when preference is absent | 新增 | 只测标题清洗 | 新键缺失时返回 false，不写入默认值 | 用户明确默认关闭；user-preferences 新要求 |
| tests/settings.test.js | download manifest preference read errors remain visible | 新增 | 无新设置错误覆盖 | 存储读取错误向调用者传播，不伪装为关闭成功 | 设置失败场景与 design 的未知状态门禁 |
| tests/manifest_browser_test.py | test_manifest_off_preserves_existing_downloads | 新增 | 原下载测试不验证新开关 | 未配置/关闭时仅下载图片，无 txt 或额外图片请求，原计数不变 | 默认关闭与原图复用约束 |
| tests/manifest_browser_test.py | test_manifest_setting_persistence_and_sync | 新增 | 无清单设置界面测试 | 开启后重开保留，另一设置/图库视图同步，删除键恢复关闭，非法非布尔值关闭 | 新设置持久化与严格布尔规则；以独立步骤断言，非参数化用例 |
| tests/manifest_browser_test.py | test_default_directory_manifest_uses_actual_paths | 新增 | 原流程只保存图片 | 默认目录单次批量下载得到一份同目录 txt，转换后的实际名称与内容一致 | 下载“修改标题后批量下载”“格式转换”场景 |
| tests/manifest_browser_test.py | test_custom_directory_manifest_tracks_duplicates | 新增 | 现有目录测试不生成清单 | 自定义真实沙盒句柄下记录新保存和同内容复用，实际随机后缀名称正确 | 两类保存目录及内容去重边界 |
| tests/manifest_browser_test.py | test_partial_failure_manifest_and_image_counts | 新增 | 无清单部分失败测试 | 成功映射与失败区分开，原图成功/失败计数不含 txt | 下载“部分或全部图片下载失败”场景 |
| tests/manifest_browser_test.py | test_all_failed_images_still_create_manifest | 新增 | 失败图片不生成来源文件 | 目录准备成功但图片全部失败时仍有一份失败清单 | 同场景，清单不能仅依成功回调生成 |
| tests/manifest_browser_test.py | test_manifest_failure_preserves_images_and_reports_error | 新增 | 无文本写入失败分支 | 定向让 txt 写入失败后图片仍在，错误可见、计数真实、不换目录；目录准备拒绝时无输出 | 下载“清单写入失败”及既有目录授权约束 |
| tests/manifest_browser_test.py | test_collected_metadata_survives_frames_and_navigation | 新增 | 无逐图片采集时间/标题断言 | iframe 和资源记录各用所属文档；合并保留首个来源，title 优先于 alt；扫描后改 DOM/导航仍保留采集值，真实 SVG/Blob 条目不遗漏 | image-discovery 新要求全部场景与无 URL 来源要求 |
| tests/manifest_browser_test.py | test_download_batch_freezes_manifest_preferences | 新增 | 原流程只固定标题/位置 | 批次中改开关、标题和元数据不改变运行中清单，下一批采用新配置 | 下载批次快照场景 |
| tests/manifest_browser_test.py | test_manifest_collision_preserves_every_batch | 新增 | 无 txt 重名测试 | 同一标题连续两批各留一份清单，旧文本不覆盖，新文本随机后缀，即使图片全部去重复用 | 每批一份与清单重名约束 |

以上为本次需要修改的完整测试用例清单。没有尚无法检查的仓库测试范围。运行时真实 OS 目录选择器及授权弹窗仍不宣称被自动化覆盖；使用临时浏览器配置、受控本地服务和真实沙盒文件句柄验证业务行为，记录该边界。若实施发现计划外测试修改，必须更新包含已批准项的完整清单并重新请求确认，不直接修改既有测试。

## 验证入口

- `npm run check`、`npm test`、`npm run package`。
- 既有 `browser_test.py`、`language_test.py`、`theme_test.py` 保持原样运行，确认默认关闭的兼容性、七语言完整目录及明暗布局。
- 新增 `manifest_browser_test.py` 独立运行并接入 CI；支持 `CHROMIUM_PATH`，复用既有 Playwright/Pillow 依赖，不增加测试依赖或放宽原 CI 步骤。
