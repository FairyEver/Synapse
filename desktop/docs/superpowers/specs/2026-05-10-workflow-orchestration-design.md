# Workflow Orchestration — Design Spec

## 概述

为 Synapse 桌面应用新增工作流编排功能，让用户在可视化画布上编排多步 Prompt Chain，一键串联执行，支持条件分支（Switch）。MVP 默认串行执行，架构预留并行执行能力。

## 目标用户

开发者/技术用户，熟悉 prompt engineering，能理解 DAG、变量传递、条件分支等概念。

## 核心使用场景

1. **Prompt Chain 自动化** — 多步提示词流程一键执行（分析需求 → 生成代码 → 写测试）
2. **多 Agent 协作** — 不同节点选不同 Agent（Claude Code 写代码、Codex 审查）
3. **内容生产流水线** — 定义一次、反复执行的内容生成流程
4. **可视化调试/实验** — 画布上查看每个节点的输入输出，快速迭代 prompt 策略

## MVP 范围

| 维度 | 包含 |
|---|---|
| 节点类型 | Prompt 节点 + Switch 节点（AI 判断分支） |
| 连线语义 | 执行顺序 + 变量可用性约束（只能引用有路径可达的上游节点） |
| 数据传递 | 通过变量绑定 UI 引用上游节点输出，Prompt 中使用 `{{$变量名}}` |
| 工作流参数 | 带类型的只读常量（text / number），运行前弹表单填值 |
| 流程结构 | DAG（无循环） |
| 执行 | 纯本地（Electron 主进程），手动触发 |
| 画布 | @xyflow/react，拖拽连线 |
| 存储 | 新内容类型，Git full-snapshot 版本模型 |
| 窗口 | 主窗口列表 + 独立编辑窗口 |

### MVP 不做

- HTTP / Script 节点（架构预留）
- 循环 / 迭代节点（架构预留）
- 服务端执行
- 定时触发
- 子工作流嵌套
- file 参数类型

---

## 1. 数据模型

### 1.1 工作流定义 (WorkflowDefinition)

```typescript
interface WorkflowDefinition {
  id: string
  name: string
  description?: string
  version: string // "v_<timestamp>_<short-hash>"
  createdAt: number // Unix ms
  updatedAt: number // Unix ms

  // 工作流级参数（运行前用户填值，节点内只读）
  params: WorkflowParam[]

  // 节点
  nodes: WorkflowNode[]

  // 连线（执行顺序 + 变量可用性约束）
  edges: WorkflowEdge[]
}

interface WorkflowParam {
  name: string
  type: "text" | "number" // 未来扩展 "file" 等
  default: string | number | null
  description?: string
}

// 列表页使用的轻量元信息（避免加载完整 definition）
interface WorkflowMeta {
  id: string
  name: string
  description?: string
  version: string
  nodeCount: number
  createdAt: number
  updatedAt: number
}
```

### 1.2 节点 (WorkflowNode)

```typescript
interface WorkflowNode {
  id: string
  name: string // 用户可编辑的显示名称（变量绑定 UI 按此展示）
  type: string // "prompt" | "switch" | 未来更多
  position: { x: number; y: number }
  config: Record<string, unknown> // 由节点类型的 schema 验证
}

// Prompt 节点 config
interface PromptNodeConfig {
  agent: string // "claude-code" | "codex" | ...
  variables: VariableBinding[]
  prompt: string // 模板，使用 {{$变量名}}
}

// Switch 节点 config
interface SwitchNodeConfig {
  agent: string
  variables: VariableBinding[]
  prompt: string // 让 Agent 判断走哪个分支
  branches: SwitchBranch[] // 分支定义
  defaultBranch?: string // 可选兜底分支 id，必须是 branches[].id 之一；匹配失败时走此分支；未配置则节点失败
}

interface SwitchBranch {
  id: string    // 小写英文，用于匹配 Agent 输出和 edge.branch
  label: string // 展示名（可中文）
}
```

