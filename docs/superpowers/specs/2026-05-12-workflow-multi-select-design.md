# 流程编辑器框选多选

## 目标

在流程编辑器画布上，用户可以通过拖拽画框一次性选中多个节点，并对选中节点执行批量移动、删除、复制和断开连线操作。

## 交互规则

| 输入 | 行为 |
|------|------|
| 在画布空白处拖拽 | 画出选框，框内（部分覆盖即可）节点被选中 |
| 滚轮 / 触控板 | 平移画布（现有行为不变） |
| Shift+Click 节点 | 逐个加选 / 取消（React Flow 默认行为，免费获得） |
| 点击单个节点（无修饰键） | 清除多选，选中该节点，侧边栏显示其配置 |
| 点击画布空白处 | 取消全部选中 |
| 拖拽选中节点 | 所有选中节点跟随移动 |
| 右键菜单 | 复制 / 删除 / 断开连线作用于所有选中节点（已有逻辑） |
| Delete / Backspace | 删除所有选中节点（React Flow 内置，end 节点受 `handleNodesChange` 保护不被删除） |

## 侧边栏（NodeConfigPanel）

- 多选时 `selectedNodeId` 设为 `null`，配置面板显示现有空态。
- 单选时保持当前行为，显示所选节点配置。
- 运行态点击节点查看结果的逻辑不受影响。

## 技术方案

### 1. ReactFlow 属性变更（canvas.tsx）

```tsx
import { SelectionMode } from "@xyflow/react"

<ReactFlow
  // ... existing props
  selectionOnDrag          // 拖拽空白处画选框
  selectionMode={SelectionMode.Partial}  // 部分覆盖即选中
>
```

### 2. 选中状态同步（canvas.tsx 内新增子组件）

使用 `useOnSelectionChange` hook 监听选中变化，向 `editor-app.tsx` 回传：

```tsx
import { useOnSelectionChange } from "@xyflow/react"

function SelectionSync({ onNodeSelect }: { onNodeSelect: (nodeId: string | null) => void }) {
  const onChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    onNodeSelect(nodes.length === 1 ? nodes[0].id : null)
  }, [onNodeSelect])

  useOnSelectionChange({ onChange })
  return null
}
```

- 1 个节点 → `onNodeSelect(nodeId)` → 侧边栏显示配置
- 0 或 2+ 个 → `onNodeSelect(null)` → 侧边栏空态

### 3. onNodeClick 瘦身（canvas.tsx）

`onNodeClick` 不再承担编辑态选中状态同步，仅保留运行态查看结果逻辑。编辑态的选中已全部由 `useOnSelectionChange` → `SelectionSync` 统一处理。

新增 `onNodeSelect` 拆分为两个回调：
- `onSelectionChange(nodeId: string | null)` — 编辑态选中同步
- `onNodeClick(nodeId: string)` — 运行态查看结果（仅在 `runState !== "idle"` 时由 canvas 触发）

或者保持单一 `onNodeSelect` 接口，由 `editor-app.tsx` 侧判断来源。考虑到改动最小化，**推荐保持单一 `onNodeSelect`**，仅改变调用源：

- 编辑态：由 `SelectionSync` 通过 `onNodeSelect` 回传
- 运行态：由 `onNodeClick` 通过 `onNodeSelect` 回传（仅 `runState !== "idle"` 时才通知）

`onNodeClick` 改为：
```tsx
const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowFlowNode) => {
  // 运行态：点击节点查看结果
  if (runState !== "idle") {
    onNodeSelect?.(node.id)
  }
  // 编辑态：选中状态由 SelectionSync 处理，不在这里干预
}, [onNodeSelect, runState])
```

> 注：`runState` 需要从 `editor-app.tsx` 传递给 `canvas.tsx`。

### 4. 传递 runState 给 canvas

`WorkflowCanvasProps` 新增 `runState` 属性，用于 `onNodeClick` 判断是否为运行态。

```tsx
interface WorkflowCanvasProps {
  definition: WorkflowDefinition
  nodeResults?: Record<string, NodeRunResult>
  runState?: string          // 新增
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}
```

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `canvas.tsx` | 添加 `selectionOnDrag`、`selectionMode`；新增 `SelectionSync` 子组件；`onNodeClick` 仅处理运行态；接收 `runState` prop |
| `editor-app.tsx` | 向 `WorkflowCanvas` 传递 `runState` |

**不改动**：`canvas-context.ts`、`node-context-menu.tsx`、`node-wrappers.tsx`、`node-config-panel.tsx`、`toolbar.tsx`

## 不在范围内

- ⌘C / ⌘V 键盘快捷键（已有右键菜单够用，后续单独加）
- 多选侧边栏摘要（侧边栏不显示多选信息，直接空态）
- 工具栏模式切换按钮
- 框选边（Edge）
