# Synapse Workflow Fix Log

---

## [2026-05-12 22:30] 第 1 次迭代

### 发现的问题
- Runner "重新运行"按钮始终传递空参数 `{}`，导致带参数的工作流重跑时使用错误的空值（runner-app.tsx:120 → ipc.ts rerun handler）
- Runner DagView 的分支连线标签显示原始 ID（如 "branch1"）而非用户配置的中文标签（dag-view.tsx:44 直接使用 e.branch 而非解析 label）

### 修复内容
- [desktop/src/types/workflow.ts:39] WorkflowRunStatus 新增 `params?: Record<string, unknown>` 字段
- [desktop/electron/modules/workflow/ipc.ts:139,262,377] run / runDefinition / rerun 三个 IPC handler 在创建 runStatus 时存储 params
- [desktop/electron/modules/workflow/ipc.ts:352-357] rerun handler 新增 effectiveParams 逻辑：caller 传空时回退到上次运行的 params
- [desktop/src/modules/workflow/runner/runner-app.tsx:25,43,120-133] Runner 新增 runParams 状态，hydration 时读取，rerun 时传递
- [desktop/src/modules/workflow/runner/dag-view.tsx:26-31,46-59] 新增 resolveBranchLabel 函数，edges memo 使用解析后的标签

### 日志补充
- rerun IPC handler: 当使用上次运行 params 时记录 info 日志（含 previousRunId 和 paramKeys）
- runner-app handleRerun: 记录 rerun 请求日志（含 runId 和 paramKeys）

### 本次进展
工作流系统的"运行→查看→重跑"闭环在带参数场景下从静默出错变为正确保持参数，Runner 视图的分支标签从开发者 ID 变为用户可读文本。

---

## [2026-05-12 23:15] 第 2 次迭代

### 发现的问题
- Switch 节点分支匹配逻辑过于脆弱：仅做 trim+lowercase 后的精确匹配，LLM 响应中常见的多行文本、列表前缀（"- "）、引号包裹、尾部标点等均导致匹配失败，工作流报错"Agent 响应 ... 不匹配任何分支"（switch/executor.main.ts:20-23）
- Switch 节点和 Prompt 节点的 executor 完全没有日志输出，分支匹配失败时无法从日志还原 agent 实际响应内容，排查困难
- Switch 匹配成功时 output 字段返回的是完整的 raw 响应文本而非干净的分支 ID，导致下游引用 Switch 输出时拿到脏数据

### 修复内容
- [desktop/workflow-nodes/switch/executor.main.ts:全文] 新增 normalizeResponse 函数（取首行、去列表前缀、去引号、去尾部标点）和 matchBranch 多策略匹配函数（精确→归一化→子串搜索最长优先），替换原有单行精确匹配逻辑
- [desktop/workflow-nodes/switch/executor.main.ts:82-87] 匹配成功时 output 返回干净的 branch ID 而非 raw 响应
- [desktop/workflow-nodes/prompt/executor.main.ts:全文] 新增 createMainLogger 日志，覆盖执行开始、失败、成功三个路径

### 日志补充
- switch executor: 执行开始（info，含 runId/agent/branchIds/defaultBranch）、agent 调用失败（warn）、匹配成功（info，含 activeBranch 和 rawResponse 前 200 字符）、使用默认分支（info）、匹配失败（warn，含完整 rawResponse 前 500 字符和 branchIds）
- prompt executor: 执行开始（info，含 runId/agent/promptPreview）、agent 调用失败（warn）、执行成功（info，含 outputPreview）

### 本次进展
Switch 节点的分支路由从"仅在 LLM 完美遵循指令时才工作"变为"容忍常见 LLM 响应格式变体"，大幅提升了条件分支工作流在真实场景下的成功率。

---

## [2026-05-12 23:55] 第 3 次迭代

### 发现的问题
- Switch 分支合并拓扑下，下游节点（如 End）绑定了多个分支上节点的输出变量时，运行时必然崩溃：`resolveVariables` 对被跳过的节点直接 throw，导致整个工作流标记为 failed（variable-resolver.ts:17-20 → workflow-engine.ts:166 catch）。验证器仅检查结构可达性（ancestors），不检查分支运行时可达性，因此校验通过但运行必失败。这使得 Switch→merge 拓扑完全不可用。
- End 节点 executor 是唯一没有日志的节点执行器，模板插值出错时无法从日志定位问题（end/executor.main.ts 全文无 logger）
- Runner 的 NodeResultPanel 不展示节点的输入变量值，用户无法判断节点收到了什么数据（node-result-panel.tsx 仅展示 prompt/output/error）

### 修复内容
- [desktop/electron/services/workflow/variable-resolver.ts:全文] 重构 resolveVariables 返回 `{ resolved, skippedReferences }` 结构；新增 `allNodeIds` 参数区分"节点被跳过"（graceful → 空字符串）和"节点不存在"（broken ref → throw）；新增 `resolveVariablesSimple` 兼容包装
- [desktop/electron/services/workflow/workflow-engine.ts:112-118] 调用侧传入 allNodeIds，解构新返回值，skippedReferences 非空时打 warn 日志
- [desktop/workflow-nodes/end/executor.main.ts:全文] 新增 createMainLogger，覆盖执行开始和成功两个路径
- [desktop/src/modules/workflow/runner/node-result-panel.tsx:30-42] 新增"输入变量"展示区，显示所有 resolved variables（空值标注"（空）"）
- [desktop/electron/services/__tests__/workflow-variable-resolver.test.ts:全文] 更新测试用例适配新返回类型，新增 skipped-node 和 broken-ref 两个场景

### 日志补充
- variable-resolver: 节点被跳过时 warn（含 variableName/sourceNodeId/sourceNodeName）；节点不存在时 error
- workflow-engine: skippedReferences 非空时 warn（含 runId/nodeId/nodeName 和引用列表）
- end-executor: 执行开始 info（含 runId/templatePreview/variableCount）；执行成功 info（含 outputPreview）

### 本次进展
Switch→merge 拓扑从"运行必崩"变为"正常完成"，被跳过分支的变量优雅降级为空字符串而非硬错误，使条件分支工作流真正可用于多路合并场景。

---

## [2026-05-13 00:30] 第 4 次迭代

### 发现的问题
- Runner 双重 hydration 竞态：runner-app.tsx 自身的 useEffect 和 useWorkflowEvents hook 各自独立调用 `runStatus(runId)` IPC 进行 hydration。useWorkflowEvents 有完善的反回退保护（terminalNodes set + workflowTerminal flag），但 runner 自身的 useEffect 无任何保护，直接 `setNodeResults(status.nodeResults)` + `setRunState(status.status)`。快速工作流中，live 事件先到达并被 useWorkflowEvents 正确应用，随后 runner 的 hydration IPC 响应到达并用过时快照覆盖最新状态，导致节点状态闪回。
- Switch 节点分支匹配对大小写敏感：matchBranch 函数将 LLM 响应 toLowerCase() 但未对 branch ID 做同样处理。用户创建 "Yes"/"No" 等含大写的分支 ID 时，LLM 正确回复 "Yes" 经 toLowerCase 变为 "yes"，与原始 "Yes" 三种策略均不匹配，导致走 defaultBranch 或直接失败。

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:33-47] 将 runner 自身的 hydration useEffect 改为仅获取 metadata（definition、params），不再写入 nodeResults 和 runState。节点结果和运行状态完全由 useWorkflowEvents 单一路径管理，消除竞态。
- [desktop/workflow-nodes/switch/executor.main.ts:39-58] matchBranch 三种策略均改为 `id.toLowerCase()` 与已 lowercase 的响应比较。返回原始 branch ID（保留用户大小写），确保下游 edge activation 正确匹配。
- [desktop/workflow-nodes/switch/executor.main.ts:87-91] 匹配成功日志新增 normalizedResponse 字段，便于排查匹配过程。

### 日志补充
- runner-app: hydration 日志从 "hydrated run status" 改为 "hydrated run metadata"（含 hasDefinition/hasParams），明确只处理元数据
- switch executor: 匹配成功日志新增 normalizedResponse 前 100 字符

### 本次进展
Runner 的节点状态展示从"快速工作流下可能闪回"变为"始终单调递进"；Switch 分支匹配从"仅全小写 ID 可靠"变为"任意大小写 ID 均正确匹配"，两个问题分别影响运行可视化准确性和条件路由正确性。

---

## [2026-05-13 01:00] 第 5 次迭代

### 发现的问题
- Runner 切换运行时 DAG 拓扑闪烁：当 workflow:started 事件或 onRunnerSwitchRun 触发时，runner-app 重置了 runId/nodeResults/runState 但保留了旧 definition。若工作流结构在两次运行间发生变化（增删节点/连线），用户在 hydration 完成前看到错误的 DAG 拓扑（runner-app.tsx 两个事件处理器未清除 definition/runParams）
- 主进程 runStatuses Map 无界增长内存泄漏：每次 run/runDefinition/rerun 创建的 WorkflowRunStatus（含完整 definition、params、所有 nodeResults）永久驻留内存。长时间运行的 Synapse 实例中频繁迭代工作流会导致内存持续增长，无上限（ipc.ts runStatuses Map 无任何清理逻辑）

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:67-68,86-87] workflow:started 和 onRunnerSwitchRun 两个事件处理器新增 `setDefinition(null)` 和 `setRunParams({})`，触发 loading 状态直到 hydration effect 获取新 run 的元数据
- [desktop/electron/modules/workflow/ipc.ts:16-30] 新增 `pruneTerminalStatuses()` 函数，按 workflow 维度保留最近 5 条终态记录，淘汰最旧的
- [desktop/electron/modules/workflow/ipc.ts:run/runDefinition/rerun handlers] 三个 handler 在 snapshot 持久化后调用 pruneTerminalStatuses，确保内存中终态条目有界

### 日志补充
- runner-app: workflow:started 和 runner-switch-run 日志已存在（含 newRunId），无需新增
- ipc.ts pruneTerminalStatuses: 执行清理时 info 日志（含 workflowId/removed/remaining）

