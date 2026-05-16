# 工作流编辑器侧边栏收起功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为工作流编辑器左右侧边栏添加收起/展开按钮，收起后保留 32px 窄条。

**Architecture:** 利用 react-resizable-panels 原生 `collapsible` + `collapsedSize` API，将左侧栏从固定宽度改为 ResizablePanel，新建 PanelCollapseButton 组件放置在 ResizableHandle 区域。

**Tech Stack:** React 19, react-resizable-panels v4, Tailwind CSS 4, lucide-react

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/modules/workflow/editor/panel-collapse-button.tsx` | 收起/展开按钮组件（新建） |
| `src/modules/workflow/editor/editor-app.tsx` | 布局结构改造 |
| `src/modules/workflow/editor/node-palette.tsx` | 适配 collapsed prop |
| `src/modules/workflow/editor/node-config-panel.tsx` | 适配 collapsed prop |

---

### Task 1: 创建 PanelCollapseButton 组件

**Files:**
- Create: `src/modules/workflow/editor/panel-collapse-button.tsx`

- [ ] **Step 1: 创建组件文件**

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface PanelCollapseButtonProps {
  side: "left" | "right"
  collapsed: boolean
  onToggle: () => void
}

export function PanelCollapseButton({ side, collapsed, onToggle }: PanelCollapseButtonProps) {
  const showExpand = collapsed
  const Icon = side === "left"
    ? (showExpand ? ChevronRight : ChevronLeft)
    : (showExpand ? ChevronLeft : ChevronRight)

  return (
    <button
      onClick={onToggle}
      className={cn(
        "absolute z-10 flex h-5 w-5 items-center justify-center rounded-full",
        "border border-border bg-background hover:bg-accent",
        "transition-colors",
        side === "left" ? "-right-2.5" : "-left-2.5",
        "bottom-[100px]"
      )}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/workflow/editor/panel-collapse-button.tsx
git commit -m "feat(workflow): add PanelCollapseButton component"
```

---

### Task 2: 改造 editor-app.tsx 布局结构

**Files:**
- Modify: `src/modules/workflow/editor/editor-app.tsx:1-20` (imports)
- Modify: `src/modules/workflow/editor/editor-app.tsx:380-409` (layout)

- [ ] **Step 1: 添加 imports 和 state**

在 editor-app.tsx 顶部添加 import：

```tsx
import { type PanelImperativeHandle } from "react-resizable-panels"
import { PanelCollapseButton } from "./panel-collapse-button"
```

在 `WorkflowEditorApp` 组件内（`canvasRef` 附近）添加：

```tsx
const leftPanelRef = useRef<PanelImperativeHandle>(null)
const rightPanelRef = useRef<PanelImperativeHandle>(null)
const [leftCollapsed, setLeftCollapsed] = useState(false)
const [rightCollapsed, setRightCollapsed] = useState(false)
```

- [ ] **Step 2: 改造布局结构**

将当前的布局区域（约 line 380-409）：

```tsx
<div className="flex-1 flex min-h-0">
  <NodePalette />
  <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
    <ResizablePanel>
      <div className="relative h-full">
        <WorkflowCanvas ... />
        <CanvasFloatingToolbar ... />
      </div>
    </ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel
      defaultSize={400}
      minSize={300}
      maxSize={600}
      groupResizeBehavior="preserve-pixel-size"
    >
      <NodeConfigPanel ... />
    </ResizablePanel>
  </ResizablePanelGroup>
</div>
```

替换为：

```tsx
<ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
  <ResizablePanel
    id="node-palette"
    panelRef={leftPanelRef}
    defaultSize={176}
    minSize={176}
    maxSize={220}
    collapsedSize={32}
    collapsible
    groupResizeBehavior="preserve-pixel-size"
    onResize={(size) => {
      setLeftCollapsed(size.inPixels <= 32)
    }}
  >
    <NodePalette collapsed={leftCollapsed} />
  </ResizablePanel>
  <ResizableHandle withHandle className="relative">
    <PanelCollapseButton
      side="left"
      collapsed={leftCollapsed}
      onToggle={() => {
        if (leftCollapsed) {
          leftPanelRef.current?.expand()
        } else {
          leftPanelRef.current?.collapse()
        }
      }}
    />
  </ResizableHandle>
  <ResizablePanel>
    <div className="relative h-full">
      <WorkflowCanvas ref={canvasRef} definition={definition} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
      <CanvasFloatingToolbar definition={definition} saving={saving} running={running} dirty={dirty} onSave={handleSave} onRun={handleRun} />
    </div>
  </ResizablePanel>
  <ResizableHandle withHandle className="relative">
    <PanelCollapseButton
      side="right"
      collapsed={rightCollapsed}
      onToggle={() => {
        if (rightCollapsed) {
          rightPanelRef.current?.expand()
        } else {
          rightPanelRef.current?.collapse()
        }
      }}
    />
  </ResizableHandle>
  <ResizablePanel
    id="node-config"
    panelRef={rightPanelRef}
    defaultSize={400}
    minSize={300}
    maxSize={600}
    collapsedSize={32}
    collapsible
    groupResizeBehavior="preserve-pixel-size"
    onResize={(size) => {
      setRightCollapsed(size.inPixels <= 32)
    }}
  >
    <NodeConfigPanel
      collapsed={rightCollapsed}
      nodeId={selectedNodeId}
      definition={definition}
      onConfigChange={handleConfigChange}
      onNameChange={handleNameChange}
      onDeleteNode={(id) => { canvasRef.current?.deleteNodes([id]); setSelectedNodeId(null) }}
      onCopyNode={(id) => canvasRef.current?.copyNodes([id])}
      renameSignal={renameSignal}
      projects={projects}
      defaultProjectName={defaultProjectName}
      onDefinitionChange={handleDefinitionChange}
    />
  </ResizablePanel>
</ResizablePanelGroup>
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `pnpm tsc --noEmit --project desktop/tsconfig.json 2>&1 | head -30`
Expected: 类型错误（NodePalette 和 NodeConfigPanel 还没接受 collapsed prop），这是预期的

- [ ] **Step 4: Commit**

```bash
git add src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow): restructure editor layout with collapsible panels"
```

---

### Task 3: 改造 NodePalette 接受 collapsed prop

**Files:**
- Modify: `src/modules/workflow/editor/node-palette.tsx`

- [ ] **Step 1: 添加 collapsed prop 并适配渲染**

将 node-palette.tsx 完整替换为：

```tsx
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"

