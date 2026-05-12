# 流程编辑器节点右键菜单

日期: 2026-05-12

## 问题

流程编辑器中节点创建后没有明显的删除途径，也缺少复制、重命名等常用操作的快捷入口。

## 决策

- 范围：节点右键菜单（不含连线、画布空白处）
- 多选复制时保留被复制节点之间的内部连线
- End 节点不可删除、不可复制，但可断开连线和重命名
- 多选右键：菜单操作批量作用于所有选中节点

## 菜单项

| 菜单项 | 快捷键提示 | 单选 | 多选 | End 节点 |
|--------|-----------|------|------|----------|
| 重命名 | — | ✅ | ❌ 隐藏 | ✅ |
| 复制 | ⌘C | ✅ | ✅ | 跳过 |
| 粘贴 | ⌘V | ✅ | ✅ | ✅ |
| 分隔线 | — | — | — | — |
| 断开所有连线 | — | ✅ | ✅ | ✅ |
| 删除 | ⌫ | ✅ | ✅ | 跳过 + toast |

### 多选行为

- 框选或 ⌘+Click 多选节点后，右键任意选中节点出菜单。
- 右键不在选区中的节点时，清除已有选区，改为仅选中该节点。
- End 节点被跳过时，如果跳过后没有可操作节点，toast 提示。

### 复制/粘贴

- 内存级剪贴板（`useRef`），存储 `{ nodes: WorkflowNode[], edges: WorkflowEdge[] }`。
- 复制时过滤 End 节点，保留其余节点之间的连线。
- 粘贴时所有节点/连线 ID 重新生成（`crypto.randomUUID()`），位置相对于右键目标节点偏移 `(+50, +50)`。
- 粘贴后自动选中新节点。
- 剪贴板为空时粘贴菜单项 disabled。

### 重命名

- 单选时右键选择「重命名」后，触发 `onNodeSelect` 并发出 `requestRename` 信号。
- `NodeConfigPanel` 接收信号后聚焦名称 input。
- 多选时隐藏重命名项（多节点同时重命名无意义）。

### 断开所有连线

- 移除所有 `from === nodeId || to === nodeId` 的 edge。
- 多选时批量处理所有选中节点。

### 删除

- 复用现有 `handleNodesChange` 中 `remove` 类型变更的逻辑。
- End 节点跳过（已有保护逻辑），给 toast 提示。
- 删除节点时自动清除关联 edge（ReactFlow 内建行为）。

## 实现方案

在 `node-wrappers.tsx` 中每个 wrapper 外层包裹 shadcn `ContextMenu` + `ContextMenuTrigger`。右键由 Radix 原生处理，与 ReactFlow 左键拖拽不冲突。

### 文件变更

| 文件 | 变更 |
|------|------|
| `desktop/src/modules/workflow/editor/node-context-menu.tsx` | **新建**。封装节点右键菜单，接收选中节点列表、剪贴板状态、回调 |
| `desktop/src/modules/workflow/editor/node-wrappers.tsx` | 每个 wrapper 用 `NodeContextMenu` 包裹 |
| `desktop/src/modules/workflow/editor/canvas.tsx` | 增加剪贴板 ref、`copyNodes` / `pasteNodes` / `disconnectNodes` / `deleteNodes` 方法，通过 `WorkflowCanvasHandle` 暴露或直接作为 context |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | 传递 `requestRename` 回调，`NodeConfigPanel` 聚焦名称 input |

### 组件结构

```
NodeContextMenu (node-context-menu.tsx)
├── props: targetNodeId, selectedNodeIds, clipboard, onCopy, onPaste, onDisconnect, onDelete, onRename
├── 内部根据 selectedNodeIds 是否包含 targetNodeId 决定操作范围
├── 根据 isMultiSelect 显示/隐藏重命名
├── 根据 clipboard 是否为空 disable 粘贴
└── End 节点: 删除/复制项 disabled 或跳过
```

### 数据流

```
右键节点
  → ContextMenu 打开
  → 选择操作
  → 回调到 CanvasContent
  → setNodes / setEdges + onChange(newDef)
  → editor-app 收到新 definition
```

### 剪贴板结构

```typescript
interface NodeClipboard {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}
```

剪贴板通过 React Context 从 `CanvasContent` 传递到各 `NodeContextMenu` 实例。

## 不做的事

- 不做画布空白处右键菜单
- 不做连线右键菜单
- 不使用系统剪贴板（避免序列化和跨窗口复杂度）
- 不做撤销/重做（不在本次范围）
