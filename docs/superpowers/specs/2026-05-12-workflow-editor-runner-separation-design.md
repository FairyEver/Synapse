# Workflow Editor / Runner 分离设计

## 概述

将工作流的编辑和运行彻底拆为两个独立窗口，互无逻辑依赖。编辑器只负责编辑和保存，Runner 只负责执行查看。两者可互相跳转，但不共享运行时状态。

## 核心原则

- 编辑界面没有运行功能
- 运行界面没有编辑功能
- 可以不编辑直接运行，也可以不运行直接编辑
- 编辑器「运行」按钮不保存，直接把内存中的 definition 发给引擎执行

## 架构

### 两个独立 BrowserWindow

| | 编辑器 (Editor) | 运行器 (Runner) |
|---|---|---|
| 入口 | `editor-app.tsx` | `runner-app.tsx`（新建） |
| 画布 | 可编辑 ReactFlow（拖拽、连线、添加节点） | 只读 ReactFlow（可缩放/平移，不可编辑） |
| 视图 | Canvas + NodePalette + NodeConfigPanel | DAG 只读视图 ↔ 时间线视图（可切换） |
| 工具栏 | 名称/描述/参数编辑、保存、运行（→跳 Runner） | 状态徽章、取消、重新运行、编辑（→跳 Editor） |
| 运行状态 | 无（不管理 runState/nodeResults） | 完整管理（useWorkflowRun + useWorkflowEvents） |
| 窗口数量 | 每个 workflowId 最多 1 个 | 每个 workflowId 最多 1 个（重新运行复用窗口） |
| 窗口标题 | `编辑 - {name}` | `运行 - {name} [{状态}]`（状态实时更新） |

### 共享层

两个窗口都使用：

- `src/types/workflow.ts` — 所有类型定义
- `hooks/use-workflow-events.ts` — 事件订阅
- `hooks/use-workflow-run.ts` — 运行状态管理
- `components/run-params-dialog.tsx` — 运行参数表单

### 归属划分

编辑器独占：canvas.tsx、node-palette、node-config-panel、params-editor-dialog、canvas-context、node-context-menu、custom-edge、node-wrappers、use-upstream-nodes

Runner 独占（全部新建）：runner-app、runner-toolbar、dag-view、timeline-view、node-result-panel、runner-node-wrappers

## 目录结构

```
desktop/src/modules/workflow/
├── index.tsx                            # 列表页入口
├── components/
│   ├── workflow-card.tsx                 # 卡片（编辑/运行/历史三入口）
│   ├── workflow-list.tsx                 # 列表
│   ├── run-params-dialog.tsx             # 共享：运行参数表单
│   ├── run-history-dialog.tsx            # 新建：历史运行记录 Dialog
│   └── params-editor-dialog.tsx          # Editor 独占：参数定义编辑
├── editor/
│   ├── editor-app.tsx                    # 重构：移除所有运行状态
│   ├── toolbar.tsx                       # 重构：无状态工具栏
│   ├── canvas.tsx                        # 不变
│   ├── node-palette.tsx                  # 不变
│   ├── node-config-panel.tsx             # 不变
│   ├── node-wrappers.tsx                 # 不变
│   ├── node-context-menu.tsx             # 不变
│   ├── custom-edge.tsx                   # 不变
│   └── canvas-context.ts                # 不变
├── runner/                              # 全部新建
│   ├── runner-app.tsx                    # Runner 入口
│   ├── runner-toolbar.tsx                # 状态/取消/重运行/编辑/视图切换
│   ├── dag-view.tsx                      # 只读 ReactFlow DAG
│   ├── timeline-view.tsx                 # 线性执行时间线（带并行分组）
│   ├── node-result-panel.tsx             # 节点结果详情面板
│   └── runner-node-wrappers.tsx          # 只读节点渲染器
├── hooks/
│   ├── use-workflow-events.ts            # 共享
│   ├── use-workflow-run.ts               # 共享
│   ├── use-workflow-list.ts              # 列表页
│   └── use-upstream-nodes.ts             # Editor 独占
```

Electron 侧：

