# Agent 监视发现专项修复计划：完整交付、恢复与完成验收

日期：2026-09-13。状态：**部分实施；图片强停门禁未通过，尚未完成全计划验收**。实测证据、已交付范围与剩余工单见[实施记录](2026-09-13-agent-monitoring-findings-remediation-execution.md)。

本计划针对一次只读监视中发现的五类缺陷及失败恢复状态差异。目标不是让模型更愿意说“完成”，而是让系统保留真实执行事实、交付缺口与任务要求，在可恢复时从确定断点继续，不能恢复时准确结束。

## 1. 适用范围与现有计划的关系

本文件是以下方案的专项实施与验收补充，不创建第二套历史、任务、预算或轮换状态库：

- [四项缺口方案](2026-09-13-agent-four-gaps-remediation-plan.md)：共用身份、DataRepository 原子操作、历史索引、HandoffRecord、Task metadata 协议和工作单元，以该方案为实现基座。
- [长任务可靠性计划](2026-09-13-agent-long-task-state-and-context-reliability-plan.md)：保留原始要求、结果覆盖、恢复安全及跨代进度原则。
- [实施记录](2026-09-13-agent-long-task-state-and-context-reliability-execution.md)：判断哪些改动已存在，不能重新实现或把未完成项误报为已完成。
- [预算设计](../specs/2026-09-12-agent-context-budget-governor-design.md)、[容量设计](../specs/2026-09-13-agent-long-running-capacity-design.md)及 `docs/agents/agent-runtime-security.md`：继续约束权限、存储、图片处理和生命周期。

本次仅编写计划。不修改被监视对话、不恢复其运行、不执行其原任务、不启动应用、不调用真实 Provider、不迁移数据、不发布。实施期间也必须重新检查授权，不能从“编写计划”推导出上述操作的授权。

范围包含：非文本结果恢复、文本范围交付、任务验收、停滞识别、诊断导出与失败状态一致性。历史增量存储及持久交接事务是依赖；全量 Renderer 重构、UI 美化、模型替换、通用文件系统沙箱不是本专项的新增任务。

## 2. 事实、推断与当前状态

监视对象的原始要求：处理 3 个压缩包，全部文本分块读取，每块最多约 500 行，48 张图片逐张使用 Read 检查，保留进度清单，完成第二轮时间顺序复核和跨日志比较；不得用抽样替代。只在全部真实完成后输出 PASS。

| ID | 可核实事实 | 可得出的结论 | 不能据此声称 |
| --- | --- | --- | --- |
| F01 | 清单含 81 个文件，33 个文本、48 张图片；总计 182,030,632 字节，文本 161,017,892 字节 | 工作量明确，可以建立资源集合和覆盖分母 | 清单存在即文件已读取；总字节数即模型已消费字节 |
| F02 | 多次 Read 返回截断提示，后续 offset 曾直接跳到更后位置，之后补读部分缺口 | 模型在手动推算续读范围，交付协议不够明确 | 所有缺口都未补；工具 success 即全文已交付 |
| F03 | 最终首次图片 Read 后报非文本结果超过上下文预算，execution_failed，监视投影 recoverable=false，转为 idle | 本轮失败且图片未见成功检查回执；不是正常完成 | 图片本身超过 Provider 硬上限；发生了 HTTP 6 MiB 错误 |
| F04 | Agent 标记完成 10 个文本文件；其余全文与逐张图片验收未完成，未输出规定终报 | 原测试未通过 | 10 个标记即 10 个已由宿主独立验证的完整阅读结果 |
| F05 | A 包 4 个主要 JSON 的解析实际失败；Agent 未充分验证就推广至三个包及脱敏根因 | 历史导出可解析性有异常证据，应建立回归 | 三包全部损坏；已确认当前导出代码仍有同一缺陷 |
| F06 | Agent 反复讨论预算、用关键词和聚合统计作确定因果结论 | 模型执行与诊断质量有问题，宿主缺少可核验完成依据 | 可以通过确定性代码证明模型理解正确或自动修正所有推理 |

当前源码核对发现：图片超预算分支仍直接调用 `stopForOutputIntegrity`；该函数当前产生 recoverable=true，与监视时结果不同。导出当前使用结构化脱敏后 JSON 序列化。两者都必须记录构建与工作区基线后复测，不得仅凭当前源码将历史问题宣布修复。

## 3. 修改前必须固定的边界

### 3.1 不变的约束

