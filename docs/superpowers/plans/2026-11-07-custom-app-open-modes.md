# 自定义应用打开方式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `iframe` or dedicated-window open mode to custom web apps, with safe routing and matching UI.

**Architecture:** Persist one additive `openMode` field from the shared contract through PostgreSQL and the desktop cache. Renderer iframe apps use a sandboxed page inside the main application shell; `window` apps keep the existing dedicated `BrowserWindow` plus `WebContentsView` runtime and never occupy the main content area.

**Tech Stack:** TypeScript, Zod, Prisma/PostgreSQL, Electron, React 19, Vitest

**Spec:** `docs/superpowers/specs/2026-11-07-custom-web-apps-design.md`

## Global Constraints

- Custom apps remain account-level web apps and do not register MCP, Workflow, Automation, Deep Link or mobile surfaces.
- `iframe` mode must not include `allow-same-origin`; it must not inherit Synapse renderer privileges.
- `window` mode is the only mode allowed to create a native web view or dedicated custom-app window.
- Older payloads and cached snapshots without `openMode` normalize to `window`.
- Keep the current shared custom-web session and all existing permission, download, popup and navigation hardening for window mode.

## Review Focus

- An old cached app without `openMode` opens safely instead of failing schema validation.
- A window-mode app never renders inside the main window, including after a remote mode change.
- An iframe-mode app cannot obtain `allow-same-origin` or create a dedicated web view.
- Switching modes while an app is open closes or exits the obsolete host without losing unrelated app state.
- Narrow dialogs preserve equal option heights and disabled submit state until a mode is selected.

---

### Task 1: Persist and validate the open mode

**Files:**
- Modify: `shared/src/custom-apps.ts`
- Modify: `shared/src/custom-apps.test.ts`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20261107120000_custom_app_open_mode/migration.sql`
- Modify: `server/src/custom-apps/custom-apps.service.ts`
- Modify: `server/src/custom-apps/custom-apps.service.spec.ts`
- Modify: `server/src/custom-apps/custom-apps.controller.spec.ts`

**Interfaces:**
- Produces: `CustomAppOpenMode = "iframe" | "window"`.
- Produces: `CustomAppDto.openMode`, required `CustomAppCreateInput.openMode`, optional `CustomAppUpdateInput.openMode`.
- Produces: Prisma `UserCustomApp.openMode String @default("window")`.

- [x] **Step 1: Write failing contract and server tests**

Assert that old create input and snapshots default to `window`, that `iframe` round-trips, and that create/update persist the selected mode.

- [x] **Step 2: Run the targeted tests and verify they fail**

Run: `pnpm --filter @synapse/shared exec vitest run src/custom-apps.test.ts`

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-apps.service.spec.ts src/custom-apps/custom-apps.controller.spec.ts`

- [x] **Step 3: Add the shared field, Prisma column and migration**

Use a Zod default of `window` on read/create compatibility. Prefer unknown or absent database values to normalize to `window`.

- [x] **Step 4: Persist create/update and normalize output**

Include `openMode` in create idempotency, update fields, records and DTO projection.

- [x] **Step 5: Regenerate Prisma and run the targeted tests**

Run: `pnpm --filter @synapse/server run prisma:generate`

Run the two commands from Step 2 and expect all tests to pass.

### Task 2: Add the creation and edit choice

**Files:**
- Modify: `desktop/src/modules/custom-apps/create-edit-dialog.tsx`
- Modify: `desktop/src/modules/custom-apps/__tests__/create-edit-dialog.test.tsx`
- Modify: `desktop/src/modules/apps/components/app-launcher-list.tsx`
- Modify: `desktop/src/modules/apps/__tests__/app-launcher-custom.test.tsx`

**Interfaces:**
- Consumes: `CustomAppOpenMode`.
- Produces: mandatory mode selection for new apps and a mode update for edited apps.

- [x] **Step 1: Write failing dialog tests**

Cover disabled submit before choosing, creating with `iframe`, editing `window` back to `iframe`, and stable option rendering.

