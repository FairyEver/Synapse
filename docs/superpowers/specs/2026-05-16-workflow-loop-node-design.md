# 工作流循环节点设计

> 日期：2026-05-16
> 状态：已就绪 → 实现计划：`docs/superpowers/plans/2026-05-16-workflow-loop-node-implementation.md`

## 1. 背景与目标

当前 Synapse 工作流是严格的 DAG（有向无环图），不支持任何形式的重复执行。用户无法表达以下场景：

- "生成内容 → 评估质量 → 不达标就重新生成"
- "固定执行 5 轮多视角分析"
- "对数组中的每个章节分别生成内容"

**目标**：新增 `loop` 复合节点类型，通过子图封装支持循环，同时保持外层图的 DAG 约束不变。

**核心设计原则**：
1. 循环控制（开始、继续、退出）必须通过**子图内的节点**来表达，不是藏在配置面板里的表达式字符串
2. 提取子图执行能力为可复用的 `SubgraphRunner`，循环执行器是它的消费者
3. 编辑器的容器节点交互是用户体验的核心，必须重点设计

---

## 2. 设计决策

### 2.1 子图封装 vs 受控回边

选择 **子图封装** 方案。

**子图封装的优势**：
- 外层图仍然是 DAG，调度器和验证器核心逻辑零改动
- 循环节点对调度器来说就是一个普通节点——一次执行、一条结果
- 嵌套循环、子工作流复用等未来扩展共用同一个"复合节点"模式
- 数据模型干净——每轮迭代结果嵌套在循环节点的 `NodeRunResult.iterations` 中

**受控回边被否决**，原因：
- 破坏引擎的 DAG 基础假设，`ReactiveScheduler` 需要大幅重写
- `nodeResults: Record<string, NodeRunResult>` 按 nodeId 单条存储，回边导致同一节点多次执行，数据模型被破坏
- 多循环交叉时引擎难以正确处理执行顺序
- 嵌套循环在平面图上几乎无法表达
- 验证器难以区分"有意的回边"和"误连的环路"

### 2.2 循环控制方式：节点驱动，不是配置驱动

**关键决策**：循环的退出条件不是配置面板里的一个表达式字符串，而是由子图内部的真实节点来决定。

这意味着：
- 子图有两个出口：**"继续"出口** 和 **"退出"出口**
- 内部节点（Switch、Script 等）通过将执行路径导向不同出口来控制循环
- 用户在画布上能直接看到"什么条件下继续、什么条件下退出"
- 判断逻辑可以是 LLM（Switch）、代码（Script）、API 返回值（HTTP Request）——任何现有节点都能参与

### 2.3 三种循环模式

一个 `loop` 节点类型，通过配置切换三种模式：

| 模式 | 语义 | 退出由谁决定 | 并行支持 |
|---|---|---|---|
| `while` | 满足条件前持续执行 | 子图内部节点选择"继续"或"退出"出口 | 不支持（有状态依赖） |
| `for` | 固定执行 N 次 | 计数器自动控制，但支持内部 Break 提前退出 | 可选 |
| `forEach` | 对数组每项执行一次 | 数组遍历完自动退出，但支持内部 Break 提前退出 | 支持 |

---

## 3. 子图结构设计

### 3.1 子图的两个出口

每个循环子图有两个特殊的出口标记（不是独立的节点类型，而是子图的出口端口）：

```
子图内部:

  [节点A] → [节点B] → [Switch: 质量判断]
                           ├─ "不够好" → → → 【继续出口】 → 下一轮迭代
                           └─ "够好了" → → → 【退出出口】 → 循环结束
```

**实现方式**：子图有一个特殊的 "Loop Output" 终端节点（类似外层工作流的 End 节点），该节点有两个输入端口：

- **`continue` 端口**：数据到达此端口 → 更新循环变量 → 开始下一轮
- **`break` 端口**：数据到达此端口 → 循环结束 → 输出最终结果

### 3.2 子图的入口

子图有一个隐式的 "Loop Input" 起始节点，提供以下变量给子图内的所有节点：