### 1.3 变量绑定 (VariableBinding)

```typescript
interface VariableBinding {
  name: string // 节点内使用的变量名
  source: VariableSource
}

type VariableSource =
  | { type: "param"; param: string }        // 引用工作流参数
  | { type: "node_output"; node: string }   // 引用其他节点输出
  | { type: "static"; value: string }       // 固定字符串
```

### 1.4 连线 (WorkflowEdge)

```typescript
interface WorkflowEdge {
  id: string   // 稳定 ID，React Flow 需要 + 边状态/动画定位
  from: string // 源节点 id
  to: string   // 目标节点 id
  branch?: string // Switch 节点专用：仅当输出匹配此分支 id 时激活
}
```

**连线语义：执行顺序 + 变量可用性约束**

- 连线表示执行顺序：A→B 意味着 A 先执行，B 后执行
- 连线同时约束变量引用范围：节点 B 只能引用与它有**有向路径可达**的上游节点的输出
  - A→C→B 时，B 可以引用 A 和 C 的输出
  - 如果 A 和 B 之间没有任何路径，B 不能引用 A 的输出
- 断开连线时：如果下游节点已引用被断开节点的输出，实时显示红色警告（边框 + tooltip），保存时拦截并报错

### 1.5 节点输出

**MVP 输出模型：**

- 每个节点固定一个输出，类型为纯文本（LLM 原始响应）
- 输出字段固定命名为 `output`

**用户操作方式（重要）：**

用户**不直接**在 prompt 中写 `{{node_name.output}}`。实际流程是：

1. 用户在节点编辑面板中通过变量绑定 UI 定义变量（两级选择器选择上游节点 + 输出字段）
2. 变量绑定内部使用节点 **ID**（非名称）作为引用，节点改名不影响绑定
3. 用户在 prompt 模板中使用 `{{$变量名}}` 引用已绑定的变量

示例：
```
// 变量绑定（UI 操作，内部存储）
{ name: "requirement", source: { type: "node_output", node: "node_abc123" } }

// 用户在 prompt 中写
请基于 {{$requirement}} 生成代码
```

**变量绑定 UI（两级选择）：**

- 第一级：选择上游节点（只显示有路径可达的上游节点，按名称展示）
- 第二级：选择输出字段（MVP 阶段只有"输出"一个选项）

**架构预留（未来扩展）：**

- `outputs?: Record<string, unknown>` 支持多输出端口
- JSON 输出类型：节点可配置输出为 JSON，此时第二级菜单展开为 JSON 各字段
- 引用语法扩展：第二级菜单显示 JSON 各字段名

### 1.6 节点运行结果 (NodeRunResult)

```typescript
interface NodeRunResult {
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "skipped"
  input: {
    variables: Record<string, string> // 实际解析后的变量值
    prompt?: string                   // 插值后的完整 prompt（便于调试回看）
  }
  output?: string
  outputs?: Record<string, unknown> // 未来多输出
  activeBranch?: string             // Switch 节点选中的分支 id
  error?: string
  startedAt?: number  // Unix ms
  endedAt?: number    // Unix ms
  durationMs?: number
}
```

此结构用于：
- 运行时画布展示每个节点的输入/输出
- 运行快照持久化（WorkflowRunSnapshot.nodeResults）
- 失败节点回看和调试
- 未来"从某个节点重跑"功能的基础

---

## 2. 节点类型插件架构

### 2.1 文件结构

每种节点类型 = 一个自包含文件夹：

