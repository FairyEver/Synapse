# Agent 上下文预算与自动续跑设计

## 实施状态

2026-09-13 首批修复已删除累计轮次输出硬额度，修正原生工具替换结构、路径交接、任务 namespace 和落盘失败处理。完整契约、覆盖账本、增量检查点和轮换事务仍按 [长任务可靠性计划](../plans/2026-09-13-agent-long-task-state-and-context-reliability-plan.md) 实施，不能将本文件原有自动续跑描述视为已满足最终可靠性保证。

## 目标

长任务自动维护上下文：保留 SDK 原生整理和预计算整理；请求预算不足或整理无效时，用有界摘要与可按需读取的完整检查点轮换 Session。工具执行和任务范围不能因上下文维护被重放或缩减。

## Hard Rules

- 可选 MCP 失败只排除对应连接器；路由初始化或权限等价性检查失败使用 strict 最小 MCP 集合，禁止恢复全量 Synapse schema。第三方对话默认按需加载，保留显式关闭选择；官方端点继续 SDK 原生模式。
- 工具必须先真实执行，再经 `PostToolUse.updatedToolOutput` 治理；不修改原始文件、附件或副作用。大文本先保存到私有只读 artifact，再返回有界预览和引用。单文件最多 16 MiB，超出保存到有序文件并返回索引，不截掉原始正文；模型预览的 2,000 行与默认单结果/单批 50/150 KiB、百炼 8/24 KiB 是上限，实际可见输出还受剩余 token/字节动态限制。并行工具串行记账，避免复用同一余额。治理只针对会进入请求体的模型可见内容：原生文件变更工具（Edit / Write / NotebookEdit）的 PostToolUse 结果是给宿主和界面的整份文件副本，模型只收到 SDK 的短确认行，因此这类结果不截断、不改写、不落盘，按 PostToolBatch 的实际交付字节记账。
- 百炼模型目录保持 1M；整理配置窗口保持 200K。SDK `autoCompactThreshold` 才是真实触发值（该 SDK 的示例为 167K）；不硬编码 33K buffer。字节安全预算保持 5 MiB，对应 Provider 6 MiB 硬上限。
- 在主线程 UserPromptSubmit、PostToolBatch、PostCompact 处检查下一次请求。SDK 完整快照包含系统提示、工具定义、Skill/Memory、消息和附件；新增内容按真实序列化字节保守估算 token。SDK 自动整理触发值独立观察；按实际工作窗口保留 4,096 余量供下一次调用；不足时暂停请求。SDK 控制快照有 5 秒超时，失败保留保守账本；不声称观察到精确 HTTP body。
- 完整字节账本跨普通快照保留。compact 成功不能假设旧工具结果消失；保留 `messageBreakdown.toolResultTokens` 对应的尾部估算，并恢复已释放的工具额度。SDK token 下降只是淘汰监测，不是宿主主动历史编辑能力。
- 不按 SDK 整理阈值的 75%/释放 10% 判定无效；整理后只有新鲜快照显示当前工作集仍无法容纳下一步时才触发预算处理。原生 compact 时序与覆盖水位的完整兼容性门禁仍待完成。
- SDK hook 暂停期间，主进程先保存脱敏原始任务、完整 history、SDK 摘要与最新工具批次，再关闭旧 Session 和清除 resume ID，通过既有 SessionManager、权限与审计创建干净 Session。前台、Automation/Workflow 与 Relay 均可主动维护；原 Synapse conversation/turn/队列不变，不产生重复用户消息，不重放工具调用。
- 私有检查点是短行 JSONL 分片，每行包含 record、offset、text，可用 Read 的 offset/limit 恢复任意位置，包括原本单行的大 JSON。正文不作长度截断；凭据及图片 Base64 除外，附件仍使用原件。新请求只注入最多 32 KiB 的任务/最近进度/整理摘要和只读索引；执行投影保留真实路径、早期要求和最新执行批次；优先消费已保存但未确认处理的结果，不要求重新搜索已知工作目录。
- 交接文件复用 tool-output artifact 的 DataRepository 元数据、0600 权限、只读授权、对话删除及普通导出隔离。内部交接信号不能进入 Renderer/history；界面只收到既有 compactBoundary。不得新增公开 MCP 或任意文件读取能力。
- 必须等待已接纳 steer 落库；轮换期间暂停新 steer。取消、Renderer 丢失和 abort 优先；检查点写入失败时不启动新 Session。连续没有工具进展的轮换必须停止，避免固定上下文本身超限时无限重启。
- 轮换前保留已观察到的 Assistant 消息用量（按消息 ID 去重），合并到最后一次结果；不能把最后一个 SDK Session 的美元费用冒充整轮总费用，本地成本继续按合并后的用量估算。
- 旧 Session 关闭前完成文件检查点收尾，然后标记 superseded；新 SDK 只跟踪本轮换后的文件修改，不承诺跨 SDK rewind。
- 已发生的 Provider 网络/API 错误不自动重放；精确 6 MiB 或 rapid_refill_breaker 优先通过检查点自动交接，无法接管时才保留已有可恢复错误兜底。主动维护与失败请求重试不同，不掩盖磁盘故障、权限拒绝或 Provider 故障。

## 用户体验与验证

- 顶栏区分实际占用和真实整理触发值，Tooltip 保留模型上限。只有配置窗口而没有 SDK 阈值时显示待确认，不虚构剩余空间。
- 验证可选 MCP 离线/待授权/超时、权限失败的最小集、动态双预算、保留尾部、并行工具限额、有效/无效整理、跨多次轮换的同轮完成、取消及落盘失败、UTF-8 完整检查点和 Renderer 隔离。
- 本地 fake SDK 回归不代表真实 Provider 长任务验收；不启动应用或发起计费模型请求来替代静态门禁。

## 参考实现

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript/issues/389) 已确认大型 MCP `structuredContent` 可能绕过内置截断并触发相同的 autocompact thrashing；官方仓库给出的宿主侧规避方式是 `PostToolUse.updatedToolOutput`。
- [Pi](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/truncated-tool.ts) 对工具输出采用 50 KiB/2,000 行双限制，并按内容类型保留头部或尾部。
- [OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts) 在请求前估算完整模型可见上下文，预留输出缓冲，并用结构化摘要与受限 recent tail 重建上下文。

- [Claude Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)：PostToolBatch 位于下一次模型请求之前；PostCompact 提供整理摘要。实现核对本地 SDK 0.3.245 类型。
