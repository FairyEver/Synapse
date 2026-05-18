# 工作流循环节点 — 实现计划

> 设计文档：`2026-05-16-workflow-loop-node-design.md`
> 日期：2026-05-16

## 总览

共 8 个实现步骤，分为 3 个阶段：

- **阶段 1（基础层）**：类型定义 + SubgraphRunner 提取 + 循环执行器 — Step 1~4
- **阶段 2（编辑器）**：容器节点渲染 + 配置面板 + 内部连线 — Step 5~7
- **阶段 3（运行时 UI）**：迭代进度 + 结果查看 — Step 8

依赖关系：
```
Step 1 (类型) ──┬──→ Step 2 (SubgraphRunner) ──→ Step 3 (循环执行器) ──→ Step 4 (验证器)
                │
                └──→ Step 5 (容器节点) ──→ Step 6 (配置面板) ──→ Step 7 (内部连线)
                                                                          │
                                                      Step 4 ────────────┴──→ Step 8 (运行时 UI)
```

Step 1 完成后，Step 2 和 Step 5 可并行。

---

## Step 1：类型定义与 Schema

**目标**：定义 loop 节点的所有 TypeScript 接口和 zod schema，为后续步骤提供类型基础。

**新增文件**：
- `desktop/workflow-nodes/loop/schema.ts` — LoopNodeConfig zod schema
- `desktop/workflow-nodes/loop/index.ts` — 统一导出

**修改文件**：
- `desktop/workflow-nodes/types.ts` — 新增 `SubgraphDefinition`、`LoopVariable`、`OutputMapping` 接口
- `desktop/src/types/workflow.ts` — 新增 `IterationResult` 接口，`NodeRunResult` 加 `iterations?` 字段

**具体内容**：

1. 在 `workflow-nodes/types.ts` 新增：
   ```typescript
   interface SubgraphDefinition {
     nodes: WorkflowNode[]
     edges: WorkflowEdge[]
     outputMappings: OutputMapping[]
   }
   interface LoopVariable {
     name: string
     type: "text" | "number"
     initialValue: string | number
     description?: string
   }
   interface OutputMapping {
     targetVariable: string
     sourceNodeId: string
     sourceField: string
   }
   ```

2. 在 `src/types/workflow.ts` 新增 `IterationResult`：
   ```typescript
   interface IterationResult {
     index: number
     status: "success" | "failed" | "skipped" | "cancelled"
     nodeResults: Record<string, NodeRunResult>
     loopVariables: Record<string, unknown>
     exitPort: "continue" | "break"
     output?: string
     outputs?: Record<string, unknown>
     durationMs?: number
     error?: string
   }
   ```
   在 `NodeRunResult` 上加 `iterations?: IterationResult[]`。

3. 创建 `workflow-nodes/loop/schema.ts`：
   - LoopNodeConfig 的 zod schema（mode、count、arrayInput、parallel、maxIterations、onError、loopVariables、subgraph）
   - 校验规则：for 模式必须有 count，forEach 必须有 arrayInput，maxIterations 范围 1~50

4. 创建 `workflow-nodes/loop/index.ts`：导出 schema + 后续的 manifest 和 executor

**验证**：
```bash
pnpm --filter @synapse/desktop run typecheck
```
无类型错误。现有测试不受影响（只加了可选字段和新文件）。

---

## Step 2：提取 SubgraphRunner

**目标**：从 `WorkflowEngine` 中提取子图执行逻辑为独立可复用的 `SubgraphRunner`。这是循环执行器的核心依赖，也是未来子工作流功能的基础。

**新增文件**：
- `desktop/electron/services/workflow/subgraph-runner.ts`
- `desktop/electron/services/workflow/__tests__/subgraph-runner.test.ts`

**修改文件**：
- `desktop/electron/services/workflow/workflow-engine.ts` — 将子图执行相关逻辑提取到 SubgraphRunner，engine 内部改为调用 SubgraphRunner（或保留直接调用 ReactiveScheduler，确保行为不变）

**具体内容**：

1. SubgraphRunner 类/函数：
   - 输入：SubgraphRunnerInput（subgraph、contextVariables、nodeRegistry、agentDeps、runtimeDeps、abortSignal、onNodeEvent）
   - 输出：SubgraphRunnerOutput（status、exitPort、nodeResults、outputData、durationMs）
   - 内部流程：
     a. 从 subgraph.nodes 和 subgraph.edges 构建执行图
     b. 将 contextVariables 注入到变量解析上下文
     c. 调用 ReactiveScheduler.execute()
     d. 从终端节点（Loop Output）确定 exitPort 和 outputData
     e. 收集所有 nodeResults