### 本次进展
Runner 的运行切换从"可能展示错误拓扑"变为"始终先 loading 再展示正确结构"；主进程内存从"无界增长"变为"每 workflow 最多 5 条终态记录常驻"，两个问题分别影响视觉正确性和长期运行稳定性。

---

## [2026-05-13 01:30] 第 6 次迭代

### 发现的问题
- 节点配置面板（Prompt/Switch/End）的 `commit()` / `onChange()` 调用以 `config` prop 为基础合并字段，但 prop 在快速连续编辑时可能是 stale 的（React 状态更新→re-render 尚未传播）。用户编辑变量绑定后立即切换 Agent 或 blur Prompt，变量绑定被旧 prop 覆盖静默丢失（prompt/panel.tsx:35, switch/panel.tsx:27-31, end/panel.tsx:17）
- Validator 不检查 Switch 节点的每个分支是否有出边连接。用户忘记连接某个分支时校验通过，运行时该分支被激活后 End 节点不可达，报出令人困惑的"结束节点未被执行"错误（workflow-validator.ts 缺少此检查）

### 修复内容
- [desktop/workflow-nodes/prompt/panel.tsx:21,23-27] 新增 `lastCommittedRef` 追踪最后一次提交的完整 config，`commit()` 以 ref 为基础而非 prop
- [desktop/workflow-nodes/switch/panel.tsx:28,30-38] 同上模式，`commit()` 改为基于 `lastCommittedRef.current`
- [desktop/workflow-nodes/end/panel.tsx:21,23-27] 同上模式，新增 `commit()` 替代直接 `onChange` 调用
- [desktop/electron/services/workflow/workflow-validator.ts:109-132] 新增 Switch 分支出边完整性校验循环，未连接分支报 `invalid_switch_edge` 错误并打 warn 日志

### 日志补充
- workflow-validator: Switch 分支无出边时 warn 日志（含 workflowId/nodeId/nodeName/branchId/branchLabel）

### 本次进展
节点配置编辑从"快速连续操作可能丢失变量绑定"变为"所有字段编辑互不干扰"；Switch 分支连接完整性从"运行时才暴露"变为"保存/运行前即拦截并给出精确提示"。

---

## [2026-05-13 02:00] 第 7 次迭代

### 发现的问题
- Switch 节点分支重命名后，画布上的连线标签（Badge）仍显示旧名称。必须关闭编辑器重新打开才能看到正确标签。100% 可复现，影响主编辑流程。

### 根因
`canvas.tsx` 的 `defToFlow` 仅在组件初始化时将 branch label 写入 edge `data.label`。`WorkflowCanvasHandle` 只暴露了 `updateNodeConfig`（更新节点数据）和 `removeEdgesByIds`（删除孤立边），没有更新边数据的方法。

`editor-app.tsx` 的 `handleConfigChange` 在 Switch 分支变更时只处理了"删除已移除分支对应的边"，未同步"仍存在分支的标签变更"到画布边数据。

### 触发路径
```
SwitchNodePanel.updateBranchLabel
  → commit({ branches: next })
    → handleConfigChange(nodeId, config)
      → canvasRef.updateNodeConfig ✓ (节点数据更新)
      → canvasRef.removeEdgesByIds ✓ (孤立边清理)
      → 边标签同步 ✗ (缺失)
```

### 修复内容
- [desktop/src/modules/workflow/editor/canvas.tsx:35-38] `WorkflowCanvasHandle` 接口新增 `updateEdgeLabels(sourceNodeId, branches)` 方法
- [desktop/src/modules/workflow/editor/canvas.tsx:119-128] 实现 `updateEdgeLabels`：遍历 edges，对 `source === sourceNodeId && sourceHandle` 匹配的边更新 `data.label`。仅在 label 实际变化时产生新引用，避免无谓重渲染
- [desktop/src/modules/workflow/editor/editor-app.tsx:87-89] `handleConfigChange` 在 Switch 分支处理块末尾调用 `canvasRef.current?.updateEdgeLabels(nodeId, branches)`

### 日志补充
- editor-app: Switch 边标签同步时 debug 日志（含 nodeId/branchCount）

### 验证
- `tsc --noEmit` 通过，无类型错误
- `updateEdgeLabels` 的 updater 对每条边做 source + sourceHandle 匹配，label 不变时返回原引用（React 不重渲染），label 变化时返回新对象触发 BranchEdge 重绘
- 不影响非 Switch 节点的边（无 sourceHandle 的边直接跳过）
- 不影响已删除分支的边（orphan 清理在前，label 同步在后）

### 本次进展
Switch 分支重命名后画布连线标签从"必须重开编辑器才能看到新名称"变为"即时同步更新"，消除了编辑器主流程中的视觉不一致。

---

## [2026-05-12 16:45] 第 8 次迭代

### 发现的问题
- 从"运行历史"打开被淘汰的旧运行时，Runner 变成空窗：内存 runStatuses 只保留每工作流 5 条终态（`MAX_TERMINAL_STATUSES_PER_WORKFLOW`），但快照服务在磁盘保留 20 条。历史对话框列出全部 20 条，用户点击第 6 条及以后任一条，`workflow:run-status` 返回 null，Runner 的 hydration（runner-app + useWorkflowEvents）双双提前返回，导致节点无状态、时间线为空、runState 永远停在 "running"。
- 画布复制-粘贴一组存在变量引用的节点后无法保存：`pasteNodes` 用 `idMap` 重写了边的 from/to，却没有重写节点 `config.variables[*].source.node`，粘贴后下游节点的变量仍指向原始（未被选中的）上游节点。保存时 `workflow-validator` 的 ancestors 检查命中 `unreachable_reference`，拒绝落盘，用户必须手动重新绑定每个变量。

### 修复内容
- [desktop/electron/modules/workflow/ipc.ts:475-511] `runStatus` handler 改为 async，内存命中时直接返回，未命中时通过 `WorkflowService.list()` + `RunSnapshotService.get()` 回退到磁盘快照，返回重建的 `WorkflowRunStatus`（含 definition/params/nodeResults/status），彻底拉通 history → runner 的查看结果路径
- [desktop/src/modules/workflow/editor/canvas.tsx:29-31] 引入 `createRendererLogger("workflow.editor.canvas")`
- [desktop/src/modules/workflow/editor/canvas.tsx:265-300] `pasteNodes` 对每个节点做 config 深克隆（`JSON.parse(JSON.stringify(...))`），并用 `idMap` 同步重写 `variables[*].source.node`，使粘贴子图内部引用自洽；附带修复了原先多次粘贴共享 config 引用导致的静默交叉污染

### 日志补充
- workflow.ipc `run-status hydrated from snapshot` info（含 runId/workflowId/status/nodeCount/hasDefinition）和 `run-status not found in memory or snapshots` warn，便于区分"被淘汰但可从磁盘恢复"与"真正不存在"两种情况
- workflow.editor.canvas `paste nodes` info（含 pastedNodeCount/pastedEdgeCount/rewrittenBindings），可从日志还原每次粘贴重写了多少条变量绑定

### 本次进展
工作流"运行→查看结果"路径在 5 条之外的历史运行上从"打开即空窗"变为"DAG/时间线/结果面板全部可查"；"编辑→复制→粘贴→保存"路径在节点间存在变量引用时从"保存被校验拒绝"变为"粘贴子图直接可保存运行"。主流程断路再推进一步。

---

## [2026-05-12 17:30] 第 9 次迭代

### 发现的问题
- 编辑器工具栏"保存"和"运行"按钮在异步操作期间无 loading/disabled 状态，用户可重复点击触发并发保存或多次运行（toolbar.tsx:36-37 → editor-app.tsx handleSave/handleRun 均为 async 但无状态追踪）
- RunParamsDialog 不支持 Enter 键提交，用户输入参数后必须用鼠标点击"运行"按钮（run-params-dialog.tsx 无 form 包装）

### 修复内容
- [desktop/src/modules/workflow/editor/editor-app.tsx:27-28] 新增 saving/running state
- [desktop/src/modules/workflow/editor/editor-app.tsx:134-161] handleSave 包裹 setSaving(true)/finally setSaving(false)
- [desktop/src/modules/workflow/editor/editor-app.tsx:164-198] handleRun 包裹 setRunning(true)/finally setRunning(false)
- [desktop/src/modules/workflow/editor/editor-app.tsx:206] WorkflowToolbar 传递 saving/running props
- [desktop/src/modules/workflow/editor/toolbar.tsx:4,9-16,18,21,36-46] 新增 Loader2 import、saving/running props、busy 计算、按钮 disabled + 动态图标
- [desktop/src/modules/workflow/components/run-params-dialog.tsx:17-41] form 包装 + type="submit" + handleSubmit 接受 FormEvent

### 与历史的关系
- 独立

### 日志补充
- 无（纯 UI 优化）

### 本次进展
编辑器核心操作（保存、运行）从"无反馈可重复触发"变为"有明确进行中状态和防重复保护"；参数对话框从"必须鼠标点击"变为"支持 Enter 键提交"，编辑→运行主流程的交互顺畅度提升一步。

---

## [2026-05-12 18:15] 第 10 次迭代

### 发现的问题
- Runner "重新运行"按钮无 loading/disabled 状态（可重复点击）、校验失败时错误静默丢失（仅 log 不展示）、成功时未清除旧 definition 导致 DAG 拓扑短暂闪烁（runner-app.tsx:129-143 + runner-toolbar.tsx:63-65）
- Runner "停止"按钮同样无 loading/disabled 状态

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:29-30] 新增 rerunning/cancelling state
- [desktop/src/modules/workflow/runner/runner-app.tsx:127-163] handleCancel 加 setCancelling 包裹；handleRerun 加 setRerunning 包裹 + errors 写入 runError + 成功路径补 setDefinition(null)/setRunParams({})
- [desktop/src/modules/workflow/runner/runner-app.tsx:177-188] RunnerToolbar 传递 rerunning/cancelling props
- [desktop/src/modules/workflow/runner/runner-toolbar.tsx:3] 新增 Loader2 import
- [desktop/src/modules/workflow/runner/runner-toolbar.tsx:20-21] 新增 rerunning/cancelling props
- [desktop/src/modules/workflow/runner/runner-toolbar.tsx:37] 错误显示条件从 runState==="failed" 改为 isTerminal
- [desktop/src/modules/workflow/runner/runner-toolbar.tsx:60-68] 停止和重新运行按钮加 disabled + loading 图标

