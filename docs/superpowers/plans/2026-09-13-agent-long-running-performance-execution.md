# Agent 长运行性能执行记录

日期：2026-09-13。结论：计划只完成了部分修复，尚未达到长期性能目标。不能将这份记录或绿色单元测试理解为 P1～P5 已完成。

## 执行前核实

- HEAD 为 `15678574e`，desktop 版本 `0.2.457`。开始时已有 135 个 tracked 文件修改及多项未跟踪的 Agent 能力、上下文治理、UI 与设计文档；没有 reset、stash、提交、覆盖还原或清理这些改动。
- 已有的入口分类、Renderer 投影、50 ms 合批、ACK、正文分页和故障止损保留。本次没有另建投递协议，没有修改 SDK 模型参数，也没有停止、重启或控制真实对话。
- 已读取仓库执行、存储、前后端、测试、UI、Knowledge Base/Agent 安全规则及相关容量、诊断和滚动设计；核查现有组件与直接依赖，没有安装依赖或启动应用、浏览器、DevTools、Playwright。
- 初始工作区 typecheck 通过。全量测试后来发现已有 `core.agent-conversation-control` 的依赖断言漏列 `core.config` 和 `provider`；实际 descriptor 的 `listProjects` / `listProviders` 使用这两个依赖。仅补齐测试预期，没有修改该能力实现。

## 调用路径与证据等级

`claude-sdk-session` / `sdk-event-bridge` → `conversation-router` → `AgentSessionRepository.appendHistory` → `SqliteNamespace.get/upsert`；显示分支经 Router 的 `enqueueRendererStreamEvent/flushRendererStreamBatch` → EventBus → Renderer `use-chat-events` → `use-chat-reducer` → Timeline 分组、正文预处理 → `use-stick-to-bottom` 的布局与滚动。

| 路径 | 结论 | 证据 |
| --- | --- | --- |
| appendHistory + 非标题保存 | 存在并发覆盖，已修复所测路径 | 修复前 32 次追加与 SDK、费用和标题保存并发，最终 history 为 `[]`；修复后所有 32 条按序保留，元数据和标题同时保留 |
| 整对象持久化 | 仍为 O(H)，未修复为分块存储 | 真实 `SqliteNamespace` + 隔离内存 SQLite 计数，见下表 |
| Timeline 每秒计时 | 已移到局部文字组件 | fake clock 前进 2 秒，显示 `2.0s`，期间对 timeline 数组元素的读取计数为 0 |
| 重复 running / active turn / clear / no-op timeline | 已抑制无变化状态通知 | 连续 100k 次相同 running action 保持同一 state 引用；有效状态改变仍产生新引用 |
| React 开发 measure | 已限制可识别记录的保留 | 本地 React 19.2.5 源码的 Components/Scheduler track；真实 Node Performance API 合成 1k/10k/100k 条，React 记录不超过 256，业务同名 measure 与 mark 保留 |
| 全文查看器 | 局部内容与回退游标有界，关闭释放 | 400 次前进、128 次回退后仍可回到开头；300 次开关清空正文；失败重试、旧响应、双击均覆盖 |
| prepend / refresh merge / backfill | 仍无限保留和追补，待改 | `use-chat-connection` 静态检查；没有声称缓存已可淘汰 |
| historyPage / MCP inspect / 全文读取 | 后续修复已移除整轮回退，按记录和字节分页；底层仍全量读取会话 | 611 条超大单轮分别遍历 UI IPC 与 MCP，覆盖尾部回复、游标连续性与原文不变；尚未完成分块存储 |
| DOM、活动字符串、SDK 内存、布局 | 尚无运行时归因 | 未采 CPU/布局调用栈、堆快照或正式包数据；不能把 90 分钟旧进程观察当成当前测量 |

## 合成存储测量

设备：Apple M1 Max，arm64，64 GiB；Node v22.22.3，pnpm 10.22.0。使用 `DatabaseSync(':memory:')`，不读取或写入用户数据库。每条初始正文固定 64 个 ASCII 字符、固定时间戳，相同单用户轮次；每次追加正文 `tail`。

| 历史条数 | 一次追加 get 次数 | 物化历史条数 | 读取 JSON 字节 | 写入 JSON 字节 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2 | 2,000 | 274,500 | 137,327 |
| 10,000 | 2 | 20,000 | 2,740,500 | 1,370,327 |
| 100,000 | 2 | 200,000 | 27,400,500 | 13,700,327 |

