# Workflow Auto-Layout Implementation Plan

Design: `docs/superpowers/specs/2026-05-16-workflow-auto-layout-design.md`

## Task 1: Add dagre dependency

- [x] Step 1.1: Add `@dagrejs/dagre` to `dependencies` in `desktop/package.json`
- [x] Step 1.2: Add `@types/dagre` to `devDependencies` in `desktop/package.json`
- [x] Step 1.3: Run `pnpm install` to update lockfile

**Verify:** `pnpm --filter @synapse/desktop exec -- node -e "require('@dagrejs/dagre')"`

## Task 2: Create auto-layout pure function + tests

- [x] Step 2.1: Create `desktop/src/modules/workflow/editor/auto-layout.ts` with `autoLayoutNodes` function
- [x] Step 2.2: Create `desktop/src/modules/workflow/editor/__tests__/auto-layout.test.ts` with unit tests

**Verify:** `pnpm --filter @synapse/desktop vitest run src/modules/workflow/editor/__tests__/auto-layout.test.ts`

## Task 3: Integrate into canvas context menu

- [x] Step 3.1: Import `autoLayoutNodes` and `LayoutGrid` icon in `canvas.tsx`
- [x] Step 3.2: Add `handleAutoLayout` callback that computes layout, updates nodes/definition, calls fitView
- [x] Step 3.3: Add "自动布局" menu item in pane context menu before the paste button

**Verify:** `pnpm --filter @synapse/desktop run typecheck`

## Task 4: Manual verification (skip)

- [ ] Start dev server and verify right-click menu shows "自动布局"
- [ ] Click it on a multi-node workflow and confirm LR layout + fitView