### 与历史的关系
- 延续第 5 轮（definition 清除模式）+ 延续第 9 轮（toolbar loading 模式），位置不同（Runner 而非 Editor）

### 日志补充
- 无（纯 UI 优化，handleRerun 已有 logger.info/warn 覆盖）

### 本次进展
Runner 的"重新运行"和"停止"操作从"无反馈可重复触发、错误静默丢失"变为"有明确 loading 状态、防重复、校验错误可见"，调试循环的交互完整度提升一步。

---

## [2026-05-12 18:50] 第 11 次迭代

### 发现的问题
- Runner 时间线视图节点列表顺序不稳定：`Object.values(nodeResults)` 按对象 key 插入顺序输出，取决于事件到达时序而非执行开始时间，多节点工作流中列表顺序不可预测（timeline-view.tsx:17）
- Runner 时间线视图 running 节点的"已运行 Xs"显示是静态快照：`Date.now() - r.startedAt` 仅在渲染时计算一次，无定时刷新机制，LLM 调用期间计时器完全静止（timeline-view.tsx:36-39）

### 修复内容
- [desktop/src/modules/workflow/runner/timeline-view.tsx:1] 添加 useEffect, useState import
- [desktop/src/modules/workflow/runner/timeline-view.tsx:18-19] 对 results 按 startedAt 升序排序（未开始的排最后）
- [desktop/src/modules/workflow/runner/timeline-view.tsx:21-29] 新增 hasRunning 检测 + setTick interval 机制，每秒触发重渲染更新计时，终态后自动停止

### 与历史的关系
- 独立

### 日志补充
- 无（纯 UI 优化）

### 本次进展
Runner 时间线视图从"顺序混乱 + 计时静止"变为"按执行时序排列 + 实时计时"，使其真正具备了观察工作流执行进度的核心功能。

---

## [2026-05-12 19:30] 第 12 次迭代

### 发现的问题
- 编辑器校验错误列表不可点击定位到问题节点：ValidationError 包含 nodeId 字段但 UI 仅渲染 message 文本，用户必须手动在画布上搜索问题节点（editor-app.tsx:208-221）
- Runner 时间线视图不展示已完成/失败节点的执行耗时：仅 running 节点显示实时计时，终态节点的 durationMs 未被展示，用户无法在时间线中比较各节点性能（timeline-view.tsx:48-55）

### 修复内容
- [desktop/src/modules/workflow/editor/editor-app.tsx:213-221] 校验错误 li 元素添加条件 className（cursor-pointer hover:underline）和 onClick（setSelectedNodeId），带 nodeId 的错误可点击定位
- [desktop/src/modules/workflow/runner/timeline-view.tsx:53-56] 新增 success 节点耗时展示（智能格式：<1s 显示 ms，≥1s 显示 s）
- [desktop/src/modules/workflow/runner/timeline-view.tsx:58-64] 重构 failed 节点展示：耗时（muted 色）+ 分隔符 + 错误信息（destructive 色），无 durationMs 和无 error 时不渲染

### 与历史的关系
- 缺陷 1（校验错误点击）：独立
- 缺陷 2（时间线耗时）：延续第 11 轮（同文件同主题，补充终态信息）

### 日志补充
- 无（纯 UI 优化）

### 本次进展
编辑器的"校验失败→定位问题→修复"循环从"需要手动搜索节点"变为"一键定位"；Runner 时间线视图从"仅展示实时进度"变为"完整展示每个节点的执行耗时"，编辑调试效率和运行观测能力各进一步。

---

## [2026-05-12 19:50] 第 13 次迭代

### 发现的问题
- Runner DAG 视图点击未开始执行的节点无任何反馈：selectedResult 为 null 时结果面板不渲染，用户点击 pending 节点看不到任何响应（runner-app.tsx:169 → 条件渲染 206）
- 时间线视图仅展示已有 nodeResults 条目的节点，pending 节点完全不可见，用户无法了解剩余执行进度和总节点数（timeline-view.tsx:18 仅 Object.values(nodeResults)）

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:169-171] selectedResult 从 `?? null` 改为 `?? { nodeId, status: "pending", input: { variables: {} } }`，确保点击任何节点都产生面板
- [desktop/src/modules/workflow/runner/node-result-panel.tsx:6-8] STATUS_LABEL/STATUS_VARIANT 新增 pending 条目
- [desktop/src/modules/workflow/runner/node-result-panel.tsx:67-70] 空状态文案区分 pending（"节点等待执行"）和其他（"无可展示的输出"）
- [desktop/src/modules/workflow/runner/timeline-view.tsx:16-26] 数据源重构：已有结果按 startedAt 排序 + definition.nodes 中未出现的节点作为 pending 追加
- [desktop/src/modules/workflow/runner/timeline-view.tsx:38-39] 空状态文案改为"暂无节点"

### 与历史的关系
- 缺陷 1（pending 节点面板）：独立
- 缺陷 2（时间线 pending 节点）：延续第 11 轮（同文件同主题，补充 pending 节点展示）

### 日志补充
- 无（纯 UI 优化）

### 本次进展
Runner 的执行观测能力从"只能看到已开始的节点"变为"完整展示所有节点状态（含 pending）"，用户在工作流执行期间可随时了解整体进度。

---

## [2026-05-12 20:30] 第 14 次迭代

### 发现的问题
- Running 节点在 Runner 时间线中不显示"已运行 Xs"：onNodeStarted 回调不传递 startedAt，hydration 路径对 running 节点也不传递完整 NodeRunResult，导致 timeline-view 的 `r.startedAt` 始终为 undefined（use-workflow-events.ts:42,67 → runner-app.tsx:100-103 → timeline-view.tsx:55）
- 编辑器"保存并关闭"在保存失败时仍关闭窗口导致数据丢失：handleCloseSave 不检查 handleSave 返回值，校验失败后直接 window.close()（editor-app.tsx:126-132）

### 修复内容
- [desktop/src/modules/workflow/hooks/use-workflow-events.ts:8] onNodeStarted 签名扩展为 `(nodeId, partial?: Partial<NodeRunResult>)`
- [desktop/src/modules/workflow/hooks/use-workflow-events.ts:42] hydration 对 running 节点传递完整 nr
- [desktop/src/modules/workflow/hooks/use-workflow-events.ts:67] live 事件传递 `{ startedAt: event.startedAt ?? Date.now() }`
- [desktop/src/modules/workflow/runner/runner-app.tsx:100-103] onNodeStarted 回调 spread partial 到结果中
- [desktop/src/modules/workflow/editor/editor-app.tsx:126-140] handleCloseSave 检查返回值，失败时关闭对话框但不关闭窗口

### 与历史的关系
- 缺陷 1：延续第 11 轮（时间线计时主题），位置在数据源层
- 缺陷 2：独立

### 日志补充
- 无（缺陷 1 修复的是数据传播路径，已有日志覆盖事件发射侧；缺陷 2 为纯 UI 逻辑）

### 本次进展
Runner 时间线的实时计时从"永远不显示"变为"节点开始执行即显示"；编辑器"保存并关闭"从"保存失败仍关闭导致数据丢失"变为"保存失败时保持窗口让用户修复"。

---

## [2026-05-12 21:15] 第 15 次迭代

### 发现的问题
- Runner 结果面板"激活分支"字段显示原始 branch ID（如 "branch1"）而非用户配置的中文标签（node-result-panel.tsx:61-65 直接渲染 result.activeBranch，无 definition 上下文）
- 运行历史对话框条目缺少耗时信息，多次运行难以区分（run-history-dialog.tsx:54-77 仅展示状态+时间+节点数，未利用 endedAt 计算耗时）
- 编辑器运行冲突确认使用 window.confirm() 原生对话框，与应用设计语言不一致（editor-app.tsx:191 直接调用 window.confirm）

### 修复内容
- [desktop/src/modules/workflow/runner/node-result-panel.tsx:4,11-16,18-26,70-76] 新增 definition prop，activeBranchLabel 解析逻辑从 definition 中查找 Switch 节点 branch label
- [desktop/src/modules/workflow/runner/runner-app.tsx:220] NodeResultPanel 调用新增 definition prop
- [desktop/src/modules/workflow/components/run-history-dialog.tsx:40-45,74-78] 新增 formatDuration 函数，每条历史记录条件展示耗时
- [desktop/src/modules/workflow/editor/editor-app.tsx:30,191-194,206-218,281-292] 新增 conflictState + handleForceRun + 运行冲突 AlertDialog，替换 window.confirm

### 与历史的关系
- 缺陷 1：延续第 1 轮（dag-view 分支标签解析），同主题但位置不同（结果面板）
- 缺陷 2：独立
- 缺陷 3：独立

### 日志补充
- 无（纯 UI 优化）

### 本次进展
Runner 结果面板的分支信息从"开发者 ID"变为"用户可读标签"，运行历史从"条目难以区分"变为"一眼可见耗时"，编辑器运行冲突从"原生对话框"变为"应用内 AlertDialog"——运行观测和编辑交互的信息可读性与一致性各进一步。

---

## [2026-05-12 22:00] 第 16 次迭代

### 发现的问题
- Runner "重新运行"在 IPC 返回 null 时静默失败无反馈：handleRerun 的 `!result` 分支直接 return，用户看到 spinner 停止但无错误提示（runner-app.tsx:143）
- 工作流列表页 Play 按钮无 loading/disabled 状态，可重复点击触发多次并发运行（workflow-list.tsx:14-37 + workflow-card.tsx:36）

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:143-147] handleRerun `!result` 分支新增 setRunError + logger.warn
- [desktop/src/modules/workflow/components/workflow-list.tsx:13,15-16,40-41,80] 新增 runningId state + guard + finally + 传递 running prop
- [desktop/src/modules/workflow/components/workflow-card.tsx:6,17,19,36-38] 新增 Loader2 import、running prop、Play 按钮 disabled + 动态图标

