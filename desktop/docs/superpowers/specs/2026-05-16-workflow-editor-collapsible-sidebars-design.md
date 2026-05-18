# 工作流编辑器侧边栏收起功能设计

## 概述

为工作流编辑器的左侧栏（NodePalette）和右侧栏（NodeConfigPanel）添加收起/展开能力，让用户在需要时获得全画布空间并减少视觉干扰。

## 设计决策

| 决策项 | 选择 |
|--------|------|
| 触发方式 | 边缘箭头按钮（无快捷键） |
| 按钮位置 | 侧边栏与画布交界处，距底边 100px |
| 收起状态 | 保留 32px 窄条 |
| 左右联动 | 完全独立 |
| 实现方式 | react-resizable-panels 原生 collapsible API |

## 布局结构

### 改造前

```
[NodePalette 固定 w-44] | [ResizablePanel: Canvas] | ResizableHandle | [ResizablePanel: ConfigPanel]
```

### 改造后

```
[ResizablePanel: NodePalette] | ResizableHandle | [ResizablePanel: Canvas] | ResizableHandle | [ResizablePanel: ConfigPanel]
```

左侧栏从固定宽度改为 ResizablePanel，与右侧栏对称。

## 面板参数

### 左侧栏（NodePalette）

- `defaultSize`: 176px
- `minSize`: 176px
- `maxSize`: 220px
- `collapsedSize`: 32px
- `collapsible`: true

### 右侧栏（NodeConfigPanel）

- `defaultSize`: 400px（保持不变）
- `minSize`: 300px（保持不变）
- `maxSize`: 600px（保持不变）
- `collapsedSize`: 32px
- `collapsible`: true

### 画布

- flex-1 自动填充剩余空间，无变化

## 交互细节

### 收起按钮

- 形状：圆形，20px 直径
- 样式：`bg-background border border-border` 与现有 ResizableHandle 风格一致
- 图标：chevron 箭头，指向收起方向（左栏用 `‹`，右栏用 `›`）
- 位置：绝对定位在 ResizableHandle 上，`bottom: 100px`
- hover 态：`bg-accent` 背景色变化

### 收起动画

- 使用 CSS transition：`flex-basis 200ms ease`
- react-resizable-panels 库内置支持，通过 panel 的 CSS transition 实现

### 收起后的窄条（32px）

- 显示内容：仅一个展开箭头按钮（距底边 100px）
- 箭头方向翻转：左栏收起后显示 `›`（点击展开），右栏收起后显示 `‹`
- 背景：`bg-muted` 与面板背景区分，提供视觉感知
- 无其他内容（不显示图标、文字或缩略信息）

### 状态持久化

- 不做持久化，每次打开编辑器默认展开状态
- 后续如有需要可通过 localStorage 保存

## 实现要点

### 使用 react-resizable-panels API

```tsx
// Panel ref 用于编程式控制
const leftPanelRef = useRef<ImperativePanelHandle>(null)
const rightPanelRef = useRef<ImperativePanelHandle>(null)

// 收起/展开
leftPanelRef.current?.collapse()
leftPanelRef.current?.expand()

// 监听状态变化
onCollapse={() => setLeftCollapsed(true)}
onExpand={() => setLeftCollapsed(false)}
```

### 收起按钮组件

抽取一个 `PanelCollapseButton` 组件：

- Props: `side: 'left' | 'right'`, `collapsed: boolean`, `onToggle: () => void`
- 绝对定位在 ResizableHandle 区域
- 根据 `side` 和 `collapsed` 决定箭头方向

### 左侧栏改造

NodePalette 当前是直接渲染的 div，需要：
1. 包裹进 ResizablePanel
2. 收起时隐藏内容，只显示窄条背景
3. 展开时恢复正常渲染

### 文件变更范围

| 文件 | 变更 |
|------|------|
| `src/modules/workflow/editor/editor-app.tsx` | 布局结构改造，添加左侧 ResizablePanel + Handle |
| `src/modules/workflow/editor/node-palette.tsx` | 适配收起状态（collapsed 时隐藏内容） |
| `src/modules/workflow/editor/node-config-panel.tsx` | 适配收起状态 |
| 新建 `src/modules/workflow/editor/panel-collapse-button.tsx` | 收起按钮组件 |

## 边界情况

- 收起右侧栏时如果正在编辑节点配置：保持编辑状态，展开后恢复
- 拖拽节点到画布时左栏收起：不影响，拖拽从画布开始
- 窗口缩小导致画布过窄：画布有最小宽度保护，不会被挤压到不可用