| 变量名 | 类型 | 说明 |
|---|---|---|
| `loop.index` | number | 当前迭代序号（从 0 开始） |
| `loop.round` | number | 当前第几轮（从 1 开始，= index + 1） |
| `loop.item` | any | forEach 模式：当前数组元素 |
| `loop.{变量名}` | text/number | 用户定义的循环变量当前值 |
| `loop.inputs.{名称}` | any | 循环节点从外层图接收的输入 |

### 3.3 循环变量

循环变量是在迭代之间传递状态的机制。

```typescript
interface LoopVariable {
  name: string                   // 变量名，如 "draft", "score"
  type: "text" | "number"        // 类型
  initialValue: string | number  // 第一轮迭代时的初始值
  description?: string           // 用途说明（显示在 UI 上）
}
```

**更新规则**：
- 每轮迭代结束时，执行到 "Loop Output" 节点的数据中如果包含与循环变量同名的字段，自动更新该变量
- 更新通过 "Loop Output" 节点的配置显式映射：用户在该节点上配置"哪个上游输出映射到哪个循环变量"
- 这确保了更新关系在画布上**可见且可编辑**，不会隐式覆盖

### 3.4 完整的子图结构示例

**场景：渐进式内容优化**

```
循环节点 (while 模式, 最多 10 次)
├─ 循环变量: draft (text, 初始值 ""), score (number, 初始值 0)
│
└─ 子图:
    [Loop Input]
        │
        ↓  (提供 loop.draft, loop.score, loop.round)
        │
    [Prompt A: 生成/优化内容]
        │  (引用 loop.draft 作为上一版草稿)
        ↓
    [Prompt B: 评估质量]
        │  (输出 quality_score 和评语)
        ↓
    [Switch: 质量够了吗？]
        ├─ "不够好" → [Loop Output.continue]
        │              映射: Prompt A 输出 → draft, Prompt B 输出 score → score
        │
        └─ "够好了" → [Loop Output.break]
                       映射: Prompt A 输出 → 循环节点最终输出
```

**用户在画布上看到的**：一个容器里有 Prompt A → Prompt B → Switch，Switch 的两个分支分别连到"继续"和"退出"。整个控制逻辑就是画布上的节点和连线，没有隐藏的配置。

---

## 4. 节点配置 Schema

```typescript
interface LoopNodeConfig {
  /** 循环模式 */
  mode: "while" | "for" | "forEach"

  /** for 模式：固定次数 */
  count?: number

  /** forEach 模式：数组输入绑定 */
  arrayInput?: VariableBinding

  /** forEach 模式：是否并行执行各迭代 */
  parallel?: boolean

  /** 通用：最大迭代次数安全阀，默认 10，上限 50 */
  maxIterations: number

  /** 通用：某轮失败时的策略 */
  onError: "stop" | "skip"

  /** 循环变量定义 */
  loopVariables: LoopVariable[]

  /** 内部子图定义 */
  subgraph: SubgraphDefinition
}

interface SubgraphDefinition {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  /** Loop Output 节点的变量映射配置 */
  outputMappings: OutputMapping[]
}

interface OutputMapping {
  /** 映射到哪个循环变量 */
  targetVariable: string
  /** 从哪个子图内节点的哪个输出字段取值 */
  sourceNodeId: string
  sourceField: string
}
```

注意：`while` 模式不再需要 `condition` 配置字段，因为退出条件完全由子图内部的节点和连线决定——数据走到 `break` 出口就退出，走到 `continue` 出口就继续。

---

## 5. 执行流程

### 5.1 SubgraphRunner：可复用的子图执行能力

从 `WorkflowEngine` 中提取子图执行逻辑为独立的 `SubgraphRunner`：

```typescript
interface SubgraphRunnerInput {
  subgraph: SubgraphDefinition
  contextVariables: Record<string, unknown>  // 注入到子图的变量
  nodeRegistry: NodeTypeRegistry
  agentDeps: AgentSendDeps
  runtimeDeps?: NodeRuntimeDeps
  abortSignal: AbortSignal
  onNodeEvent?: (event: WorkflowEvent) => void
}

interface SubgraphRunnerOutput {
  status: "success" | "failed" | "cancelled"
  /** 子图终端节点（Loop Output）被激活的端口名 */
  exitPort: "continue" | "break"
  /** 子图各节点的执行结果 */
  nodeResults: Record<string, NodeRunResult>
  /** 终端节点收到的数据（用于更新循环变量或作为最终输出） */
  outputData: Record<string, unknown>
  durationMs: number
}
```