- [x] **Step 2: Run the dialog tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__/create-edit-dialog.test.tsx`

- [x] **Step 3: Add the two selectable mode options**

Use existing `Button`, `Input`, `Label` and token styling. Explain iframe limits in the option and show the selected mode in the app launcher.

- [x] **Step 4: Update launcher assertions**

Assert `应用内嵌` and `独立窗口` labels appear without changing the primary row action.

- [x] **Step 5: Run the targeted tests**

Run the dialog test command plus:

`pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/app-launcher-custom.test.tsx`

### Task 3: Route iframe and window modes to the correct host

**Files:**
- Create: `desktop/src/modules/custom-apps/iframe-app-content.tsx`
- Create: `desktop/src/modules/custom-apps/__tests__/iframe-app-content.test.tsx`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/modules/custom-apps/app-availability.ts`
- Modify: `desktop/src/modules/custom-apps/__tests__/app-availability.test.ts`
- Modify: `desktop/src/modules/custom-apps/custom-app-window-app.tsx`
- Modify: `desktop/src/modules/custom-apps/__tests__/custom-apps-integration.test.tsx`
- Modify: `desktop/electron/services/custom-apps/window-service.ts`
- Modify: `desktop/electron/services/custom-apps/__tests__/window-service.test.ts`
- Modify: `desktop/electron/services/custom-apps/runtime-service.ts`
- Modify: `desktop/electron/services/custom-apps/__tests__/runtime-service.test.ts`

**Interfaces:**
- Consumes: `CustomAppDto.openMode`.
- Produces: `IframeCustomAppContent({ app })`.
- Produces: `window` mode opens/focuses only the dedicated BrowserWindow; `iframe` mode never opens one.

- [x] **Step 1: Write failing rendering and host tests**

Assert the iframe has the exact safe sandbox, disabled history controls and guarded external-open action. Assert iframe apps are rejected by window/runtime services and window-mode apps return the main shell to launcher.

- [x] **Step 2: Run the targeted tests and verify they fail**

Run:

`pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__/iframe-app-content.test.tsx src/modules/custom-apps/__tests__/app-availability.test.ts src/modules/custom-apps/__tests__/custom-apps-integration.test.tsx electron/services/custom-apps/__tests__/window-service.test.ts electron/services/custom-apps/__tests__/runtime-service.test.ts`

- [x] **Step 3: Implement iframe content and route App/Dock opens**

Iframe mode is rendered only in the main content area with `sandbox="allow-forms allow-scripts"` and no `allow-same-origin`. Window mode calls `customApps.window.open()` without selecting the app in the main navigation.

- [x] **Step 4: Guard obsolete hosts and mode changes**

Reject iframe apps in window/runtime services and close a dedicated window if its app changes to iframe mode.

- [x] **Step 5: Run the targeted tests**

Run the command from Step 2 and expect all tests to pass.

### Task 4: Update boundaries, release notes and verify

**Files:**
- Modify: `docs/agents/module-boundaries.md`
- Modify: `docs/superpowers/specs/2026-11-07-custom-web-apps-design.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Documents the two modes and the iframe sandbox boundary.

- [x] **Step 1: Update authoritative docs**

Remove the iframe non-goal, define `openMode`, document legacy default `window`, and scope session/preload/Windows protections by mode.

- [x] **Step 2: Update release notes**

Describe the user-visible choice and that iframe mode may be blocked by sites.

- [x] **Step 3: Run focused verification**

Run:

`pnpm --filter @synapse/shared exec vitest run src/custom-apps.test.ts`

`pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-apps.service.spec.ts src/custom-apps/custom-apps.controller.spec.ts`

`pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps src/modules/apps/__tests__/app-launcher-custom.test.tsx electron/services/custom-apps/__tests__`

- [x] **Step 4: Run build gates**

Run:

`pnpm --filter @synapse/desktop run typecheck`

`pnpm --filter @synapse/server run typecheck`

`pnpm --filter @synapse/desktop run check:hard-constraints`

- [x] **Step 5: Commit**

Use a Chinese commit message that names the new iframe and dedicated-window modes.
