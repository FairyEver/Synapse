# 工作流结束节点 — Design Spec

## 概述

在现有工作流编排系统中引入显式结束节点（End Node）。结束节点作为工作流的明确终止信号，同时定义工作流的最终输出文本。执行引擎从结束节点反向推导需要执行的节点子集，未连入结束节点的节点不执行。

## 核心约束

- 结束节点**必须存在且仅有一个**
- 双层保障：UI 层预置不可删 + 校验层兜底拦截
- 工作流运行顺序由结束节点反推确定（反向 BFS 裁剪）

---

## 1. 数据模型变更

### 1.1 EndNodeConfig（新增）

```typescript
interface EndNodeConfig {
  outputType: "text"           // MVP 只做 text，预留扩展
  template: string             // 文本模板，使用 {{$变量名}}
  variables: VariableBinding[] // 复用现有 VariableBinding
}
```

与 `PromptNodeConfig` 结构一致，差别是无 `agent` 字段，多了 `outputType`。

### 1.2 WorkflowRunResult（扩展）

```typescript
interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  durationMs: number
  output?: string   // 新增：End Node 渲染后的文本，仅 status=completed 时有值
}
```

### 1.3 ValidationError（扩展）

```typescript
type ValidationErrorType =
  | "cycle"
  | "unreachable_reference"
  | "invalid_config"
  | "invalid_switch_edge"
  | "orphan_edge_branch"
  | "missing_end_node"    // 新增
  | "multiple_end_nodes"  // 新增
```

---

## 2. 节点插件 `workflow-nodes/end/`

遵循现有插件架构，新增 `end/` 文件夹：

```
workflow-nodes/end/
├── manifest.ts        ← 元数据，ports 只有 input，无 output
├── schema.ts          ← Zod schema for EndNodeConfig
├── executor.main.ts   ← 渲染模板，不调用 Agent
├── card.tsx           ← 画布卡片（展示模板摘要）
├── panel.tsx          ← 编辑面板（变量绑定 + 文本模板）
└── index.ts
```

### 2.1 Manifest

```typescript
{
  type: "end",
  title: "结束",
  icon: "LogOut",
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: []   // 无出边，是终止节点
  },
  cardSummary: (config) => ({
    title: "结束",
    subtitle: config.template.slice(0, 40) || "返回文本"
  })
}
```

### 2.2 Executor

```typescript
// executor.main.ts
execute({ config, resolvedVariables }) {
  const output = interpolatePrompt(config.template, resolvedVariables)
  return {
    status: "success",
    output,
    durationMs: 0,   // 无 Agent 调用
  }
}
```

复用现有 `interpolatePrompt`，不新增工具函数。

### 2.3 Panel UX

与 `prompt/panel.tsx` 结构一致：
- 上半部分：变量绑定列表（复用现有 `variable-binding-editor.tsx`）
- 下半部分：文本模板 textarea，支持 `{{$变量名}}` 语法

---

## 3. 引擎改动

`workflow-engine.ts` 新增两处改动，其余逻辑不变。

### 3.1 执行前——反向 BFS 裁剪

在 `topoOrder()` 之前插入：

```typescript
function reachableFromEnd(def: WorkflowDefinition): Set<string> {
  const endNode = def.nodes.find(n => n.type === "end")
  if (!endNode) return new Set(def.nodes.map(n => n.id)) // fallback，validator 会报错

  const visited = new Set<string>()
  const queue = [endNode.id]
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    for (const e of def.edges.filter(e => e.to === id)) {
      queue.push(e.from)
    }
  }
  return visited
}
```

`run()` 方法中：

```typescript
const reachableSet = reachableFromEnd(def)
const order = topoOrder(def).filter(id => reachableSet.has(id))
```

### 3.2 执行后——提升 End Node 输出

```typescript
const endNodeId = def.nodes.find(n => n.type === "end")?.id
const result: WorkflowRunResult = {
  status: overallFailed ? "failed" : "completed",
  nodeResults, durationMs,
  output: endNodeId ? nodeOutputs[endNodeId] : undefined,
}
```

**总计：引擎新增约 15 行，不改动任何现有执行路径。**

---

## 4. 校验器改动

在 `validateWorkflow()` 开头新增两条规则：

```typescript
const endNodes = def.nodes.filter(n => n.type === "end")
if (endNodes.length === 0)
  errors.push({ type: "missing_end_node", message: "工作流必须包含一个结束节点" })
if (endNodes.length > 1)
  errors.push({ type: "multiple_end_nodes", message: "结束节点只能有一个" })
```

现有 `multiple_start_nodes` warning 保持不变（入度为 0 且非 End Node 的节点）。

---

## 5. UI 改动

### 5.1 新建工作流自动放置 End Node

`workflow-service.ts` 的 `createWorkflow()` 中，初始 `nodes` 包含一个默认 End Node：

```typescript
const defaultEndNode: WorkflowNode = {
  id: generateId(),
  name: "结束",
  type: "end",
  position: { x: 600, y: 200 },
  config: { outputType: "text", template: "", variables: [] },
}
```

### 5.2 画布禁止删除 End Node

```typescript
onNodesDelete={(nodes) => {
  const deletable = nodes.filter(n => n.data.type !== "end")
  if (deletable.length < nodes.length) toast("结束节点不能删除")
  handleDelete(deletable)
}}
```

End Node 卡片不渲染删除按钮（`card.tsx` 中条件隐藏）。

### 5.3 节点面板过滤 End Node

`node-palette.tsx` 的节点列表过滤掉 `type === "end"`，用户无法从面板再拖出第二个。

### 5.4 End Node 视觉区分

- 只有输入 handle，无输出 handle
- 边框使用 `border-primary`，与 prompt 节点的 neutral 边框区分
- 图标：`LogOut`（lucide）

---

## 6. 改动范围

| 文件/目录 | 改动类型 |
|---|---|
| `workflow-nodes/end/` | 新增（5 个文件） |
| `workflow-nodes/register.main.ts` | 注册 end 节点类型 |
| `src/types/workflow.ts` | 扩展 `WorkflowRunResult.output`、新增 error 类型 |
| `electron/services/workflow/workflow-engine.ts` | 新增反向 BFS + output 提升，~15 行 |
| `electron/services/workflow/workflow-validator.ts` | 新增 2 条校验规则，~6 行 |
| `electron/services/workflow/workflow-service.ts` | 新建工作流默认放置 End Node |
| `src/modules/workflow/editor/canvas.tsx` | 禁止删除 End Node |
| `src/modules/workflow/editor/node-palette.tsx` | 过滤 End Node |
| 测试文件 | 更新现有测试 + 新增 End Node 测试用例 |

**不需要改动**：IPC channels、存储层、变量解析器、`variable-binding-editor.tsx`。

---

## 7. MVP 不做

- 返回变量模式（`outputType: "variables"`）
- End Node 多输出端口
- 从结束节点"回溯重跑"
