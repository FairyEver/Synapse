# Content Store Desktop Skill Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users publish an already-installed local Skill from Desktop to the cloud Content Store as a saved draft, then continue publishing in Dashboard.

**Architecture:** Reuse the existing editor scan and Skill source readers. Desktop reads a selected Skill directory through main-process services, validates only the container boundary, uploads files to `POST /api/content-store/drafts` through the logged-in AccountService, then opens Dashboard at the new draft edit page. Rule and Prompt do not support Desktop upload in this phase.

**Tech Stack:** Electron main/preload/renderer, existing editor scan module, existing AccountService authenticated HTTP, existing `content-skill-source-service`, React, shadcn/Radix components, Vitest.

---

## Dependencies

This plan depends on:

- `docs/superpowers/plans/2026-06-09-content-store-server-foundation.md`
- `docs/superpowers/plans/2026-06-09-content-store-dashboard-editor.md`

Desktop install is independent and can be implemented before or after this plan.

## Hard Rules

- Only Skill supports Desktop upload draft.
- Rule and Prompt creation remains Dashboard-only.
- Upload creates or directly overwrites the user's current matching local-source draft when the server detects the same `localSourceFingerprint`; do not ask the user to choose merge modes in v1.
- Desktop upload saves a draft only. It does not publish.
- After upload, Desktop opens Dashboard for final editing and publish.
- Do not upload icons, categories, summaries, release notes, or history.
- Do not silently write to local repositories.
- Reading Skill files must remain in Electron main process and go through existing permission/audit boundaries.

## Files

- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
- Create: `desktop/electron/services/content-store-upload-service.ts`
- Create: `desktop/electron/services/__tests__/content-store-upload-service.test.ts`
- Modify: `desktop/electron/modules/editor-scan/ipc.ts`
- Modify: `desktop/electron/modules/editor-scan/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/types/editor-scan.ts`
- Create: `desktop/src/modules/editor-scan/lib/content-store-upload.ts`
- Create: `desktop/src/modules/editor-scan/lib/__tests__/content-store-upload.test.ts`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`
- Modify: `desktop/src/modules/editor-scan/hooks/use-editor-scan.ts` if upload status needs refresh coordination.

## Server Contract Used

- `POST /api/content-store/drafts`

Payload for Skill:

```ts
{
  type: "skill",
  title: string,
  description: string | null,
  localSourceFingerprint: string,
  files: Array<{
    path: string,
    contentBase64: string,
    mimeType?: string | null
  }>
}
```

---

### Task 1: AccountService Content Store Draft API

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [x] Add `createContentStoreSkillDraft(input)` using authenticated JSON request.
- [x] Use `apiBaseUrl()/content-store/drafts`.
- [x] Reuse existing HTTP error normalization and auth refresh behavior.
- [x] Return `ContentStoreDraftDto`.
- [x] Test success, unauthenticated failure, and server validation message passthrough.

### Task 2: Upload Service

**Files:**
- Create: `desktop/electron/services/content-store-upload-service.ts`
- Create: `desktop/electron/services/__tests__/content-store-upload-service.test.ts`

- [x] Reuse `readSkillDraftFromDirectory` from `desktop/electron/services/content-skill-source-service.ts`.
- [x] Compute stable `localSourceFingerprint` from editor id, scope, project path when present, and Skill directory path. Hash the normalized tuple; do not send raw absolute path as the fingerprint.
- [x] Convert files to server payload:
  - root `SKILL.md` path preserved as `SKILL.md`
  - attachments keep relative paths
  - content is strict base64
  - mimeType carried when available
- [x] Title and description come from existing Skill draft metadata where available.
- [x] Call `accountService.createContentStoreSkillDraft`.
- [x] Return:
  - draft id
  - item id
  - revision
  - dashboard edit URL
- [x] Build Dashboard URL from deployment public app URL and route `/dashboard/my-content/<itemId>/edit`.
- [x] Test path fingerprint stability, no absolute path leakage in fingerprint, upload payload shape, and Dashboard URL.

### Task 3: Editor Scan IPC

**Files:**
- Modify: `desktop/electron/modules/editor-scan/ipc.ts`
- Modify: `desktop/electron/modules/editor-scan/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/types/editor-scan.ts`

- [x] Add IPC method `uploadSkillDraftToContentStore`.
- [x] Payload includes selected scan item path, editor id, scope, and optional project path.
- [x] Validate payload with zod.
- [x] Reject non-Skill item types.
- [x] Register through existing `editorScanIpcModule`; do not create bare IPC handlers.
- [x] Expose method through preload as `window.synapse.editorScan.uploadSkillDraftToContentStore`.
- [x] Tests cover Skill success, Rule/Prompt rejection, validation failure, and unauthenticated error mapping.

### Task 4: Renderer Action Builder

**Files:**
- Create: `desktop/src/modules/editor-scan/lib/content-store-upload.ts`
- Create: `desktop/src/modules/editor-scan/lib/__tests__/content-store-upload.test.ts`

- [x] Implement `canUploadSkillToContentStore(item)` returning true only for Skill scan items with a readable item path.
- [x] Implement `buildUploadSkillDraftRequest(item, context)` to produce IPC payload without UI-specific state.
- [x] Implement result message builder:
  - success: draft saved
  - unauthenticated: ask login
  - validation/server error: show server message
- [x] Tests cover disabled reasons and request payload.

### Task 5: Scan Detail UI

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

- [x] Add an action for Skill items: `发布到商店`.
- [x] Action calls IPC and shows busy state.
- [x] On success, show a concise dialog/toast and open Dashboard edit URL through existing shell/external opener.
- [x] Do not add upload controls for Rule or Prompt.
- [x] Do not add explanatory marketing copy.
- [x] Preserve existing local repository quick-publish behavior.
- [x] Test the action is visible for Skill, hidden for Rule/Prompt, disabled when scan item has no path, and opens Dashboard after success.

### Task 6: Error and Auth States

**Files:**
- Modify upload service, IPC, and UI files.

- [x] If Desktop account is unauthenticated, show existing login path and do not attempt upload.
- [x] If server says the draft was overwritten because of matching fingerprint, treat as success and open the returned item edit page.
- [x] If server validation fails because `SKILL.md` is missing or file limits are exceeded, surface the server message.
- [x] If Dashboard URL cannot be opened, keep success state visible with the edit URL as copyable text.

### Task 7: Verification

- [x] Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/desktop run test -- content-store-upload editor-scan content-skill-source-service account-service
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

- [x] Inspect forbidden renderer UI patterns:

```bash
rg "style=\\{\\{|#[0-9A-Fa-f]{3,8}|rgb\\(|hsl\\(|from-|to-|via-|✨|🚀|⚡" desktop/src/modules/editor-scan
```

- [x] Update `RELEASE_NOTES_PENDING.md`.
- [x] Commit:

```bash
git add desktop/electron desktop/src RELEASE_NOTES_PENDING.md
git commit -m "feat(desktop): upload skills to content store drafts"
```
