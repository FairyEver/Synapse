# Content Store Dashboard Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add Dashboard authoring flows for Content Store drafts and publishing: Skill file-tree editor with Monaco, Rule/Prompt textarea editors, draft save, publish, and public/private control.

**Architecture:** Build editor routes under `my-content` because all authoring is authenticated and owned by the current user. Keep request logic in `dashboard/src/lib/api.ts`, editor state in feature hooks under `dashboard/src/features/content-store/editor/`, and UI in shadcn/Radix components. Skill editor edits a bounded virtual file tree and serializes files to server draft payloads; Rule/Prompt use regular multiline textareas.

**Tech Stack:** React 19, TanStack Router, shadcn/Radix components, Tailwind theme tokens, `@monaco-editor/react`, `monaco-editor`, Vitest, `@synapse/shared`.

---

## Dependencies

This plan depends on:

- `docs/superpowers/plans/2026-06-09-content-store-server-foundation.md`
- `docs/superpowers/plans/2026-06-09-content-store-dashboard-store.md`

## Hard Rules

- Skill supports arbitrary content inside server-side container limits; client UI should not invent stricter content limits.
- Container boundaries must remain enforced by server file validation.
- Skill must include `SKILL.md`.
- Rule and Prompt use ordinary multiline textboxes. Do not use Monaco for Rule/Prompt.
- Do not support terminal execution, zip upload/import, icon editing, category editing, summary, release notes, multiple drafts, version history display, or draft history.
- There is one current draft per content item. Publishing consumes that draft. Later edits create or update the current draft for the item.
- Save is manual. Do not autosave.
- Publish has no release notes field.
- Public visibility requires server-side description validation.
- Skill editor supports arbitrary file upload and replacement within server container limits. Binary files show metadata only and are not previewed or edited.

## Files

- Modify: `dashboard/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/features/content-store/editor/content-store-editor-types.ts`
- Create: `dashboard/src/features/content-store/editor/content-store-file-model.ts`
- Create: `dashboard/src/features/content-store/editor/content-store-file-model.test.ts`
- Create: `dashboard/src/features/content-store/editor/content-store-draft-serialization.ts`
- Create: `dashboard/src/features/content-store/editor/content-store-draft-serialization.test.ts`
- Create: `dashboard/src/features/content-store/editor/use-content-store-draft-editor.ts`
- Create: `dashboard/src/features/content-store/editor/skill-file-tree.tsx`
- Create: `dashboard/src/features/content-store/editor/skill-file-editor.tsx`
- Create: `dashboard/src/features/content-store/editor/rule-prompt-editor.tsx`
- Create: `dashboard/src/features/content-store/editor/content-store-publish-dialog.tsx`
- Create: `dashboard/src/features/content-store/editor/content-store-editor-page.tsx`
- Create: `dashboard/src/features/content-store/editor/content-store-create-page.tsx`
- Modify: `dashboard/src/features/content-store/my-content-list.tsx`
- Modify: `dashboard/src/features/content-store/my-content-detail.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/new.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/$contentId/edit.tsx`

## Server Contract Used

- `POST /api/content-store/drafts`
- `PUT /api/content-store/items/:id/draft`
- `POST /api/content-store/items/:id/publish`
- `GET /api/content-store/items/:id`
- `GET /api/content-store/items/:id/draft`
- `POST /api/content-store/items/:id/visibility`

---

### Task 1: Add Editor Dependency

**Files:**
- Modify: `dashboard/package.json`
- Modify: `pnpm-lock.yaml`

- [x] Add `@monaco-editor/react` and `monaco-editor` to `@synapse/dashboard` dependencies.
- [x] Run `pnpm install --lockfile-only` from the repository root if the package manager requires lockfile updates.
- [x] Do not add a second code editor library.