字节是 namespace 边界 JSON 计数，不是 SQLite 页/WAL 实际磁盘 IO，也不是 RSS。测试计数本身执行 JSON.stringify，不能拿它的耗时当生产性能指标。修复前源码有 requireConversation、persistNonTitleUpdate 和 SQLite upsert.previous 三次完整读取；本次追加改为两次，但仍不能满足有界热路径验收。

可复现命令：

```bash
pnpm --filter @synapse/desktop exec vitest run tests/perf/agent-long-running-storage.test.ts
```

输出为 `AGENT_STORAGE_BASELINE` + JSON，内容仅有计数和规模。数据库在每例 finally 中关闭，无文件清理或付费模型流量。测试通过只代表追加内容正确，性能预算没有通过。

## 阶段状态

| 阶段 | 已完成 | 仍未完成 |
| --- | --- | --- |
| P0 | 当前代码/修改核实；持久化计数基线；并发覆盖复现；React 保留来源；计时组件隔离计数 | 相同负载下完整更新链的 1k/10k/100k 对比，巨大单条/多后台场景，真实 profiling 与堆保留路径 |
| P1 | 历史读改写与标题共享队列；非标题字段 patch 避免旧 history 覆盖；并发回归 | 摘要/历史分离、索引与正文块、全量消费者迁移、跨页关联、受控旧 JSON 迁移及崩溃/并发切换恢复 |
| P2 | 全文查看器的单段和 128 游标预算、关闭释放与请求 epoch | 时间线有界页缓存、聚合预算、双向卸载重载、稳定滚动锚点、旧快照/新尾部衔接 |
| P3 | 局部计时、不变正文预处理复用、无变化 reducer 保持引用 | DOM 虚拟化、巨大过程组拆行、活动 Markdown 语义片段、选择/复制/搜索/焦点与动态行高验收 |
| P4 | React 性能记录上限与卸载；查看器晚到请求隔离；300 轮计时与查看器生命周期回归 | 多会话/多窗口聚合预算、ACK/React commit 积压、持久化高水位、快照 resync、语义事件旁路、SDK/订阅等完整释放审计 |
| P5 | 专项及仓库检查、release notes 与实施边界同步 | 下述长期验收，以及 P1～P4 尚未完成实现对应的完整矩阵 |

独立进行的计时、诊断和查看器修复没有改变分页接口；P2 的主缓存仍等待 P1 的稳定存储契约。本次没有自动启用真实数据迁移，也没有设计或宣称无损回退已验证。

## 验证记录

- Electron 专项：session repository / conversation router；并发追加回归先红后绿。原标题并发测试改为先排队 rename、释放被阻塞的 append 读取，再等待两者；保留完整历史和标题断言，适配新串行契约。
- Renderer 最终专项：6 文件、105 项全部通过，3.05 秒；覆盖 Timeline、phase row、reducer、React measure guard、全文查看器和局部 clock，包含 300 次释放循环及 100k 次重复更新/诊断记录。
- 前两次 `typecheck` 通过；`check:hard-constraints`、`check:ipc-codegen` 及本次生产文件专项 ESLint 通过。最终共享工作区 typecheck 未通过：并行修改的 `session-manager.test.ts` 中多处 `{ ensureTaskListId } as AgentSessionRepository` 不满足 TS2352 的结构重叠要求；这批测试替身仍需其正在进行的改动完成后复核。本次没有批量改写该测试文件。
- 首次全量：910 文件、8676 用例，8675 通过、1 个已有注册依赖断言失败，实际时长 254.02 秒。核实实际依赖后补齐该断言，后续注册专项 5 项通过。
- 第二次全量：910 文件、8680 用例，8676 通过、4 失败，245.59 秒。期间共享工作区的 context-budget、context-continuation 及 session repository 的 task-list 功能与测试发生了并行修改，新增测试先于实现被该轮测试读取。失败包括 2 项 budget、1 项 continuation 和当时尚未可用的 `ensureTaskListId`。本次保留了并行修改，没有回退其代码或修改其预算断言。
- 随后复验：session repository 23 项、conversation router 91 项、continuation 4 项和 registry 5 项通过；budget 在并行更新断言后 9 项通过，最后一次 budget 测试前后源码和测试 SHA-256 相同。没有取得一个冻结工作区快照下的全量全绿结果；不能把两个全量过程合并宣称完整通过。
- 最终 Electron 联合专项重跑：上述 5 文件、132 项全部通过，3.88 秒；这不替代全量与最终类型检查的未通过状态。
- 本次没有新增 Worker、原生依赖或改变打包配置，因此没有运行 packaged-asar 检查；没有生成新的正式包。
- 没有新增 capability/tool/IPC schema、Dock、Workflow 或 Deep Link，也没有改变 MCP inspect `beforeIndex`；现有能力清单数量和权威 Skill 的对外契约无需因这些局部修复变更，既有修改保持原样。