2. 关键复用点：
   - 变量解析（variable-resolver）要支持 `loop.*` 前缀
   - taskFactory 创建逻辑与 WorkflowEngine 中的一致
   - resolveActivatedDownstream 回调需要处理 Loop Output 的 continue/break 端口

3. 在 `variable-resolver.ts` 中新增对 `loop.*` 变量的解析支持

**测试用例**：
- 简单子图（A → B → Output）执行成功
- 子图内并行节点正确执行
- 子图内节点失败 → 状态 = failed
- abortSignal 正确终止子图执行
- contextVariables 正确注入且子图内节点可引用
- Loop Output 的 continue/break 端口正确识别 exitPort

**验证**：
```bash
pnpm --filter @synapse/desktop run vitest run electron/services/workflow/__tests__/subgraph-runner.test.ts
pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/workflow-engine.test.ts
```
SubgraphRunner 新测试全过。**原有 workflow-engine 测试必须全部通过**，证明提取是安全的重构。

---

## Step 3：循环执行器

**目标**：实现 loop 节点的 NodeExecutor，管理三种模式的迭代逻辑。

**新增文件**：
- `desktop/workflow-nodes/loop/executor.main.ts`
- `desktop/workflow-nodes/loop/manifest.ts`
- `desktop/electron/services/workflow/__tests__/loop-executor.test.ts`

**修改文件**：
- `desktop/workflow-nodes/register.main.ts` — 注册 loop executor
- `desktop/workflow-nodes/register.renderer.ts` — 注册 loop manifest

**具体内容**：

1. `manifest.ts`：
   - type: "loop"
   - title: "循环"
   - icon: 选用 Repeat / RefreshCw 等 Lucide 图标
   - ports: inputs = [{ name: "input", label: "输入" }]，outputs = [{ name: "output", label: "输出" }]
   - configFields: mode 选择、maxIterations 数字、onError 选择、loopVariables 列表
   - configSchema: 引用 schema.ts

2. `executor.main.ts`：
   - 实现 `NodeExecutor<LoopNodeConfig>` 接口
   - execute() 流程：
     a. 根据 mode 选择执行策略
     b. while 模式：循环调用 SubgraphRunner，检查 exitPort
     c. for 模式：固定次数循环，支持 break
     d. forEach 模式：解析数组，顺序/并行调用 SubgraphRunner
     e. 每轮收集 IterationResult
     f. 错误处理：stop 或 skip
     g. 最终输出：最后一轮的 outputData（while/for）或 results 数组（forEach）
   - 进度上报：每轮开始时调用 onProgress
   - 循环变量管理：每轮结束后根据 outputMappings 更新

3. 注册到 register.main.ts 和 register.renderer.ts

**测试用例**：

while 模式：
- 子图第 3 轮选择 break → 循环执行 3 次后退出
- 子图始终选择 continue → 到达 maxIterations 强制退出
- 循环变量在迭代间正确传递（第 1 轮输出的 draft 在第 2 轮可读取）
- abortSignal 在第 2 轮取消 → 循环终止，前 1 轮结果保留

for 模式：
- count=5 → 执行 5 次
- count=5 但第 3 轮 break → 执行 3 次
- count=0 → 不执行，直接输出

forEach 顺序模式：
- 3 元素数组 → 执行 3 次，结果按序
- 某轮失败 + onError=stop → 后续不执行
- 某轮失败 + onError=skip → 结果中对应位置 null

forEach 并行模式：
- 3 元素数组 → 并发执行，结果按原始顺序
- 某个迭代失败不影响其他

**验证**：
```bash
pnpm --filter @synapse/desktop run vitest run electron/services/workflow/__tests__/loop-executor.test.ts
```
所有测试通过。

---

## Step 4：验证器扩展

**目标**：在 `validateWorkflow` 中递归验证循环节点的子图，新增循环专属验证规则。

**修改文件**：
- `desktop/electron/services/workflow/workflow-validator.ts`

**具体内容**：

1. 在 `validateWorkflow` 中检测 loop 节点，对每个 loop 节点的 `config.subgraph` 递归调用验证逻辑

