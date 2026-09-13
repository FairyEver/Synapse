# Agent Runtime、MCP 与脱敏规则

本文件适用于 Claude Agent SDK 参数、Agent event bridge、MCP 注册/诊断、权限事件、timeline、导出、Usage Analysis 和 provider 预览。

处理百炼容量、非文本结果超预算或持续对话问题前，先读[真实 API 边界实测](../reference/2026-09-13-bailian-qwen-context-probe.md)与[持续对话方案](../superpowers/plans/2026-09-13-bailian-context-and-continuous-conversation-plan.md)。前者已验证 token/body 两种上限；后者记录原预算将非文本序列化字节作为 token 成本的可复现误判；修复与验收见[图片交接实施记录](../superpowers/plans/2026-09-13-agent-image-handoff-execution.md)。直接 API 成功不能当作 SDK 图片交付、自动重呈现或长任务验收通过；方案不改变下文既有保护与权限边界。

## 历史写入与容量

长运行性能相关的持久化与显示容量实施状态见 `docs/superpowers/specs/2026-09-13-agent-long-running-capacity-design.md`。历史追加、记录元数据和问题响应须与标题共享会话级读改写串行队列；摘要保存不得将读到的旧 history 回写覆盖新记录。当前整历史 JSON 存储仍未完成分块改造，不能把局部缓存、诊断或计时优化描述为长期稳定性保证。

## 长任务证据与完成边界

- `agent.task-progress` 是 DataRepository 的 SQLite 版本化 journal；按 project/conversation/logical turn 隔离，单条最多 64 KiB、分页读取、串行写入和 generation 所有权屏障。Conversation 只保存逻辑任务指针。自动交接和显式继续复用逻辑任务，新请求开启新范围；旧数据缺字段时为无已登记状态，重启不得自动执行。
- 复用原生 `TaskCreate/TaskUpdate.metadata.synapseProgress` 提交清单与发现，不新增公开工具、MCP server 或权限。提交包含 version=1、baseRevision、每次最多 32 项 units/findings、可选 seal。工具调用成功不是宿主提交成功；版本过期、路径替换、未知/未呈现回执必须拒绝，保存失败必须停止。
- Read 回执和清单同时保留原始/规范路径，不能因 macOS 目录别名变更而丢失身份；回执还保留原件版本、实际行区间/总行数、完整性、原生 toolUseId；区分取得、模型已接收和提交已处理。串行 PostToolUse 只记录取得，PostToolBatch 先核对 SDK 转换后文本/图片内容与取得结果的一致性（与原始工具结构分开处理），再固定待确认集合，下一主线程 PreToolUse/后继 PostToolBatch/正常 Stop 才确认上一批呈现。不能使用可能迟到的 SDK iterator Assistant 事件清空当前批次。
- 图片先呈现当次必须续接的原件，再允许其它工具；大量待呈现原图按干净会话可用 body 分批，余项持久保留且未计尝试。每个版本仍只允许一次容量重呈现，不能提高 200K/5 MiB/6 MiB 阈值。权限、取消、原件与停止屏障保持有效。
- 完整文本已保存但当前工作集无法容纳其引用时，在批次屏障自动交接；新代读取保存的准确版本/区间。恢复回执必须同时匹配宿主 artifact 规范路径和完整哈希，扣除保存元数据行后关联原始区间。保存失败、原件不可验证或 artifact 损坏不得计作已覆盖。已执行操作保存脱敏参数、完整结果或完整结果引用，不因维护自动重跑。
- 已登记材料完整呈现后，读取下一份新材料前须提交前一批处理状态；保存答案、Task 提交、检查点读取与同一原件的核对仍可执行。主 query 必须先完成当批待续接图片，不让进度治理消耗其保留空间。
- 清单不能缩减或替换已登记资源；初次封存或显式重开后封存须包含已取得的材料；已封存清单重复提交 seal 为幂等操作，之后校验生成的输出不强制扩张原输入范围。过早封存可用 `reopen:true` 追加缺项后重新封存，不能重编号或替代旧单元。文本覆盖检查同一版本的区间并集；图片检查已确认的原生呈现。来源完整且已呈现才接受发现；相同事实冲突保留双来源，显式包含原来源的校正才清除冲突。缺失 ID、缺失字节数和零用量都不是错误或零大小的证据。
- 只有已封存范围全部覆盖且声明已处理、没有证据冲突时才产生 `coverage-complete`；未登记为 `unverified`；有任务工具且已读取多个非私有证据资源仍无清单时，要求一次补登记，否则保留无法验证的可恢复失败。部分完成触发一次基于实际进展的 Stop 补正，仍有缺口则持久化可恢复失败。评估字段在实时 IPC、历史回放和 MCP timeline 中保持一致。所有评估的 `semanticCorrectness` 仍为 `unverified`，不证明清单穷尽用户材料或模型理解正确。不得据 SDK 成功、Task completed 或 Agent 自报 PASS 对外宣称任务通过。
- 检查点写入新增历史、链接祖先并保留祖先 artifact 校验引用；当前进度为完整记录的独立 JSONL 页，同时注入有界的已完成/待处理 ID、已执行动作与已保存发现；缺省项明确计数并保留完整索引，不能每次强制重读全部检查点。新 query 前验证全部引用，缺资料停止。停滞标记以已登记单元/版本/范围状态变化为依据；未登记任务仍只能使用已有保守轮换保护，不宣称拥有通用业务进展判定。
- 原生 Assistant 边界记录回复字节/摘要、重复长段落与独立思考标签计数；同 UUID 且同内容才抑制重复投递，不按文字相同删除正常消息。排除代码和引用示例后，异常回复只允许一次有持久记录的重新组织；再次异常保留失败，不重跑副作用。未采集原生事件的旧导出不能追溯断言是模型、SDK、IPC 或 Renderer 的重复。
- 导出保留严格允许的数值 token/body 计量，路径使用每次导出独立随机盐生成的稳定匿名资源 ID；相同导出可比对，不跨导出关联。新增任务 journal 导出脱敏的清单、回执与已提交发现，不附私有 artifact 原文。累计用量不代表当前上下文，宿主 body 账本不代表实际 HTTP 字节。