1. 原生 Claude Agent SDK 继续管理主 query、resume、自动整理和工具执行；不编辑 SDK 私有 transcript，不虚构 `Query.compact()` 或结果注入 API。
2. 图片仍通过受控原件路径和原生 Read 进入主 query。不新增 image content block、附件子 query、隐藏摘要调用、附件 MCP、后台子 Agent或切片/OCR替代原图。
3. 宿主不能省略图片后让模型“根据已有信息完成”。安全停止保留为最终兜底；不得仅删除停止分支。
4. 只允许重新呈现确定为只读且版本可验证的原件，或读取已保存的不可变结果；不得重跑 Bash、网络写入、上传、发送消息等有副作用操作来恢复输出。
5. 继续使用 DataRepository、AgentArtifactStore、SessionManager、PermissionGuard 和 AuditSink。原件不写数据库 BLOB，执行引用不进入普通导出，原始凭据不进入诊断。
6. 当前任务的预算与用量跨 generation 连续，不提高用户配额，不因换 Session 重置配额。5 MiB 内部预算与百炼官方端点 6 MiB 上限保持现有作用域，不扩展到所有 Provider。
7. 用户取消、权限撤销、所属 Renderer 失联优先于自动维护；不自动启动进程重启前的本地交互任务。未知副作用保留 unknown 并阻止自动重放。

### 3.2 需要明确处理的产品规则冲突

现行规则规定“模型是否调用 Read、调用次数和是否读完不属于 Synapse 的完成条件”。本计划拟增加的严格完成验收**只用于用户明确要求完整覆盖且已建立可校验任务契约的受跟踪任务**；普通聊天和普通附件使用不增加强制全读要求。

这是拟议的产品边界调整，不是当前已生效规则。编写方案无需阻塞；实施严格模式前须确认这一限定并同步规则。未确认时可以完成协议夹具、数据结构和隔离测试，但严格模式不能启用，也不能报为已交付。不得用宿主关键词匹配将所有“总结、阅读”请求自动升级为强制全读。

现有早期计划提及私有进度 MCP，本专项采用四项缺口方案中已细化的**原生 TaskCreate/TaskUpdate metadata + hooks**路径；不同时实现两种入口。Task 被禁用或协议验证失败时不强行启用工具。

### 3.3 能保证和不能保证的事情

- 可以保证资源身份、保存完整性、可证明的交付范围、恢复次数、校验结果和最终状态一致。
- SDK 没有通用逐字节“模型已理解”回执。生产交付证据必须区分 prepared、SDK-accepted、request-observed；后者只有实际观察到请求时才能记录。
- 本地 loopback 测试证明适配路径兼容，不能伪装为每次生产请求均已被观测。模型回报“看过”只是协议确认。
- 可以验证计数、范围、产物和必需检查，语义结论仍需评测或人工复核；不能宣称宿主能机械证明“根因正确”。

## 4. 修改位置与复用点

以下路径均已存在；表中的扩展字段和协议仍是拟实现内容。

| 责任 | 主要入口 | 修改内容 |
| --- | --- | --- |
| 工具结果与请求边界 | `desktop/electron/services/agent-runtime/claude-sdk-session.ts` | 结果分类、挂起/交接、并行预留、回执关联、Stop hook、失败兜底 |
| 文本输出 | 同目录 `tool-output-governor.ts` | 精确源范围、原生结构适配、预算内页、无歧义续读提示 |
| 字节/token 账本 | 同目录 `context-budget.ts`、`context-usage.ts`、`provider-transport-policy.ts` | 快照水位、非文本待交付成本、跨代账本、估算来源 |
| 结果保存与原件 | 同目录 `artifact-store.ts`、`attachment-staging-service.ts`、`attachments.ts` | 不可变资源引用、版本校验、有界范围页、租约及删除 |
| 持久交接 | 同目录 `context-continuation.ts`、`conversation-router.ts`、`session-manager.ts`、`session-repository.ts` | 共用 HandoffRecord、generation fence、恢复确认、用户队列 |
| 完成/失败 | 同目录 `turn-outcome.ts`、`context-recovery.ts`、`agent-error-messages.ts`、`sdk-event-bridge.ts` | 同一完成检查器、恢复原因、终态投影 |
| 导出 | 同目录 `conversation-export-service.ts` | 可解析输出、同一快照、缺口标记、结构化脱敏 |
| 存储基础 | `desktop/electron/runtime/data-repo/` | 按共用计划实现原子操作、索引、schema；不导入业务 service |
| 协议验收 | `desktop/electron/services/agent-runtime/__tests__/sdk-native-long-task-contract.test.ts` | 真实已安装 SDK + 本地 loopback，检查实际出站与 hook 次序 |
| 状态端到端 | `desktop/electron/modules/agent/`、`desktop/app-capabilities/agent/main/control-service.ts`、`desktop/src/modules/agent/` | IPC/MCP/UI 对同一持久终态一致，必要时补状态回归 |