## 未完成的长期验收

真实时间耐久测试实际时长：**0 小时**。未运行 8 小时或 24 小时测试。

下列项全部未通过验收、不能从合成测试推定：

1. 正式包与开发版固定窗口、输出字节速率、事件速率和并发量下，输入/滚动/切换/停止按钮本地响应 p95 ≤100 ms。
2. 主线程稳态长任务累计 <5%，不反复出现 >200 ms 历史重算任务。
3. 第 8 小时相对第 30 分钟交互 p95 退化 ≤20%。
4. Renderer、主进程、GPU、SDK 子进程分别记录 RSS/heap/DOM；预热后已回收堆低水位不持续增长，最后一小时增幅 ≤10%。
5. 生产快于消费、Renderer 暂停、多个后台对话与前台回看下，队列/缓存/挂载总量有界且最终正文一致。
6. 100k 历史分块追加/读取、迁移中断恢复、费用/附件/关联/导出一致性。
7. 虚拟化后的原生查找范围、产品搜索定位、全文复制、权限表单、焦点及滚动恢复。

应用运行时验收需要额外授权及隔离测试数据；但 P1～P4 尚未完成的代码工作不应归因于缺少运行时授权。当前交付是部分实施，不能以“只差 8 小时测试”概括。

## 后续修复：长单轮结束后历史为空（2026-09-13）

根因：UI historyPage 为满足用户轮次边界先向前扩到整轮，超过页面字节预算后又按整轮移除，611 条单轮可能返回空 entries；MCP inspect 同条件返回 truncatedTurn 占位。这是读取投影的错误，不能据此判定持久化历史丢失。

本次共用连续记录分页器，只投影当前页候选记录，保留 100 条与原有字节预算。beforeIndex 明确为排他记录索引，兼容旧用户消息边界；UI 可向前加载，MCP nextBeforeIndex 可遍历全轮。跨页工具按 toolUseId 关联；MCP 超大单项摘要也保留该键。MCP 总响应仍无法容纳时显式报错，不返回空历史假成功。无显示记录但仍有旧页、正在加载或历史错误时，UI 显示对应加载入口或状态。

验证采用独立合成数据，不读取正文或凭据，不调用模型，不改用户会话。覆盖 611 条同轮且超过 1 MiB 的 UI/MCP 逐页读取（尾部答案可见，所有 ID 恰好一次，原历史不变）、183 条在工具调用/结果间切页、同名并行工具跨页配对、100k 历史只投影 100 条、UTF-8/JSON 转义字节预算、零游标、追加后的旧游标、越界拒绝、Renderer 向前加载与重新选择、既有尾部刷新/缺口追补/迟到事件回归。

这次修复不迁移存储，不实现页缓存淘汰或 DOM 虚拟化，也不代表长上下文任务无遗漏、无限上下文或长期性能验收通过。未重启用户应用；运行中的旧进程不会因为源码修复自动具备新版主进程分页行为。此前验证记录与未完成阶段仍按各自范围保留。

验证结果（基于 `ad95d7652` 的本次修改）：Electron IPC/分页器/MCP 控制/公开 schema/manifest/tool names 共 6 文件 124 项通过，Renderer timeline 与 chat hook 2 文件 126 项通过，合计 250 项。desktop 完整 typecheck、hard constraints、IPC codegen 一致性与 diff whitespace 检查通过。专项 ESLint 仅报告 control-service 原有 timer 的 prefer-const；对 HEAD 原文运行同一 ESLint 也得到相同告警，本次未改该观察计时逻辑。未运行真实应用或全量测试，不将专项结果当成原失败会话在运行中的旧版本已恢复的证据。
