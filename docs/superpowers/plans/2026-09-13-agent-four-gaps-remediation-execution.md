# Agent 四项缺口实施记录

2026-09-13。实施中，尚未完成四项修复。计划：`2026-09-13-agent-four-gaps-remediation-plan.md`。

## P00：冻结基线

HEAD `15678574e12f7afaf741ac8c61f1956a59ec8d2a`，desktop 0.2.457，Claude Agent SDK 0.3.245，Streamdown 2.5.0。开始时已有大量其他任务未提交改动；本次不清理、不混入提交。初始状态、消费者 SHA-256 与存储基线见同目录 `2026-09-13-agent-four-gaps-baseline.json`。完整工作区 tracked/index diff 和文件哈希另保存在本机临时目录 `synapse-four-gaps-baseline-mbnlk77f`。

基线命令：`pnpm --filter @synapse/desktop exec vitest run tests/perf/agent-long-running-storage.test.ts electron/services/agent-runtime/__tests__/session-repository.test.ts electron/services/agent-runtime/__tests__/sdk-native-long-task-contract.test.ts`。3 文件、27 项通过，9.00 秒。

1k/10k/100k 历史追加仍读取两次整对象，物化 2k/20k/200k 条；逻辑读取 JSON 为 274500/2740500/27400500 字节，写入为 137327/1370327/13700327 字节。不是磁盘 IO 或 RSS 测量。保留既有 mutation 队列、标题 patch、稳定 Task ID、原生整理、权限/脱敏、ACK、文件 checkpoint。

### 消费者归属与回归路由

本次 rg 枚举 `ConversationEntryV1`、conversations namespace、appendHistory 和相关 `.history` 访问。下表的新 API 均为迁移目标，不表示消费端已迁移。

| 消费端 | V2 归属 | 回归/保留语义 |
| --- | --- | --- |
| session-repository | summary + append receipt + relation/revision | session-repository：并发追加、标题、费用、Task ID |
| session-manager / session-lifecycle | summary / generation | session-manager、cancel：会话身份、权限、取消 |
| conversation-router | summary / MessageWriter / history iteration | conversation-router：工具关联、费用去重、终态、steer |
| agent-runtime-service / index | summary / 完整结果引用 | runtime-cancel、runtime：入口隔离、完整输出 |
| context-continuation / context-recovery | checkpoint refs / bounded ledger | continuation、recovery：原要求与路径、恢复边界 |
| command-router / persona-runtime | summary / config refs | command-router、persona-runtime：slash 与 persona 保留 |
| conversation-export-service | revision-bound iterator | export：全部文件共享快照、附件和脱敏 |
| ipc-sessions / ipc-shared | summary index / history page | ipc-sessions、ipc：列表与分页兼容 |
| ipc-messages | content chunk / permission relation | ipc、ipc-schema：scope、offset、权限校验 |
| app-capabilities/agent/main/control-service | summary / TurnIndex / record cursor | agent control-service：旧整轮模式及 truncation |
| app-capabilities/agent/main/conversation-reference / conversation-target | bounded summary index | conversation-reference：跨项目唯一定位 |
| bridge-adapter-service | summary | bridge-adapter：Relay 会话复用与外部完整回复 |
| provider-reference-scanner-deps | summary/config refs | provider-reference：模型/provider 引用完整性 |
| runtime/data-repo/{index,schemas/index,schemas/placeholders} | V2 明确类型；V1 留作迁移输入 | schemas、backup/import：不能伪造空 history |
| config-backup-service / DataRepository export/import | namespace + artifact manifests | config-backup、repository：引用完整、旧包兼容 |
| Renderer use-chat-connection / reducer / events / timeline | cursor page cache / flat rows | use-agent-chat、timeline：resync、滚动、权限与完整查看 |
| Workflow / Automation / Relay 的 AgentRuntimeTurnResult 消费端 | 文本迭代器/受控引用，在出口明确物化 | 现有各入口专项；禁止使用 UI 32 KiB 投影替代完整结果 |

## P01：原生 SDK 协议

新增真实 native fixture 和 Task/recovery 协议测试，复用既有 loopback/SSE 隔离方法；独立 HOME/config/cwd，无真实 Provider、用户设置或用户 MCP。测试源码记录逐请求字节数，不保存原始生产请求。

已验证：TaskCreate 返回 task.id；TaskUpdate metadata/status 成功与不存在任务失败；TaskGet/List 不返回 metadata；预分配 sessionId 对应 UserPromptSubmit；PostToolUse additionalContext 进入下一请求。两个 Read hook 逆序完成仍按 tool_use_id 对应替换正文。PostToolBatch 内 getContextUsage 可完成；interrupt 和 interrupt→close 后释放暂停不会再发送请求。Stop 抛错或超时仍可能得到 SDK success，因此必须保留宿主二次验收。原生 `/compact` 用既有 session 产生 PreCompact→PostCompact→compact_boundary。

真实发现：单独 `close()` 后释放 PostToolBatch，即使 hook 返回 continue:false，仍观测到第二次模型请求（连续两次复现）。后续关闭适配必须先取得 interrupt 确认；不能将 close 返回当作已撤销旧执行的证明。当前产品 close 实现尚未接入该适配，此项仍待修复，不把协议夹具通过视作产品已修复。

当前新增协议专项：2 文件、12 项通过（6.93 秒）；已补齐其它 hook 覆盖宿主 prepared 输出、SessionStore 延迟与三次失败丢批、结构化输出以及原生 maxTurns error 终态。镜像失败出现 mirror_error，但 SDK 仍可成功结束。TaskCompleted 的完整覆盖与自动 compact 后迟到/重复快照的宿主处理仍未通过本工单验收；P01 不勾选全部完成。