## Claude SDK 配置

- 修改 SDK 参数前核对官方文档和当前安装包类型。`Options.env` 是子进程环境；`Options.settings` 是更高优先级 inline/flag settings，两者不能混用。
- Provider 隔离必须同时写两层：顶层 `Options.env`，以及 `Options.settings.env` 中当前 provider 的 `ANTHROPIC_*` 覆盖（至少 base URL、model、auth token/API key 和默认模型变量）。
- `Options.settings.env` 只能放 provider 的 `ANTHROPIC_*` 及宿主持久化的 `CLAUDE_CODE_TASK_LIST_ID`，不得放 `SYNAPSE_SIDE_CHANNEL_TOKEN`、data-server token、普通 shell env 或其它 runtime secret。
- 回归测试必须证明 provider 配置进入 `settings.env`，side-channel 等非 provider secret 不进入。
- 历史回归：提交 `6778d598e` 曾删除 `settings.env: options.env`，导致用户本机配置其它 Claude provider 时混用旧 base URL 与当前模型。遇到 `model not found or not supported`，先检查 `desktop/electron/services/agent-runtime/claude-sdk-session.ts` 的覆盖层。
- SDK 终态只要标记 `is_error` 或 `terminal_reason=api_error`，即使 `subtype=success`、`errors` 为空，也必须按失败结束；SDK 合成的 `is_api_error_message` 不得作为普通 Assistant 回复写入 history。网络中断应投影为可恢复状态并允许用户显式继续，不得自动重放整轮请求，因为已执行工具可能产生不可重复的副作用。
- 百炼官方 Anthropic 端点使用独立传输策略：6 MiB 请求体上限、200,000 token 自动整理阈值，不得降低模型目录中的 1,000,000 token 上限，也不得把策略扩展到代理或其它 Provider。命中精确 6 MiB 错误后，必须等本轮终态落库再关闭旧 SDK Session、清除持久化 Session ID；Automation、Workflow 与 Relay 只清理 Session，不自动续跑。
- 所有 Claude Agent SDK 会话必须在 `PostToolUse` 阶段按“单结果/单批”预算治理模型可见工具结果：默认 50/150 KiB，百炼官方 Anthropic 端点 8/24 KiB；累计工具输出只计量，不能触发轮换，文本单结果另受 2,000 行限制。`Read`、搜索和抓取保留前部，`Bash` 保留尾部；截断提示必须说明窄化读取方式，且不得诱导重放已有副作用的调用。大型文本结果必须先原子写入会话私有 artifact 目录（单文件最多 16 MiB，超出按有序文件分片保存并返回索引，文件权限 0600），SDK 仅获得该目录的读取能力，直接文件写工具不得因此扩大可写根；删除会话时同步清理，普通对话导出不得携带该正文。
- 完整模型请求同时执行 token 与字节预算。百炼 6 MiB 硬限制使用 5 MiB 内部安全预算；预算基于 SDK `getContextUsage()` 的可信完整 token 快照，加上快照后新增消息与工具 payload 的实际 UTF-8/序列化字节。图片/PDF 不做文本截断，但其 payload 必须计入字节预算；将越过安全预算但无法保证完整呈现时显式停止，不能省略结果后引导模型猜测完成；附件原件不得修改。日志不得把估算字节描述为实际 HTTP body。
- SDK 原生自动整理和预计算整理保持启用；工具结果 token 下降只表示观察到淘汰，不得宣称宿主已经修改 SDK 历史。每轮结束与 compact 后必须读取 SDK 上下文分类；只用 `messageBreakdown.toolResultTokens` 的下降判断已发生的原生淘汰，并按淘汰 token 比例释放本地已跟踪的工具结果字节预算。compact 监测只记录前后 token、耗时、类别与摘要字节数，不记录摘要、工具正文、路径或凭据。请求字节账本必须跨普通 SDK token 快照保留，累计静态上下文、用户消息、主线程 Assistant/工具调用块和工具结果封装；compact 成功后按静态上下文、整理摘要及实际保留的工具结果尾部重建基线，并恢复已释放的工具额度，不能假设工具尾部全部被删除。
- 正常执行在 `UserPromptSubmit`、主线程 `PostToolBatch`、`PostCompact` 边界读取完整 SDK 快照（5 秒超时），区分 SDK `autoCompactThreshold` 整理触发值和 `maxTokens` 实际工作窗口；宿主按当前工作窗口预留下一次调用空间，不从整理触发值再次扣减 buffer；阈值未知时使用已有保守预算，界面不得把配置窗口冒充真实触发阈值。并行 PostToolUse 必须串行预留额度，不能重复消费剩余预算。
- 当前 token/字节工作集无法容纳下一次请求时，必须暂停下一次请求，完整保存脱敏任务历史、最近批次、原始任务和 SDK 整理摘要的私有检查点，再关闭旧 Session、清除 resume ID，通过原 SessionManager/权限/审计创建干净 Session，同一 turn 自动续跑。该主动维护适用于前台及后台，不重放请求或工具调用；只有检查点引用与最多 32 KiB 的摘要进入新上下文。历史按短行 JSONL 分片保存，原文不作长度截断；凭据和图片 Base64 除外，附件原件与授权范围保持不变。私有检查点复用 tool-output artifact 的只读授权、删除及导出隔离，不注册公开能力。
- 轮换必须等待已接纳的 steer 落库，暂停新的 steer 接纳，并保留队列与当前 turn。关闭前保存文件检查点，再将旧 SDK 的检查点标为 superseded；新 Session 不得承诺撤销旧 Session 文件。取消、Renderer 丢失或中止优先于续跑；交接失败停止并保留已有记录，不得发送缺失资料的新请求；连续无工具进展的轮换必须停止，不能形成无限重启。
- 执行器捕获精确 `rapid_refill_breaker` 或已限定百炼端点的请求体容量失败时，优先采用同一私有检查点交接自动续跑，不重放失败的 HTTP 请求或工具调用。只有无法建立自动交接条件、连续无进展或维护失败时才使用现有可恢复错误兜底；普通网络/API 错误不自动续跑。
- 自动维护无法接管且已投影为失败终态后的兜底恢复仍是 Agent UI 私有两阶段操作：先验证最新失败轮并整理，再由用户显式“继续上一个任务”。恢复交接最多 32 KiB，只能在用户可见消息落库后注入新 SDK Session；不得包含 Base64、绝对路径、完整工具结果、敏感字段，不得直接重放工具调用。用户发送其它消息时清除恢复状态并使用干净 Session。
- 请求体恢复期间必须结束旧 Session 的权限等待并暂停既有待发送队列；取消、切换对话和关闭窗口不得向旧 Session 发送内容。恢复日志只记录 Provider scope、阈值、最后可信 token、附件数量/字节、失败轮和恢复结果，不记录 prompt、工具正文、路径、Base64 或凭据。
- Agent SDK 高频事件必须先分类再构造 payload。`system/thinking_tokens` 与未知 SDK 类型不得进入 AgentEvent、EventBus、持久化或轮次结果；只允许不含正文、路径、凭据和原始 payload 的每轮聚合诊断。真实 thinking 文本继续使用 `thinking_delta`。
- Timeline 和 MCP inspect 按持久化记录的连续区间分页，允许在同一用户回合内以及工具调用/结果之间切页；`beforeIndex` 是排他的记录索引，旧用户消息边界游标仍兼容。返回页必须保留稳定记录 ID 与 `toolUseId`，字节超限只缩小当前页，不得整轮删除、用空页或整轮占位符掩盖非空历史。超大单项只裁剪显示投影，不修改持久化原文。
- Renderer 只接收有界显示投影：流式批次最多 128 条/64 KiB、等待确认最多 512 KiB；send 终态最多 32 KiB；timeline 每页最多 100 条/1 MiB、单项与全文分块最多 64 KiB。Renderer 私有全文接口只能接受 project、conversation、history index 和 offset，禁止接受文件路径。
- Renderer 崩溃或持续无响应时，必须按 webContents 所属关系停止其发起的本地交互轮次、结束权限等待并清除未确认批次；不得停止 Automation、Workflow、Relay 或其它 Renderer 的运行。已执行工具保留真实结果，不回滚、不自动重放。详细不变量见 `docs/superpowers/specs/2026-09-12-agent-renderer-capacity-and-recovery-design.md`。
- Agent 用户附件只在主进程受控目录暂存；Renderer 与发送 IPC 只携带版本化 attachment id/metadata，history 只保存用户正文与结构化附件元数据，不得携带原始字节、Base64、data URL 或受控绝对路径。
- 图片只通过“受控原图路径 + Read”进入既有主 query。不得创建图片 content block、附件子 query、隐藏批次会话、摘要回灌、附件 MCP 或读取完整性循环。
- 附件处理不得读取 Provider 类别、模型名称、base URL 或自定义能力覆盖，不按白名单启停。百炼 Kimi、Qwen 和自定义兼容模型使用同一路径清单；模型或 Provider 拒绝时保留原生错误。
- 发送时只接受本轮有序 attachmentId，并同时校验 project、draft、conversation、turn 和所有权；不得接受 Renderer 提供的路径或字节。文件夹选择结果只向 Renderer 返回名称和 attachmentId，真实目录只保存在主进程元数据中；旧历史路径在投影到 Renderer 和导出前收敛为显示名称。路径解析不得读取图片原始字节。
- 同一草稿下的受控附件根目录作为一个精确 `additionalDirectories` 授权。每个已提交附件批次必须轮换草稿范围；附件轮结束后必须关闭对应 live session，下一轮按 SDK session id 恢复，避免旧草稿目录继续留在进程授权中。单独选择的图片和文件不得授权原始父目录；只有用户明确选择的文件夹才可授权该精确真实路径。
- 同一次选择或拖放遇到图片数量、单轮、项目或全局空间配额时，必须释放该次调用已经暂存的全部附件，不得向 Renderer 返回部分批次。其它无效路径仍可按项拒绝，不能破坏同批次有效项。
- 附件孤儿回收必须按当前 `projectId` 过滤后再比较会话集合；任何项目服务都不得用本项目会话列表清理其它项目的 committed 附件。
- Persona 显式禁用 Read 时继续禁用；runtime 不强制启用工具，也不以此判断模型能力。普通工具可用性不等于完成验证；仅对已登记的任务范围执行下述证据覆盖门禁，不能用 Read 次数代替覆盖或语义正确性。
- 交互式 Agent 的 `Write`、`Edit`、`MultiEdit`、`NotebookEdit` 必须在 PreToolUse 阶段限制到会话 `cwd` 或已明确授权的 `additionalDirectories`；祖先 Git 仓库不得扩大该边界，且 `bypassPermissions` 不得绕过这条直接文件写入边界。校验必须同时约束词法路径和真实路径：已存在目标取目标 `realpath`，新目标取最近存在父目录的 `realpath`，授权根或目标无法安全解析时拒绝，项目内 symlink 不得把写入导向真实根外。该检查是 SDK 工具执行前的 fail-closed 预检，不提供文件描述符级原子写入，不能消除校验后到 SDK 实际写入之间的 TOCTOU 竞态。Bash、MCP 和外部进程不属于这条结构化路径检查，继续服从 SDK permission mode、显式授权及操作系统权限；项目目录不是通用 OS 沙箱。
- 运行时附件清单不写入 history。timeline、权限卡片、工具事件、日志和导出必须把受控附件路径投影为稳定附件标签；存在附件上下文时不得持久化可能拆分路径的流式 `input_json_delta` 正文。
- 附件诊断只允许记录类型和计数；不得记录 attachmentId、名称、路径、哈希、运行时清单、工具输入或模型输出。路径链路不登记为公开 capability/MCP。
- 附件回滚不得恢复 Renderer 原图字节、raw image IPC、Blob URL 或重写用户附件。

