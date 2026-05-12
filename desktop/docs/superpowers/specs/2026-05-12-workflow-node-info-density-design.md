# 流程编排节点信息密度优化

日期：2026-05-12

## 目标

在流程编排的节点图上展示更丰富的信息，让用户不需要点开配置面板就能了解每个节点在做什么。

## 改动范围

### 1. 侧边栏节点面板（Node Palette）显示图标

**现状：** `node-palette.tsx` 只显示 `manifest.title` 文字。

**目标：** 每个节点类型前显示对应的 Lucide 图标，与画布上节点卡片左上角的图标一致。

**实现：**

- `NodeManifest.icon` 字段类型从 `string` 改为 `LucideIcon`（即 `React.ComponentType<LucideProps>`）
- 各 manifest 文件直接 import 并 export Lucide 组件：
  - prompt → `MessageSquare`
  - switch → `GitBranch`
  - end → `LogOut`
- `node-palette.tsx` 通过 `manifest.icon` 直接渲染：`<manifest.icon className="h-3.5 w-3.5" />`
- 各 card 组件不再自行 import 图标，改为从 manifest 取（保证单一来源）

**影响文件：**
- `workflow-nodes/types.ts` — icon 类型定义
- `workflow-nodes/prompt/manifest.ts`
- `workflow-nodes/switch/manifest.ts`
- `workflow-nodes/end/manifest.ts`
- `workflow-nodes/prompt/card.tsx`
- `workflow-nodes/switch/card.tsx`
- `workflow-nodes/end/card.tsx`
- `src/modules/workflow/editor/node-palette.tsx`

### 2. Agent 选择下拉菜单显示图标

**现状：** `prompt/panel.tsx` 的 Agent Select 只显示 `def.label` 文字。

**目标：** 下拉菜单每个选项前显示 Agent 的 icon.png，选中后 trigger 也显示图标。

**实现：**

- 新建 `workflow-nodes/agent-icon.tsx`，照搬 `src/components/editor-icon.tsx` 模式：
  - 接收 `agentId: string` + `className?: string`
  - 从 `agentDefinitions` 查找对应的 `icon` URL
  - 渲染 `<img>` + `clipPath: "inset(6%)"` 裁掉透明边距
  - 默认尺寸 `size-4`（16px）
- `prompt/panel.tsx` 的 SelectItem 内加 `<AgentIcon />` + label
- `switch/panel.tsx` 同理

**影响文件：**
- `workflow-nodes/agent-icon.tsx`（新建）
- `workflow-nodes/prompt/panel.tsx`
- `workflow-nodes/switch/panel.tsx`

### 3. 节点卡片显示 Agent 图标 + Prompt 预览

**现状：** Prompt 卡片两行——类型图标+名称、agent ID 或 prompt 片段（二选一）。

**目标：** 三行布局：
1. 节点类型图标 + 节点名称
2. Agent 图标（16px）+ Agent label
3. Prompt 内容预览（单行截断 + ellipsis）

**实现：**

- `prompt/card.tsx` 改为三行结构：
  - 第一行：`<manifest.icon />` + `name`（font-medium）
  - 第二行：`<AgentIcon agentId={config.agent} />` + agent label（从 agentDefinitions 查）
  - 第三行：`<p className="truncate opacity-70">{config.prompt}</p>`
  - 未选 Agent 时第二行显示 "未选择 Agent"（text-muted-foreground）
  - prompt 为空时第三行显示 "无 Prompt"
- `switch/card.tsx` header 区域同理增加 Agent 图标行
- `end/card.tsx` 无 Agent 概念，保持现状
- 卡片宽度从 `w-52`（208px）微调为 `w-56`（224px）以容纳三行信息

**影响文件：**
- `workflow-nodes/prompt/card.tsx`
- `workflow-nodes/switch/card.tsx`

### 4. Agent label 查找工具

**实现：**

- 在 `workflow-nodes/agent-icon.tsx` 同文件或独立 `workflow-nodes/agent-utils.ts` 中导出 `getAgentLabel(agentId: string): string`
- 从 `agentDefinitions` 查找，找不到时 fallback 返回 agentId 本身

**影响文件：**
- `workflow-nodes/agent-icon.tsx` 或 `workflow-nodes/agent-utils.ts`（新建）

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| manifest icon 类型 | LucideIcon 组件 | 节点类型固定且少，直接 export 组件最简洁，避免运行时字符串映射 |
| Agent 图标裁切 | clipPath inset(6%) | 与现有 EditorIcon 模式一致，处理 icon.png 的透明边距 |
| 卡片布局 | 方案 B（双图标共存） | 保留节点类型快速识别能力，同时展示 Agent 信息 |
| prompt 预览 | 单行 truncate | 信息密度够用，不占过多垂直空间 |
| 图标来源 | manifest 集中定义 | 单一来源，palette 和 card 不重复定义 |

## 不做的事

- 不支持用户自定义节点图标
- 不改变节点卡片的整体尺寸风格（保持 shadow-sm、rounded-lg）
- 不改变 End 节点的布局（它没有 Agent）
- 不改变 runner 视图的节点渲染（runner wrappers 复用同一 card 组件，自动生效）

## 验证标准

- 侧边栏拖拽节点时能看到图标，与画布上卡片图标一致
- Agent 下拉菜单每项有图标，选中后 trigger 显示图标
- 节点卡片三行信息完整：名称、Agent（带图标）、prompt 预览
- 画布缩小时节点类型仍可通过图标快速区分