### 与历史的关系
- 缺陷 1：延续第 10 轮（runner toolbar 错误反馈），覆盖 !result 失败路径
- 缺陷 2：延续第 9 轮（editor toolbar loading 模式），位置在列表页

### 日志补充
- runner-app handleRerun: IPC 不可用时 warn 日志（含 runId）

### 本次进展
Runner 的"重新运行"失败路径从"静默无反馈"变为"有明确错误提示"；列表页运行入口从"无防重复保护"变为"有 loading 状态和防重复点击"，两个主要运行入口的交互完整度补齐。

---

## [2026-05-12 22:45] 第 17 次迭代

### 发现的问题
- Runner 时间线视图点击节点行后无选中态高亮，用户无法辨别当前查看的是哪个节点的结果（timeline-view.tsx:49 className 固定无条件高亮）
- Runner DAG 视图的节点选中态由 ReactFlow 内部管理，与应用层 selectedNodeId 不同步：关闭面板后节点仍显示选中 ring，从时间线切换到 DAG 时无节点高亮（dag-view.tsx:34-44 nodes memo 无 selected 属性）

### 修复内容
- [desktop/src/modules/workflow/runner/timeline-view.tsx:10-14] TimelineViewProps 新增 selectedNodeId prop
- [desktop/src/modules/workflow/runner/timeline-view.tsx:17] 函数签名解构新增 selectedNodeId
- [desktop/src/modules/workflow/runner/timeline-view.tsx:49] 行 className 新增条件 bg-muted 高亮
- [desktop/src/modules/workflow/runner/dag-view.tsx:19-25] DagViewProps 新增 selectedNodeId prop
- [desktop/src/modules/workflow/runner/dag-view.tsx:34,43,45] DagViewInner 解构 selectedNodeId，nodes memo 设置 selected 属性并加入 deps
- [desktop/src/modules/workflow/runner/runner-app.tsx:198-211] DagView 和 TimelineView 调用处传递 selectedNodeId

### 与历史的关系
- 缺陷 1：延续第 11 轮（时间线视图同文件同主题，补充交互反馈）
- 缺陷 2：独立

### 日志补充
- 无（纯 UI 优化）

### 本次进展
Runner 的节点选中态从"视觉断裂（时间线无高亮、DAG 与面板不同步）"变为"跨视图一致（选中态始终与结果面板同步）"，调试观测的交互清晰度提升一步。

---

## [2026-05-12 23:30] 第 18 次迭代

### 发现的问题
- handleRun 在 handleSave 之后读取 definitionRef.current 得到旧 definition（缺少新 version hash），传给 runDefinition，导致 snapshot 记录错误版本号（editor-app.tsx:166 setDefinition 不同步 ref → :180 读取 stale ref）
- RunParamsDialog 每次打开都重置为默认值，带参数工作流的迭代测试循环中用户必须反复输入相同参数（run-params-dialog.tsx:13-15 useEffect 无条件重置）

### 修复内容
- [desktop/src/modules/workflow/editor/editor-app.tsx:166-172] handleSave 成功时同步更新 definitionRef.current，确保后续 async 代码读取到最新 version hash
- [desktop/src/modules/workflow/editor/toolbar.tsx:21-23,57-62] 新增 lastRunValues state，传递给 RunParamsDialog 并在提交时记录
- [desktop/src/modules/workflow/components/run-params-dialog.tsx:8-27,29-34] 新增 lastValues prop，useEffect 优先使用上次提交值；onConfirm 签名扩展返回 raw values
- [desktop/src/modules/workflow/components/workflow-list.tsx:87] 适配 onConfirm 新签名

### 与历史的关系
- 独立

### 日志补充
- 无（缺陷 1 修复的是 ref 同步时序，已有日志覆盖 save 成功路径；缺陷 2 为纯 UI 优化）

### 本次进展
编辑器的"编辑→运行→调整→再运行"迭代循环从"每次重新输入参数 + snapshot 版本不一致"变为"参数自动保持 + 版本正确记录"，降低了带参数工作流的迭代摩擦并修复了运行历史的数据完整性。

---

## [2026-05-13 02:30] 第 19 次迭代

### 发现的问题
- ParamsEditorDialog 意外关闭（点击外部/Esc/点击X）时静默丢弃所有未保存的参数编辑，用户必须从头重新输入（params-editor-dialog.tsx:103 handleOpenChange 无条件关闭）
- RunHistoryDialog 加载失败时陷入两种错误态：IPC 不可用→静默显示"暂无运行记录"（误导），异常抛出→永久"加载中…" spinner 无出口（run-history-dialog.tsx:26-31 无 try/catch）
- 节点重命名输入框不支持 Enter 键提交，用户本能按 Enter 无响应，必须点击其他区域触发 blur（node-config-panel.tsx:44 仅 onBlur 无 onKeyDown）

### 修复内容
- [desktop/src/modules/workflow/components/params-editor-dialog.tsx:1,3,97-100,104,110,112-122,142,169,174-187] 新增 paramsEqual 比较函数 + isDirty memo + showCloseConfirm state；handleOpenChange/handleCancel 在 dirty 时弹出 AlertDialog 确认框（保存/放弃/取消）而非直接关闭；外层包裹 <> fragment
- [desktop/src/modules/workflow/components/run-history-dialog.tsx:1,4-5,23,25-53,78-87] 新增 error state + useCallback load 函数（try/catch + !data 检测）；loading/error/empty 三态分离渲染，error 态展示 Alert + 重试按钮
- [desktop/src/modules/workflow/editor/node-config-panel.tsx:45] 名称 Input 新增 onKeyDown handler，Enter 键触发 e.currentTarget.blur() 复用 onBlur 提交流程

### 与历史的关系
- 独立

### 日志补充
- 无（缺陷 1 和 3 为纯 UI 交互优化；缺陷 2 为错误处理补齐，IPC 不可用和异常路径均为无日志的纯渲染层状态管理）

### 本次进展
工作流编辑器的参数编辑从"意外关闭静默丢数据"变为"有未保存更改时弹确认"，运行历史从"加载失败无反馈/永久卡死"变为"三态分离+重试"，节点重命名从"必须鼠标点击提交"变为"支持 Enter 键"——编辑安全、错误可见性、交互效率三个维度各进一步。

---

## [2026-05-13 03:10] 第 20 次迭代

### 发现的问题
- 复制粘贴 Switch 子图后分支连线标签丢失：pasteNodes 构造 ReactFlow edge 对象时使用粘贴前的旧 definitionRef.current 解析分支标签，新 paste 的 Switch 节点不存在于旧定义中导致 resolveBranchLabel 返回 undefined，edge 未设置 type:"branch" 和 label data。关闭重开编辑器后 defToFlow 重新构造才恢复标签。
- RunSnapshotService.save() 无错误处理：save() 方法体无 try/catch，六处 IPC handler 调用均用 `void snapshots.save(...)` 吞掉 Promise rejection。磁盘满或权限异常时快照静默丢失，已完成运行在 Run History 中消失且无任何日志可追踪。

### 修复内容
- [desktop/src/modules/workflow/editor/canvas.tsx:309-336] pasteNodes 中将 newDef 构造和 definitionRef.current 更新提前到 flowNodes/flowEdges 构造之前，确保 resolveBranchLabel 查找时定义已包含新 paste 的 Switch 节点
- [desktop/electron/services/workflow/run-snapshot-service.ts:1-6] 新增 createMainLogger 导入，初始化 logger
- [desktop/electron/services/workflow/run-snapshot-service.ts:29-47] save() 方法体包裹 try/catch，catch 分支 logger.error 记录 runId/workflowId/error/stack

### 与历史的关系
- 缺陷 1：与第 7 轮同主题（分支标签未同步）但触发路径不同（paste 而非 rename），属于独立新缺陷
- 缺陷 2：独立（untouched 文件首次审查）

### 日志补充
- run-snapshot-service: save 失败时 error 日志（含 runId/workflowId/error/stack），快照丢失从完全不可观测变为可追踪

### 本次进展
工作流编辑器的"复制→粘贴→确认"路径中 Switch 分支标签从"粘贴后丢失需重开编辑器"变为"即时正确显示"；运行结果快照从"IO 异常静默丢失不可观测"变为"异常有日志"，主流程视觉一致性和数据可观测性各进一步。

---

## [2026-05-13 03:50] 第 21 次迭代

### 发现的问题
- 工作流列表页加载失败时展示误导性空状态（"还没有工作流。"），useWorkflowList hook 无 error 状态，IPC 桥接不可用或 list() 异常时用户无法区分"加载中/加载失败/确实无数据"三种情况（use-workflow-list.ts:8-9 → workflow-list.tsx:72-73）
- 工作流模块"新建"/列表"运行"/参数"运行"三个操作的早期 return 路径均无 toast 反馈：handleCreate 无 try/catch（index.tsx:14-16），handleRun 中 !def 静默 return（workflow-list.tsx:22-23），handleConfirmRun 中 !result 静默 return（workflow-list.tsx:55-56），用户操作无响应时不知道发生了什么
- ExecutionOverlay 中 Switch 节点激活分支显示原始 ID（"branch1"）而非用户配置的中文标签，与 NodeResultPanel 行为不一致（execution-overlay.tsx:90-93 → node-result-panel.tsx:20-26 已有正确实现但未同步到 ExecutionOverlay）