2. 新增验证规则：
   - `loop_empty_subgraph`：子图 nodes 为空
   - `loop_missing_output`：子图没有 loop-output 类型的终端节点
   - `loop_no_exit_path`：while 模式下，没有任何连线到达 break 端口（意味着循环永远不会退出）
   - `loop_missing_array_input`：forEach 模式但 arrayInput 未配置
   - `loop_disconnected_nodes`：子图内有孤立节点（warning）
   - `loop_subgraph_cycle`：子图本身有环（error）
   - `loop_invalid_mapping`：outputMappings 引用不存在的节点或字段
   - `loop_max_exceeded`：maxIterations < 1 或 > 50

3. 子图内部的节点配置校验复用现有逻辑（调用各节点 manifest 的 configSchema.safeParse）

**测试用例**：
- 空子图 → 报 loop_empty_subgraph
- 无 Loop Output → 报 loop_missing_output
- while 模式所有路径都到 continue → 报 loop_no_exit_path（warning）
- forEach 无 arrayInput → 报 loop_missing_array_input
- 子图内有环 → 报 loop_subgraph_cycle
- 正常循环节点 → 无错误

**验证**：
```bash
pnpm --filter @synapse/desktop run vitest run electron/services/workflow/__tests__/workflow-validator.test.ts
```
新旧测试全部通过。

---

## Step 5：编辑器容器节点渲染

**目标**：在画布上渲染循环节点的折叠态和展开态。

**新增文件**：
- `desktop/src/modules/workflow/editor/loop-container.tsx` — 容器节点组件
- `desktop/src/modules/workflow/editor/loop-input-node.tsx` — Loop Input 特殊节点
- `desktop/src/modules/workflow/editor/loop-output-node.tsx` — Loop Output 特殊节点

**修改文件**：
- 画布节点渲染入口（根据 node.type === "loop" 使用 LoopContainer 组件）
- 节点面板（添加"循环"节点到可拖入列表）

**具体内容**：

1. **折叠态渲染**：
   - 普通节点卡片尺寸
   - 显示：🔄 图标 + 节点名称 + 模式标签（"while · 最多 10 次"）
   - 输入/输出端口与外层连线
   - 双击触发展开

2. **展开态渲染**：
   - 虚线边框容器，背景微透明
   - 顶部 header：节点名称 + 模式 + 循环变量摘要 + 折叠按钮
   - 内部区域：渲染子图的 nodes 和 edges
   - Loop Input 节点固定在左侧，显示可用变量列表
   - Loop Output 节点固定在右侧，显示 continue / break 两个输入端口
   - 容器可拖动、可调整大小
   - 点击容器外或按 Esc 折叠

3. **Loop Input 节点**：
   - 不可删除、不可拖出容器
   - 显示当前可用的循环变量和内置变量
   - 只有输出端口（提供数据给子图内节点）

4. **Loop Output 节点**：
   - 不可删除、不可拖出容器
   - 有两个输入端口：continue（蓝色）和 break（绿色）
   - 视觉上用不同颜色/图标区分

**验证**：
- 手动验证：启动 dev 服务器，从节点面板拖入循环节点，双击展开/折叠
- Loop Input / Loop Output 正确显示且不可删除
- 折叠态外部连线正常

---

## Step 6：循环配置面板

**目标**：实现循环节点和 Loop Output 节点的右侧配置面板。

**新增文件**：
- `desktop/src/modules/workflow/components/loop-config-panel.tsx`

**修改文件**：
- 右侧面板路由逻辑（根据选中节点 type 显示对应面板）

**具体内容**：

1. **循环节点面板**（选中容器时显示）：
   - 节点名称编辑
   - 循环模式 ToggleGroup（while / for / forEach）
   - 最大迭代次数 NumberInput
   - 错误处理 Select（终止循环 / 跳过继续）
   - 循环变量管理区：
     - 变量列表表格：名称(input) + 类型(select) + 初始值(input) + 删除按钮
     - 添加变量按钮
   - forEach 专属区（仅 forEach 模式可见）：
     - 数组输入绑定 Select（列出上游节点的输出）
     - 并行执行 Switch

2. **Loop Output 节点面板**（选中 Loop Output 时显示）：
   - 变量映射表：
     - 每行：循环变量名 → 源节点 Select → 源字段 Select
     - 根据循环变量定义自动生成行
   - 提示文字说明 continue / break 端口的语义