### Task 2: API Client Methods

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`

- [x] Add request types:
  - `CreateContentStoreDraftInput`
  - `SaveContentStoreDraftInput`
  - `PublishContentStoreDraftInput`
  - `ContentStoreDraftFileInput`
- [x] Add `dashboardApi.createContentStoreDraft(input)`.
- [x] Add `dashboardApi.saveContentStoreDraft(id, input)`.
- [x] Add `dashboardApi.publishContentStoreDraft(id, input)`.
- [x] Ensure file payloads use `contentBase64`, `path`, and optional `mimeType`.
- [x] Test request paths and JSON body serialization for Skill, Rule, and Prompt.

### Task 3: File Model and Serialization

**Files:**
- Create files under `dashboard/src/features/content-store/editor/`.

- [x] Implement a `SkillEditorFile` model with:
  - `path`
  - `kind: "text" | "binary"`
  - `text`
  - `bytesBase64`
  - `size`
  - `mimeType`
  - `sha256`
- [x] Implement path normalization for UI-created files:
  - slash separators
  - no empty segments
  - no `.` or `..`
  - no absolute paths
  - no duplicate paths
- [x] Keep `SKILL.md` immutable as a root file name in the initial template. User may edit its content but not remove or rename it.
- [x] For Dashboard-created Skill, initialize a virtual folder with exactly one text file: `SKILL.md`.
- [x] Serialize text and binary files to strict base64 for server payloads.
- [x] Use browser `File` APIs for upload/replace and classify text/binary consistently with the server rule where practical. Server validation remains authoritative.
- [x] Binary files are uploadable and replaceable, but not previewed or edited in Monaco.
- [x] Test normalization, duplicate detection, `SKILL.md` presence, text base64 serialization, binary base64 serialization, upload, and replace behavior.

### Task 4: Draft Editor Hook

**Files:**
- Create: `dashboard/src/features/content-store/editor/use-content-store-draft-editor.ts`

- [x] Implement loading existing item detail by id.
- [x] Implement local editor dirty state without autosave.
- [x] Track server draft `revision` and require it for save/publish.
- [x] Handle revision mismatch by showing the server message and requiring refresh.
- [x] Expose actions:
  - `createDraft`
  - `saveDraft`
  - `publishDraft`
  - `setVisibility`
- [x] Keep async errors explicit and user-visible via existing toast/error patterns.

### Task 5: Skill Editor UI

**Files:**
- Create: `dashboard/src/features/content-store/editor/skill-file-tree.tsx`
- Create: `dashboard/src/features/content-store/editor/skill-file-editor.tsx`

- [x] Use a restrained two-pane layout: file tree left, editor right.
- [x] Use Monaco only for text files.
- [x] Use existing buttons, inputs, dialogs, scroll areas, and separators.
- [x] Actions:
  - create text file
  - create folder by path
  - upload file
  - replace selected file
  - rename text file except `SKILL.md`
  - delete file except `SKILL.md`
  - edit file content
- [x] Binary files display path and size only.
- [x] Do not add terminal, run button, zip import, or icon controls.
- [x] Avoid custom styles and arbitrary colors.

### Task 6: Rule and Prompt Editors

**Files:**
- Create: `dashboard/src/features/content-store/editor/rule-prompt-editor.tsx`

- [x] Use ordinary `Textarea` for body.
- [x] Shared metadata fields:
  - title
  - description
  - type
- [x] Prompt editor has copy-oriented language only. Do not add install controls.
- [x] Rule editor can publish and later be installed through store detail after publish.
- [x] Keep helper text minimal.

### Task 7: Create and Edit Routes

**Files:**
- Create: `dashboard/src/features/content-store/editor/content-store-editor-page.tsx`
- Create: `dashboard/src/features/content-store/editor/content-store-create-page.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/new.tsx`
- Create: `dashboard/src/routes/_authenticated/my-content/$contentId/edit.tsx`
- Modify: `dashboard/src/features/content-store/my-content-list.tsx`
- Modify: `dashboard/src/features/content-store/my-content-detail.tsx`

- [x] `/my-content/new` lets the user choose Skill, Rule, or Prompt and then creates the initial draft.
- [x] Skill new draft initializes with `SKILL.md`.
- [x] Rule/Prompt new draft initializes with an empty multiline body after the user enters a title and body.
- [x] `/my-content/$contentId/edit` loads current detail and current draft state from `GET /api/content-store/items/:id/draft`.
- [x] My Content list/detail edit buttons link to the edit route.
- [x] Save updates the draft and stays on edit route.
- [x] Publish calls publish API and navigates to `/my-content/$contentId`.

### Task 8: Publish and Visibility Flow

**Files:**
- Create: `dashboard/src/features/content-store/editor/content-store-publish-dialog.tsx`
- Modify editor page files.

- [x] Publish dialog shows title, type, current visibility, and description field if needed.
- [x] Publish calls `publishDraft` with current `revision`.
- [x] Public toggle calls `setVisibility` after publish. If description is missing, surface server validation.
- [x] Do not ask for release notes.
- [x] Do not show historical versions after publish.

### Task 9: Server Draft Read Endpoint

**Files:**
- Modify: `shared/src/content-store.ts`
- Modify: `server/src/content-store/content-store.service.ts`
- Modify: `server/src/content-store/content-store.controller.ts`
- Modify: `server/src/content-store/content-store.service.spec.ts`
- Modify: `server/src/content-store/content-store.controller.spec.ts`
- Modify: `dashboard/src/lib/api.ts`

- [x] Add `GET /api/content-store/items/:id/draft` returning `ContentStoreDraftDto`.
- [x] Require ownership for the draft endpoint.
- [x] Return 404 when no current draft exists.
- [x] Add service and controller tests for owner-only access and revision values.

### Task 10: Verification

- [x] Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/server run test -- content-store
pnpm --filter @synapse/server run build
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run build
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/features/content-store
```

- [x] Inspect forbidden UI patterns:

```bash
rg "style=\\{\\{|#[0-9A-Fa-f]{3,8}|rgb\\(|hsl\\(|from-|to-|via-|✨|🚀|⚡" dashboard/src/features/content-store dashboard/src/routes/_authenticated/my-content
```

- [x] Update `RELEASE_NOTES_PENDING.md`.
- [x] Commit:

```bash
git add dashboard package.json pnpm-lock.yaml shared/src/content-store.ts server/src/content-store RELEASE_NOTES_PENDING.md
git commit -m "feat(dashboard): add content store editor"
```