细分 helper 时先复用现有目录类型，避免继续扩大 SDK session/router 巨型文件；只抽取本专项新增职责，不重构相邻无关业务。

## 5. 共用资源与进度契约

复用四项缺口方案中的 ConversationScope、ExecutionIdentity、HistoryPosition、Requirement、WorkUnit、Receipt、ProgressCommit、HandoffRecord。存储 namespace 和基础类型只定义一次。

针对本次失败扩展的最小字段：

| 对象 | 必需字段与语义 |
| --- | --- |
| ResourceVersion | 受控 resourceId、版本、类型、长度、不可变引用、内容摘要；摘要用于完整性，不写到外部日志；本地 stat 仅作变化提示 |
| RangeReceipt | toolUseId、generation、resourceVersion、requested/acquired/prepared 范围、deliveryEvidence、omittedRanges、resultRef、nativeTruncated、状态 |
| PendingPresentation | 原始 toolUseId、resourceVersion、类型、成本估算、最后尝试 generation、次数、未交付原因；图片按 item 记录，不能用文本范围冒充 |
| WorkUnit | requirementRevision、resourceVersion、method、passId、requiredRange/item、dependsOn、findingRef、receiptRefs、effectiveStatus |
| ProgressState | 不同阶段的新增范围/单元数量、最后有效 revision、无进展轮换数、补齐次数、跨代用量；去重后再增加 |
| FailureDetail | 机器原因、失败阶段、资源受控引用、已保存/未知结果、是否可重取、是否需用户动作；消息文本不作为恢复路由键 |

额外规则：

1. 文本规范坐标为同一资源版本的 UTF-8 半开区间 `[start,end)`；保留 BOM/CRLF/原始字节语义，解码器不静默 `errors=replace`。非 UTF-8 资源保存原编码及映射，不能把解码后的字符数当原始字节数。
2. 行号是原生 Read 的输入/显示坐标，必须由同版本索引映射；元数据、行号前缀、截断提示均不计入正文覆盖。当前治理会将 filePath/startLine 等拼入 Read content，需在适配层消除显示行号与源行号混用，保持 SDK 原生 schema 合法。
3. 目录/压缩包先封存资源集合；同内容但不同必需文件项不因 hash 相同自动消失。硬链接、重复路径、大小写差异及软链接按既有授权规则显式处理。
4. 空文件是明确工作项；未知或不支持格式必须可见，不默默从分母剔除。资源发生变化，旧版本范围不能与新版本范围合并。
5. 第一轮阅读、第二轮复核使用不同 passId。第一轮的覆盖证据不能自动满足“重新检查”的要求；第二轮必须有新的复核结论与相应证据。结构统计、完整文本阅读、视觉检查是不同 method。
6. 同一 receipt 重放幂等，不增加覆盖。程序扫描可以支持统计，但不能升级为 Agent 全文阅读或视觉检查。
7. 任一未知原生结果结构、SDK 原生截断或无法核对的版本均为 unknown；不凭字符串长度推导完成。

## 6. 文本精确续读

### 6.1 执行流程

1. 工具真实执行后，按 toolUseId 关联原生返回，先判定 SDK 是否已截断。只保存实际取得的范围；不能把 SDK 丢掉的正文标为完整落盘。
2. 大结果完整保存到已有受控 artifact，超过 16 MiB 按现有分片策略保存；提交 manifest 前核对所有分片。对已经存在的同一不可变结果复用引用，避免读取一次又生成一层 artifact。
3. 使用输出预算减去原生结构、JSON 转义、完整引用与页说明的成本，得到正文预算；UTF-8 边界及用户 500 行上限同时满足。不得用“500 行”承诺固定字节数。
4. 返回页描述：resourceRef、version、实际源 start/end、下一 cursor、hasMore、遗漏范围、resultRef、证据强度。只把真实正文纳入范围；截断提示必须能完整显示。
5. nextCursor 绑定 scope/resourceVersion/位置，过期或跨会话引用拒绝。普通原生 Read 不接受 cursor 时，由受控页 manifest 映射为具体分页文件和 offset/limit，不发明 SDK 参数。
6. 超长单行 JSON 使用可逆的短行片段封装供原生 Read 阅读，记录 fragmentId、源范围、转义规则和校验信息；切分依据序列化后的实际预算。还原结果必须与原始字节一致，不改写 JSON 数字精度、重复 key、字符串或非法语法。
7. 源文件已变化则重新取受影响版本或阻塞；Bash 原始输出缺失不得重跑命令。宿主没有资格自动重新取得的资源维持明确缺口。

### 6.2 覆盖计算与恢复

按 `(requirementRevision, passId, resourceId, resourceVersion, unit)` 合并重叠/相邻区间，计算 `required - validCoverage`，下一读取从第一缺口开始。验证函数纯化，乱序回执结果必须一致。