```
desktop/electron/
├── services/workflow/
│   ├── workflow-service.ts               # 不变
│   ├── workflow-engine.ts                # 不变
│   ├── workflow-validator.ts             # 不变
│   └── window-manager.ts                # 重构：管理 editor + runner 两类窗口
├── modules/workflow/
│   └── ipc.ts                           # 新增 runDefinition / openRunner / rerun 通道
```

## 数据流

### 编辑器发起运行

```
Editor「运行」按钮
  → 如有参数：弹 RunParamsDialog
  → IPC: workflow.runDefinition(definition, params)
      → 主进程 Engine.run(def, params, runId, emit)  // 不写磁盘
      → 返回 { runId }
  → IPC: workflow.openRunner(workflowId, runId)
      → 主进程打开/聚焦 Runner BrowserWindow
```

编辑器的「运行」不保存。运行引擎接收完整的内存 definition，不依赖磁盘版本。类似 VS Code "Run without Save"。

### 列表页发起运行

```
List「运行」按钮
  → 如有参数：弹 RunParamsDialog
  → IPC: workflow.run(workflowId, params)     // 从磁盘读 def
      → 主进程读 def → Engine.run(...)
      → 返回 { runId }
  → IPC: workflow.openRunner(workflowId, runId)
```

### Runner 重新运行

```
Runner「重新运行」按钮
  → 弹 RunParamsDialog（预填上次使用的参数值）
  → IPC: workflow.rerun(previousRunId, params)
      → 主进程从 RunStatus 取上次使用的 definition
      → Engine.run(def, params, newRunId, emit)
      → 返回 { runId: newRunId }
  → Runner 切换到 newRunId，重置视图
```

### Runner 订阅事件

```
Runner 打开时
  → IPC: workflow.runStatus(runId)
      → 返回 { status, nodeResults, definition }  // definition 新增字段
  → 渲染 DAG 只读视图 / 时间线视图
  → 订阅 workflow.onEvent 实时更新
```

## IPC 通道变更

### 新增

| 通道 | 类型 | 描述 |
|---|---|---|
| `workflow:run-definition` | invoke | 接收完整 definition + params，不走磁盘。返回 `{ runId }` 或 `{ errors }` |
| `workflow:rerun` | invoke | 接收 previousRunId + params，用上次 def 重新执行。返回 `{ runId }` |
| `workflow:open-runner` | invoke | 打开/聚焦 Runner 窗口，传入 workflowId + runId |

### 修改

| 通道 | 变更 |
|---|---|
| `workflow:run-status` | 返回值新增 `definition` 字段（本次 run 使用的 definition 快照） |

### 不变

`workflow:run`（列表页用，从磁盘读）、`workflow:open-editor`、`workflow:save`、`workflow:list`、`workflow:get`、`workflow:delete`、`workflow:cancel`、`workflow:run-history`、`workflow:run-snapshot`、`workflow:event` 等。

## Editor 改动

### editor-app.tsx 移除

- `useWorkflowRun` / `useWorkflowEvents` hooks
- `runState` / `nodeResults` / `runError` / `viewingNodeId` 状态
- `ExecutionOverlay` 组件
- `runIdRef` / `attachRun` 逻辑
- `workflow:started` 事件监听
- `execution-overlay.tsx` import

### editor-app.tsx 保留

- definition 加载与编辑
- canvas 交互（拖拽、连线、删除、复制粘贴）
- node config panel
- dirty tracking + 关闭确认对话框
- 保存逻辑

### editor-app.tsx 新增

```typescript
const handleRun = async (params: Record<string, unknown>) => {
  const def = definitionRef.current
  if (!def) return
  const result = await window.synapse?.workflow.runDefinition(def, params)
  if (!result || "errors" in result) {
    // 在编辑器内以 Alert 形式展示校验错误
    setRunErrors(result?.errors ?? [])
    return
  }
  void window.synapse?.workflow.openRunner(def.id, result.runId)
}
```

### toolbar.tsx 变化

移除：`runState` prop、停止/返回编辑按钮

保留：名称/描述输入、参数编辑按钮、保存按钮

变更：「运行」按钮语义变为"发到 Runner 窗口执行"

工具栏变为无状态——任何时候看到的按钮都完全一样，不存在模式切换。

```
┌────────────────────────────────────────────────────────┐
│ [名称________] [描述（可选）____]   [参数] [保存] [▶运行] │
└────────────────────────────────────────────────────────┘
```

