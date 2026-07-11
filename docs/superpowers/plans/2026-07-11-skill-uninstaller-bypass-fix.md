# Skill Uninstaller Bypass Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every user-triggered installed Skill removal uses the shared Skill Uninstaller service, while the legacy editor-scan trash endpoint remains Rule-only.

**Architecture:** Route the install-status IPC handler by scanned content type: Skills are converted to `SkillUninstallTarget` values and passed to `SkillUninstallerService.uninstall`; Rules keep the existing `trashScanItem` path. Narrow the editor-scan trash contract and implementation to Rules so future renderer callers cannot bypass the shared Skill validation and status-refresh behavior.

**Tech Stack:** Electron IPC modules, TypeScript 6, Zod, Vitest.

## Global Constraints

- Skill uninstall must use `desktop/app-capabilities/skill-uninstaller/main/service.ts`.
- Rule trash behavior must remain unchanged.
- Do not add dependencies or modify `templates/`.
- Keep changes surgical and update `RELEASE_NOTES_PENDING.md` for the user-visible correction.

---

### Task 1: Route install-status Skill removal through Skill Uninstaller

**Files:**
- Modify: `desktop/electron/modules/install-status/ipc.ts`
- Test: `desktop/electron/modules/install-status/__tests__/ipc.test.ts`

**Interfaces:**
- Consumes: `SkillUninstallerService.uninstall(targets, security, hooks)`.
- Produces: the existing `install-status:uninstall` IPC response, with Skill targets delegated to the shared service and Rule targets delegated to `trashScanItem`.

- [x] **Step 1: Write the failing test**

Add a Skill case that injects a mocked uninstaller, invokes the IPC handler, and expects:

```ts
expect(mocks.skillUninstallerService.uninstall).toHaveBeenCalledWith(
  [{ path: "/editor/skills/skill", query: { name: "Skill" } }],
  expect.objectContaining({ actor: { kind: "user" } }),
  expect.objectContaining({ onTrashedContentId: expect.any(Function) }),
)
expect(mocks.trashScanItem).not.toHaveBeenCalled()
```

Keep a separate Rule case proving `trashScanItem` is still used.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/install-status/__tests__/ipc.test.ts
```

Expected: FAIL because the handler still calls `trashScanItem` for Skills.

- [x] **Step 3: Implement the minimal routing change**

Export a small factory so the test can inject `Pick<SkillUninstallerService, "uninstall">`. For a discovered Skill call:

```ts
service.uninstall(
  [{ path: skill.path, query: { name: skill.name } }],
  securityFrom(ctx),
  { onTrashedContentId: async (contentId) => notifyInstallStatusChanged(...) },
)
```

Treat any non-`trashed` result as an IPC failure. Preserve the Rule branch and existing refresh warning semantics.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 2: Make editor-scan trash Rule-only and verify all surfaces

**Files:**
- Modify: `desktop/electron/modules/editor-scan/ipc.ts`
- Modify: `desktop/electron/services/editor-scan-service.ts`
- Modify: `desktop/src/types/editor-scan.ts`
- Test: `desktop/electron/services/__tests__/editor-scan-service.test.ts`
- Test: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: existing Rule `EditorScanTrashRequest` variants.
- Produces: an IPC/schema/service contract that cannot accept `itemType: "skill"`.

- [x] **Step 1: Write the failing contract tests**

Add assertions that the editor-scan IPC request schema rejects `itemType: "skill"` and that production Renderer source only calls `editorScan.trashItem` after narrowing the item to Rule.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-scan-service.test.ts src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: FAIL while the IPC/service contract still supports Skill trash.

- [x] **Step 3: Remove the legacy Skill branch**

Change `EditorScanTrashRequest.itemType` and the Zod schema to `"rule"`; remove `assertTrashableSkillDirectory`; simplify `trashScanItem` to validate only Rule files or Rule sections before moving them to trash.

- [x] **Step 4: Update release notes**

Add one user-facing bullet explaining that all Skill deletion entries now use the shared Skill Uninstaller validation and trash flow.

- [x] **Step 5: Run verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/install-status/__tests__/ipc.test.ts app-capabilities/skill-uninstaller/main/__tests__/service.test.ts app-capabilities/skill-uninstaller/main/__tests__/ipc.test.ts electron/services/__tests__/editor-scan-service.test.ts src/modules/editor-scan/__tests__/editor-bulk-skill-trash-dialog.test.tsx src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
pnpm --filter @synapse/desktop run typecheck
git diff --check
rg -n 'itemType:\s*"skill"|shell\.trashItem' desktop/electron/modules/install-status desktop/electron/modules/editor-scan desktop/electron/services/editor-scan-service.ts
```

Expected: all tests and type checks pass; the final scan shows no Skill deletion branch outside the Skill Uninstaller service.