```
desktop/workflow-nodes/
├── types.ts              ← 共享接口定义
├── registry.ts           ← 节点类型注册表
├── schemas/
│   └── variable-binding.ts ← 共享 VariableBinding Zod schema（避免重复定义）
├── prompt/
│   ├── manifest.ts       ← 元数据 + 端口定义 + 卡片摘要
│   ├── schema.ts         ← Zod config schema（引用共享 variable-binding）
│   ├── executor.main.ts  ← 主进程执行逻辑
│   ├── card.tsx          ← 画布卡片组件（由 React Flow wrapper 包装后使用）
│   ├── panel.tsx         ← 编辑面板组件
│   └── index.ts
└── switch/
    ├── manifest.ts
    ├── schema.ts
    ├── executor.main.ts
    ├── card.tsx
    ├── panel.tsx
    └── index.ts
```

### 2.2 Manifest 接口

```typescript
interface NodeManifest<TConfig = unknown> {
  type: string
  title: string
  icon: string // lucide icon name
  color: string // 主题色 token

  ports: {
    inputs: PortDefinition[]
    outputs: PortDefinition[] | "dynamic"
  }

  // 动态端口解析（Switch 等节点）
  resolveDynamicPorts?: (config: TConfig) => PortDefinition[]

  // 卡片摘要（从 config 提取显示内容）
  cardSummary: (config: TConfig) => { title: string; subtitle: string }

  configFields: readonly ConfigFieldDescriptor[]
  configSchema: ZodType<TConfig>
}

interface PortDefinition {
  id: string
  label: string
}
```

### 2.3 节点执行器接口

```typescript
interface NodeExecutor<TConfig = unknown> {
  execute(input: NodeExecutionInput<TConfig>): Promise<NodeExecutionResult>
}

interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string> // 已解析的变量值
  context: WorkflowRuntimeContext
}

interface NodeExecutionResult {
  status: "success" | "failed"
  output: string // MVP 单输出（纯文本）
  outputs?: Record<string, unknown> // 未来多输出
  activeBranch?: string // Switch 节点：选中的分支
  error?: string
  durationMs: number
}
```

### 2.4 Agent Runtime 集成

节点执行器通过依赖注入调用 `AgentRuntimeService.sendScheduled()`：

```typescript
interface AgentSendDeps {
  sendToAgent: (input: {
    agent: string       // agentType: "claude-code" | "codex" | ...
    prompt: string      // 已插值的完整 prompt
    abortSignal: AbortSignal
  }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
  }>
}
```

桥接实现（在引擎初始化时注入）：

```typescript
const sendToAgent: AgentSendDeps["sendToAgent"] = async ({ agent, prompt, abortSignal }) => {
  const result = await agentRuntimeService.sendScheduled({
    projectId: context.projectId,
    agentType: agent,
    mode: "default",
    prompt,
    sessionPolicy: "fresh",
    timeoutMs: 120_000,
    abortSignal,
  })
  return {
    status: result.status === "success" ? "success" : "failed",
    response: result.summary ?? "",
    error: result.error,
    durationMs: result.durationMs,
  }
}
```

> **注意：** MVP 节点输出使用 `AgentRuntimeService.sendScheduled()` 返回的 `summary` 字段。
> 如果 summary 是摘要而非完整 LLM 原文，下游节点拿到的是压缩后的结果。
> 实现时需确认 summary 的实际内容，必要时改用更完整的返回字段。

### 2.5 Switch 节点分支匹配策略

Switch 节点在发送给 Agent 的 prompt 末尾自动追加约束指令（使用分支 id）：

```
---
你必须只回复以下选项之一（不要包含任何其他文字）：
- fix
- skip
```

匹配逻辑：
1. 对 Agent 响应执行 `trim().toLowerCase()`
2. 精确匹配 `branches[].id` 列表（分支 id 限制为小写英文）
3. 匹配成功 → `activeBranch` 设为匹配到的分支 id
4. 匹配失败 → 检查是否配置了 `defaultBranch`：
   - 有 defaultBranch → 走默认分支，`activeBranch` 设为 defaultBranch
   - 无 defaultBranch → 返回 `status: "failed"`，错误信息包含 Agent 实际响应和期望的分支列表
5. 不重试（避免无限循环和 token 浪费）

