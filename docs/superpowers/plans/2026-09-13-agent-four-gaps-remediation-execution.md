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

当前新增协议专项：2 文件、7 项通过（11.26 秒）。P01 仍需补齐其它 hook 改写、SessionStore 丢批/延迟和结构化/error 终态，不能勾选全部完成。

## P02：DataRepository 原子基础

- `types.ts`：schema 明确声明字段白名单、复合/唯一索引、单记录预算；结构化 commitBatch、CAS guards、queryRange。
- `backends/sqlite.ts`：同连接 BEGIN IMMEDIATE，批次任一步失败整体回滚；冲突单独返回；提交后只发布 ID；insert 不调用 get/读取 previous。只有显式 opt-in namespace 适用，普通 namespace 通知契约保留。
- `backends/sqlite-query.ts`：参数绑定，索引名/字段白名单，等值前缀 + 下一字段范围，keyset 无 OFFSET，最多 101 行。
- `repository.ts` / `factory.ts`：只调度已注册 SQLite schema，不向业务暴露 SQL/DatabaseSync；旧 namespace 默认不启用 atomic。
- `config.ts`：集中 128 项、256 KiB、101 行预算。

先建立 5 项失败用例，均因缺少 API 失败，再实现。追加跨 namespace SQL 故障、普通写入绕过预算回归后，DataRepository 全目录 17 文件、160 项通过，1.51 秒。hard constraints、修改生产文件 ESLint 通过；最终类型检查和提交结果待补。

边界：尚未启用 V2 产品写入；Agent 的完整索引声明随 P03 落地。巨大旧 JSON 的 raw-value/native RSS/取消测量仍未执行，P02 的迁移源访问门禁未通过。当前事务默认延续 WAL + NORMAL，仅保证进程崩溃一致性，不声称断电持久性。

## 后续与授权门禁

P03–P16 未完成。严格覆盖产品边界已按计划第 2.2 节向用户请求确认，收到明确答复前不启用。未启动应用、真实 Provider 或迁移真实数据库，未安装依赖、发布或 push。真实长跑 **0 小时**；正式包容量、8 小时耐久与真实任务质量均未通过。
