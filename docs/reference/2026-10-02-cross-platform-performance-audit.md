# 三端性能审查与优化记录

日期：2026-10-02。

范围：iOS 终端资源收集与录音播放、桌面 Git 状态与后台轮询/录音请求/文件监控、Web 管理路由与云盘读取/Markdown 评论定位，以及三端共用的 Live 连接服务。以源码、确定性回归和隔离合成数据为证据，保持业务功能、权限、数据和协议不变。未新增依赖，未启动应用、开发服务器、浏览器或模拟器，未访问真实用户数据。

## 已定位并处理的热点

| 范围 | 原问题 | 优化与验收目标 |
| --- | --- | --- |
| iOS 终端 | 普通输出也保存无链接 occurrence，后续帧反复遍历；连续软换行反复回溯到行首；遍历字典时删除触发写时复制 | 只跟踪实际链接，连续行复用已解析行首，扫描后删除，短行优先检查列宽；保持跨帧、改写、历史链接语义 |
| iOS 终端链接 | 每个普通外部链接也扫描全部已有资源两次，判断仅本站分享链接才可能满足的残片合并条件 | 先用既有 shareRootID 判定候选，仅分享链接执行残片合并；仍保留原始合并规则 |
| iOS 录音播放 | AVPlayer 持有周期回调，回调强捕获同一播放器 | 弱捕获播放器，打断循环引用；播放进度与时长读取不变 |
| 桌面 Git | 已勾选路径逐项扫描新变更列表，刷新最坏 O(S×N) | 路径集合匹配降为 O(N+S)，保持勾选顺序及新增/删除文件行为 |
| 桌面 Agent 状态 | 后台轮询超过 5 秒时重叠并反复作废上一响应 | 后台同时最多一个刷新请求，保留手动刷新、切项目及失效响应隔离 |
| 桌面录音 | 清空选择与卸载没有完整使旧请求失效 | 旧列表/详情响应不可回写已经离开或清空的页面，保留同录音刷新期间的内容 |
| 桌面文件监控 | lstatSync 的非 ENOENT 异常逃出原始事件回调 | 通过既有 onError 报告检查失败，不误报删除；回调自身不抛出异常，生产 service 继续按既有规则将绑定标为错误 |
| 桌面同步重试 | 慢批次可重叠，旧失败批次可覆盖新事件，停用/重建后的迟到回调可重建旧重试 | 同绑定代次串行处理，较新事件优先；异步续段校验绑定身份，旧代次不得清理新重试或复活已停用队列 |
| Web 管理路由 | 管理入口静态导入全部业务页，首屏预载包含不需要的页面 | 使用既有 lazyRouteComponent 按目标路由加载；登录、鉴权和错误页契约保留 |
| Web 云盘 | Query 的取消信号未传至集中客户端，切目录后旧下载继续 | 快速导航及卸载取消失去消费者的快照请求，取消不触发登录过期 |
| Web 请求遥测 | 主动取消读取仍被统计为失败 | 使用既有 cancelled 结果，只影响遥测分类；其他错误仍为 failure，保存请求不因导航取消 |
| Web Markdown | 每条评论重复把全文转换为码点数组并构建前缀，图片评论重复遍历 DOM | 每次解析共用 UTF-16 偏移索引和图片集合；仅此转换与图片存在性检查从重复全文/DOM 扫描降为一次；保留 Unicode、引用校验与位置状态 |
| 跨端 Live | 查询一个账号设备时扫描全站所有保留连接 | 维护账号键索引，只读取当前账号的设备；排序、心跳、顶号、离线保留和清理语义保持一致 |

Live 的确定性计数：注册 10,000 个其他账号与目标账号的两台设备后，目标查询仅调用主记录 Map.get 两次，没有全表迭代。过期时同时释放账号索引桶，重连后重新建立；不会为查询不存在的账号创建桶。新增索引每台设备仅保留一个记录键，不缓存复制的设备对象。

Git 的确定性计数：10,000 个变更、9,999 个勾选、反序刷新时，原选择保留逻辑读取 path 49,995,100 次；新逻辑读取 path 10,000 次，再做 9,999 次 Set.has。测试还校验选择顺序与当前文件不变。

Markdown 回归计数：100 条缓存 V2 评论的全文码点扫描从 200 次降为 1 次，101 条图片评论的图片 DOM 查询从 101 次降为 1 次。该结论只针对本次优化的偏移转换、精确引用校验及图片存在性查询，不代表所有锚点解析都已达到线性复杂度。

## 合成对照测量

### iOS 终端资源收集

Swift 6.3.3、macOS arm64、`swiftc -O`；同一进程、同一批输入比较基线 `fd97b4511` 和优化后代码。初始 reset 预热不计时，计时结束校验链接 ID 与 needsConfirmation 一致。下面是一次合成批次的 CPU 耗时，不是真机帧率或整体 App 加速比。

| 输入规模 | 基线 | 优化后 |
| --- | ---: | ---: |
| 6,000 行普通输出，250 次尾行改写 | 85.90 ms | 1.17 ms |
| 2,000 行单条软换行，3 次整体改写 | 246.10 ms | 10.64 ms |
| 1,000 条外部链接，30 次改写尾部 200 条 | 30,189.41 ms | 206.28 ms |

### Web 管理首屏预载