**分支命名规则：**
- `id`：小写英文 + 数字 + 下划线，用于匹配和 edge.branch 关联
- `label`：用户可见的展示名，支持中文（如 "需要修复"、"跳过"）

### 2.6 跨进程约定

沿用现有 action-packages 模式：
- `.main.ts` — 主进程代码
- `.tsx` — 渲染进程组件
- `.ts`（无后缀标记）— 跨进程共享

---

## 3. 执行引擎

### 3.1 位置

`electron/services/workflow/workflow-engine.ts`，运行在主进程。

### 3.2 接口

```typescript
interface WorkflowEngine {
  run(input: WorkflowRunInput): Promise<WorkflowRunResult>
  cancel(runId: string): void
  on(event: WorkflowEvent, handler: Function): Disposable
}

interface WorkflowRunInput {
  definition: WorkflowDefinition
  params: Record<string, unknown> // 用户填入的参数值
  abortSignal: AbortSignal
}

interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  durationMs: number
}
```

### 3.3 执行流程

1. **准备**：拓扑排序 → DAG 校验（检测环路）→ 创建 RunContext
2. **调度循环**：
   - 找出所有前置节点已完成的就绪节点
   - 用 p-queue 并发执行（MVP 默认并发数 1，架构支持配置更高并发）
   - 每个节点执行前：变量解析器替换 `{{...}}` 为实际值
   - 调用节点 executor.execute()
   - 存储输出到 `nodeOutputs[nodeId]`
   - Switch 节点：根据 `activeBranch` 决定激活哪条出边
3. **终止条件**：
   - 所有可达节点完成 → `workflow:completed`
   - 任一节点失败 → 停止调度新节点 → `workflow:failed`
   - 用户取消 → abortSignal → `workflow:cancelled`

### 3.4 事件系统

```typescript
type WorkflowEvent =
  | { type: "workflow:started"; runId: string }
  | { type: "node:started"; nodeId: string }
  | { type: "node:completed"; nodeId: string; output: unknown }
  | { type: "node:failed"; nodeId: string; error: string }
  | { type: "edge:activated"; from: string; to: string }
  | { type: "workflow:completed"; result: WorkflowRunResult }
  | { type: "workflow:failed"; error: string }
  | { type: "workflow:cancelled" }
```

事件通过 IPC push 到渲染进程，驱动画布实时状态更新。

### 3.5 变量解析器

`electron/services/workflow/variable-resolver.ts`

- 输入：节点的 `variables[]` 定义 + 当前 `nodeOutputs` + 工作流 `params`
- 输出：`Record<string, string>`（变量名 → 解析后的值）
- 解析时机：节点执行前（lazy），确保引用上游最新输出
- prompt 模板中的 `{{$变量名}}` 由引擎替换后传给 executor

**Switch 分支汇合后的变量引用（重要）：**

当 Switch 分支汇合到同一个下游节点时，存在运行时可达性问题：

```
A → Switch
Switch --fix--> B
Switch --skip--> C
B → D
C → D
```

静态图上 D 的上游有 B 和 C，路径可达检查通过。但运行时 B 和 C 只会执行一个。

**MVP 规则：** 变量解析时，如果引用的上游节点在本次运行中被 skipped（输出不存在），则该节点执行失败，错误信息提示"变量 $xxx 引用的节点 [节点名] 在本次运行中未执行（被分支跳过）"。

**使用建议：** Switch 分支汇合后的节点不应引用分支内节点的输出。如需汇合分支结果，后续版本可引入可选变量（`optional: true`）或 Merge 节点。

### 3.6 工作流校验器

`electron/services/workflow/workflow-validator.ts`

```typescript
interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

interface ValidationError {
  type: "cycle" | "unreachable_reference" | "invalid_config" | "invalid_switch_edge" | "orphan_edge_branch"
  nodeId?: string
  edgeId?: string
  message: string
}

interface ValidationWarning {
  type: "disconnected_node" | "multiple_start_nodes"
  nodeId?: string
  message: string
}

function validateWorkflow(definition: WorkflowDefinition): ValidationResult
```