`SubgraphRunner` 复用现有的 `ReactiveScheduler` 来执行子图内部的 DAG。这样：
- 子图内部的并行执行、错误传播等逻辑和外层图完全一致
- 未来的子工作流功能也可以直接复用这个 runner

### 5.2 while 模式执行流程

```
1. 初始化循环变量为各自的 initialValue
2. iteration = 0
3. WHILE iteration < maxIterations:
   a. 检查 abortSignal，若已取消 → 退出
   b. 构建子图上下文变量:
      - loop.index = iteration
      - loop.round = iteration + 1
      - loop.{变量名} = 当前循环变量值
      - loop.inputs.{名称} = 循环节点从外层接收的输入
   c. 调用 SubgraphRunner 执行子图
   d. 如果子图失败:
      - onError === "stop" → 循环终止，状态 = failed
      - onError === "skip" → 记录错误，继续下一轮
   e. 读取 SubgraphRunner 返回的 exitPort:
      - exitPort === "break" → 循环结束
      - exitPort === "continue" → 根据 outputMappings 更新循环变量
   f. iteration++
4. 如果因为 maxIterations 到达上限而退出 → 使用最后一轮的输出
5. 循环节点的最终输出 = 最后一轮的 outputData
```

### 5.3 for 模式执行流程

```
1. 初始化循环变量
2. FOR iteration = 0 TO count - 1:
   a. 检查 abortSignal
   b. 构建子图上下文变量（同 while）
   c. 调用 SubgraphRunner 执行子图
   d. 处理错误（同 while）
   e. 如果 exitPort === "break" → 提前退出（用户在子图中显式 break）
   f. 根据 outputMappings 更新循环变量
3. 输出 = 最后一轮的 outputData
```

### 5.4 forEach 模式执行流程

```
1. array = 从外层输入解析数组
2. results = []

【顺序模式】
3. FOR (item, index) IN array:
   a. 检查 abortSignal
   b. 构建子图上下文变量:
      - loop.index = index
      - loop.item = item
      - （forEach 模式通常不需要循环变量，但也支持）
   c. 调用 SubgraphRunner 执行子图
   d. 处理错误
   e. results.push(outputData)
   f. 如果 exitPort === "break" → 提前退出，后续元素不再处理

【并行模式】
3. 同时启动所有 SubgraphRunner 实例，每个处理一个 (item, index)
4. 等待全部完成，按原始顺序收集结果

5. 输出 = results 数组
```

### 5.5 错误处理

| 策略 | 行为 |
|---|---|
| `onError: "stop"`（默认） | 某轮子图失败 → 循环立即终止，循环节点状态 = failed |
| `onError: "skip"` | 某轮失败 → 记录错误，结果为 null，继续下一轮 |

额外规则：
- 如果连续失败超过 3 轮（可配置），即使是 `skip` 模式也强制终止，防止持续浪费资源
- forEach 并行模式下，某个迭代失败不影响其他迭代的执行

### 5.6 取消/中止

- 循环执行器每轮开始前检查 `abortSignal`
- `abortSignal` 透传给 `SubgraphRunner`，子图内部正在执行的节点会自然收到取消信号
- 取消后，循环节点状态 = `cancelled`，已完成的迭代结果保留

### 5.7 进度上报

循环执行器通过 `onProgress` 回调上报进度，格式：

```typescript
// 每轮迭代开始
onProgress("loop", `迭代 ${round}/${maxIterations}`)

// 子图内部节点的事件透传（加上迭代前缀）
onNodeEvent({ ...subgraphEvent, iterationIndex: iteration })
```

---

## 6. 数据模型扩展

### 6.1 NodeRunResult 扩展