## 长任务可靠性实施边界（2026-09-13）

- 工具结果保存或呈现失败的 `execution_failed` 必须保留 SDK 明确给出的 `recoverable`，经轮次归一化、持久化 `turnOutcome`、IPC、历史回放和 MCP 读取不得降为 false；未明确给出时不推断为可恢复。取消和超时仍优先。idle 只代表没有活动轮次，可恢复失败不授权自动重放。
- 诊断导出的 SDK 流采集状态区分 `captured`、`not-recorded`、`read-failed`；后两者的 `observedEventCount` 为 null，不能把未采集或读取失败解释为零事件。保留采集量、导出量与超限省略量的不同语义。
- SDK 0.3.245 单独 `close()` 会释放挂起 hook，不能当作停止屏障。自动交接必须先保存检查点，等待 `interrupt()` 确认，再关闭 query 并等待原生迭代器真正结束；不能以收到迟到帧或 `close()` 返回代替终止。控制操作有界超时，失败不创建新代、不自动强杀；当前进程内停止未获确认时，用户再点继续也不能放行图片交接。
- 外部 AbortSignal 不得先中止 SDK 控制通道；先停止新工作准入并执行既有停止屏障，确认结束后再 abort transport。预先取消的请求不创建执行；确认失败必须保留失败保护，不能当作已安全停止。
- token 与请求体字节分别计量。图片 Base64 完整计入 body；视觉 token 未被完整 SDK 快照覆盖时为未知，不能按 Base64 字节判 token 超限，不能声称未知等于零。文本估算保留来源；快照/compact 只清算覆盖水位以内的成本。native token 降低不能按比例抹掉已知图片字节。图片不消耗文本单批预览额度。
- 图片原生 Read 的已取得未呈现状态保存在 conversation 可选 `contextHandoff` 中：generation、phase、checkpoint 引用、原 toolUseId、原件路径/大小/摘要、尝试次数与接收确认。这是现有串行 DataRepository 写入链路的最小扩展，不是 History V2 或另一套恢复存储；旧数据缺字段按无恢复状态读取。
- 在 `PostToolBatch` 暂停下一请求，使并行工具已经产生的结果都进入同一检查点。新主 query 只通过原生 Read 重呈现原件，保留 conversation、turn、taskListId、权限配置及累计用量；不得重跑生成图片的 Bash、截图、上传或消息发送。路径引用不授予权限，Read 前后校验原件版本；这不是 OS 文件锁，不承诺消除恶意并发改写的全部 TOCTOU 竞态。
- 同一原件最多一次因容量不足触发的干净会话重呈现。普通网络/认证/服务端错误不自动回放；精确输入范围容量拒绝与已有容量故障可走同一交接链路。待呈现图片未获后续主模型响应确认时，result 不得记为成功；接收确认只表示呈现，不等于理解质量或业务覆盖。
- 保存失败、旧代停止未确认、检查点缺损、原件变化或权限撤销必须保留可验证状态并停止。重启不自动执行旧任务；用户明确继续时验证原件与检查点后恢复尚未尝试的图片，已提交而接收不明的尝试不得静默重放。