**校验规则：**

1. **DAG 无环检测** — 拓扑排序验证
2. **变量引用路径可达性** — 对每个 `source.type === "node_output"` 的变量绑定，检查从 source node 到当前节点是否存在有向路径
3. **Config schema 验证** — 每个节点的 config 通过对应节点类型的 Zod schema 验证
4. **Switch 出边校验** — 如果 edge.from 是 Switch 节点，则 `edge.branch` 必须存在且匹配 `branches[].id`；如果 edge.from 不是 Switch 节点，则 `edge.branch` 不应存在；`defaultBranch` 如配置则必须是 `branches[].id` 之一
5. **孤立节点检测**（warning）— 没有任何连线的节点（起始节点除外）发出警告
6. **多起始节点提示**（warning）— 存在多个起始节点时提示"将按依赖顺序依次执行"

**起始节点规则：**

- 入度为 0 的节点是起始节点
- 允许多个起始节点
- MVP 并发数为 1 时，多个起始节点按拓扑排序顺序依次执行

**校验时机：**

- 保存时：完整校验，有 error 则阻止保存并显示错误列表
- 运行前：复用保存校验（运行前会先自动保存）
- 编辑时：断线操作触发局部校验（只检查受影响的变量引用），实时红色警告

### 3.7 扩展性预留

- 并发数可在工作流级别配置
- Loop 节点未来通过 `loopBack: true` 标记让引擎重新调度子图
- 多输出端口通过 `outputs` 字段 + 引用语法 `{{node.output.field}}` 支持

---

## 4. 画布 UI

### 4.1 技术选型

- `@xyflow/react` — 画布核心
- 自定义节点组件：每种节点类型的 `card.tsx` 通过 React Flow wrapper 组件适配
- 自定义边组件（分支边带标签 + 颜色）

**React Flow 节点适配模式：**

```tsx
// 每种节点类型需要一个 wrapper，桥接 React Flow 的 NodeProps 到节点 card 的 props
function PromptNodeWrapper({ data }: NodeProps) {
  return <PromptNodeCard config={data.config} status={data.status} />
}

const nodeTypes = {
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
}
```

### 4.2 窗口模型

**主窗口 Workflow Tab**：列表视图，显示工作流名称、节点数、运行状态。类似现有定时任务页面。

**独立编辑窗口**：双击列表项打开 Electron BrowserWindow，包含完整画布编辑器。

**编辑器窗口创建机制：**

- 加载同一 Vite dev server 的 URL，通过 query param 区分：`http://localhost:5173/?window=workflow-editor&workflowId=xxx`
- 渲染进程入口根据 `window` 参数决定挂载 `WorkflowEditorApp` 还是主应用
- 复用主窗口的 preload script（共享 `window.synapse` bridge）
- 窗口尺寸：默认 1200x800，可调整

编辑器布局：
- 顶部工具栏：工作流名称 + 参数设置 + 运行 + 保存
- 左侧节点面板：拖拽添加节点
- 中央画布：React Flow
- 右侧/底部编辑面板：双击节点后显示配置（由节点类型的 `panel.tsx` 渲染）

### 4.3 运行时状态可视化

5 种节点视觉状态：
- **等待中**：灰色虚线边框
- **执行中**：蓝色脉冲动画边框
- **完成**：绿色实线 + 可展开查看输出
- **失败**：红色边框 + 错误信息
- **跳过**：半透明（Switch 未激活的分支）

边激活时显示流动动画。

**校验状态可视化：**
- 变量引用失效的节点：红色虚线边框 + tooltip 显示具体错误
- 断开连线时实时触发，不阻止操作，仅在保存时拦截

### 4.4 交互