示例：要求 `[0,10000)`，回执 `[0,4000)`、`[3000,7000)`、`[8000,10000)`，仍缺 `[7000,8000)`；读取总量超过 10000 也不得通过。

页未完整交付则不推进完整覆盖；模型处理声明必须引用对应合法回执，不能以任务勾选替代。新代只收到缺口首页和完整索引引用，禁止把所有范围数组塞进恢复上下文。

验收：中文/emoji/CRLF、8 MiB 单行、500 行内超预算、单字符边界、乱序并行、重复页、文件变化、原生截断、artifact 落盘失败与分页再截断均无丢失或虚假完成。

## 7. 图片及非文本结果的恢复

### 7.1 两种容量问题分开处理

- **当前上下文不足**：原件在新的合法工作集能够容纳，应保留待呈现引用并交接，再在主 query 中读取同一版本。
- **单件在干净上下文也无法容纳**：不是轮换可解决的问题。停止为明确可恢复阻塞，说明需用户改变输入/任务方法；不自动压图、切片、OCR、替换 Provider 或无限轮换。

元数据大小不是实际 SDK image payload 大小。预检估算要注明来源和不确定性；取得原生结果后用真实序列化结构校核，不能把历史附件总量视作当前请求体。

### 7.2 可实施的主路径与协议门禁

1. 第一次工具执行产生非文本结果时，在 PostToolUse 保存 PendingPresentation 和原件身份，保留 acquired 状态，尚未呈现不算视觉完成。用户草稿附件引用不得转移所有权；普通本地文件也必须沿原授权核对版本。
2. 若能容纳，保持原生结果不变并结算预算；无需额外 Session 或图片摘要。
3. 若不能容纳，在下一模型请求前暂停，并进入共用交接事务；不返回“图片已处理”或伪造文本成功结果。
4. **先通过真实 SDK 夹具证明**：PostToolUse 挂起期间，保存、取消与 close 可完成，且超预算原结果未被继续发往 Provider。未证明时保留现有安全停止，并将图片自动恢复列为未交付，不能硬接一个猜测 API。
5. 新代恢复输入仅包含原始目标、未完成图片项、合法原件引用、上一轮工具已执行但未交付的事实。新主 query 通过原生 Read 重新呈现这个只读原件；记录 originalToolUseId 与新的 presentationAttempt，禁止重新执行产生图片的截图/Bash/上传动作。
6. 已呈现图片由模型在原生 Task metadata 协议中提交对应检查结果引用；宿主只校验项、版本、回执及方法，视觉语义通过评测核对。检查器读图片头不能算视觉检查。
7. 图片所在批次的其它结果按各自回执处理：已执行且持久的副作用不重放；未交付文本从 artifact 续读；仍未知的副作用先核对，不直接启动业务动作。

### 7.3 收敛与原件生命周期

- 同一图片因容量不足允许一次干净 generation 的重新呈现；仍无法呈现或没有新增交付进度则阻塞。已呈现后的第二轮复核不是失败重试，按 passId 单独计。
- 恢复前验证资源版本与所有权。原文件删除、权限撤销、hash 不匹配或引用失效均停止，不拿路径相同的新文件替代。
- 不可变快照如确有必要，复用受控 artifact 保存，保持原始字节且在原授权范围内；引用本身不授予读权限。不永久 pin 整个历史附件目录。
- 活动任务和可恢复 checkpoint 引用的资料不按普通诊断 TTL 删除；会话删除、取消后的保留/回收、备份和全局 storage root 迁移跟随既有所有权规则。清理失败保留待回收记录，不能先删唯一引用。
- 如果原生图片结果没有可验证的受控原件引用，明确 unsupported；不在数据库/history 塞 Base64 兜底。

## 8. 持久交接、失败状态与预算诊断

复用 HandoffRecord 状态机：running → quiescing → checkpoint_prepared → handoff_committed → starting → input_prepared → input_submitted → recovery_acknowledged → running。generation/runId/cancelRevision 不另起一套。

专项增加的提交顺序：先封存结果引用与缺口，再提交 checkpoint 及其 requirements/progress revision，再撤销旧代控制权、保留旧 SDK ID 作为历史身份，最后预分配新 SDK ID 并启动。artifact IO、SDK 调用和权限等待不能放进数据库事务。