- 稳定 taskListId 保存在 conversation 可选字段，SDK 普通轮次、resume 和轮换复用；其它 conversation 使用独立随机 UUID。两层 SDK env 均覆盖宿主或 Provider 的全局 task-list ID。旧记录仅可沿用其合法 SDK UUID 对应的默认 namespace，不扫描 SDK 私有任务目录，不声称恢复历史已丢失的任务。
- 自动交接使用专用执行投影，保留原有真实工作路径、早期用户要求和最新执行批次；凭据仍脱敏。手动恢复和普通导出继续采用各自脱敏边界。路径引用不授予新权限；执行批次不等于模型已消费或处理。
- SDK 0.3.245 的 Read/Bash 等原生工具会校验 updatedToolOutput 结构；字符串替换可被静默拒绝。治理必须保留原生结构，按实际替换结构及 JSON 转义计入预算；MCP 替换必须移除旧 structuredContent。未知结构不得假称治理成功。
- 文本结果落盘失败、返回缺失/截断记录或无法保存完整 artifact 引用时，显式结束为可恢复错误；不得继续截断或自动启动缺资料的新代。完整引用仅因当前容量暂时无法交付时，使用上文的持久检查点与停止屏障交接。可验证的原生 Read 图片超出当前工作集时走上述持久交接；未知非文本结构或无法保存引用时保留停止保护。
- 导出的 timeline、transcript 和消息/工具计数以同一 conversation 持久化历史投影为准；runtime 空页、尾页、sentinel 不作为历史权威。工具计数按 toolUseId 去重。
- 新代创建前后和轮换异步边界核对取消/Renderer 状态。SDK 在循环开始前已结束或无终态退出时必须记为未完成。
- 增量检查点、任务证据账本与已登记范围的覆盖门禁见上文“长任务证据与完成边界”；增量权威历史迁移、通用副作用事务和语义正确性自动验收仍未完成，不能作为整套长期可靠性保证。详细状态见实施计划及其验证记录。