- 从左侧面板拖拽添加节点
- 从输出端口拖到输入端口连线
- 双击节点打开编辑面板
- 点击"运行"→ 弹出参数表单 → 确认后执行
- 运行中可点击已完成节点查看输出
- 运行中"运行"按钮禁用（MVP 不支持同一工作流并发执行）

### 4.5 变量绑定 UI

编辑面板中的变量绑定使用两级选择器：

1. **第一级**：下拉选择上游节点（只显示有路径可达的上游节点列表）
2. **第二级**：下拉选择输出字段（MVP 固定为"输出"一个选项）

可用上游节点的计算：从当前节点出发，反向遍历 DAG，收集所有可达的祖先节点。

---

## 5. 窗口管理与边界条件

### 5.1 窗口管理规则

| 规则 | 处理方式 |
|---|---|
| 重复打开同一工作流 | 聚焦已有窗口，不新建 |
| 同时打开多个不同工作流 | 允许 |
| 编辑窗口打开时主窗口交互 | 允许（查 prompt、看 rule 等） |
| 编辑中尝试仓库同步 | 拦截同步，toast 提示"请先关闭编辑中的工作流" |
| 关闭未保存的编辑窗口 | 弹确认框："放弃修改？" / "保存并关闭" |
| 主窗口关闭 | 逐个触发编辑窗口未保存确认，全部处理后关闭 |
| 编辑中点击"运行" | 先自动保存当前版本，再执行 |
| 工作流正在运行时编辑 | 允许（编辑定义不影响运行中实例） |
| 工作流正在运行时关闭编辑窗口 | 允许（引擎在主进程，不依赖窗口） |

### 5.2 实现

`electron/services/workflow/window-manager.ts`：
- 维护 `Map<workflowId, BrowserWindow>` 跟踪打开的编辑窗口
- 暴露 `check-can-sync` 接口供仓库同步前调用
- 监听窗口 `close` 事件处理未保存确认

---

## 6. 存储设计

### 6.1 Git Full-Snapshot 模型

```
content-repo/workflows/<workflow-id>/
├── meta.json           ← 元信息（名称、描述、创建者）
├── v_<hash1>.json      ← 版本快照 1
├── v_<hash2>.json      ← 版本快照 2（更新）
└── v_<hash3>.json      ← 版本快照 3（最新，生效）
```

- 每次保存生成新文件，文件名格式 `v_<timestamp>_<short-hash>.json`（timestamp 为 Unix ms，保证排序）
- 不修改已有文件，多人推送不冲突（全是文件新增）
- 当前生效版本 = 文件名字典序最大的（timestamp 前缀保证正确排序）
- 复用现有 Content Store 的 Git 同步基础设施

> **已知限制（MVP）：** 多人并发编辑时，后保存的版本自动成为最新版本，先保存的修改虽然文件仍在但不再生效（"语义覆盖"）。MVP 以版本历史浏览和恢复为主要补救手段；后续再引入 currentVersion pointer / baseVersion 冲突检测机制。

### 6.2 内容类型注册

workflow 作为新的 `SynapseContentType` 注册，与 rule / skill / prompt 并列。

### 6.3 运行快照（本地存储，不进 Git）

工作流定义存 Git，运行记录存本地。关闭编辑器窗口后仍可回看历史运行结果。

```typescript
interface WorkflowRunSnapshot {
  runId: string
  workflowId: string
  version: string        // 运行时使用的工作流版本
  startedAt: number      // Unix ms
  endedAt?: number
  status: "completed" | "failed" | "cancelled"
  params: Record<string, unknown>
  nodeResults: Record<string, NodeRunResult>
}
```

**存储位置：** `<app-data>/workflow-runs/<workflowId>/` 目录，每次运行一个 JSON 文件。

**保留策略：** 每个工作流最多保留最近 20 次运行记录，超出时删除最旧的。

**用途：**
- 编辑器窗口重新打开时，可加载最近一次运行的节点输出
- 未来可扩展为完整运行历史浏览 UI

