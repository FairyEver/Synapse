# Workflow Editor Global Settings Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workflow editor top toolbar with a canvas floating toolbar (save/run) and a right-panel global settings view (name/description/project/params) shown when no node is selected.

**Architecture:** Delete `toolbar.tsx`. Add `canvas-floating-toolbar.tsx` for save/run buttons floating over the canvas. Modify `node-config-panel.tsx` to render a global settings form when `selectedNodeId` is null. Modify `editor-app.tsx` to remove the toolbar, add a window drag region, wrap the canvas in a relative container for the floating toolbar overlay, and pass new props down.

**Tech Stack:** React, TypeScript, shadcn/ui (Input, Textarea, Label, Select, Separator, Button), Tailwind CSS, lucide-react icons

**Design spec:** `docs/superpowers/specs/2026-05-16-workflow-editor-global-settings-panel-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx` | Create | Save + Run buttons floating over canvas; hosts RunParamsDialog |
| `desktop/src/modules/workflow/editor/node-config-panel.tsx` | Modify | Add global settings form in the `!node` branch; new props `onDefinitionChange`, accept `ParamsEditorDialog` |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | Modify | Remove WorkflowToolbar; add drag region; wrap canvas in relative container with floating toolbar; pass new props |
| `desktop/src/modules/workflow/editor/toolbar.tsx` | Delete | No longer needed |

---

### Task 1: Create canvas-floating-toolbar.tsx

**Files:**
- Create: `desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx`

- [ ] **Step 1: Create the floating toolbar component**

```tsx
// desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx
import { useState } from "react"
import { Save, Play, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkflowDefinition } from "@/types/workflow"
import { RunParamsDialog } from "../components/run-params-dialog"

interface CanvasFloatingToolbarProps {
  definition: WorkflowDefinition
  saving?: boolean
  running?: boolean
  dirty?: boolean
  onSave: (def: WorkflowDefinition, silent?: boolean) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string | null>
}

export function CanvasFloatingToolbar({ definition, saving, running, dirty, onSave, onRun }: CanvasFloatingToolbarProps) {
  const [runParamsOpen, setRunParamsOpen] = useState(false)
  const [lastRunValues, setLastRunValues] = useState<Record<string, string>>({})
  const busy = saving || running
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm border rounded-lg shadow-sm px-2 py-1.5">
      <Button size="sm" variant="ghost" data-track="workflow-editor-save" onClick={() => void onSave(definition)} disabled={busy} className="relative">
        {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
        保存
        {dirty && !saving && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />}
      </Button>
      <Button size="sm" data-track="workflow-editor-run" onClick={() => definition.params.length === 0 ? void onRun({}) : setRunParamsOpen(true)} disabled={busy}>
        {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
        运行
      </Button>
      <RunParamsDialog
        open={runParamsOpen}
        params={definition.params}
        lastValues={lastRunValues}
        onConfirm={(params, rawValues) => { setRunParamsOpen(false); setLastRunValues(rawValues); void onRun(params) }}
        onCancel={() => setRunParamsOpen(false)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx
git commit -m "feat(workflow): add canvas floating toolbar component"
```

---

### Task 2: Add global settings form to NodeConfigPanel

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx`

- [ ] **Step 1: Add new imports at the top of node-config-panel.tsx**

Add these imports after the existing imports:

```tsx
import { useState } from "react"  // already imported via useEffect — extend the import
import { SlidersHorizontal } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ParamsEditorDialog } from "../components/params-editor-dialog"
```

- [ ] **Step 2: Extend NodeConfigPanelProps interface**

Add `onDefinitionChange` to the props interface:

```tsx
interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
  onDeleteNode?: (nodeId: string) => void
  onCopyNode?: (nodeId: string) => void
  renameSignal?: number
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  onDefinitionChange?: (def: WorkflowDefinition) => void
}
```

Update the function signature to destructure `onDefinitionChange`:

```tsx
export function NodeConfigPanel({ nodeId, definition, onConfigChange, onNameChange, onDeleteNode, onCopyNode, renameSignal, projects, defaultProjectName, onDefinitionChange }: NodeConfigPanelProps) {
```

- [ ] **Step 3: Replace the empty-state branch with global settings form**

Replace the `!node` branch (lines 140-143 of the current file):

```tsx
// Old:
      ) : (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">点击节点编辑配置</p>
        </div>
      )}
```

With the global settings form. Use a constant for the "no project" sentinel:

```tsx
      ) : (
        <GlobalSettingsForm definition={definition} projects={projects} onChange={onDefinitionChange} />
      )}
```

- [ ] **Step 4: Add the GlobalSettingsForm component in the same file, before the export**

```tsx
const NO_PROJECT_VALUE = "__none__"