## Runner 窗口设计

### 整体布局：左右分栏

```
┌──────────────────────────────────────────────────────┐
│  运行 - 我的工作流 [执行中]                   ─ □ ✕  │
├──────────────────────────────────────────────────────┤
│ [⟲重新运行] [■取消] [✎编辑]      [DAG] [时间线]     │
├──────────────────────────────────┬───────────────────┤
│                                  │                   │
│     DAG 只读视图                 │  节点结果         │
│     或                           │  详情面板         │
│     时间线视图                   │                   │
│                                  │  (点击节点后      │
│     （主区域）                   │   显示详情)       │
│                                  │                   │
├──────────────────────────────────┴───────────────────┤
│ ● 3/5 节点完成  耗时 4.2s                  运行于 9:30│
└──────────────────────────────────────────────────────┘
```

左侧大区域：DAG 或时间线（工具栏 tab 切换）。右侧面板：节点详情（两个视图共享同一面板）。底部状态栏：总体进度摘要。

### runner-app.tsx

- URL 参数：`?runId=xxx`（必需）
- 启动时通过 `runStatus(runId)` 获取 definition + 当前状态
- 两个视图 tab：DAG / 时间线
- 状态管理：复用 `useWorkflowRun` + `useWorkflowEvents`

### runner-toolbar.tsx

根据运行状态动态显示按钮：

- 运行中：`[■取消]` `[✎编辑]` `[DAG|时间线]`
- 已完成/失败/取消：`[⟲重新运行]` `[✎编辑]` `[DAG|时间线]`
- 历史查看模式：隐藏取消按钮，显示「运行于 xx:xx」时间戳

「编辑」按钮：打开/聚焦该工作流的编辑器窗口（如已打开，直接 bring to front）。

「重新运行」按钮：用上次 run 使用的同一个 definition 重新执行。弹参数对话框预填上次参数值。

### DAG 只读视图 (dag-view.tsx)

ReactFlow 配置：

```
nodesDraggable={false}
nodesConnectable={false}
elementsSelectable={true}
panOnDrag={true}
zoomOnScroll={true}
selectionOnDrag={false}
deleteKeyCode={null}
fitView
```

- 无网格背景（纯色），与编辑器的网格点阵形成视觉区分
- 无 NodePalette
- 无 context menu
- 节点可点击 → 右侧面板显示运行结果
- 缩放控件（zoom in/out/fit）保留

### 时间线视图 (timeline-view.tsx)

按执行顺序的线性列表，支持并行分组：

- 同一拓扑层级的节点用左侧竖线分组包裹
- 每条：开始时间 | 节点名 | 类型 badge | 状态图标 | 耗时
- 可点击 → 右侧面板显示详情
- 正在执行的节点有脉冲动画 + 自动滚动到可视区域
- 跳过/等待节点灰色低饱和度

```
09:30:01  ✅ 节点 A        1.2s
          ┃
09:30:02  ┃ ✅ 节点 B    0.8s     ← 并行分组
09:30:03  ┃ ✅ 节点 C    1.5s
          ┃
09:30:04  ✅ 节点 D        0.3s
```

### 节点结果详情面板 (node-result-panel.tsx)

DAG 视图和时间线视图共用同一个右侧面板。未选中节点时显示空态「点击节点查看详情」。

面板内容（按条件显示）：

1. 标题区：节点名 + 类型 + 状态 badge + 耗时
2. 输入变量：key-value 列表
3. 完整 Prompt：可折叠预格式化文本（长文本默认折叠到 5 行）
4. 输出：可折叠预格式化文本
5. 激活分支（仅 switch 节点）
6. 错误信息（仅失败时，destructive 色）

## 列表页改动

### workflow-card.tsx

三入口卡片：

- **双击卡片** → 打开编辑器
- **▶ 运行** → 弹参数对话框（如有参数）→ 发起运行 → 打开 Runner
- **📋 历史** → 弹出 History Dialog
- **🗑 删除** → 确认对话框 → 删除 + 自动关闭相关窗口

### run-history-dialog.tsx（新建）

Dialog 弹窗展示历史运行列表：