---

## 7. IPC Channel

```
// CRUD
synapse:workflow:list              → WorkflowMeta[]
synapse:workflow:get      {id}     → WorkflowDefinition
synapse:workflow:save     {def}    → { versionHash } | { errors: ValidationError[] }
synapse:workflow:delete   {id}     → void
synapse:workflow:validate {def}    → ValidationResult（编辑时局部校验）

// 执行
synapse:workflow:run      {id, params}  → { runId }
synapse:workflow:cancel   {runId}       → void
synapse:workflow:run-status {runId}     → WorkflowRunResult

// 运行历史（本地）
synapse:workflow:run-history {workflowId}  → WorkflowRunSnapshot[]
synapse:workflow:run-snapshot {runId}      → WorkflowRunSnapshot

// 事件推送（主进程 → 渲染进程）
synapse:workflow:event    ← WorkflowEvent

// 窗口管理
synapse:workflow:open-editor  {id}  → void
synapse:workflow:editor-state       → { openEditors: string[] }
synapse:workflow:check-can-sync     → { canSync: boolean; blockers: string[] }
```

---

## 8. 模块文件结构

```
desktop/
├── workflow-nodes/                ← 节点类型插件
│   ├── types.ts
│   ├── registry.ts
│   ├── schemas/
│   │   └── variable-binding.ts   ← 共享 VariableBinding Zod schema
│   ├── prompt/
│   └── switch/
│
├── electron/
│   ├── ipc/workflow-handlers.ts   ← IPC handler
│   └── services/workflow/
│       ├── workflow-service.ts     ← CRUD + 版本管理
│       ├── workflow-engine.ts      ← DAG 执行引擎
│       ├── workflow-validator.ts   ← 保存/运行前校验（DAG + 变量路径可达性）
│       ├── variable-resolver.ts    ← 变量解析器
│       ├── run-snapshot-service.ts ← 本地运行记录存取
│       └── window-manager.ts       ← 编辑窗口生命周期
│
└── src/modules/workflow/           ← 渲染进程
    ├── index.tsx                   ← 主窗口 Tab（列表）
    ├── components/
    │   ├── workflow-list.tsx
    │   ├── workflow-card.tsx
    │   └── run-params-dialog.tsx
    ├── editor/
    │   ├── editor-app.tsx
    │   ├── canvas.tsx
    │   ├── toolbar.tsx
    │   ├── node-palette.tsx
    │   ├── node-wrappers.tsx       ← React Flow NodeProps → card props 适配层
    │   └── execution-overlay.tsx
    └── hooks/
        ├── use-workflow-list.ts
        ├── use-workflow-run.ts
        ├── use-workflow-events.ts
        └── use-upstream-nodes.ts   ← 计算当前节点可引用的上游节点列表
```

---

## 9. 与现有系统集成

| 系统 | 集成方式 |
|---|---|
| Agent Runtime | Prompt/Switch 节点的 executor 调用 `AgentRuntimeService.sendScheduled()` |
| Content Store | workflow 注册为新内容类型，复用 Git 存储/同步/版本浏览 |
| Repository Sync | 同步前调用 `check-can-sync`，有编辑窗口时拦截 |
| Navigation | 主窗口新增 Workflow Tab |
| Action Runtime | 未来 HTTP/Script 节点可直接复用现有 Action 执行器 |
| Task Scheduler | 未来可作为工作流触发源（定时执行工作流） |

---

## 10. 架构扩展路径

| 阶段 | 新增能力 |
|---|---|
| Phase 2 | HTTP 节点、Script 节点、file 参数类型 |
| Phase 3 | Loop/迭代节点、子工作流、多输出端口 |
| Phase 4 | 定时触发（集成 Task Scheduler）、完整运行历史浏览 UI、运行对比、重跑 |
| Phase 5 | 服务端执行、工作流市场/分享 |