interface NodePaletteProps {
  collapsed?: boolean
}

export function NodePalette({ collapsed }: NodePaletteProps) {
  const types = nodeTypeRegistry.listTypes().filter((t) => t !== "end")

  if (collapsed) {
    return <div className="h-full bg-muted" />
  }

  return (
    <div className="h-full border-r bg-background flex flex-col gap-1 p-2">
      <p className="text-xs font-medium text-muted-foreground px-1 pb-1">节点</p>
      {types.map((type) => {
        const manifest = nodeTypeRegistry.getManifest(type)
        const Icon = manifest.icon
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-grab hover:bg-muted active:cursor-grabbing"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{manifest.title}</span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/workflow/editor/node-palette.tsx
git commit -m "feat(workflow): NodePalette supports collapsed state"
```

---

### Task 4: 改造 NodeConfigPanel 接受 collapsed prop

**Files:**
- Modify: `src/modules/workflow/editor/node-config-panel.tsx:20-33` (interface + component signature)

- [ ] **Step 1: 添加 collapsed prop 到 interface**

在 `NodeConfigPanelProps` interface 中添加：

```tsx
collapsed?: boolean
```

- [ ] **Step 2: 在组件开头添加 collapsed 渲染分支**

在 `export function NodeConfigPanel` 的解构参数中添加 `collapsed`，然后在组件体最前面（`const node = ...` 之前）添加：

```tsx
if (collapsed) {
  return <div className="h-full bg-muted" />
}
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

Run: `pnpm tsc --noEmit --project desktop/tsconfig.json 2>&1 | head -20`
Expected: PASS（无错误）

- [ ] **Step 4: Commit**

```bash
git add src/modules/workflow/editor/node-config-panel.tsx
git commit -m "feat(workflow): NodeConfigPanel supports collapsed state"
```

---

### Task 5: 添加收起动画 transition

**Files:**
- Modify: `src/modules/workflow/editor/editor-app.tsx` (ResizablePanelGroup 添加 CSS)

- [ ] **Step 1: 为面板添加 transition 样式**

在 `ResizablePanelGroup` 上添加 `className` 使面板支持动画。react-resizable-panels 通过内联 `flex-basis` 控制尺寸，需要在面板的 style 或 className 中添加 transition。

在两个 collapsible 的 `ResizablePanel` 上添加 `style` prop：

```tsx
// 左侧栏 ResizablePanel
style={{ transition: "flex-basis 200ms ease" }}

// 右侧栏 ResizablePanel
style={{ transition: "flex-basis 200ms ease" }}
```

- [ ] **Step 2: 验证开发服务器中动画效果**

Run: `pnpm dev`（如果未运行）
在浏览器中打开工作流编辑器，点击收起按钮验证：
- 面板平滑收起到 32px 窄条
- 窄条显示 bg-muted 背景
- 展开按钮在正确位置（距底边 100px）
- 点击展开按钮恢复面板

- [ ] **Step 3: Commit**

```bash
git add src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow): add collapse/expand transition animation"
```

---

### Task 6: 最终验证与清理

- [ ] **Step 1: TypeScript 编译检查**

Run: `pnpm tsc --noEmit --project desktop/tsconfig.json`
Expected: PASS

- [ ] **Step 2: 功能验证清单**

在开发服务器中验证：
- 左侧栏收起按钮位置正确（距底边 100px）
- 右侧栏收起按钮位置正确（距底边 100px）
- 左侧栏收起后显示 32px 窄条 + 展开箭头
- 右侧栏收起后显示 32px 窄条 + 展开箭头
- 收起/展开动画平滑（200ms）
- 左右独立操作互不影响
- 收起右侧栏后再展开，之前选中的节点配置仍在
- ResizableHandle 的拖拽调整尺寸功能不受影响
- 收起按钮不与 ResizableHandle 的拖拽手柄重叠

- [ ] **Step 3: 修复发现的问题（如有）**

根据验证结果修复任何视觉或交互问题。

- [ ] **Step 4: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix(workflow): polish collapsible sidebar interactions"
```