### 修复内容
- [desktop/src/modules/workflow/hooks/use-workflow-list.ts:7,9-23,26] 新增 error state，catch 块设置错误，IPC 不可用时检查 !data 设为错误而非空；返回值新增 error 字段
- [desktop/src/modules/workflow/components/workflow-list.tsx:3,8-9,13,84-95] 新增 Alert/Button 导入，解构 error，loading/error/empty 三态分离渲染，error 态展示 Alert + 重试按钮
- [desktop/src/modules/workflow/components/workflow-list.tsx:23-25,29-31,64-66] handleRun 中 !def 分支新增 toast.error("工作流不存在，请刷新列表")；!result 分支新增 toast.error("运行失败：无法连接到主进程")；handleConfirmRun 同理
- [desktop/src/modules/workflow/index.tsx:2,14-29] 新增 toast 导入，handleCreate 包裹 try/catch，!result 和 "errors" in result 分支分别 toast.error
- [desktop/src/modules/workflow/editor/execution-overlay.tsx:27-32,100] 新增 resolveActiveBranchLabel 函数，参照 node-result-panel.tsx 的标签解析逻辑；激活分支字段使用解析后的标签

### 与历史的关系
- 缺陷 1：独立（列表页 error state 从未被覆盖）
- 缺陷 2：独立（列表页操作的 silent 失败从未被覆盖）
- 缺陷 3：延续第 15 轮（NodeResultPanel 的 activeBranchLabel 解析同主题但位置不同——ExecutionOverlay 而非 NodeResultPanel）

### 日志补充
- 无（纯 UI 优化：所有修改均为渲染侧错误状态补充和 toast 反馈，不涉及数据流、执行路径或 IPC 契约变更）

### 本次进展
工作流列表页从"二态（loading/empty）"变为"三态（loading/error/empty）"，列表层所有用户操作（新建/运行/参数运行）从"静默失败无反馈"变为"有明确 toast 提示"；编辑器内 Switch 分支信息展示从"开发者 ID"变为"用户标签"——列表层交互完整度补齐一步，编辑/运行/观测三层的信息一致性提升一步。

---

## [2026-05-13 14:00] 第 22 次迭代

### 发现的问题
- 画布节点选中后按 Delete/Backspace 键无响应：`handleKeyDown` 的 `if (!mod) return` 在 canvas.tsx:389 拦截了无修饰键的 Delete/Backspace，右键菜单标注的 ⌫ 快捷键实际未绑定
- 工作流校验器不检查 `param` 类型变量绑定的有效性：validator.ts:79-88 仅检查 `node_output` 可达性，用户删除参数后节点引用仍存在，运行时静默解析为空字符串
- 从节点面板拖入画布的新节点未被自动选中：`onDrop` 设置 `selected: false`，用户必须额外点击才能进入配置面板；`pasteNodes` 已实现了 `selected: true` 但 `onDrop` 遗漏

### 修复内容
- [desktop/src/modules/workflow/editor/canvas.tsx:390-394] 在 `handleKeyDown` 中 `mod` 检查之前新增 Delete/Backspace 处理分支，调用 `deleteNodesRef.current(ids)`（复用已有 End 节点保护）
- [desktop/electron/services/workflow/workflow-validator.ts:87-91] 在 node_output 检查之后新增 param 引用有效性检查，引用不存在的参数报 `invalid_config` 错误并打 warn 日志
- [desktop/src/modules/workflow/editor/canvas.tsx:223-231] `onDrop` 将 `selected: false` 改为 `selected: true`（取消其他节点选中），并显式调用 `onNodeSelect?.(id)`，与 pasteNodes 行为对齐

### 与历史的关系
- 缺陷 1（Delete 快捷键）：独立
- 缺陷 2（参数验证）：独立
- 缺陷 3（拖入自动选中）：独立

### 日志补充
- workflow-validator: 参数引用不存在时 warn 日志（含 workflowId/nodeId/nodeName/missingParam）
- 其余两项为纯 UI/交互优化，无需日志补充

### 本次进展
编辑器的键盘交互从"缺失删除快捷键"补齐到完整编辑操作，拖入→配置路径从"两步"缩短为"一步"，校验器从"仅检查节点引用"扩展到"同时检查参数引用"——编辑效率、交互流畅度、数据完整性各向前一步。

---

## [2026-05-13 14:35] 第 23 次迭代

### 发现的问题
- 编辑器加载工作流失败时无限显示"加载中…"：editor-app.tsx:42-43 IPC bridge 不可用时静默 return、:48 get() 返回 null 时 `if (def)` 跳过不设错误，渲染层仅 loading/ready 二态（:226）。用户遇到 IPC 未就绪或工作流被删除时永久 spinner 无反馈。
- Runner 打开被淘汰的历史运行时无限"加载中…"：runner-app.tsx:43 runStatus 返回 null 时 hydration effect 静默 return，:60 fallback effect 的 `if (runId) return` 阻止降级获取 definition，渲染层仅 loading/ready 二态（:189）。快照被淘汰（超过 20 条）时 runner 永久空白。

### 修复内容
- [desktop/src/modules/workflow/editor/editor-app.tsx:2,31,40-73,71-73,249-266] 新增 loadError state 和 loadDefinition callback（try/catch + 三条失败路径）；渲染层新增 error 三态（Alert + 重试按钮）
- [desktop/src/modules/workflow/runner/runner-app.tsx:31,42-56,59-78,199-212,229-233] 新增 loadError state；hydration !status 分支设 loadError 并解锁 fallback effect（guard 从 `if (runId) return` → `if (runId && !loadError) return`）；渲染层新增 error 态 + fallback 成功时警告 banner

### 与历史的关系
- 缺陷 1：独立（editor-app 的 definition loading 错误态从未被任何轮次覆盖）
- 缺陷 2：延续第 8 轮（同主题——历史运行打开 Runner，覆盖第 8 轮未处理的快照被淘汰最终退化路径）

### 日志补充
- editor-app: IPC 桥不可用时 warn 日志（含 workflowId）；get() 返回 null 时 warn 日志；加载异常时 error 日志（含 workflowId/error）
- runner-app: hydration 失败时 warn 日志（含 runId/workflowId），触发 fallback

### 本次进展
工作流系统的两个核心入口（编辑器加载、Runner 查看历史结果）在数据不可达时从"永久 loading spinner 无任何反馈"变为"有明确错误信息和降级/恢复路径"，主流程错误处理断路修复。

---

## [2026-05-13 15:30] 第 24 次迭代

### 发现的问题
- 取消运行后被中断节点永久显示"运行中"：引擎两处 cancel return 路径（正常 abort check + 异常 catch）均未将 `nodeResults[nodeId].status` 从 "running" 更新为终态 → timeline-view 的 `hasRunning` 永远为 true → 计时持续增长（workflow-engine.ts:142-147, 177-181 → timeline-view.tsx:31-37）
- 工作流列表页 Play 按钮冲突无恢复路径：handleRun/handleConfirmRun 仅 toast.error 后 return，无 force-run 入口。编辑器已有 AlertDialog 冲突解决流程（editor-app.tsx:235-247），列表页缺失同等功能（workflow-list.tsx:38-40, 73-75 → ipc.ts:250 已支持 force 参数）

### 修复内容
- [desktop/electron/services/workflow/workflow-engine.ts:142-156] 正常 abort 检测路径：return cancelled 前将 `nodeResults[nodeId]` 更新为 `status: "failed", error: "运行被取消"`，设 endedAt/durationMs
- [desktop/electron/services/workflow/workflow-engine.ts:186-199] 异常 catch 路径：同上逻辑
- [desktop/src/modules/workflow/components/workflow-list.tsx:10] 新增 AlertDialog 组件导入
- [desktop/src/modules/workflow/components/workflow-list.tsx:19] 新增 conflictState 状态
- [desktop/src/modules/workflow/components/workflow-list.tsx:41-43,76-78] handleRun/handleConfirmRun 冲突分支改为 setConflictState
- [desktop/src/modules/workflow/components/workflow-list.tsx:87-99] 新增 handleForceRun 函数
- [desktop/src/modules/workflow/components/workflow-list.tsx:129-140] 新增 AlertDialog 冲突对话框

### 与历史的关系
- 缺陷 1：独立（引擎 cancel 路径此前未被任何轮次覆盖）
- 缺陷 2：独立（列表页冲突路径此前未被覆盖）

### 日志补充
- 无（缺陷 1 仅修改数据状态赋值逻辑，不新增执行路径；缺陷 2 为纯 UI 交互优化）

### 本次进展
工作流"运行→取消→观测"闭环的数据完整性从"被中断节点永久标记 running"变为"全链路一致（标记 failed + 取消原因）"；列表页"运行→冲突"路径从"死胡同（仅错误 toast）"变为"可恢复（对话框 → 取消旧运行并启动新运行）"，与编辑器入口行为对齐。

---

## [2026-05-13 16:00] 第 25 次迭代

### 发现的问题
- IPC delete handler 不中止正在运行的 workflow：delete 仅删文件+关窗，running 的 engine 继续执行并在完成时写入幽灵快照到已删除目录，abortMap/runStatuses 内存泄漏（ipc.ts:115-119 → workflow-service.ts delete + window-manager forceCloseAll 均不访问 abortMap）
- workflow-service.ts save() 的 writeFile 无 try/catch：磁盘满/权限异常时异常传播至渲染侧，被 catch 块固定显示误导性"无法连接到主进程"，用户无法对症处理（workflow-service.ts:67 → editor-app.tsx:174）
- workflow-validator 仅检查 Switch 分支出边存在性，不检查每条分支路径是否可达 End 节点：Switch→分支B→Prompt（无出边到End）保存通过但运行时才报"结束节点未被执行"，浪费 LLM 调用（workflow-validator.ts:117-137 仅检查 outgoingBranches.has → workflow-engine.ts:219-223 运行时捕获）