## Agent 文件检查点

- Agent 文件检查点只属于本地交互式 Agent 会话。它依赖本地 Claude Agent SDK/CLI 的文件跟踪与 `rewindFiles`，不以 Anthropic 自家模型为能力门槛；DeepSeek 官方与百炼 Anthropic 兼容 Provider 使用同一运行路径。
- SDK 必须同时启用 `enableFileCheckpointing` 与 `replay-user-messages`，并把回放用户消息 UUID 仅作为内部恢复锚点。回放消息不得重复进入 timeline、history 正文或导出。
- 启用文件检查点时不得向 SDK 传入 `sessionStore` 或 `sessionStoreFlush`；SDK 0.3.245 明确拒绝该组合，因为外部 store 不镜像 rewind 所需备份 blob。新会话标题使用 Agent Runtime 的首条用户消息回退，不得为 AI title 恢复 transcript 镜像。
- V1 只捕获前台 SDK `Write`、`Edit`、`MultiEdit`、`NotebookEdit` 对当前项目工作区普通文件的修改。Bash、普通 subagent、MCP、外部进程、目录操作、符号链接、硬链接、远程文件和额外目录不属于可恢复集合。
- SDK `rewindFiles` 是实际恢复权威；Synapse sidecar 是审查 Diff、路径身份、文件指纹、并发校验和产品状态权威。timeline/history 只保存相对显示路径与摘要，不得保存绝对路径、源码快照或 patch。
- Diff patch 每文件最多 128 KiB、每检查点最多 512 KiB；超限、二进制或读取失败只保留摘要与安全元数据。全局 64 MiB patch 配额只允许清理 `superseded` 或 `rewound` 的旧载荷，不得清理当前可撤销检查点的指纹和身份元数据。
- 只允许撤销当前会话最后一个 `available` 检查点；发起下一轮用户消息必须先把旧检查点标记为 `superseded`。撤销只恢复文件，不回退对话历史、模型上下文、usage 或工具记录。
- 撤销使用两阶段协议：prepare 产生 5 分钟有效的一次性 operation id；confirm 必须重新校验项目、会话、SDK session、busy 状态、精确文件集合、逐文件写权限、真实父路径和 after 指纹。任一校验失败时不得调用真实 rewind。
- 实际 rewind 后必须逐文件验证 before 指纹。SDK 多文件恢复不是事务；链接跳过或任一文件未恢复时状态为 `partial`，不得报告完全撤销成功。权限检查与最终结果必须写入 `AuditSink`，日志不得包含源码、patch 或文件哈希。
- 检查点详情、单文件 Diff、prepare 与 confirm 是 Agent UI 私有窄 IPC，不注册 Capability、MCP、Workflow、Deep Link 或 System App；Renderer 不获得任意路径读写能力。