- 每条：状态图标 + 日期时间 + 耗时
- 显示最近 20 条运行记录
- 点击某条 → 打开 Runner 窗口查看该 run
- 无运行记录时显示空态

### workflow-list.tsx

运行后不再 `openEditor(id, runId)`，改为 `openRunner(id, runId)`。

## 用户场景决策

### 编辑器连续多次运行

复用 Runner 窗口，切换到新 runId。如果旧 run 还在执行中，弹确认框：「有正在执行的运行，是否取消并启动新运行？」

### 编辑器是否感知运行状态

不感知。编辑器完全不订阅运行事件，彻底解耦。

### 删除工作流时有窗口打开

自动关闭该工作流的所有编辑器 + Runner 窗口。

### 历史查看 vs 实时运行

Runner 根据 run 状态自适应：
- 实时运行：显示取消按钮，节点有实时动画
- 历史查看：隐藏取消按钮，显示「运行于 xx:xx」时间戳

### Runner → Editor 跳转

直接聚焦已有编辑器窗口，保持编辑器当前状态不变（包括未保存的修改）。

### 校验错误

在编辑器内以 Alert 形式展示校验错误，不打开 Runner 窗口。

## 视觉区分

### Editor vs Runner 画布

| 特征 | 编辑器 | Runner |
|---|---|---|
| 画布背景 | 网格点阵（ReactFlow 默认） | 纯色/无网格 |
| NodePalette | 有（左侧） | 无 |
| 右侧面板 | 节点配置编辑 | 节点运行结果 |
| 工具栏 | 编辑操作为主 | 运行控制为主 |
| 节点外观 | 中性色，可选中拖拽 | 带状态色边框/背景 |
| 连线 | 可操作（连接/删除） | 只读，带激活色 |
| 鼠标光标 | 画布上 grab，节点上 move | 画布上 grab，节点上 pointer |

### Runner 画布交互

| 操作 | 支持 |
|---|---|
| 平移画布 | ✅ 拖拽/滚轮 |
| 缩放 | ✅ 滚轮/controls |
| 适应视图 | ✅ fitView |
| 选中节点 | ✅ 单击 → 右侧面板 |
| 拖拽节点位置 | ❌ |
| 连线 | ❌ |
| 删除 | ❌ |
| 拖入新节点 | ❌ |
| 右键菜单 | ❌ |
| 框选 | ❌ |

### 节点状态颜色/图标体系

统一所有视图使用同一套视觉语言：

| 状态 | 图标 | 颜色 token | DAG 节点样式 |
|---|---|---|---|
| 等待 | ○ | `text-muted-foreground` | 虚线边框，低饱和度 |
| 运行中 | ◌ | `text-primary` + 脉冲动画 | primary 色实线边框 + 脉冲 |
| 成功 | ● | success 绿 | success 色左边框 |
| 失败 | ✕ | `text-destructive` | destructive 色左边框 |
| 跳过 | ⊘ | `text-muted-foreground` | 灰色，半透明 |
| 取消 | ◻ | `text-muted-foreground` | 灰色 |

### 边状态

| 状态 | 样式 |
|---|---|
| 已激活 | primary 色实线 |
| 未激活 | muted 色虚线 |

## Electron 层改动

### WorkflowWindowManager

从管理单一窗口类型改为管理两类窗口：

- `editorWindows: Map<workflowId, BrowserWindow>`（现有）
- `runnerWindows: Map<workflowId, BrowserWindow>`（新增）

两类窗口独立管理，各自每个 workflowId 最多 1 个。

`open(type, workflowId, ...)` — 如果目标窗口已存在，bring to front 并更新参数（如 runId）。

### 删除时关闭窗口

`WorkflowService.delete(id)` 后，调用 `WindowManager.closeAll(workflowId)` 关闭该工作流的所有编辑器和 Runner 窗口。

### RunStatus 存储 definition

`WorkflowRunStatus` 新增 `definition` 字段。引擎启动 run 时将使用的 definition 快照存入 RunStatus，Runner 从 `runStatus(runId)` 获取。

### RunSnapshot 存储 definition

`WorkflowRunSnapshot`（磁盘持久化）同样存储实际执行用的 definition 快照，确保历史回看时数据自洽（即使原 definition 未保存或已修改）。