| 故障位置 | 必须行为 |
| --- | --- |
| 结果文件写完但元数据未提交 | 不认 acquired 完成，旧代不丢唯一结果；回收只处理已确认无引用的孤儿 |
| checkpoint 缺块或写失败 | 不关掉唯一可恢复状态后假装交接成功；明确失败并保留证据 |
| 已提交交接但新 SDK 未建立 | 记录可恢复阶段；重启后待用户继续，不自动执行旧交互任务 |
| send 返回与 input_submitted 落库之间崩溃 | 依据预分配身份核对；无法确定为 needs_reconciliation，不重发整轮 |
| 新代启动后收到旧代结果/费用 | 旧代不得修改当前进度；已发生事实和费用作为迟到证据去重保存 |
| 任一等待期间取消或权限撤销 | 取消先落库，释放 hook/队列；新旧代都不能继续业务操作 |

错误终态以持久记录为权威，区分 capacity、permission、storage、provider、cancelled、unknown-outcome 等已有或拟增原因。最终代码须复用现有错误类型，新增判别值时同步所有消费者；不得把文档中的分类当已有 API。

SDK session → event bridge → router/turn outcome → history → IPC → MCP/UI → export 链路逐级检查恢复标志。idle 仅表示没有活动轮次，不能抹掉失败原因；recoverable=true 表示存在安全的用户恢复路径，不代表可自动续跑。

模型可见的容量提示只提供下一步所需的剩余预算/页范围/阻塞原因；单结果上限、当前工作集、累计用量、Provider 字节限制分开表达。不得凭 token 估算告诉模型“任务必然无法完成”，也不得把 estimated 字节写成实际 HTTP body。

compact 只按有来源的 SDK 事件与去重边界登记；普通文本出现 compact/summarize 不算。快照迟到、重复通知、批次结果尚未纳入快照需保留覆盖水位，既不能双计也不能假释放。代码更改前先用夹具固定时序。

## 9. 任务契约、完成验收与停滞

### 9.1 契约与工作项

严格任务只有在第 3.2 节边界得到确认后启用。原始用户要求、集合来源和方法约束保留 sourceUserEntryId；模型整理只是候选解析，含糊要求标 requiresReview，不自动补造任务。

本夹具工作项至少为：解压/封存清单、33 文本第一轮完整覆盖、48 图片视觉检查、三日志第二轮按时间复核（用户消息、回复、工具、token、compact、错误、session、附件八类）、跨日志比较、最终报告。

第二轮及交叉比较必须有引用和结论；没有实际 HTTP body 时，“超过 6 MiB 的历史错误”可以确证，“具体哪些字节导致越界”必须保持推断/未知。关键词命中计数不可代替事件数量，工具事件按 toolUseId 去重，时间线按事件身份关联。

要求只因新的用户修订而升 revision；模型不能删除未完成项、把全文改抽样或把 48 张改为已看的张数作为新分母。网络/子代理等方法约束沿现有权限及实际执行能力检查，不以字符串正则冒充通用 shell 沙箱。

### 9.2 进度提交

复用原生 Task metadata 中的 declare/progress/recovery_ack 协议。PreToolUse 校验 schema、scope、revision、合法证据及幂等键，写 intent；只有 PostToolUse 的成功结果才提交宿主回执。模型提供的 testsPassed、readAll、PASS 均不直接可信。

SDK Task completed 与宿主 verified 分开；Task 工具被禁用时保留普通聊天行为，严格模式标 unsupported，不暗中开启工具。宿主 Task 镜像写入失败不凭 SDK status 补造证据。

### 9.3 双重完成校验

Stop hook 与持久化终态共用一个检查器，核对最新契约、资源集合、每个 pass/method 覆盖、版本、处理结果、必需测试、未交付结果、未知副作用与恢复确认。

- 缺可补项：最多两次有界补齐提示，跨 generation 保留次数，只返回首批缺口和分页引用。
- 无有效新增进度或不可补：保留最终文本为未验收输出，状态 incomplete/blocked，不生成伪 PASS。
- 用户取消、API 失败、StopFailure 不被门禁复活；Stop 超时或被其它 hook 绕过，宿主仍不提交 success。
- 语义判定无法自动验证的项目保留 requiresReview。不要把人工评审未进行写成自动通过。
- runtime 被强制终止时可展示宿主生成的执行失败摘要，但不能冒充模型最终答案；保留失败阶段、最后已验证项、剩余数和恢复原因。

### 9.4 停滞与预算收敛

有效进展是首次取得合法新范围、交付阶段推进、带证据的处理结果、必需检查首次通过或用户解决阻塞。重复列表、重复 Task 更新、重交相同证据、thinking 文本和 revision 增加不计入。

沿共用计划使用“连续两次上下文轮换无新增有效进度则阻塞”和“同工具同参数三次只作疑似重复信号”；合法分页、复核、源变化、等待权限及有期限轮询必须豁免误判。