```typescript
interface NodeRunResult {
  // ... 现有字段全部保持不变
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "cancelled" | "skipped"
  input: { variables: Record<string, string>; prompt?: string }
  output?: string
  outputs?: Record<string, unknown>
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  error?: string

  /** 新增：循环迭代详情（仅 loop 节点有此字段） */
  iterations?: IterationResult[]
}

interface IterationResult {
  /** 迭代序号（从 0 开始） */
  index: number
  /** 该轮状态 */
  status: "success" | "failed" | "skipped" | "cancelled"
  /** 该轮子图内各节点的执行结果 */
  nodeResults: Record<string, NodeRunResult>
  /** 该轮结束时的循环变量快照 */
  loopVariables: Record<string, unknown>
  /** 该轮的退出端口 */
  exitPort: "continue" | "break"
  /** 该轮的最终输出数据 */
  output?: string
  outputs?: Record<string, unknown>
  /** 该轮耗时 */
  durationMs?: number
  /** 该轮错误信息（如有） */
  error?: string
}
```

### 6.2 WorkflowDefinition 兼容性

循环节点的子图存储在 `node.config.subgraph` 中。外层的 `WorkflowDefinition.nodes` 和 `WorkflowDefinition.edges` 只包含外层图的内容。

这意味着：
- 现有的 `topoSort`、`canReachEnd`、`validateWorkflow` 对外层图的处理逻辑**完全不受影响**
- 子图的验证由验证器递归调用处理

### 6.3 验证规则扩展

新增针对循环节点的验证：

| 验证项 | 错误类型 | 说明 |
|---|---|---|
| 子图为空 | `loop_empty_subgraph` | 循环节点内部没有任何节点 |
| 缺少 Loop Output | `loop_missing_output` | 子图没有终端节点 |
| while 模式缺少分支控制 | `loop_no_exit_path` | while 模式下没有任何路径能到达 break 出口 |
| forEach 缺少数组输入 | `loop_missing_array_input` | forEach 模式但没有绑定数组输入 |
| 子图内部不连通 | `loop_disconnected_nodes` | 子图内有孤立节点 |
| 子图内部有环 | `loop_subgraph_cycle` | 子图本身也必须是 DAG |
| 循环变量映射无效 | `loop_invalid_mapping` | outputMapping 引用了不存在的节点或字段 |
| maxIterations 超出范围 | `loop_max_exceeded` | 最大次数 < 1 或 > 50 |

验证器递归进入子图后，对子图内的节点执行与外层相同的验证逻辑（节点配置校验、连通性检查、DAG 检查等）。

---

## 7. 编辑器交互设计

### 7.1 创建循环节点

**三种入口**：

1. **节点面板拖入**：从左侧节点面板拖出"循环"节点到画布，初始为空容器（自动包含 Loop Input 和 Loop Output 两个特殊节点）
2. **容器内新建**：展开循环节点后，在内部区域通过快捷键或右键菜单新建节点
3. **包装现有节点**：选中画布上的多个节点 → 右键 →"包装为循环" → 自动创建循环节点，将选中节点移入，并保留它们之间的连线

### 7.2 画布上的两种状态

**折叠态（默认）**：
- 显示为普通尺寸的节点卡片
- 卡片上显示：节点名称、循环模式图标、摘要信息（如"while · 最多 10 次"）
- 双击展开
- 有输入端口（接收外层数据）和输出端口（输出循环结果）

**展开态**：
- 扩展为一个虚线边框的可视容器
- 容器顶部显示循环配置摘要：模式、循环变量、最大次数
- 内部节点直接可见、可选中、可编辑、可连线
- Loop Input 节点显示在容器左侧（不可删除）
- Loop Output 节点显示在容器右侧（不可删除），有 `continue` 和 `break` 两个输入端口
- 容器可拖动调整大小
- 点击容器外部区域或按 Esc 折叠

### 7.3 Loop Output 节点的交互

Loop Output 是子图内的特殊终端节点，这是用户控制循环行为的核心：

- **两个输入端口**：
  - `continue`（标签："继续循环"）— 连到这个端口的路径表示"继续下一轮"
  - `break`（标签："退出循环"）— 连到这个端口的路径表示"结束循环"
- **变量映射配置**：选中 Loop Output 节点后，右侧面板显示变量映射表——用户配置"哪个上游节点的输出更新哪个循环变量"
- **视觉区分**：`continue` 端口用蓝色/循环图标，`break` 端口用绿色/退出图标