**验证**：
- 手动验证：选中循环节点 → 右侧面板正确显示配置项
- 修改模式 → 面板动态切换（forEach 专属区显隐）
- 添加/删除循环变量 → 数据正确保存到节点 config
- Loop Output 变量映射可配置

---

## Step 7：容器内连线交互

**目标**：支持在展开的循环容器内部进行节点连线。

**修改文件**：
- 画布连线逻辑（需要区分"外层连线"和"容器内连线"）

**具体内容**：

1. **连线规则**：
   - 容器内节点之间可以连线（走子图的 edges）
   - 容器内节点可以连到 Loop Output 的 continue / break 端口
   - Loop Input 的输出端口可以连到容器内节点
   - 禁止：容器内节点直接连到容器外节点（必须通过 Loop Input/Output 桥接）
   - 禁止：外部节点连到容器内部节点

2. **连线存储**：
   - 容器内连线存储在 `node.config.subgraph.edges` 中
   - 外层连线存储在 `WorkflowDefinition.edges` 中
   - 连线操作时根据源/目标节点是否在同一容器内来决定存储位置

3. **"包装为循环"功能**：
   - 选中多个节点 → 右键 →"包装为循环"
   - 创建 loop 节点，将选中节点移入 subgraph
   - 选中节点之间的连线移入 subgraph.edges
   - 指向选中节点的外部连线 → 改为指向循环节点输入端口
   - 选中节点指向外部的连线 → 改为从循环节点输出端口指向原目标
   - 自动添加 Loop Input 和 Loop Output 节点

**验证**：
- 手动验证：展开容器后可在内部拖线连接节点
- Switch 节点分支可连到 Loop Output 的 continue / break
- 容器内外连线互不干扰
- "包装为循环"操作后连线正确迁移

---

## Step 8：运行时 UI

**目标**：循环执行时显示实时进度，执行完成后可查看各轮迭代结果。

**新增文件**：
- `desktop/src/modules/workflow/components/iteration-result-viewer.tsx`

**修改文件**：
- 执行 overlay 逻辑（处理 loop 节点的 iterations 数据）
- 节点状态渲染（loop 节点的运行中/完成态）

**具体内容**：

1. **折叠态实时进度**：
   - loop 节点卡片上显示进度文本："迭代 2/10"
   - 运行中 → 蓝色脉冲动画
   - 完成 → 绿色（成功）或红色（失败）

2. **展开态实时进度**：
   - 容器顶部显示当前轮次："第 3 轮执行中..."
   - 内部节点正常显示 running / success / failed 状态
   - 每轮结束后内部节点状态重置（视觉上短暂过渡到下一轮）

3. **迭代结果查看器**（iteration-result-viewer.tsx）：
   - 执行完成后，展开循环节点，顶部显示迭代导航 Tab
   - 格式：第1轮 ✅ | 第2轮 ✅ | 第3轮 ✅
   - 点击某轮 → 内部节点显示该轮的 nodeResults
   - 每个内部节点可点击查看详细输入/输出/耗时

4. **运行历史整合**：
   - WorkflowRunResult 中 loop 节点的 nodeResult 包含 iterations
   - run history dialog 中可展开循环节点查看各轮详情

**验证**：
- 手动验证：运行包含循环节点的工作流
  - 折叠态正确显示"迭代 N/M"
  - 展开态内部节点状态正确变化
  - 执行完成后可切换轮次查看结果
- 运行历史中循环节点可展开查看迭代详情

---

## 实施时间估算

| 步骤 | 预估工作量 | 可并行 |
|---|---|---|
| Step 1 类型定义 | 0.5 天 | — |
| Step 2 SubgraphRunner | 1.5 天 | 与 Step 5 并行 |
| Step 3 循环执行器 | 1.5 天 | — |
| Step 4 验证器 | 0.5 天 | — |
| Step 5 容器节点渲染 | 2 天 | 与 Step 2 并行 |
| Step 6 配置面板 | 1 天 | — |
| Step 7 容器内连线 | 1.5 天 | — |
| Step 8 运行时 UI | 1 天 | — |
| **合计** | **~9.5 天** | |

关键路径：Step 1 → Step 2 → Step 3 → Step 4 → Step 8（引擎侧 4 天）
并行路径：Step 1 → Step 5 → Step 6 → Step 7（编辑器侧 4.5 天）

如果引擎和编辑器可并行开发，总工期约 **5~6 天**。