同一 generation 中长时间只有思考也要可观察：记录最后有效进展时间与阶段，不采集思考正文；先给状态提示，不因固定分钟数强制中止。自动暂停只能依据用户既有费用/时间上限或已验证的重复执行规则；本专项不默设新的全局超时，也不改变 reasoning。

## 10. 导出修复与证据质量

1. 先构建合成回归：字符串中嵌套 JSON/shell 转义引号、Windows/Unix 路径、中文/emoji、反斜杠、URL、canary 凭据、Base64、深层数组及超长字段。测试所有 JSON 文件均可 parse，而不是只测单个 helper。
2. 继续采用结构化值脱敏后序列化；禁止对完整 JSON 字符串替换路径。各份文件使用同一脱敏投影和一致稳定别名，保留关联所需的非敏感身份；不能为合法 JSON 保留真实 secret。
3. 导出绑定同一持久化 snapshotRevision，各文件计数/时间线/工具回执引用同一视图。缺 SDK 流、超限省略或历史未采集分别记录原因和范围，不声称零事件。
4. 若历史 JSON 确实损坏，导入/诊断只报告文件类别和错误位置，不原地修复压缩包、不静默容错丢字段、不把旧损坏数据再次包装成“完整”。原件复现须单独授权，只在隔离目录操作。
5. 流式导出复用共用历史/内容索引；Worker/主进程之间有字节预算，导出大文件不可一次读全再裁剪。活动任务和导出互不改写对方状态。
6. 诊断区分事实/推断/未知；容量统计必须写明 per-request/per-turn、估算/实测、已采集/未采集。无需在内部工具界面堆放功能介绍，仅保留必要状态与缺口说明。

## 11. 实施工单、依赖与退出标准

所有工单开始前重新读当前 diff/规则，记录 desktop、SDK、HEAD 和目标构建身份；工作区已有大量其它任务修改，禁止 reset/清理/整仓暂存。下列相对工期按熟悉代码的工程师估计，仅用于排序，不是验收承诺。

| 工单 | 内容与交付物 | 依赖 | 完成标准 | 估计 |
| --- | --- | --- | --- | --- |
| M00 | 冻结监视事实/当前源码/目标构建差异；建立失败夹具和消费者清单 | 无 | 每项 F01–F06 有来源和不确定性标记，不含敏感正文 | 0.5–1 天 |
| M01 | 原生 SDK 文本、图片、hook 挂起/关闭、Task、Stop、compact 次序夹具 | M00 | 本地 loopback 捕获脱敏断言；不支持项明确阻塞对应功能 | 2–4 天 |
| M02 | 复用共用 P02/P03/P09，交付事务/CAS、资源版本、范围/回执索引、generation | M00 | 原子故障注入、幂等、跨代隔离通过；不增加第二数据库 | 3–6 天，已有成果扣除 |
| M03 | 文本源范围、预算内分页、单行分片、覆盖合并、artifact 复用 | M01+M02 | T01–T08 全通过，不依赖模型猜 offset | 2–4 天 |
| M04 | PendingPresentation、干净工作集重呈现、单件超限收敛 | M01+M02+共用 P10 持久交接 | I01–I07、R01–R04 通过；无原图改写/副作用重放 | 3–5 天 |
| M05 | Task 契约/镜像、pass/method 区分、双完成门禁 | M02+M03+M04、第3.2节确认 | C01–C07 通过；普通聊天回归；协议未支持不伪通过 | 3–5 天 |
| M06 | 有效进度、重复信号、跨代预算、状态诊断 | M05 | S01–S04 通过；合法慢任务不误停 | 1–2 天 |
| M07 | 导出 JSON、快照一致性、恢复状态全链路 | M00；快照部分依赖共用历史索引 | E01–E05/F01 通过；明确旧构建差异 | 1–3 天，基础依赖另计 |
| M08 | 集成、故障矩阵、真实任务验收及发布证据 | 全部 | 第13节所有门禁通过，没有用跳过当通过 | 2–4 天加真实长跑 |

关键路径为 M00 → M01/M02 → M03/M04 → M05 → M06 → M08。M07 的纯 JSON 回归可独立实施。共用历史增量存储、迁移和持久交接若仍缺失，必须先完成或并入对应工单，不能在本专项里以连续 upsert 冒充事务。不要把上表机械相加当项目总工期。

每个工单提交包含实现、专项测试、必要规则及发布说明，记录通过/失败/未执行证据。可以先交付已验证的导出和恢复状态修正，但不能以局部发布宣称全部长任务可靠性已解决。