统计 `dashboard/dist/admin.html` 中入口 script 和 modulepreload 的去重 JS 文件；不含 CSS、字体、HTML 和后续动态导入的业务页。gzip 是每个 JS 文件独立用 zlib.gzipSync 默认设置压缩后求和，不代表生产服务器实际压缩或网络加载时间。

| 指标 | 基线 | 优化后 | 降幅 |
| --- | ---: | ---: | ---: |
| 静态 JS 文件数 | 97 | 64 | 34.0% |
| 原始 JS 字节 | 1,405,647 | 709,727 | 49.5% |
| 独立 gzip 汇总字节 | 436,865 | 234,551 | 46.3% |
| 管理入口 JS 字节 | 423,203 | 16,871 | 96.0% |

## 仍需专项处理的架构负担

这些是源码可见的风险，不是已测出的整机 CPU 或内存占比。

1. **Agent 历史存储仍随历史长度增加追加成本。** `desktop/electron/services/agent-runtime/session-repository.ts` 的 `appendHistory` 读取完整会话并复制 history，再整体 upsert；`desktop/src/modules/agent/hooks/use-chat-connection.ts` 的 prepend/merge 和缺口追补没有聚合容量限制。本次没有变更其存储格式。摘要/历史分离、有界分页缓存、消费者迁移、崩溃恢复和完整导出验收需按已有 [长运行容量设计](../superpowers/specs/2026-09-13-agent-long-running-capacity-design.md) 配套实施，不能用加 memo、删历史或强制重载掩盖。
2. **云盘原始文件事件仍有同步磁盘检查。** `desktop/electron/services/drive-sync-watcher.ts` 在按路径合并之前调用 `lstatSync`，高频保存或慢磁盘可能阻塞主进程。将其改成合并后的异步检查，需要一起验证自写过滤、停止/重建 binding、失败重试及同路径创建/改写/删除时序，不能仅替换成 Promise。`drive-sync-excludes.ts` 还在每条路径检查时重建 ignore matcher；后续可复用单次扫描/批次的 matcher，避免长驻路径缓存无界增长。
3. **Web 文件渲染入口仍静态导入多个编辑器。** 当前构建中 drive-browser chunk 约 1.217 MB，Monaco 相关 chunk 约 2.548 MB；后续可按文件类型拆分。体积只能证明下载/解析负担，不能直接证明滚动或输入卡顿。`document/` 的 VitePress 页面及定时器清理未发现本轮足以直接修改的明显问题。
4. **iOS 尚未实测的候选。** RealtimeClient 在主 actor 解码消息，DriveStore 派生列表读取时排序，MeetingAudioCache 在主 actor 查询文件属性及索引。需要按消息/目录/音频规模取得实际耗时证据，再决定后台处理与缓存失效策略。本次不把这些代码形态写成已证实的整机瓶颈。

## 验证边界

正式包/真机帧率、交互 p95、RSS/heap 曲线及 8–24 小时耐久测试未执行；主机微基准和单元测试不能代替这些结果。尤其不能将这轮局部优化描述为已解决全部 Agent 长运行容量问题。运行入口与限制沿用仓库已有规则，不通过自动启动用户应用完成验收。

验证结果：

- 服务端 Live 专项 6 文件、117 项通过；server typecheck 通过。首次全量 1,764/1,765 通过，problem-feedback HTTP 限流/大小测试出现 write ECONNRESET；该文件单独复跑 8 项通过，第二轮全量 137 文件、1,765 项全部通过。
- 桌面最终专项 6 文件、175 项通过（watcher 24、DriveSyncService 134、Git/Agent/录音 17）。完整 `pnpm --filter @synapse/desktop run typecheck` 通过（shared 构建及 renderer/electron/preload/test 四套检查），hard constraints、改动文件专项 ESLint 和 diff 检查通过。隔离基线稳定复现 Git 二次复杂度、后台轮询重叠、录音旧响应回写与文件检查异常；追加的 11 条 flush 时序回归在修复前失败 10 条，修复后全部通过。
- Web 核心专项 6 文件、93 项通过；完整 dashboard build 通过（包括 shared 构建、tsc -b 与 Drive telemetry coverage）。附加 Markdown 集成 99 项中 97 项通过，2 项既有 UI 断言失败：直接“编辑”按钮与引用中文引号。临时 loader 使用 git HEAD 原版 annotation helper 重跑这两项仍失败，没有修改或放宽这些断言。
- iOS 44 项、5 个数据层套件通过。测试在临时 macOS Swift Package 中使用实际 TerminalStore/TerminalResources/AppConfiguration 及从实际源码提取的终端协议/SynapseWebLink；不是 iOS 设备上的完整测试运行。`xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/synapse-ios-performance-build CODE_SIGNING_ALLOWED=NO` 成功，编译了完整测试目标，未启动模拟器。仍有原有 actor isolation 警告。

本机审查产物（临时文件，不随 Git 提交）：iOS 对照、测试和构建日志分别为 `/tmp/synapse-ios-performance-benchmark.log`、`/tmp/synapse-ios-performance-unit.log`、`/tmp/synapse-ios-performance-build.log`；Web 构建、体积统计脚本/快照及原版 helper 复跑日志为 `/tmp/synapse-web-performance-build.log`、`/tmp/synapse-web-performance-assets.mjs`、`/tmp/synapse-web-performance-baseline.json`、`/tmp/synapse-web-performance-after.json`、`/tmp/synapse-web-markdown-baseline-tests.log`；服务端全量复跑日志为 `/tmp/synapse-performance-server-test-recheck.log`。
