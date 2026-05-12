# 工作流 DAG 实时运行状态可视化

## 概述

优化工作流编排的 Runner DAG 视图，让用户在运行时能直观感知每个节点的执行进度。核心改动：running 节点增加进度条动画、阶段文字、实时计时器；边在数据流过时播放光点过渡动画。

## 现状

- DAG 视图使用 `@xyflow/react`，节点状态通过 `RunnerNodeResultsContext` 传递
- Running 状态：`border-primary animate-pulse`（几乎看不出来）
- 事件系统：`node:started` / `node:completed` / `node:failed` / `node:skipped`
- 无中间阶段事件，无实时进度反馈

## 设计

### Running 节点

**进度条**
- 位置：节点卡片底部内侧，左右底部各留 8px/6px 缝隙
- 尺寸：高 3px，圆角 2px
- 轨道：`#27272a`
- 滑块：固定宽度 35%，渐变色 `#3b82f6 → #60a5fa → #93c5fd → #60a5fa → #3b82f6`（background-size: 200%）
- 移动动画：`translateX(-100%) → translateX(290%)`，1.8s 周期，`cubic-bezier(0.4, 0, 0.2, 1)`，infinite
- 流光动画：background-position 从 200% 到 -200%，3s 周期，linear
- 技术：使用 transform 实现 GPU 加速，`will-change: transform`

**阶段文字**
- 位置：节点标题下方一行，居中
- 样式：`text-muted-foreground text-xs`
- 内容来源：主进程执行器发出的 `node:progress` 事件
- Prompt 节点阶段序列：解析变量… → 构建提示词… → 调用模型… → 等待响应… → 处理输出…
- Switch 节点阶段序列：解析变量… → 评估条件… → 匹配分支…
- 快速阶段（<500ms）闪过即可，不做特殊处理

**计时器**
- 位置：节点卡片右上角
- 样式：`text-muted-foreground text-[10px] font-mono`
- 格式：`M:SS`（如 0:03, 1:24）
- 实现：`requestAnimationFrame` 或 1s interval，基于 `startedAt` 时间戳计算

### 边的状态

**光点过渡动画**
- 触发时机：节点 completed 事件到达时，对该节点的所有出边播放一次
- 光点：主体 r=4 `#60a5fa` opacity 0.9 + 光晕 r=7 `#3b82f6` opacity 0.3
- 运动：沿 edge path 从 source 到 target，0.8s，`cubic-bezier(0.4, 0, 0.2, 1)`
- 播放次数：一次，播完移除 DOM 元素

**边的静态状态**
- 数据已流过（source 节点 completed）：蓝色实线 `#3b82f6` opacity 0.6
- 未经过：灰色虚线 `#3f3f46` stroke-dasharray="4 4"
- 失败节点的出边：保持灰色虚线（数据未流过）

### 完成/失败节点

保持现有设计，不增加额外动画：
- Success：`border-primary` + 文字 "✓ 完成 · {duration}"
- Failed：`border-destructive` + 文字 "✗ 失败"
- Skipped：`opacity-40 border-dashed`

## 后端改动

### 新增事件：`node:progress`

```typescript
interface NodeProgressEvent {
  type: "node:progress"
  runId: string
  nodeId: string
  phase: string  // "resolving_variables" | "building_prompt" | "calling_model" | "awaiting_response" | "processing_output" | "evaluating_condition" | "matching_branch"
  label: string  // 用户可见文案："调用模型中…"
}
```

**发射位置：**
- `workflow-nodes/prompt/executor.main.ts`：在每个执行阶段开始时发射
- `workflow-nodes/switch/executor.main.ts`：在条件评估阶段发射
- End 节点不需要（瞬间完成）

**传递路径：**
- executor → workflow engine → IPC event → renderer `useWorkflowEvents` hook → `nodeResults` state

### NodeRunResult 扩展

```typescript
interface NodeRunResult {
  // ...existing fields
  progressLabel?: string  // 当前阶段文案，running 时有值
}
```

## 前端改动

### 文件清单

| 文件 | 改动 |
|------|------|
| `src/modules/workflow/runner/runner-node-wrappers.tsx` | 读取 progressLabel，渲染阶段文字 + 计时器 + 进度条 |
| `src/modules/workflow/runner/dag-view.tsx` | 边的状态样式 + 光点动画触发 |
| `src/modules/workflow/hooks/use-workflow-events.ts` | 处理 `node:progress` 事件，更新 progressLabel |
| `src/types/workflow.ts` | 扩展 NodeRunResult、新增 NodeProgressEvent 类型 |
| `workflow-nodes/prompt/executor.main.ts` | 发射 progress 事件 |
| `workflow-nodes/switch/executor.main.ts` | 发射 progress 事件 |
| `electron/ipc/workflow.ts` 或引擎层 | 转发 progress 事件到 renderer |

### 进度条组件

新建 `src/modules/workflow/runner/node-progress-bar.tsx`，纯 CSS 动画组件，running 时渲染，其他状态不渲染。

### 边光点动画

在 `dag-view.tsx` 中监听 nodeResults 变化，当节点从 running → success 时，获取该节点的出边 path，创建 SVG animate 元素播放一次后移除。可用 `@xyflow/react` 的 `useEdges` + `getEdgePath` 获取路径。

## 不做的事

- 不改变节点的尺寸或布局
- 不加完成/失败的过渡动画
- 不做进度百分比（无法预估 LLM 响应时间）
- 不改 timeline 视图（本次只改 DAG 视图）