## P02：DataRepository 原子基础

- `types.ts`：schema 明确声明字段白名单、复合/唯一索引、单记录预算；结构化 commitBatch、CAS guards、queryRange。
- `backends/sqlite.ts`：同连接 BEGIN IMMEDIATE，批次任一步失败整体回滚；冲突单独返回；提交后只发布 ID；insert 不调用 get/读取 previous。只有显式 opt-in namespace 适用，普通 namespace 通知契约保留。
- `backends/sqlite-query.ts`：参数绑定，索引名/字段白名单，等值前缀 + 下一字段范围，keyset 无 OFFSET，最多 101 行。
- `repository.ts` / `factory.ts`：只调度已注册 SQLite schema，不向业务暴露 SQL/DatabaseSync；旧 namespace 默认不启用 atomic。
- `config.ts`：集中 128 项、256 KiB、101 行预算。

先建立 5 项失败用例，均因缺少 API 失败，再实现。追加跨 namespace SQL 故障、普通写入绕过预算回归后，DataRepository 全目录 17 文件、160 项通过，1.51 秒。hard constraints、修改生产文件 ESLint 通过；完整 desktop typecheck 随后通过。P02 原子基础提交 `48a775407`，未包含其他任务已有改动。

边界：尚未启用 V2 产品写入；Agent 的完整索引声明随 P03 落地。巨大旧 JSON 的 raw-value/native RSS/取消测量仍未执行，P02 的迁移源访问门禁未通过。当前事务默认延续 WAL + NORMAL，仅保证进程崩溃一致性，不声称断电持久性。

## P03：隔离基础草稿（未提交、未接入产品）

文件：`schemas/agent-history.ts`、`history-content-store.ts`、`history-repository.ts`、`history-repository.test.ts`，以及 `artifact-store.ts` 的有界正文回读方法、`config.ts` 的 V2 容量常量。

已在隔离数据库/临时 artifact 目录实现与验证：

- 摘要不含 history；descriptor/content/chunk/revision/turn/operation receipt 使用独立集合及声明索引。
- append 原子提交描述符、摘要计数、轮次索引与回执；相同操作同载荷幂等、异载荷冲突。32 并发追加不读既有 history/list。
- 32 KiB UTF-8 块，独立 UTF-16 偏移、块 hash 和完整正文 hash；16 MiB 以上中文/emoji 正文以及 128 KiB metadata 可完整回读。
- 校验项目/对话 scope、受控路径、文件类型、大小与 hash；拒绝拆分代理对的偏移。
- staging→committed/orphan；并发相同操作产生的未使用正文标记 orphan；落盘失败不追加或发布历史。
- 页查询使用 seq keyset，附快照描述；revision 读取具备接口基础，但修订写入与全链路一致快照尚未完成。

专项 6 项通过。**不能把它称为 P03 完成**：尚无流式 MessageWriter 与 250 ms 刷盘、全消费端接入、异常尾块恢复及 S01 的 1k/10k/100k V2 追加验收；append 输入目前仍接收完整字符串。尚未将新 schema 放入产品 allSchemas，未切换现有读写。Orphan 清理须等 P15 的引用生命周期验证，当前不自动删除。

### 需要用户处理的前置依赖归属

当前 HEAD 的 `artifact-store.ts` 没有 `persistToolOutputText`，`AgentArtifactEntryV3` 及其 exports 也来自此前任务未提交的工作区。本草稿复用了这些实际存在的实现，未另建一套 artifact 存储。

根 AGENTS.md 要求“只提交本次任务产生的代码……不得混入用户或其他任务的未提交改动”；本计划第 14 节要求“各中间提交都必须可编译”。仅提交 P03 新文件会缺少已有前置实现，直接提交整文件又会夹带其他任务改动。因此已请求用户选择：由原任务先提交前置代码，或明确允许把本计划必需的已有前置改动纳入提交。必要依赖限 `artifact-store.ts` 的工具正文存储、`schemas/placeholders.ts` 的 V3 artifact 结构及 `schemas/index.ts` / data-repo `index.ts` 对应 exports；不包含无关 UI、MCP、更新等已有修改。收到答复前保留草稿，不提交 P03 或继续执行依赖它通过的后续工单。

## 本轮最终验证与提交

- 联合专项：DataRepository 全目录、V2 history 草稿、三份 native SDK contract、artifact store、旧 storage perf，共 **23 文件 / 189 项通过**，9.20 秒。
- 完整 desktop `typecheck` 通过。此前共享工作区新出现的 `monitoring-failure-projection.test.ts` 曾有两项异步替身类型错误，后续由其来源改动更新后已通过；本次没有修改该文件。
- `check:hard-constraints`、`check:ipc-codegen`、修改生产文件 ESLint、`git diff --check` 通过。
- 没有运行全量 desktop test；尚未进入稳定集成点。不以当前专项代替 P16 验收。
- 已提交：`b129cd198` 基线与消费者清单；`48a775407` 原子存储基础；`5619766a5` SDK 协议测试。P03 草稿因上述依赖归属待确认而未提交。
- 本轮没有启用任何产品读写变化，没有注册/更改公共 capability 或 IPC schema，没有改变打包边界。RELEASE_NOTES_PENDING、能力数量和权威 MCP/Skill 不因这些未启用基础模块新增完成声明；它们的原有未提交修改保留。

## 后续与授权门禁

P03–P16 未完成。严格覆盖产品边界已按计划第 2.2 节向用户请求确认，收到明确答复前不启用。未启动应用、真实 Provider 或迁移真实数据库，未安装依赖、发布或 push。真实长跑 **0 小时**；正式包容量、8 小时耐久与真实任务质量均未通过。