### 修复内容
- [desktop/electron/modules/workflow/ipc.ts:113-138] IPC delete handler 在删除文件前遍历 runStatuses 中止该 workflowId 的所有 running 运行，从 abortMap + runStatuses 中移除，新增 abortedCount 日志
- [desktop/electron/services/workflow/workflow-service.ts:66-72] save() 的 mkdir + writeFile 包裹 try/catch，catch 中 logger.error 记录错误详情（含 stack），返回结构化 { errors: [{ message: "保存失败：磁盘空间不足或权限不足，请检查后重试" }] }
- [desktop/electron/services/workflow/workflow-validator.ts:33-52] 新增 computeEndReachable() 函数（反向 BFS from End 节点），与引擎中 canReachEnd 逻辑等价
- [desktop/electron/services/workflow/workflow-validator.ts:142,161-177] Switch 分支出边检查后新增 End 可达性检查：对每条已连接分支，沿边找到目标节点并检查 endReachable.has(e.to)，不可达时报 invalid_switch_edge 错误并打 warn 日志

### 与历史的关系
- 缺陷 1：独立（delete 路径从未被任何轮次覆盖）
- 缺陷 2：独立（与第 20 轮 RunSnapshotService.save() 同模式但不同服务）
- 缺陷 3：延续第 6 轮（同主题 Switch 分支校验深化——从"有没有边"到"边走不走得到 End"）

### 日志补充
- ipc.ts delete handler: 中止运行中的 run 时 info 日志（含 workflowId/abortedCount）
- workflow-service save: 磁盘写入异常时 error 日志（含 id/name/error/stack），完全覆盖此前缺失的错误可观测性
- workflow-validator: Switch 分支 End 不可达时 warn 日志（含 workflowId/nodeId/nodeName/branchId/branchLabel）

### 本次进展
工作流系统的"删除→清理"闭环从残缺变为完整，"保存→错误反馈"从误导变为准确，"编辑→校验"从浅层检查变为深度可达性验证——三个维度均向真正可用迈进。

---

## [2026-05-13 16:30] 第 26 次迭代

### 发现的问题
- Switch 节点 prompt 仅包含 raw branch IDs（如 `branch1`），不含用户配置的分支标签（如 `正面`），导致 LLM 在无语义上下文中猜测机器 ID，匹配成功率降低（switch/executor.main.ts:67 → LLM 看到 `- branch1` 而非 `- branch1（正面）`）
- Runner handleCancel 缺少错误处理：cancel IPC 异常时无 catch 块，取消失败静默无反馈，用户看到 spinner 消失但运行仍在继续（runner-app.tsx:149-157 try/finally 无 catch）

### 修复内容
- [desktop/workflow-nodes/switch/executor.main.ts:67-72] LLM prompt 构造改为 `${config.branches.map((b) => `- ${b.id}（${b.label}）`).join("\n")}`，将分支标签附加到选项列表中
- [desktop/workflow-nodes/switch/executor.main.ts:75-79] logger.info 新增 branchLabels 字段，便于从日志确认 LLM 收到的标签上下文
- [desktop/src/modules/workflow/runner/runner-app.tsx:149-163] handleCancel 新增 catch 块：logger.warn 记录错误详情 + setRunError 设置用户可见错误信息
- [desktop/src/modules/workflow/runner/runner-toolbar.tsx:37] runError 展示条件从 `isTerminal && runError` 改为 `runError`，确保取消操作在 running 态失败时错误也可见

### 与历史的关系
- 缺陷 1：独立（历史上第 1/2 轮涉及 Switch 匹配策略、第 7 轮涉及画布边标签同步、第 15/21 轮涉及结果面板/ExecutionOverlay 标签解析，但均未触及 LLM prompt 层面的标签传递）
- 缺陷 2：独立（历史上第 10 轮添加了 Runner toolbar 的 loading 状态、第 16 轮为 rerun 添加了错误反馈，但 cancel 错误路径未被覆盖）

### 日志补充
- switch executor: 执行开始日志新增 branchLabels 字段（含 config.branches.map label），补齐此前缺失的 LLM 接收标签的可观测性
- runner-app handleCancel: catch 分支新增 warn 日志（含 runId/error）

### 本次进展
工作流系统的 LLM 交互准确性（Switch 节点条件路由）和运行控制可靠性（Cancel 错误反馈）两个维度各向真正可用迈进一步。

---

## [2026-05-13 17:10] 第 27 次迭代

### 发现的问题
- Runner 的 loadError 警告条在 fallback 成功或 rerun 成功后永不消除：fallback 成功加载定义后用户看到 DAG 正常却同时显示"无法加载运行记录"横幅，rerun 后新运行正常但旧警告依然存在（runner-app.tsx:48 → :75 未清 loadError；:183-191 未清 loadError）
- 编辑器和列表页 handleForceRun 三个失败路径（IPC 不可用/校验失败/仍有冲突）均静默 return 无 toast 反馈，用户点击"取消旧运行并启动"后对话框关闭但无任何结果（editor-app.tsx:242 → workflow-list.tsx:93 注释 "handled silently"）

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:75-80] fallback 成功获取定义时新增 `setLoadError(null)`
- [desktop/src/modules/workflow/runner/runner-app.tsx:196] handleRerun 成功路径新增 `setLoadError(null)`
- [desktop/src/modules/workflow/editor/editor-app.tsx:1,242-255] 新增 toast import；handleForceRun 的三个失败分支分别 toast.error（IPC 不可用/校验失败/仍有冲突）
- [desktop/src/modules/workflow/components/workflow-list.tsx:92-109] handleForceRun 三个失败分支分别 toast.error + catch 块 toast.error("操作异常")，替换原有静默处理

### 与历史的关系
- 缺陷 1：独立（loadError 在第 23 轮引入但未覆盖清除逻辑）
- 缺陷 2：独立（handleForceRun 错误处理从未被任何轮次覆盖）

### 日志补充
- 无（纯 UI 交互优化：所有修改均为渲染侧状态清除和 toast 反馈，不涉及数据流、执行路径或 IPC 契约变更）

### 本次进展
Runner 的错误恢复体验从"误导性警告永不消失"变为"情况改善即清除"；编辑器和列表页的冲突解决路径从"确认后无反馈"变为"失败有明确 toast 提示"——错误信息可消失性和操作反馈完整性两个维度向真正可用迈进。

---

## [2026-05-13 17:45] 第 28 次迭代

### 发现的问题
- RunSnapshotService 读取路径四个 catch 块（readdir / 单文件解析 / list / get）静默返回空结果，磁盘错误或文件损坏时运行历史静默消失，无任何日志可追踪。同服务的 save() 已在第 20 轮补齐日志，但读取侧完全空白（run-snapshot-service.ts:17-18,29-32,63-70,78-87）
- Prompt executor 和 Switch executor 各自维护本地 `interpolate()` 函数（分别 7 行和 4 行），使用与共享 `interpolatePrompt` 等价但独立维护的正则表达式。Engine 日志用 `interpolatePrompt` 记录 prompt preview，而 executor 用本地函数发送实际 prompt，两端不一致。End executor 已使用共享函数，Prompt/Switch 未统一（prompt/executor.main.ts:9-13, switch/executor.main.ts:62 → variable-resolver.ts:37 → workflow-engine.ts:125）

### 修复内容
- [desktop/electron/services/workflow/run-snapshot-service.ts:21-26] `readdir` catch 块新增 `logger.warn("run snapshot readdir failed", { workflowId, error, stack })`
- [desktop/electron/services/workflow/run-snapshot-service.ts:33-37] 单文件读取/解析 catch 块新增 `logger.warn("run snapshot file corrupted or unreadable, skipping", { workflowId, file, error })`
- [desktop/electron/services/workflow/run-snapshot-service.ts:69-74] `list()` catch 块新增 `logger.warn("run snapshot list failed", { workflowId, error, stack })`
- [desktop/electron/services/workflow/run-snapshot-service.ts:85-89] `get()` catch 块新增非 ENOENT 异常的 warn 日志（含 runId/workflowId/error/code）
- [desktop/workflow-nodes/prompt/executor.main.ts:1-7,12] 删除本地 `interpolate()` 函数（7 行），改为 `import { interpolatePrompt }`，executor 调用共享函数
- [desktop/workflow-nodes/switch/executor.main.ts:1-4,62] 删除本地 `interpolate()` 函数（4 行），改为 `import { interpolatePrompt }`，executor 调用共享函数

### 日志补充
- run-snapshot-service: readdir 失败时 warn（含 workflowId/error/stack）；单文件损坏时 warn（含 workflowId/file/error）；list 失败时 warn（含 workflowId/error/stack）；get 失败（非 ENOENT）时 warn（含 runId/workflowId/error/code）
- prompt/switch executor: 无新增（已移除本地函数，日志沿用第 2 轮已添加的 executor 日志，prompt preview 日志现在与 engine 日志使用同一插值函数保证一致）

### 本次进展
工作流系统的数据可观测性（快照读取异常从完全不可追踪变为四个路径均有日志）和代码健壮性（变量插值从 Prompt/Switch/End/Engine 四处维护变为单一来源）两个维度向真正可用迈进。

---

## [2026-05-13 04:48] 第 29 次迭代

### 发现的问题
- 工作流模块"新建"按钮无防重复点击保护：`handleCreate` 为 async 函数，快速双击可并发触发两次 `workflow.create()` IPC 调用，两次均可能成功创建两份工作流（index.tsx:14-29）。`openEditor` + `setListKey` 异步执行期间第二次点击的 create 已发出，无法被拦截。
- 工作流列表页参数化工作流运行时 WorkflowCard 不展示 running 状态：`handleConfirmRun` 在 RunParamsDialog 确认后调用 `runDefinition`，但未设置 `runningId`，导致 WorkflowCard 的 `running={runningId === meta.id}` 始终为 false。只有 `handleRun`（无参数直跑路径）正确设置了 runningId（workflow-list.tsx:61-85）。有参数的工作流运行时 card 无任何 loading 反馈，用户可重复点击 Play 触发多个 RunParamsDialog。

### 修复内容
- [desktop/src/modules/workflow/index.tsx:5,13,16-17,32-34,40-41] 新增 Loader2 导入 + creating state；handleCreate 新增 `if (creating) return` 守卫 + `setCreating(true)` / `finally setCreating(false)` 包裹；Button 新增 `disabled={creating}` + 创建中显示 Loader2 spinner 替代 Plus 图标
- [desktop/src/modules/workflow/components/workflow-list.tsx:65,85-87] handleConfirmRun 在提取 def 后新增 `setRunningId(def.id)`，原无 finally 块补充 `finally { setRunningId(null) }` 确保清理