**典型连线方式**：
```
Switch 节点
  ├─ "不满足" 分支 ──→ Loop Output [continue 端口]
  └─ "满足" 分支   ──→ Loop Output [break 端口]
```

### 7.4 循环节点的右侧配置面板

选中循环节点（容器本身，不是内部子节点）时，右侧面板显示：

**基础配置区**：
- 节点名称（可编辑）
- 循环模式切换（while / for / forEach 三选一）
- 最大迭代次数（数字输入框，默认 10）
- 错误处理策略（终止循环 / 跳过继续）

**循环变量区**（while 和 for 模式）：
- 变量列表，每行：名称、类型（text/number）、初始值
- 添加/删除变量按钮
- 变量名称不能和内置变量冲突（loop.index, loop.round, loop.item）

**forEach 专属区**（仅 forEach 模式显示）：
- 数组输入绑定：下拉选择"哪个上游节点的输出"作为数组源
- 并行执行开关

### 7.5 运行时可视化

**折叠态下的实时进度**：
- 节点卡片上显示当前迭代进度条，如 "迭代 3/10"
- 状态颜色随迭代变化（运行中 = 蓝色脉冲，完成 = 绿色，失败 = 红色）

**展开态下的实时进度**：
- 内部节点正常显示执行状态（pending → running → success/failed）
- 每轮迭代结束后，内部节点状态重置，下一轮重新开始
- 容器顶部显示当前轮次
- 已完成的轮次可通过一个下拉/标签栏回看

**执行结束后的结果查看**：
- 展开循环节点后，顶部出现迭代结果导航栏（如 Tab: "第1轮 ✅ | 第2轮 ✅ | 第3轮 ✅"）
- 点击某一轮 → 内部节点显示该轮的执行结果
- 每个内部节点可像普通节点一样点击查看详细输入/输出

---

## 8. 实现范围

### 8.1 新增文件

| 文件 | 进程/层 | 说明 |
|---|---|---|
| `workflow-nodes/loop/schema.ts` | 共享 | LoopNodeConfig zod schema + LoopVariable 类型 |
| `workflow-nodes/loop/manifest.ts` | 共享 | NodeManifest：类型、图标、端口、配置字段描述 |
| `workflow-nodes/loop/executor.main.ts` | 主进程 | 循环执行器：管理迭代、调用 SubgraphRunner |
| `workflow-nodes/loop/index.ts` | 共享 | 统一导出 |
| `electron/services/workflow/subgraph-runner.ts` | 主进程 | 可复用的子图执行器，从 WorkflowEngine 提取 |
| `src/modules/workflow/editor/loop-container.tsx` | 渲染器 | 画布上的容器节点组件（展开/折叠） |
| `src/modules/workflow/editor/loop-output-node.tsx` | 渲染器 | Loop Output 特殊节点的渲染 |
| `src/modules/workflow/editor/loop-input-node.tsx` | 渲染器 | Loop Input 特殊节点的渲染 |
| `src/modules/workflow/components/loop-config-panel.tsx` | 渲染器 | 循环节点右侧配置面板 |
| `src/modules/workflow/components/iteration-result-viewer.tsx` | 渲染器 | 迭代结果查看界面 |
| `electron/services/workflow/__tests__/subgraph-runner.test.ts` | 测试 | SubgraphRunner 单元测试 |
| `electron/services/workflow/__tests__/loop-executor.test.ts` | 测试 | 循环执行器单元测试 |

### 8.2 修改文件

| 文件 | 改动内容 |
|---|---|
| `workflow-nodes/register.main.ts` | 注册 loop executor |
| `workflow-nodes/register.renderer.ts` | 注册 loop manifest |
| `src/types/workflow.ts` | 新增 `IterationResult` 接口，`NodeRunResult` 加 `iterations?` 字段 |
| `workflow-nodes/types.ts` | 新增 `SubgraphDefinition`、`LoopVariable`、`OutputMapping` 接口 |
| `electron/services/workflow/workflow-validator.ts` | 递归验证子图 + 新增循环专属验证规则 |
| `electron/services/workflow/variable-resolver.ts` | 支持 `loop.*` 前缀的循环上下文变量解析 |
| `electron/services/workflow/workflow-engine.ts` | 提取子图执行逻辑到 SubgraphRunner（重构，非新功能） |