function GlobalSettingsForm({ definition, projects, onChange }: {
  definition: WorkflowDefinition
  projects: readonly SynapseProjectConfig[]
  onChange?: (def: WorkflowDefinition) => void
}) {
  const [paramsOpen, setParamsOpen] = useState(false)
  return (
    <>
      <div className="border-b px-3 py-2.5">
        <p className="text-sm font-medium">工作流设置</p>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">名称</Label>
          <Input
            className="h-7 text-sm"
            value={definition.name}
            onChange={(e) => onChange?.({ ...definition, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">描述</Label>
          <Textarea
            className="min-h-16 text-xs resize-none"
            value={definition.description ?? ""}
            onChange={(e) => onChange?.({ ...definition, description: e.target.value || undefined })}
            placeholder="添加描述"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">默认项目</Label>
          <Select
            value={definition.defaultProjectId ?? NO_PROJECT_VALUE}
            onValueChange={(v) => onChange?.({ ...definition, defaultProjectId: v === NO_PROJECT_VALUE ? undefined : v })}
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={NO_PROJECT_VALUE}>无默认项目</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div className="space-y-1.5">
          <Label className="text-xs">工作流参数</Label>
          {definition.params.length > 0 ? (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {definition.params.map((p) => (
                <div key={p.name} className="flex items-center gap-1.5">
                  <span className="font-mono">{p.name}</span>
                  <span className="text-muted-foreground/60">({p.type})</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无参数</p>
          )}
          <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => setParamsOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
            编辑参数
          </Button>
        </div>
      </div>
      <ParamsEditorDialog
        open={paramsOpen}
        params={definition.params}
        onChange={(params) => onChange?.({ ...definition, params })}
        onClose={() => setParamsOpen(false)}
      />
    </>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/editor/node-config-panel.tsx
git commit -m "feat(workflow): add global settings form to right panel"
```

---

### Task 3: Update editor-app.tsx and delete toolbar.tsx

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx`
- Delete: `desktop/src/modules/workflow/editor/toolbar.tsx`

- [ ] **Step 1: Update imports in editor-app.tsx**

Remove:

```tsx
import { WorkflowToolbar } from "./toolbar"
```

Add:

```tsx
import { CanvasFloatingToolbar } from "./canvas-floating-toolbar"
```

- [ ] **Step 2: Replace the toolbar + canvas layout in the return block**

Replace the current return block (lines 353-408) with:

```tsx
  return (
    <ProviderLookupProvider>
    <div className="flex flex-col h-screen">
      <div className="h-8 shrink-0 [-webkit-app-region:drag]" />
      {runErrors.length > 0 && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-xs font-medium">校验失败</AlertTitle>
          <AlertDescription className="text-xs">
            <ul className="mt-0.5 space-y-0.5 list-none">
              {runErrors.map((e, i) => (
                <li
                  key={i}
                  className={e.nodeId ? "cursor-pointer hover:underline" : undefined}
                  onClick={e.nodeId ? () => setSelectedNodeId(e.nodeId!) : undefined}
                >
                  {e.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
          <AlertAction>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setRunErrors([])}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className="flex-1 flex min-h-0">
        <NodePalette />
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel>
            <div className="relative h-full">
              <WorkflowCanvas ref={canvasRef} definition={definition} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
              <CanvasFloatingToolbar definition={definition} saving={saving} running={running} dirty={dirty} onSave={handleSave} onRun={handleRun} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={400}
            minSize={300}
            maxSize={600}
            groupResizeBehavior="preserve-pixel-size"
          >
            <NodeConfigPanel
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
      </div>
    </div>
```

Key changes vs. current:
- `<WorkflowToolbar ...>` removed
- `<div className="h-8 shrink-0 [-webkit-app-region:drag]" />` added as window drag region
- Canvas wrapped in `<div className="relative h-full">` with `<CanvasFloatingToolbar>` overlaid
- `NodeConfigPanel` receives new `onDefinitionChange={handleDefinitionChange}` prop

- [ ] **Step 3: Delete toolbar.tsx**

```bash
rm desktop/src/modules/workflow/editor/toolbar.tsx
```

- [ ] **Step 4: Verify no remaining imports of toolbar.tsx**

```bash
grep -r "toolbar" desktop/src/modules/workflow/editor/ --include="*.tsx" --include="*.ts"
```

Expected: only `canvas-floating-toolbar` references, no `./toolbar` import.

- [ ] **Step 5: Commit**

```bash
git add -A desktop/src/modules/workflow/editor/
git commit -m "feat(workflow): replace toolbar with floating toolbar + global settings panel"
```

---

### Task 4: Smoke-test verification

- [ ] **Step 1: Type-check the project**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: no errors in the modified files.

- [ ] **Step 2: Run existing workflow editor tests**

```bash
pnpm --filter @synapse/desktop run test -- --run src/modules/workflow/editor/
```

Expected: all existing tests pass. If there are tests that reference `WorkflowToolbar`, they should be updated or removed since the component no longer exists.

- [ ] **Step 3: Check for any test files referencing toolbar**

```bash
grep -r "WorkflowToolbar\|toolbar" desktop/src/modules/workflow/editor/__tests__/ --include="*.tsx" --include="*.ts" 2>/dev/null || echo "No toolbar references in tests"
```

If references found, update the test imports and assertions to match the new structure.

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A desktop/src/modules/workflow/
git commit -m "test(workflow): update tests for toolbar removal"
```

(Skip this step if no test changes were needed.)