## 12. 验收矩阵

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| T01 | 500 行结果超过 8 KiB | 返回准确源范围及续读位置，提示和引用不被截掉 |
| T02 | 8 MiB 单行 JSON，含转义、重复 key、大数字 | 片段可逐字节重建，未以解析重写或抽样替代 |
| T03 | 中文/emoji/CRLF/BOM/非 UTF-8 | 无半字符、错误位移或静默替换；编码规则明确 |
| T04 | 重叠/乱序/重复范围及留洞 | union/gap 稳定，重复不增加覆盖，有洞不通过 |
| T05 | 第二轮复核、同内容不同文件项 | 不复用第一轮状态冒充复核，不自动合并资源分母 |
| T06 | SDK 已截断/未知原生结构 | acquired/delivery 为局部或 unknown，不能标全文保存 |
| T07 | 源文件中途改变、symlink 越权 | 拒绝混合版本和越权读取，原件不变 |
| T08 | artifact 写失败、页引用缺失、反复读同页 | 安全停止，无嵌套无限 artifact，无虚假完成 |
| I01 | 长文本后首张图片不能放进旧上下文、可放进新上下文 | 暂停旧请求，主 query 新代 Read 同一原件成功，turn/任务连续 |
| I02 | 同批多图片乱序，夹杂已生效副作用 | 每件独立回执；已生效副作用执行次数保持一次 |
| I03 | 图片在干净上下文仍超限 | 一次干净尝试后明确阻塞，不无限轮换、不改图 |
| I04 | 原图丢失、变更、权限撤销 | 不以 metadata/OCR/其它文件冒充检查 |
| I05 | 只有图片尺寸/格式读取 | 视觉检查计数不增加 |
| I06 | hook 被其它 hook 改写/取消/close 卡住 | 无超预算请求偷偷发送，超时可终止，不虚报交付 |
| I07 | 非图片未知二进制/PDF | 不套用图片或文本成功分支，按支持程度明确阻塞 |
| R01 | 第8节每个提交点前后故障 | 持久阶段可解释，缺资料不启动新代 |
| R02 | cancel/steer/权限与交接并发 | 取消优先，已接纳 steer 不丢；无旧代恢复 |
| R03 | 重启、旧代迟到结果、send 结果未知 | 不自动续跑旧交互任务，不重放未知副作用，费用去重 |
| R04 | 重复 compact/迟到快照/并行结果 | 不双计、不重复释放，跨代费用和预算连续 |
| C01 | 登记32文本或47图片后声称全部完成 | 与封存分母不一致，不能通过 |
| C02 | Python扫描/Grep命中/Task completed | 不等于全文阅读、视觉检查或语义验收 |
| C03 | 模型降低范围、删除 Task、重建列表 | 原 requirement revision 仍在，缺项不消失 |
| C04 | 伪造 receipt、跨会话引用、过期 revision | 拒绝提交且不增加进度 |
| C05 | Stop成功/超时/异常、模型直接写PASS | 宿主未验收不提交 success，补齐次数有界 |
| C06 | 用户修订要求/取消 | 更新契约或终止，旧校验失效；无强制复活 |
| C07 | 普通聊天、Read/Task被禁用 | 不强加严格契约、不提升权限，限制清晰 |
| S01 | 多次重复列目录/TaskUpdate/相同回执 | revision增长不算有效进度 |
| S02 | 合法分页/第二轮复核/长工具/等待权限 | 不被固定时长或相同工具误判停滞 |
| S03 | 连续两代无进展、费用达到既有上限 | 有界阻塞，换代不重置计数或预算 |
| S04 | 错误使用compact关键词、累计token推导请求大小 | 诊断只认可事件/可信快照，语义评测拒绝过度因果结论 |
| E01 | 嵌套转义路径+canary+Base64全JSON导出 | 全部parse成功，敏感数据不出现，原件不变 |
| E02 | 导出时历史持续追加或更新状态 | 所有文件一致snapshotRevision，计数可核对 |
| E03 | SDK流缺失/省略/未采集 | 元数据明确区分，不把缺采集当零事件 |
| E04 | 大导出/取消/磁盘满 | 内存有界，无完整成功假象或覆盖旧包 |
| E05 | 历史坏JSON | 定位失败，不自动修复原包，不虚构其它文件损坏 |
| F01 | 同一非文本失败经过SDK/router/history/IPC/MCP/UI/export | 失败原因、可恢复性一致；idle不覆盖失败 |

所有期望数量应从独立 fixture oracle 导出，不能用被测实现生成期望值。图片夹具含可核验的文字/图形标记与不同尺寸；真实视觉语义评测与二进制交付测试分开记分。

## 13. 验证命令、真实验收与发布

### 13.1 分层验证