### 8.3 编辑器改动清单（工作量最大的部分）

| 改动项 | 复杂度 | 说明 |
|---|---|---|
| 容器节点渲染 | 高 | 展开/折叠动画、虚线边框、内部节点布局 |
| 容器内连线 | 高 | 内部节点之间的连线交互，与外部连线隔离 |
| Loop Input / Output 特殊节点 | 中 | 不可删除、固定位置、特殊端口 |
| 拖入/拖出容器 | 中 | 将节点从外层拖入容器或从容器拖出 |
| "包装为循环"右键菜单 | 低 | 选中节点 → 创建容器 → 移入 |
| 循环配置面板 | 中 | 模式切换、变量管理、forEach 配置 |
| Loop Output 变量映射配置 | 中 | 可视化的映射表编辑 |
| 运行时迭代进度 | 中 | 实时进度显示、轮次标识 |
| 迭代结果导航 | 中 | Tab 切换查看各轮结果 |

### 8.4 不在本次范围

- **嵌套循环**：数据结构已支持（SubgraphDefinition 里可以有 loop 节点），但编辑器 UI 暂不处理嵌套容器的渲染
- **子工作流复用**：SubgraphRunner 可复用，但"引用外部子工作流"是独立功能
- **循环模板/预设**：如"渐进优化"模板——可后续作为用户体验优化
- **条件表达式模式**：保留在 schema 中但不在 v1 实现，v1 只支持节点驱动控制

---

## 9. 对现有架构的影响评估

| 组件 | 影响程度 | 说明 |
|---|---|---|
| `ReactiveScheduler` | **无改动** | 外层图仍是 DAG |
| `WorkflowEngine` | **重构** | 提取子图执行逻辑为 SubgraphRunner，engine 本身逻辑不变 |
| `workflow-validator.ts` | **中等** | 新增递归子图验证 + 循环专属规则 |
| `variable-resolver.ts` | **小改** | 新增 `loop.*` 变量前缀支持 |
| `NodeTypeRegistry` | **无改动** | 新 node type 走正常注册流程 |
| `src/types/workflow.ts` | **小改** | 加 IterationResult 和相关类型 |
| 编辑器画布 | **大改** | 容器节点是全新的渲染和交互模式 |

**风险点**：
1. SubgraphRunner 提取是关键路径——必须保证提取后外层工作流的所有现有测试仍然通过
2. 编辑器容器节点的交互设计需要迭代打磨——建议先实现基础展开/折叠 + 内部连线，再逐步完善拖入拖出等高级交互
3. 运行时的迭代可视化依赖 WebSocket 或 IPC 事件推送的性能——循环次数多时需要注意事件风暴

---

## 10. 验收标准

### 10.1 引擎侧

- [ ] SubgraphRunner 独立可测试，通过所有子图执行场景的单元测试
- [ ] while 模式：子图内 Switch 选择 break → 循环退出，选择 continue → 下一轮
- [ ] for 模式：固定次数执行，内部 break 能提前退出
- [ ] forEach 顺序模式：逐项执行，结果按序收集
- [ ] forEach 并行模式：多项并发执行，结果按原始顺序
- [ ] 最大迭代次数安全阀：到达上限强制退出
- [ ] 错误处理 stop：某轮失败立即终止
- [ ] 错误处理 skip：某轮失败记录 null 继续
- [ ] 取消信号正确透传到子图内部
- [ ] 循环变量在迭代间正确传递和更新
- [ ] 验证器正确检测所有循环专属错误

### 10.2 编辑器侧

- [ ] 可从节点面板拖入循环节点
- [ ] 循环节点可展开/折叠
- [ ] 展开后可在内部新建节点和连线
- [ ] Loop Input / Loop Output 节点正确显示且不可删除
- [ ] Switch 节点的分支可连到 Loop Output 的 continue / break 端口
- [ ] 右侧面板可配置循环模式、变量、最大次数
- [ ] Loop Output 节点可配置变量映射
- [ ] 运行时显示迭代进度
- [ ] 执行完成后可按轮次查看各迭代结果