### 与历史的关系
- 缺陷 1：独立（"新建"按钮的防重复保护此前从未被任何轮次覆盖）
- 缺陷 2：延续第 16 轮（同文件同主题——列表页 runningId 保护，补齐参数化运行路径的遗漏）

### 日志补充
- 无（纯 UI 交互优化：所有修改均为渲染侧状态管理，不涉及 IPC 契约或数据流变更）

### 本次进展
工作流列表页的创建入口从"可双击创建重复工作流"变为"有防重复保护 + loading 反馈"；列表页的参数化运行路径从"无 running 状态反馈"变为"与无参数路径一致的 loading 保护"——列表层两个操作的交互完整度补齐。

---

## [2026-05-13 18:20] 第 30 次迭代

### 发现的问题
- snapshot hydration 路径丢失工作流级别错误信息：`runStatus` IPC handler 从 `WorkflowRunSnapshot` 恢复状态时，该类型无 `error` 字段（保存侧也未写入），导致历史失败运行的 `hydrated.error` 始终为 undefined。Runner UI 的 `error` 属性始终为空，用户看到 failed 但不知原因（ipc.ts:508-535）。
- End 节点 executor 的 `durationMs` 硬编码为 0：`endNodeExecutor.execute()` 返回 `{ status: "success", output, durationMs: 0 }`，而 Prompt 和 Switch executor 均正确计时。Runner 的 Timeline 视图中 End 节点始终显示 "0ms"，与其他节点的时间呈现不一致（end/executor.main.ts:24）。

### 修复内容
- [desktop/electron/modules/workflow/ipc.ts:508-535] snapshot hydration 路径新增错误恢复逻辑：当 `snap.status === "failed"` 时从 `snap.nodeResults` 中查找第一个 `status === "failed" && error` 的节点，提取其 error 作为 workflow-level error；通过条件展开 `...(error ? { error } : {})` 注回 hydrated 对象；日志新增 `recoveredErrorFromNodeResults: true` 字段
- [desktop/workflow-nodes/end/executor.main.ts:10-24] 函数入口新增 `const start = Date.now()`，插值后计算 `const durationMs = Date.now() - start`，return 使用计算值替换硬编码 0，成功日志新增 `durationMs` 字段

### 与历史的关系
- 缺陷 1：延续第 20 轮（snapshot save 侧已补齐错误字段写入但 hydration 侧未读取，属于读写不对称的残留问题）
- 缺陷 2：延续第 28 轮（End executor 使用共享 `interpolatePrompt` 但计时未统一，属于 executor 三兄弟一致性的遗漏）

### 日志补充
- ipc.ts: snapshot hydration 恢复错误时 info 日志新增 `recoveredErrorFromNodeResults: true`，声明错误来源为 nodeResults 重建而非原始字段
- end executor: 成功日志新增 `durationMs` 字段，与其他 executor 的 log shape 对齐

### 本次进展
工作流系统的错误可追溯性（失败运行恢复后可知原因而非"Unknown error"）和显示一致性（End 节点 Timeline 时间不再硬编码为 0ms）两个维度的补齐。

---

## [2026-05-13 19:00] 第 31 次迭代

### 发现的问题
- 画布键盘事件处理器未排除 SELECT 元素：`handleKeyDown` 的 tagName 白名单检查仅排除 INPUT / TEXTAREA / contentEditable，遗漏 SELECT。用户在节点配置面板的 `<select>` 下拉框中按 Backspace/Delete 时，画布上的选中节点被意外删除且无撤销（canvas.tsx:389）。
- WorkflowWindowManager 完全缺少日志：6 个公开方法（open / openRunner / focusEditor / forceClose / forceCloseAll / hasActiveRun）无一有 log 调用，窗口生命周期事件（创建、复用、关闭、销毁）均无诊断轨迹。同模块其他 5 个 service 均使用 createMainLogger（window-manager.ts:全文）。

### 修复内容
- [desktop/src/modules/workflow/editor/canvas.tsx:389] 键盘事件 guard 条件新增 `tag === "SELECT"`，SELECT 元素获得焦点时不再误触发 Delete/Backspace 节点删除
- [desktop/electron/services/workflow/window-manager.ts:4-6,13,16,25,32,36,40,42,47,50,52-53,58,60-62,67,70-71] 新增 `createMainLogger("service.workflow.window-manager")` 导入与实例化；open / openRunner 的复用路径和新建路径分别记录 info 日志（含 workflowId / runId / newRunId）；closed 事件监听器新增 info 日志；focusEditor 未找到窗口时记录 info 日志；forceClose 和 forceCloseAll 在销毁窗口前记录 info 日志

### 与历史的关系
- 缺陷 1：独立（canvas 键盘处理此前未被任何轮次审计，属于 UI 交互保护缺口）
- 缺陷 2：延续第 28 轮（logging-coverage area，补齐 workflow 模块最后一个无日志 service）

### 日志补充
- 新增：window-manager.ts 全程日志覆盖（6 类生命周期事件），命名空间 `service.workflow.window-manager`

### 本次进展
画布键盘交互从"SELECT 聚焦时误删节点"变为完整交互隔离；窗口管理器从系统唯一无日志 service 变为与其他 5 个 workflow service 一致的日志覆盖。两个修复均为防御性补齐——无功能变更，消除静默风险。

---

## [2026-05-13 19:45] 第 32 次迭代

### 发现的问题
- 画布键盘处理器未排除 BUTTON 元素，工具栏按钮聚焦时按 Delete/Backspace 误删除画布节点（canvas.tsx:389 排除列表遗漏 BUTTON）
- 工作流列表页删除操作无错误处理，IPC 不可用时静默失败无反馈（workflow-list.tsx:56-59 handleDelete 无 try/catch）

### 修复内容
- [desktop/src/modules/workflow/editor/canvas.tsx:389] 键盘事件 guard 条件新增 `tag === "BUTTON"`，工具栏按钮获得焦点时不再误触发 Delete/Backspace 节点删除
- [desktop/src/modules/workflow/components/workflow-list.tsx:56-65] handleDelete 包裹 try/catch，失败时 toast.error + 不刷新列表，成功时 toast.success + refresh

### 与历史的关系
- 缺陷 1：延续第 31 轮（同文件同位置 canvas.tsx:389 guard 条件，第 31 轮添加 SELECT，本轮补充 BUTTON）
- 缺陷 2：独立（handleDelete 的错误处理从未被任何轮次覆盖，虽然同文件 handleRun/handleConfirmRun 已在 iter 21/29 补齐）

### 日志补充
- 无（纯 UI 交互优化：键盘事件 guard 为已有排除逻辑的扩展，delete handler 补充的是渲染侧 toast 反馈，均不涉及数据流、执行路径或 IPC 契约变更）

### 本次进展
画布交互安全从"BUTTON 聚焦时 Delete 可误删节点"补齐了最后一种常见可聚焦元素的保护；列表页删除操作从"静默失败无反馈"变为"失败有明确提示+成功有确认"——交互安全性（防误操作）和操作完整度（有始有终反馈）两个维度向真正可用迈进。

---

## [2026-05-13 21:00] 第 33 次迭代

### 发现的问题
- Runner 错误页（runStatus 返回 null 时）无重试按钮，用户只能关闭窗口重新打开（runner-app.tsx:221-237 仅展示错误信息卡片，无可操作入口）
- 变量绑定编辑器中 node_output 类型的 Select 在上游节点列表为空时，下拉内容为空且无解释文案，用户不知道为何没有可选项（variable-binding-editor.tsx:76-91 空数组直接 map 产生空 SelectContent）
- Runner 的 NodeResultPanel 对 skipped（跳过）状态节点显示"（无可展示的输出）"，与真正无输出的节点无法区分；Editor 的 ExecutionOverlay 中 skipped 节点不可点击查看详情（node-result-panel.tsx:78 仅区分 pending / 其他；execution-overlay.tsx:64-65 仅允许 success/failed 状态点击）

### 修复内容
- [desktop/src/modules/workflow/runner/runner-app.tsx:12,34,60,86,210-232] 新增 retrySignal 状态、handleRetry 回调（清空 loadError + definition 后递增 retrySignal 重新触发 hydration 和 fallback 两个 effect），错误页 UI 新增"重试"按钮（Button + RefreshCw 图标），hydration effect 和 fallback effect 的依赖数组均加入 retrySignal
- [desktop/workflow-nodes/variable-binding-editor.tsx:85-92] node_output Select 的 SelectContent 内增加空数组守卫：upstreamNodes.length === 0 时渲染"暂无可选的上游节点"说明文字，替代原先隐式的空下拉列表
- [desktop/src/modules/workflow/runner/node-result-panel.tsx:78] 空状态文案从二态（pending / 其他）改为三态：skipped → "节点因工作流分支逻辑被跳过，未执行"；pending → "节点等待执行"；其他 → "（无可展示的输出）"
- [desktop/src/modules/workflow/editor/execution-overlay.tsx:64-65,105] 列表项点击条件从 success/failed 扩展为 success/failed/skipped（className 和 onClick 均覆盖）；Dialog 空状态文案同步区分 skipped（与 NodeResultPanel 一致）

### 与历史的关系
- 缺陷 1：延续第 14 轮（同文件 runner-app.tsx hydration 健壮性，第 14 轮新增 loadError 状态和 fallback 回退逻辑，本轮补齐错误态的可操作入口）
- 缺陷 2：独立（variable-binding-editor.tsx 空列表状态从未被覆盖，虽然 use-upstream-nodes hook 在 iter 20 评估为 stable）
- 缺陷 3：与 iter 17 的 timeline-view 跳过状态 badge 互补（iter 17 确保列表页 badge 正确显示"跳过"，本轮确保 Runner 面板和 Editor 浮层对跳过节点提供差异化信息）

