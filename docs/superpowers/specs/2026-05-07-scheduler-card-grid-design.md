# 定时任务列表页卡片网格重构设计

## 概述

将定时任务列表页从表格布局重构为卡片网格布局，提升视觉轻量感和信息可读性。

## 布局结构

### 页面骨架

```
┌─────────────────────────────────────────────────┐
│ [Search]                [Import] [Export] [+ New]│  ← 工具栏（保持不变）
├─────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│ │  Card 1  │ │  Card 2  │ │  Card 3  │         │  ← 3 列网格
│ └──────────┘ └──────────┘ └──────────┘         │
│ ┌──────────┐ ┌──────────┐                       │
│ │  Card 4  │ │  Card 5  │                       │
│ └──────────┘ └──────────┘                       │
└─────────────────────────────────────────────────┘
```

### 网格规格

- 布局：`grid grid-cols-3 gap-3`
- 与内容模块（Rules/Skills/Prompts）的 `gap-3` 保持一致
- 容器背景：`bg-muted/30`（与当前页面一致）

## 卡片设计

### 结构

```
┌────────────────────────────────┐
│ ● Task Name                    │  ← 标题行：状态圆点 + 名称
│                                │
│ Trigger        0 2 * * *       │  ← 信息区：label-value 对齐
│ Last Run       Today 02:00     │
│ Next Run       Tomorrow 02:00  │
│                                │
│ ─────────────────────────────  │  ← 分隔线
│ [▶] [Switch]           [•••]  │  ← 操作栏
└────────────────────────────────┘
```

### 样式规格

- 卡片：`rounded-lg bg-background px-4 py-4`，无边框
- Hover：`hover:ring-2 hover:ring-muted-foreground/25 transition-shadow`
- 标题：`text-sm font-medium`
- 信息标签：`text-xs text-muted-foreground`
- 信息值：`text-xs text-foreground`
- 分隔线：`border-t border-border` 或极浅的 `border-muted`

### 状态圆点

标题行左侧 8px 圆点，颜色映射：

| 状态 | 颜色 | 说明 |
|------|------|------|
| idle (成功) | `bg-green-500` | 上次运行成功，等待下次 |
| running | `bg-blue-500` + pulse 动画 | 正在执行中 |
| error | `bg-destructive` | 上次运行失败 |
| disabled | `bg-muted-foreground` | 任务已禁用 |

### 禁用态

- 整卡 `opacity-60`
- 运行按钮 disabled
- 开关处于关闭状态
- Next Run 显示 "—"

### 运行中态

- 圆点蓝色 + `animate-pulse`
- 信息区显示 "Status: Running..." 和 "Started: HH:MM" 替代 Last Run / Next Run
- 运行按钮变为停止按钮（方块图标，红色）

## 操作栏设计

### 左侧高频操作

1. **运行/停止按钮**：`Button variant="ghost" size="icon"`
   - 空闲态：Play 图标，点击手动触发
   - 运行中：Square 图标（红色），点击停止
   - 禁用态：Play 图标，disabled
2. **启用开关**：`Switch` 组件，控制任务启用/禁用

### 右侧更多菜单

`DropdownMenu` 触发器为 `MoreHorizontal` 图标按钮，菜单项：

- Edit（编辑）— 打开 TaskFormDialog
- History（运行历史）— 打开 TaskRunsDialog
- Separator
- Delete（删除）— 打开确认 AlertDialog，destructive 样式

## 空状态

保持现有 `<Empty>` 组件不变，居中显示在网格区域。

## 组件拆分

```
task-scheduler/
├── index.tsx                    ← 页面入口（工具栏 + 网格容器 + 对话框）
├── components/
│   ├── task-card.tsx            ← 单张任务卡片
│   ├── task-card-grid.tsx       ← 网格容器（处理空状态）
│   ├── task-form-dialog.tsx     ← 保持不变
│   ├── task-export-dialog.tsx   ← 保持不变
│   ├── task-import-dialog.tsx   ← 保持不变
│   └── task-runs-dialog.tsx     ← 保持不变
```

### task-card.tsx 职责

- 接收 `ScheduledTask` 数据
- 渲染卡片结构（标题、信息、操作栏）
- 处理运行/停止、启用/禁用的交互回调
- 更多菜单的展开与操作分发

### task-card-grid.tsx 职责

- 接收任务列表
- 渲染 3 列网格或空状态
- 不包含业务逻辑

## 不变的部分

- 工具栏（搜索、导入、导出、新建按钮）保持现有实现
- 所有对话框组件（表单、导出、导入、运行历史）保持不变
- hooks 层（`use-task-scheduler`）保持不变
- 类型定义保持不变
