# Claude Agent SDK 原生上下文生命周期

状态：生效（2026-09-15）

## 决策

Synapse 的 Agent、Relay、Workflow 与 Automation 统一依赖 Claude Agent SDK 0.3.245 的持久 Streaming Input、session resume、Agent Loop 与原生 compact。宿主不再预测下一次 HTTP 请求体、不设置本地 compact 窗口、不改写工具结果，也不因容量错误创建新 Session 或交接任务。

官方依据：

- [Agent Loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)

百炼的 6 MiB 是序列化 HTTP 请求体限制，不等同于模型 token 上限。请求体可能包含系统提示、历史、工具与 MCP schema、工具结果和图片，因此大任务可能很早触发。Synapse 不再尝试在 SDK 外重建这份请求体。

## 运行时不变量

- 每个会话保留一个 Streaming Input query；存在 SDK session id 时使用 `resume`。
- 所有 SDK query 不传 `maxTurns`、`autoCompactEnabled`、`autoCompactWindow`、`precomputeCompactionEnabled` 或宿主 token/body/tool-output 预算。
- Read、Bash、MCP 数组、`structuredContent` 与图片结果保持 SDK 原始形态。Synapse 不使用 PostToolUse/PostToolBatch hook 截断、落盘替换或做结构完整性门禁。
- SDK `compacting`/`compact_boundary` 事件继续进入 timeline。只在 compact 完成或一轮结束后读取 `getContextUsage()`；读取失败不改变会话生命周期。
- 请求体过大、rapid refill 和其它 Provider/SDK 异常只产生一次普通失败。已知的 6 MiB 请求体超限应显示为不可恢复的容量错误，给出减少图片或大型工具结果、或新建对话的操作建议，不得误报为网络中断。不得重试、轮换 Session、注入恢复 prompt 或阻断下一条用户消息。
- 保留权限审批、工作区直接写入边界、AskUserQuestion、文件 checkpoint/rewind、Persona/子 Agent 工具策略、连接器、项目规则和 Skills。
- Agent 与内置 Claude Code 终端只透传 Provider 显式配置的 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`。模型能力目录不得推导该变量。

## 旧数据兼容

旧 conversation 的 `taskListId`、`taskProgressScope`、`contextHandoff` 与 `contextRecovery` 仍通过 V1 schema 读取，但不进入运行时和 Renderer。下一次正常保存会移除这些字段，并按 project/conversation 尽力删除 `agent.task-progress` 旧行；清理失败只记录脱敏日志，并在以后保存时重试。没有全库破坏性迁移。

Artifact 存储继续服务历史、附件与界面展示；仅服务工具输出治理、交接和任务证据的调用面已删除。

## 验证

- 反向契约检查所有入口不再传 host turn/compact/预算参数，且 Provider context 环境只显式透传。
- 安全回归覆盖权限、工作区、提问、checkpoint/rewind、Persona 与连接器。
- compact 回归验证同一 query/session 在边界后继续；容量错误回归验证只有一次普通失败。
- 真实百炼 A/B 使用同一 SDK 捆绑 Claude Code runtime、Provider、模型、工作目录、环境和材料。若裸 SDK 仍早于 Claude Code 失败，只保存脱敏差异并单独评估 SDK 版本或调用模式，不重新引入外围兜底。

2026-09-15 的九轮百炼 A/B 已验证两条链路在同一轮遇到一次大输入失败，随后各自在原 session 中跨过三次原生 compact 并完成五轮后续对话。结果与未通过的复杂 Read 补充项见[验收记录](../../reference/2026-09-15-agent-native-context-bailian-ab.md)。

## 被取代的设计

2026-09-12 至 2026-09-13 的上下文预算、长任务交接、图片重呈现、任务证据和 Renderer 恢复设计保留为历史调查，但不再定义产品行为。