## MCP 命名、传输与 Schema

- Agent 分组查询与新建对话分别使用 `agent.conversation.read` / `agent.conversation.control` 权限、既有客户端限流与无正文审计。新建只接受默认分组、已配置项目或已有对话所属的可用分组，不接受任意工作目录、来源、permission mode 或继承旧对话身份；普通身份与模型/权限默认值由主进程确定。幂等键作用域为客户端和创建操作，并复用进程内有界 10 分钟缓存；已创建成功后的界面刷新失败不能触发重复创建。

- “Synapse MCP 工具按需加载”默认开启，仅用于非 Anthropic 官方端点；保留用户/会话显式关闭的选择，缺少快照的旧对话使用默认按需模式。Anthropic 官方端点继续使用 SDK 原生工具模式；对话切换 Provider/端点时按快照与端点重新计算，不读取当前全局开关改写旧对话。
- 实验会话必须先用正常 `settingSources` 做一次不消费用户 prompt、不发送模型请求的 MCP discovery，再以 `strictMcpConfig: true` 重建其它可序列化 MCP，移除 `synapse-mcp` 并注入进程内 `synapse-tool-router`。不得用 `disallowedTools`、运行时 toggle 或同名 server 覆盖模拟隔离。
- 路由模式中任何异常都不得回退完整 MCP：可选连接器缺失、失败、待授权或 pending 超时，只排除该连接器并保留路由器及其它可重建 MCP；不可重建的可选配置也只排除该项。discovery 整体失败、重名、显式原始 Synapse 权限规则、policy helper、Synapse server 工具策略或路由器创建失败时，使用 `strictMcpConfig: true` 和空 MCP 集合，保留受现有权限限制的内置工具，不能绕过原权限策略。诊断仅记录名称、安全 reason 与状态，禁止配置、header、env 或凭据正文。
- 内部 router 只暴露 `search` 与 `invoke`。`search` 只读且可自动允许；`invoke` 必须把原始 Synapse 工具名和参数投影回 Persona、子 Agent allowlist、permission mode、权限卡片、toolUse/toolResult、history 与导出，并以 `toolUseId` 关联。底层执行仍走同一 action router、`PermissionGuard`、`AuditSink` 和公共 MCP 结果归一化。
- 自动注册/清理 Synapse MCP 时移除旧 server：`synapse-data`、`synapse-database`、`synapse-services`，以及旧权限 allowlist 工具名；不得自动新增 `mcp__synapse-mcp__*` allowlist。
- MCP 工具顶层 `inputSchema` 必须是普通对象，禁止顶层 `oneOf`、`anyOf`、`allOf`。跨字段条件由 dispatcher/service 校验，并在描述中说明。新增/修改工具时运行 `buildAllMcpTools()` 顶层兼容性测试。
- 公开工具名只使用由 `app.*` capability 派生的规范 `app_*`。旧 `database_*`、`model_price_*`、`repository_*`、`automation_*`、`workflow_*`、`content_*`、`drive_*` 前缀不是兼容别名，调用必须返回 `Unknown tool`。
- API、MCP、IPC、preload 使用同一 `app.<namespace>.<resource>.<action>` 语义源：HTTP action 保留点，MCP 将点替换为下划线，IPC 使用 `synapse:app:<namespace>:<resource>:<action>`，bridge 去掉 `app`、snake_case 转 camelCase 并按资源嵌套。
- UI 专用 IPC operation 也遵守 `app.*`，但不得因此注册为 MCP。旧 action/channel/bridge 不保留别名、转发或 fallback。
- `app.agent.conversation.open` 仍是只定位本机界面的公开导航能力。Agent Conversation Deep Link 唯一格式为 `synapse://threads/<thread-id>`，不携带项目查询参数；主进程严格校验路径短引用，再通过有界摘要扫描跨本机持久化项目解析唯一对话。不得注册或解析旧 `synapse://app/agent/open?projectId=...&conversationId=...` 入口。MCP 可直接接收完整 `deepLink`，后续调用优先使用 `projectId + conversationRef`。混合目标、歧义匹配、损坏校验和与其它畸形链接必须在读取前拒绝。链接本身不得包含标题、session key、timeline、消息正文、密钥或授权。冷启动待处理请求只驻留内存并在 Renderer 确认消费后清除。
- Agent Conversation MCP 可分页读取所有来源的界面可见时间线和运行状态，但只允许控制 `local` / `local-renderer` 用户对话。读取必须递归遮盖敏感字段并移除 provider/SDK 会话标识、原始 SDK payload、Base64 和内部 artifact URL；单项 64 KiB、整页 1 MiB。审计只记录项目、对话、回合、请求、动作、结果和正文/答案长度，不记录正文、thinking、工具输入输出或答案。
- Agent Conversation 控制采用协作语义而非独占租约。异步发送以 MCP 客户端内的幂等键接纳；steer、优雅停止、强停和权限响应必须匹配当前精确 `turnId`，权限响应还必须匹配仍 pending 的 `requestId`、kind 与 tool name。优雅停止不得超时自动强停，强停只通过独立高风险 capability 执行。
- Agent Conversation `observe` 只返回 revision、变化类型、历史数量和运行快照，不重复返回正文；最长等待 30 秒，并限制每对话 4、每客户端 8、全局 32 个并发观察。普通“接管”或“监视”不构成底层工具授权；allow 仍须当前用户明确批准具体操作并继续经过 Shell、文件、网络等既有 `PermissionGuard`。
- Synapse MCP 只通过 loopback HTTP `/mcp` 提供，不要求静态 token、Authorization/Bearer；不再支持 stdio bridge，旧配置必须自动迁移。内部 data-server `/api` 仍使用 `data-server.json` token，不得作为 MCP 传输入口。
- 未来远程 MCP 认证必须采用标准 OAuth 或客户端支持方案，不得要求手写静态 Bearer。
- 诊断必须区分 HTTP server 是否运行，以及 `~/.claude.json` 是否注册 `synapse-mcp`；不得用 `~/.claude/settings.json` 或旧 allowlist 推断 server 存在。

