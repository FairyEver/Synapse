# Workflow Editor Right Panel Resizable — Design

**Date:** 2026-05-11  
**Scope:** `desktop/src/modules/workflow/editor/`

## Goal

Make the right-side node config panel in the workflow editor horizontally resizable by dragging, matching the pattern already used in the main app's `SidebarContentLayout`.

## Current State

```
[NodePalette w-44 fixed] | [canvas flex-1] | [NodeConfigPanel w-60 fixed]
```

`NodeConfigPanel` has a hardcoded `w-60` (240 px) Tailwind class. It cannot be resized.

## Design

Use the existing `ResizablePanelGroup / ResizablePanel / ResizableHandle` primitives from `@/components/ui/resizable` (backed by `react-resizable-panels`). No new dependencies.

### New layout structure

```
[NodePalette w-44 fixed]
  ResizablePanelGroup orientation="horizontal" (flex-1)
    ResizablePanel (canvas)          ← no size constraints, takes remaining space
      WorkflowCanvas + ExecutionOverlay
    ResizableHandle withHandle
    ResizablePanel (config)          ← default 240 px, min 200 px, max 480 px
      NodeConfigPanel content
```

`groupResizeBehavior="preserve-pixel-size"` is used on the config panel so pixel-based min/max constraints are respected consistently.

### Width constraints

| Property | Value |
|---|---|
| `defaultSize` | 240 px |
| `minSize` | 200 px |
| `maxSize` | 480 px |

### Persistence

Not required. Width resets to 240 px on page reload.

## Files Changed

| File | Change |
|---|---|
| `editor-app.tsx` | Wrap canvas div + `NodeConfigPanel` in `ResizablePanelGroup` with `ResizableHandle` between them |
| `node-config-panel.tsx` | Replace `w-60 shrink-0` on outer div with `h-full w-full` |

## Non-Goals

- Left `NodePalette` remains fixed width.
- No persistence of panel width.
- No changes to canvas behavior, node selection, or run state logic.