1. 纯函数与 DataRepository 故障测试：覆盖范围、预算、事务、导出及终态。
2. 已安装 SDK/native binary + 隔离配置 + loopback：验证真正的结构替换、图片请求、hook时序、关闭、Task 与 Stop，不连接收费 Provider或用户 MCP。
3. IPC/MCP/UI 状态链路回归：既有测试夹具，不以启动应用替代。
4. 获得启动/真实Provider授权后，再做目标构建端到端长任务验收；使用根命令启动最小范围，不擅自运行浏览器/Playwright。

实现后按影响范围运行；以下是现有命令和测试文件，新增测试应加入对应专项：

```bash
pnpm --filter @synapse/desktop run test electron/services/agent-runtime/__tests__/tool-output-governor.test.ts electron/services/agent-runtime/__tests__/artifact-store.test.ts electron/services/agent-runtime/__tests__/context-budget.test.ts
pnpm --filter @synapse/desktop run test electron/services/agent-runtime/__tests__/sdk-native-long-task-contract.test.ts electron/services/agent-runtime/__tests__/sdk-native-image-contract.test.ts electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts electron/services/agent-runtime/__tests__/context-continuation.test.ts
pnpm --filter @synapse/desktop run test electron/services/agent-runtime/__tests__/conversation-router.test.ts electron/services/agent-runtime/__tests__/turn-outcome.test.ts electron/services/agent-runtime/__tests__/context-recovery.test.ts electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
git diff --check
```

再对本次改动文件运行现有 ESLint；IPC/schema改变运行 codegen一致性与相关IPC/MCP测试；新增/移动Worker或打包资源时运行 `check:packaged-asar` 并核对正式包。最后执行 desktop 全量 test；已有无关失败记录归属，不删除测试或降低断言。

### 13.2 真实长任务验收

- 先用不含敏感内容的合成数据复刻33文本、48图片、超长单行和总字节规模；设置每页唯一可检查标记与跨页/跨日志结论，避免只测顺序读完。
- 使用确有容量压力的工作集触发至少一次原生compact和两次宿主交接；确定性SDK夹具负责保证覆盖这些路径，真实Provider未发生的路径标为未验证，不能谎称自然触发。
- 完整验收原7步：文本每个必需范围、全部图片、第二轮八类复核、跨日志分析及最终统计。若需使用原始三个包，再单独确认文件访问及敏感数据边界，不重启已失败对话或重写其清单。
- 记录每步真实用量、有效覆盖、新增进度、暂停/恢复原因、峰值资源和缺口；模型输出PASS与独立验收通过分别报告。累计读取含重读，唯一覆盖字节不含重读；图片元数据扫描不计视觉完成。
- 真实长跑不能以“运行了若干小时”代替完成；达到既有预算仍未完成应明确FAIL/未验收，保留断点，不缩减范围制造绿色结果。
- 必须复测本次“第一张图片导致整轮终止”的场景，并核对目标安装构建确实包含修复；单元测试通过不等于用户运行版本已更新。

### 13.3 发布与回退

发布条件：所有适用矩阵项通过、协议未知项已关闭、严格模式边界已确认、目标构建真实验收通过、没有未知副作用、完整交接/取消通过、配套规则与指南一致。任一核心项未满足，只能报告局部修复，不能宣布本次问题全部解决。

按独立工单小提交发布。回退自动恢复时恢复现有明确安全停止，不能恢复“丢结果后继续”；关闭严格模式不把既有未验收任务变成已完成。版本化账本保留只读，不删除新状态让旧二进制强行打开；旧版本不支持数据版本时禁止无校验降级写入，迁移回退使用共用计划的可验证备份/切换流程。

## 14. 文档同步、提交与交接

实施时同步：

- 图片引用/恢复、任务契约与完成边界：`docs/agents/agent-runtime-security.md`、`knowledge-base.md`、`module-boundaries.md`、预算及生命周期设计。
- 数据与生命周期：repository guide、共用容量/存储设计、schema、备份/删除/迁移规则。
- 用户可操作能力或状态schema变化：MCP描述、权威 `desktop/app-capabilities/synapse-skill/skill-package/` 指南；注册表面变化再同步 capability-registry 表格、数量和例外。本专项不为内部状态额外注册公共工具。
- 每次真实实现的用户变化写 `RELEASE_NOTES_PENDING.md`；本次纯计划不写成已发布修复。

代码工单完成并通过必要验证后按 AGENTS.md 自动本地提交，中文说明具体行为，不 push；只暂存本工单文件/片段。交接报告必须包含：提交短哈希、构建/SDK版本、实现范围、测试证据、未验证项、剩余工单和下一步，禁止仅写“计划已完成”。

本计划的最先执行项是 M00/M01。最重要的技术不确定性是**原生图片结果如何在请求发送前安全暂停并跨代重呈现**以及**生产交付证据能达到哪一层**；通过真实协议夹具解决，不能用猜测、mock成功或扩权限绕过。