## 安全诊断与脱敏

- 诊断 Knowledge Base slash 来源时只做只读文件证据检查：backing directory、`.claude-plugin/plugin.json`、`skills/<name>/SKILL.md`、`commands/<name>.md` 和 commands 第一层文件名。不得执行目标 slash，也不得读取 Claude 配置、进程列表或任何 secret。
- 权限卡片、工具事件、错误日志、timeline、复制、导出和 Usage Analysis 必须同时脱敏 tool input 与 tool result。
- 规则至少覆盖敏感 key/JSON 字段、shell/env 赋值、Authorization/Bearer、Cookie、`data-server.json` token、`ps aux` 与 `--env KEY=value`；普通路径和 `file_path` 仍保留。
- Electron 与 renderer 复用共享脱敏 helper，不得在主进程、renderer、导出和 Usage Analysis 各写一套正则。
- Usage Analysis 只对 Synapse 内部展示、详情 JSON、事件预览和搜索 snippet 使用脱敏投影；不得改写用户机器上的外部原始 JSONL/日志，rawText 搜索不得返回真实 secret。
- Provider 预览、Agent 环境和 MCP/side-channel 诊断不得展示 `buildEnv`、`getAgentEnv` 或 data-server 配置中的值，只显示 key 是否存在、来源或 `[redacted]`。
- Agent 对话导出可附带 Claude Agent SDK 暴露的脱敏 API StreamEvent，但不得宣称为线级 HTTP 响应或原始 SSE 文本。高频 delta 只在内存中按轮次缓冲，单轮最多 1000 条、512 KiB，完成或失败时批量持久化；单个导出最多包含 8 MiB，超限必须在导出元数据中标记。旧会话未持久化的 delta 不得伪造或声称可恢复。
- JSON 诊断导出必须先对结构化值脱敏再序列化，不得对序列化后的 JSON 字符串做路径替换；所有导出的 JSON 文件必须保持可解析。工具结果中的内嵌 Base64 图片只保留省略标记，不得进入 timeline、history 或诊断正文。
- 相关修改必须用假 canary 回归测试 provider/side-channel token、Authorization/Bearer、Cookie、JSON `token`/`apiKey`、data-server token、`--env KEY=value` 不出现，普通 `/Users/...` 路径仍保留。
- 手工验证只用假 canary，优先只打印、不 export、不写文件、不改配置；不得要求用户提供真实 token。