### 日志补充
- 无（纯 UI 交互优化：重试按钮为已有 IPC 调用的重新触发，上游节点空状态为 Select 下拉内容的渲染守卫，跳过状态为已有 status 字段的显示分支扩展）

### 本次进展
Runner 错误页从"死胡同"变为"可重试的等待室"——用户无需关闭窗口即可重新请求加载；变量绑定编辑器在无上游节点时不再是迷惑的空下拉框；跳过节点在 Runner 面板和 Editor 浮层中获得了与 pending/success/failed 对等的语义化状态说明和交互支持。

---

## [2026-05-13 21:40] 第 34 次迭代

### 发现的问题
- 变量绑定编辑器中 param 类型的 Select 在工作流参数列表为空时，下拉内容为空且无解释文案，用户不知道为何没有可选项（variable-binding-editor.tsx:69-73 空数组直接 map 产生空 SelectContent）。此问题与第 33 轮修复的 node_output 空列表问题完全同构，但第 33 轮仅补了 node_output 分支。
- Runner 的 handleRerun 只有 try/finally 没有 catch 块，当 IPC bridge 抛出异常（而非返回 null 或 { errors }）时，异常穿透到 React event boundary，用户看到的是 unhandled promise rejection 而不是友好的错误提示（runner-app.tsx:177-203 try 块直接到 finally，中间无 catch）。对比同文件的 handleCancel（157-171 行）有完整的 try/catch/finally 模式。

### 修复内容
- [desktop/workflow-nodes/variable-binding-editor.tsx:69-76] param Select 的 SelectContent 内增加空数组守卫：workflowParams.length === 0 时渲染"暂无可选的工作流参数，请先在工具栏 → 参数中定义"说明文字，替代原先隐式的空下拉列表。文案比 node_output 的提示更长，因为告诉用户如何解决问题（去工具栏→参数定义）。
- [desktop/src/modules/workflow/runner/runner-app.tsx:201-206] handleRerun 的 try/finally 之间新增 catch 块：捕获 IPC 调用异常，记录 warn 日志（含 runId 和错误信息），设置 setRunError("重新运行失败：无法连接到主进程，请重试")。与 handleCancel（157-171 行）的 catch 模式完全一致。

### 与历史的关系
- 缺陷 1：延续第 33 轮（同文件同组件 VariableSourceControl，第 33 轮为 node_output Select 补了空数组守卫但遗漏了同结构的 param Select，本轮补齐最后一处）
- 缺陷 2：独立（handleRerun 的 catch 块从未被任何轮次覆盖，虽然 handleCancel 已在第 26 轮补了完整的 try/catch/finally 模式，handleRerun 仅在同轮次补了 finally 中的 setRerunning(false)）

### 日志补充
- 缺陷 2 的 catch 块内使用 logger.warn 记录 rerun IPC call failed（含 runId 和 error message），与 handleCancel 的 catch 日志对称

### 本次进展
变量绑定编辑器三种 source 类型（static / param / node_output）的空列表状态现已全部覆盖，不再有任何隐式的空下拉框。Runner 重跑操作从 try/finally（异常穿透无反馈）变为 try/catch/finally（异常有日志+用户可读错误提示），与取消操作的错误处理达到一致。

---

## [2026-05-13 22:10] 第 35 次迭代

### 发现的问题
- 编辑器无 Ctrl+S / Cmd+S 键盘快捷键：用户只能通过工具栏按钮保存，无法使用通用快捷键。画布 keydown handler 仅处理 Delete/Backspace/Ctrl+C/Ctrl+V，保存操作完全依赖鼠标点击（editor-app.tsx 全文无 Ctrl+S 监听；canvas.tsx:386-407 仅处理 4 种快捷键）。
- 保存成功无 toast 反馈：handleSave 成功路径仅清除 runErrors + 更新 definition，用户点击保存后无任何视觉确认。对比 handleForceRun 的三个失败路径均有 toast.error，成功路径的反馈缺失导致用户不确定保存是否完成（editor-app.tsx:188-196 成功分支无 toast）。
- 编辑器无"未保存"状态指示：isDirtyRef 仅用于 beforeunload 拦截，工具栏无任何视觉标记告知用户当前有未保存更改。用户修改节点配置后，保存按钮外观与未修改时完全一致，无法区分是否需要保存（toolbar.tsx 全文无 dirty 相关 prop 或 UI）。

### 修复内容
- [desktop/src/modules/workflow/editor/editor-app.tsx:88-98] 新增 useEffect 注册 window-level keydown 监听器，捕获 Ctrl+S / Cmd+S 并调用 handleSave(definitionRef.current)，e.preventDefault() 阻止浏览器默认保存行为
- [desktop/src/modules/workflow/editor/editor-app.tsx:30,101-103,107,126,137,190-191,209] 新增 `dirty` state（与 isDirtyRef 并行，isDirtyRef 保留用于 beforeunload 同步访问）；handleDefinitionChange / handleConfigChange / handleNameChange 中 setDirty(true)；handleSave 成功路径 setDirty(false) + `if (!silent) toast.success("已保存")`
- [desktop/src/modules/workflow/editor/editor-app.tsx:167,209,296] handleSave 签名新增 `silent?: boolean` 参数；handleRun 调用 handleSave 时传入 `silent: true` 避免"保存→运行"连续操作产生多余 toast；toolbar 传入 dirty prop
- [desktop/src/modules/workflow/editor/toolbar.tsx:12,14,19,43-47] WorkflowToolbarProps 新增 `dirty?: boolean`；onSave 签名更新为 `(def, silent?) => Promise<unknown>`；保存按钮新增 `className="relative"` + 条件渲染 `<span>` 圆点指示器（bg-primary, 1.5x1.5, absolute top-1 right-1），dirty && !saving 时显示

### 与历史的关系
- 缺陷 1：独立（编辑器键盘快捷键从未被任何轮次覆盖，canvas.tsx 的 keydown 处理在 iter 31/32 补齐了 guard 条件但未涉及保存快捷键）
- 缺陷 2：独立（handleSave 成功反馈从未被覆盖，虽然 iter 27 为 handleForceRun 补了失败 toast）
- 缺陷 3：独立（dirty 状态可视化从未被覆盖，isDirtyRef 在 iter 20 评估为 stable 但仅用于 beforeunload）

### 日志补充
- 无（纯 UI 交互优化：键盘快捷键为已有 handleSave 的新入口，toast 为渲染侧反馈，dirty 指示器为已有状态的可视化——均不涉及数据流、执行路径或 IPC 契约变更）

### 本次进展
编辑器保存体验从"仅鼠标点击+无反馈+无状态指示"变为"快捷键+成功 toast+未保存圆点指示器"的完整闭环——三个缺陷共同构成"保存工作流"这一高频操作的体验补齐。

---

## [2026-05-13 23:00] 第 36 次迭代

### 发现的问题
- Runner 的 NodeResultPanel 不显示 progressLabel：节点执行中时 DAG 卡片上显示进度文字（如"调用模型中…"），但用户点击节点打开详情面板后，面板仅显示"执行中" Badge 和空内容区域"（无可展示的输出）"，丢失了 progressLabel 信息。数据已通过 onNodeProgress 写入 nodeResults 并传递到面板，但面板未渲染该字段（node-result-panel.tsx:28-83 全文无 progressLabel 引用）。
- 画布无 Escape 键取消选中：用户选中节点后，无法通过 Escape 键取消选中（只能点击空白区域）。keydown handler 仅处理 Delete/Backspace/Ctrl+C/Ctrl+V，缺少 Escape → deselect 逻辑。这是画布编辑器的标准交互模式缺失（canvas.tsx:386-407 无 Escape 分支）。
- 工作流列表页 RunParamsDialog 不记忆上次参数值：toolbar.tsx 正确维护 lastRunValues 状态并传递给 RunParamsDialog，但 workflow-list.tsx 的同一对话框未传递 lastValues prop，导致用户从列表页重复运行同一工作流时每次都要重新填写参数（workflow-list.tsx:148 缺少 lastValues prop）。

### 修复内容
- [desktop/src/modules/workflow/runner/node-result-panel.tsx:31-35,79] Badge 后新增条件渲染：status === "running" && progressLabel 时显示 animate-pulse 的进度文字；空状态文案从二态扩展为三态，running 状态显示"节点正在执行…"
- [desktop/src/modules/workflow/editor/canvas.tsx:385,393-397] 新增 onNodeSelectRef 跟踪 onNodeSelect prop；keydown handler 在 Delete/Backspace 之后、mod 检查之前新增 Escape 分支：setNodes 清除所有 selected + onNodeSelectRef.current(null)
- [desktop/src/modules/workflow/components/workflow-list.tsx:20,69,149] 新增 lastRunValues 状态；RunParamsDialog onConfirm 回调中通过 rawValues 记录上次参数值并传递 lastValues prop

### 与历史的关系
- 缺陷 1：独立（NodeResultPanel 的 progressLabel 渲染从未被覆盖，虽然 iter 33 为同文件补了 skipped 状态文案）
- 缺陷 2：独立（Escape 键取消选中从未被覆盖，iter 31/32 补的是 guard 条件排除可聚焦元素，iter 35 补的是 Ctrl+S）
- 缺陷 3：独立（toolbar.tsx 的 lastRunValues 在 iter 21 引入，但 workflow-list.tsx 的同一对话框从未获得该功能）

### 日志补充
- 无（纯 UI 交互优化：progressLabel 为已有数据的渲染补齐，Escape 为已有 setNodes 的新触发入口，lastRunValues 为渲染侧状态记忆——均不涉及数据流、执行路径或 IPC 契约变更）

### 本次进展
Runner 详情面板从"执行中无进度信息"变为"实时显示当前执行阶段"；画布交互从"只能鼠标点空白取消选中"变为"Escape 一键取消"；列表页参数化运行从"每次重填"变为"记忆上次值"——三个修复分别补齐了执行反馈、编辑效率、重复操作便利性三个维度的体验缺口。