## 工具输入、提问与事件关联

- 权限事件中的 `toolInput` / `toolInputRaw` 是展示、权限和审计摘要，可能已脱敏、截断或带 `[truncated]`。除非用户显式编辑并提交 `updatedInput`，不得把摘要回传 runtime 当真实工具参数，尤其不得让 Write/Edit 正文从权限卡片回流。
- AskUserQuestion 返回空答案时，后续敏感写操作必须停止，并反馈“未收到选择，已停止操作。”；不得视为同意或默认值。
- Renderer 内部可用 id/key/index 区分重复题干，但回传 SDK 的 `updatedInput.answers` 必须以原始 `question` 文本为 key、选项文本为 value。重复题干时在 runtime 边界转为不会丢题的 `response` 或 SDK 支持格式。
- 测试普通单题、重复题干、多题缺失、空答案停止，以及不得出现 `User has answered your questions: .`。
- 工具调用与结果的稳定关联键是 `toolUseId`。event bridge、history、IPC、timeline、复制和导出必须端到端保留；存在时只能按它归属，缺失才允许旧数据 fallback。
- 并行结果不得只靠顺序或 `toolName` 猜归属；`toolName` 可重复，也可能只是占位名。

## 权限与日志

- shell、userData 外写文件、网络连接、扩展加载、agent spawn、secret 访问等敏感操作必须经过 `PermissionGuard.check()` 并写入 `AuditSink`。
- 生产日志使用结构化 logger，不记录正文、token、Authorization、Cookie、secret、未脱敏输入或原始异常堆栈中可能包含的敏感数据。
- 日志和审计需要保留排障所需普通路径与资源身份，但不能把脱敏摘要误当作运行输入。
- Agent 回复 Outbox 只保存已有外部 dispatcher 接管的投递事件；本地 Renderer 通过 EventBus 接收事件，不得为其复制 Outbox 记录。已发送记录按回复目标保留最近 500 条，清理必须覆盖先前进程留下的数据，待发送和失败记录不得随已发送记录一起删除。
- `agent.events` 中 `sdkEvent` / `streamDiagnostics` 是原始诊断层，保留 30 天后可由后台维护删除；历史 `sdkEvent + system/thinking_tokens` 可立即分批删除。Conversation history、语义事件、usage、artifact 与 file checkpoint 不得混入该清理。已删除 conversation 的孤儿 `agent.events` 可分批清理。
- 运行数据维护只能在主窗口创建后调度，通过独立 Worker 对 `DataRepository` 内部 SQLite 表执行最多十万行一轮、五百行一批的短事务；中断、超时或锁冲突保留已提交批次并自动重试，不执行启动期 `VACUUM`，不得阻塞 Renderer。权限仅允许 `system:data-maintenance` 对 `runtime-data` 执行 `database.mutate`，结果写入结构化日志、AuditSink 和诊断页。
