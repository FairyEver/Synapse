# Skill Repository Phase 2 Web Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Dashboard/Web management surface for private Skill Repositories: My Skills, repository detail, GitHub-like file browsing, light Code renderer editing, file mutations, and owner settings.

**Architecture:** The server remains the source of truth for repository metadata, file metadata, and object storage references. Dashboard gets a Skill Repository feature module that adapts server DTOs into a shared file browser layer extracted from Drive Browser. Drive keeps its existing behavior through thin wrappers; Skill Repository uses only the shared Finder and Code renderer pieces that match its simpler file-tree model.

**Tech Stack:** NestJS, Prisma, Zod, `@synapse/shared` DTOs, Content Store COS storage port, React 19, TanStack Router, existing Dashboard API client, shadcn/ui, Tailwind theme tokens, existing Monaco Code renderer.

---

## Scope Check

Phase 2 includes:

- Personal Dashboard route for private Skill repositories.
- Owner repository detail page at `/skill-repositories/$repositoryId`.
- File browser generated from the flat repository file list.
- Shared file browser primitives extracted from `dashboard/src/features/drive-browser`.
- Text file read, edit, save, reload, dirty/synced state, and conflict handling.
- Upload, replace, rename, and delete for repository files.
- Hard guard that `SKILL.md` cannot be deleted or renamed and every active repository keeps a non-empty root `SKILL.md`.
- Repository settings for `title`, `description`, `repoName`, and delete.
- Private-only management. Visibility UI may display `private`, but changing to `public` stays out of this phase.

Phase 2 excludes:

- Public repository pages by `ownerHandle/repoName`.
- Explore, install sessions, Fork, public visibility changes, and Desktop install flow.
- Cloud-from-scratch empty Skill creation.
- Release/history/rollback/diff/comment/rating/team collaboration.
- MDX editor, Drive annotations, Drive image import, Drive site publishing, Drive share/public-asset actions.

## File Structure

Add or modify these files:

```text
shared/src/skill-repository.ts

server/src/skill-repository/skill-repository.controller.ts
server/src/skill-repository/skill-repository.controller.spec.ts
server/src/skill-repository/skill-repository.service.ts
server/src/skill-repository/skill-repository.service.spec.ts
server/src/skill-repository/skill-repository-file-rules.ts
server/src/skill-repository/skill-repository.types.ts

dashboard/src/lib/api.ts
dashboard/src/components/layout/data/sidebar-data.ts
dashboard/src/features/file-browser/finder/file-browser-breadcrumbs.tsx
dashboard/src/features/file-browser/finder/file-browser-layout.tsx
dashboard/src/features/file-browser/finder/file-browser-list.tsx
dashboard/src/features/file-browser/finder/file-browser-model.ts
dashboard/src/features/file-browser/finder/file-browser-model.test.ts
dashboard/src/features/file-browser/renderers/code-renderer.tsx
dashboard/src/features/file-browser/renderers/renderer-shell.tsx
dashboard/src/features/file-browser/renderers/renderer-toolbar-context.tsx
dashboard/src/features/drive-browser/finder/drive-finder.tsx
dashboard/src/features/drive-browser/renderers/code-renderer.tsx
dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx
dashboard/src/features/drive-browser/renderers/drive-renderer-toolbar-context.tsx
dashboard/src/features/skill-repository/skill-repository-api.ts
dashboard/src/features/skill-repository/skill-repository-list-page.tsx
dashboard/src/features/skill-repository/skill-repository-detail-page.tsx
dashboard/src/features/skill-repository/skill-repository-file-browser.tsx
dashboard/src/features/skill-repository/skill-repository-settings-dialog.tsx
dashboard/src/features/skill-repository/skill-repository-view-model.ts
dashboard/src/features/skill-repository/skill-repository-view-model.test.ts
dashboard/src/features/skill-repository/use-skill-repository.ts
dashboard/src/routes/_authenticated/skill-repositories/index.tsx
dashboard/src/routes/_authenticated/skill-repositories/$repositoryId.tsx

RELEASE_NOTES_PENDING.md
```

## Task 1: Extend Shared Skill Repository Contracts

Files:

- `shared/src/skill-repository.ts`

Steps:

- [x] Add DTOs for repository update, delete result, text content read, text save, upload/replace, rename, and delete file.
- [x] Add request types with `expectedSha256` for text save and replace conflict detection.
- [x] Add helper constants for root entry file path and text preview size.
- [x] Keep `SkillRepositoryFileDto` metadata-only; do not add file text to the list/detail DTO.
- [x] Export error codes for file conflict and protected root file.

Target contract shape:

```ts
export const skillRepositoryRootFilePath = "SKILL.md"
export const skillRepositoryTextPreviewMaxBytes = 1024 * 1024

export interface SkillRepositoryUpdateInput {
  readonly name?: string
  readonly title?: string
  readonly description?: string | null
}

export interface SkillRepositoryFileContentDto {
  readonly file: SkillRepositoryFileDto
  readonly text: string | null
  readonly downloadUrl: string | null
  readonly truncated: boolean
}

export interface SkillRepositoryTextSaveInput {
  readonly path: string
  readonly text: string
  readonly expectedSha256: string
}

export interface SkillRepositoryFileUploadInput {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
  readonly expectedSha256?: string | null
}

export interface SkillRepositoryFileRenameInput {
  readonly fromPath: string
  readonly toPath: string
}

export interface SkillRepositoryFileDeleteInput {
  readonly path: string
  readonly expectedSha256?: string | null
}
```

Verification:

```bash
pnpm --filter @synapse/shared run typecheck
```

## Task 2: Add Server File Content And Mutation APIs

Files:

- `server/src/skill-repository/skill-repository.controller.ts`
- `server/src/skill-repository/skill-repository.service.ts`
- `server/src/skill-repository/skill-repository.types.ts`
- `server/src/skill-repository/skill-repository-file-rules.ts`

Steps:

- [x] Add Zod schemas for metadata update, content read query, text save, file upload/replace, rename, and delete.
- [x] Add authenticated owner-only routes:

```text
PATCH  /api/skill-repositories/:id
DELETE /api/skill-repositories/:id
GET    /api/skill-repositories/:id/files/content?path=<path>
PUT    /api/skill-repositories/:id/files/text
POST   /api/skill-repositories/:id/files
PATCH  /api/skill-repositories/:id/files/rename
DELETE /api/skill-repositories/:id/files
```

- [x] Implement `updateMine(userId, repositoryId, input)` with repo name normalization, owner scoping, active/private scoping, redirect creation for renamed names, and conflict checks against both current names and redirect names.
- [x] Implement `deleteMine(userId, repositoryId)` as status update to `removed`, with cleanup tasks for every file storage object. Do not hard-delete rows.
- [x] Implement `getFileContent(userId, repositoryId, path)` by locating the active owner file and reading object bytes from the Content Store storage port.
- [x] Return text only for `kind === "text"` and size within `skillRepositoryTextPreviewMaxBytes`; return `text: null` for binary files.
- [x] Return `downloadUrl: null` for now unless the existing storage port already exposes a safe signed-read helper. Do not invent a public COS URL.
- [x] Implement `saveTextFile` with `expectedSha256`; return HTTP 409 when the current file sha does not match.
- [x] Implement upload/replace through the same path normalization and kind detection used by import.
- [x] Implement rename and delete with `SKILL.md` protection.
- [x] After every mutation, revalidate that the repository still contains a non-empty root `SKILL.md`.
- [x] Add object cleanup tasks and best-effort storage cleanup for replaced/deleted objects, matching Phase 1 import behavior.

Conflict response shape:

```ts
throw new ConflictException({
  code: "SKILL_REPOSITORY_FILE_CONFLICT",
  message: "文件已有新内容。",
})
```

Verification:

```bash
pnpm --filter @synapse/server run test -- skill-repository
pnpm --filter @synapse/server run typecheck
```

## Task 3: Cover Server Behavior With Tests

Files:

- `server/src/skill-repository/skill-repository.service.spec.ts`
- `server/src/skill-repository/skill-repository.controller.spec.ts`

Steps:

- [x] Add failing service tests before implementation for: text content read, binary content read, save success, save conflict, upload new file, replace file, rename file, delete file, blocked `SKILL.md` rename/delete, repository rename redirect, repository delete cleanup tasks.
- [x] Add controller tests for route validation and expected status codes.
- [x] Assert file list remains metadata-only.
- [x] Assert non-owner access returns not found/forbidden consistently with existing Phase 1 behavior.
- [x] Run the focused test command and keep it failing before implementation work in Task 2 is complete.

Verification:

```bash
pnpm --filter @synapse/server run test -- skill-repository
```

## Task 4: Add Dashboard API Client Methods

Files:

- `dashboard/src/lib/api.ts`
- `dashboard/src/features/skill-repository/skill-repository-api.ts`

Steps:

- [x] Import the new shared Skill Repository DTO types in `dashboard/src/lib/api.ts`.
- [x] Add low-level methods for `listMySkillRepositories`, `getSkillRepository`, `updateSkillRepository`, `deleteSkillRepository`, `getSkillRepositoryFileContent`, `saveSkillRepositoryTextFile`, `uploadSkillRepositoryFile`, `renameSkillRepositoryFile`, and `deleteSkillRepositoryFile`.
- [x] Keep request construction centralized in `api.ts`; feature components must not call `fetch()` directly.
- [x] Add `skill-repository-api.ts` as a small feature-facing wrapper only if the existing Dashboard pattern uses one for grouping hook calls.
- [x] Preserve `ApiError` behavior so Code renderer can detect status `409`.

Verification:

```bash
pnpm --filter @synapse/dashboard run typecheck
```

## Task 5: Extract A Shared File Browser Model

Files:

- `dashboard/src/features/file-browser/finder/file-browser-model.ts`
- `dashboard/src/features/file-browser/finder/file-browser-model.test.ts`

Steps:

- [x] Define generic browser types for a root, virtual folder, file row, breadcrumb, and selected item.
- [x] Implement `buildFileBrowserTree(files, currentPath)` that derives virtual folders from flat slash-separated file paths.
- [x] Sort folders before files, then natural-sort by display name.
- [x] Ensure empty folders cannot be represented.
- [x] Ensure root `SKILL.md` can be prioritized by an adapter option without hard-coding Skill Repository behavior into the shared model.
- [x] Add tests for nested paths, current folder children, breadcrumb derivation, root file prioritization, and duplicate path rejection.

Model shape:

```ts
export type FileBrowserSourceFile = {
  readonly id: string
  readonly path: string
  readonly size: number
  readonly updatedAt: string
  readonly kind: "text" | "binary"
}

export type FileBrowserRow =
  | { readonly type: "folder"; readonly path: string; readonly name: string; readonly childCount: number }
  | { readonly type: "file"; readonly file: FileBrowserSourceFile; readonly name: string }
```

Verification:

```bash
pnpm --filter @synapse/dashboard run test -- file-browser-model
```

## Task 6: Extract Shared Finder And Code Renderer Primitives

Files:

- `dashboard/src/features/file-browser/finder/file-browser-breadcrumbs.tsx`
- `dashboard/src/features/file-browser/finder/file-browser-layout.tsx`
- `dashboard/src/features/file-browser/finder/file-browser-list.tsx`
- `dashboard/src/features/file-browser/renderers/code-renderer.tsx`
- `dashboard/src/features/file-browser/renderers/renderer-shell.tsx`
- `dashboard/src/features/file-browser/renderers/renderer-toolbar-context.tsx`
- Existing Drive Browser wrapper files listed in File Structure.

Steps:

- [x] Copy the reusable layout, list, breadcrumbs, renderer shell, toolbar context, and Monaco Code renderer behavior out of Drive Browser into `features/file-browser`.
- [x] Rename Drive-specific prop names to neutral names: `snapshot` -> `browser`, `current` -> `currentItem`, `preview` -> `content`, `DriveRendererEditContext` -> `FileRendererEditContext`.
- [x] Keep the existing Drive files as wrappers/adapters so Drive behavior does not change.
- [x] Do not move MDX editor, markdown annotations, Drive share status, image import, versions dialog, public asset actions, or site publishing into the shared Skill Repository path.
- [x] Keep existing Code renderer UX strings: `已同步`, `未保存`, reload, save, conflict, download local version.
- [x] Use existing shadcn components and Tailwind token classes only. Do not add custom colors, inline styles, gradients, or nested cards.

Verification:

```bash
pnpm --filter @synapse/dashboard run test -- drive-renderer-shell
pnpm --filter @synapse/dashboard run test -- code-renderer
pnpm --filter @synapse/dashboard run typecheck
```

## Task 7: Build Skill Repository View Model And Hooks

Files:

- `dashboard/src/features/skill-repository/skill-repository-view-model.ts`
- `dashboard/src/features/skill-repository/skill-repository-view-model.test.ts`
- `dashboard/src/features/skill-repository/use-skill-repository.ts`

Steps:

- [x] Convert `SkillRepositoryDetailDto.files` into the shared file browser model.
- [x] Derive the display identity as `owner.handle ?? owner.displayName ?? owner.id` plus `repository.name`.
- [x] Mark `SKILL.md` as protected and root-priority in the adapter.
- [x] Expose actions allowed by file kind: text edit, binary replace, upload, rename, delete.
- [x] Block delete/rename for `SKILL.md` in the view model before calling the API.
- [x] Add hook state for selected path, loaded file content, saving, reloading, mutation errors, and detail refresh.
- [x] Use the API client methods from Task 4; no direct network calls in components.

Verification:

```bash
pnpm --filter @synapse/dashboard run test -- skill-repository-view-model
pnpm --filter @synapse/dashboard run typecheck
```

## Task 8: Add My Skills Route And Navigation

Files:

- `dashboard/src/features/skill-repository/skill-repository-list-page.tsx`
- `dashboard/src/routes/_authenticated/skill-repositories/index.tsx`
- `dashboard/src/components/layout/data/sidebar-data.ts`

Steps:

- [x] Add authenticated route `/skill-repositories`.
- [x] Add sidebar item labeled `Skill Repositories` or the closest existing product wording already used in Dashboard navigation.
- [x] Render a compact table/list with repository name, title, file count, updated time, and visibility badge.
- [x] Link rows to `/skill-repositories/$repositoryId`.
- [x] Add loading, empty, and error states with only necessary text.
- [x] Do not add marketing hero text or explanatory paragraphs.

Verification:

```bash
pnpm --filter @synapse/dashboard run typecheck
```

## Task 9: Add Repository Detail Page And File Browser

Files:

- `dashboard/src/features/skill-repository/skill-repository-detail-page.tsx`
- `dashboard/src/features/skill-repository/skill-repository-file-browser.tsx`
- `dashboard/src/routes/_authenticated/skill-repositories/$repositoryId.tsx`

Steps:

- [x] Add authenticated route `/skill-repositories/$repositoryId`.
- [x] Render a slim repository identity header:

```text
owner / repoName    private    Settings
```

- [x] Keep Install and Fork out of Phase 2, or render them disabled only if needed to preserve planned layout. Prefer omitting them until Phase 3.
- [x] Render the shared file browser as the primary page content.
- [x] Click folders to update current path from the virtual tree.
- [x] Click files to load content through the explicit content API.
- [x] Text files open the shared Code renderer with edit context.
- [x] Binary files show a minimal download/replace surface; if `downloadUrl` is null, show replace only and no fake download link.
- [x] Keep stable height and scroll regions so the list/editor does not resize on toolbar changes.

Verification:

```bash
pnpm --filter @synapse/dashboard run typecheck
```

## Task 10: Implement Text Editing Conflict Flow

Files:

- `dashboard/src/features/file-browser/renderers/code-renderer.tsx`
- `dashboard/src/features/skill-repository/use-skill-repository.ts`
- `dashboard/src/features/skill-repository/skill-repository-file-browser.tsx`

Steps:

- [x] Wire `saveText` to `PUT /api/skill-repositories/:id/files/text` with `expectedSha256` from the loaded file.
- [x] On save success, update saved text, clear dirty state, and refresh repository file metadata.
- [x] On HTTP 409, open the existing conflict dialog with options to keep editing, download local version, or reload.
- [x] Reload reads only the selected file content and refreshes metadata.
- [x] Confirm reload if the local editor is dirty.
- [x] Ensure all error messages are explicit and do not rely on `console.log`.

Verification:

```bash
pnpm --filter @synapse/dashboard run test -- code-renderer
pnpm --filter @synapse/dashboard run typecheck
```

## Task 11: Implement File Upload, Replace, Rename, And Delete UI

Files:

- `dashboard/src/features/skill-repository/skill-repository-file-browser.tsx`
- `dashboard/src/features/skill-repository/skill-repository-view-model.ts`
- `dashboard/src/features/skill-repository/use-skill-repository.ts`

Steps:

- [x] Add toolbar/menu actions for upload file to current virtual folder.
- [x] Add per-file actions for replace, rename, and delete.
- [x] Hide or disable rename/delete for `SKILL.md`.
- [x] Use dialogs from existing shadcn/ui patterns for rename/delete confirmation.
- [x] Validate destination paths before API calls and show server validation messages when returned.
- [x] Refresh repository detail after every successful mutation.
- [x] If a selected file is deleted or renamed, navigate to the parent folder or renamed file accordingly.
- [x] Do not introduce custom CSS, inline styles, cards inside cards, or decorative UI copy.

Verification:

```bash
pnpm --filter @synapse/dashboard run typecheck
```

## Task 12: Add Repository Settings

Files:

- `dashboard/src/features/skill-repository/skill-repository-settings-dialog.tsx`
- `dashboard/src/features/skill-repository/skill-repository-detail-page.tsx`

Steps:

- [x] Add a Settings action in the repository header.
- [x] Implement fields for `repoName`, `title`, and `description`.
- [x] Show visibility as private/read-only for Phase 2, with no public toggle.
- [x] Display fork source if `forkedFromRepositoryId` is present, but no fork behavior in Phase 2.
- [x] Implement delete repository confirmation with the repository name typed or otherwise explicit enough to prevent accidental deletion.
- [x] After rename, refresh data and keep the user on `/skill-repositories/$repositoryId`; do not route by name in Phase 2.
- [x] After delete, navigate back to `/skill-repositories`.

Verification:

```bash
pnpm --filter @synapse/dashboard run typecheck
```

## Task 13: Add Focused Dashboard Tests

Files:

- `dashboard/src/features/skill-repository/skill-repository-list-page.test.tsx`
- `dashboard/src/features/skill-repository/skill-repository-detail-page.test.tsx`
- Existing Code renderer tests if needed.

Steps:

- [x] Test My Skills renders repositories and links to detail.
- [x] Test empty state is concise.
- [x] Test detail page renders `owner / repoName`, private badge, and file rows.
- [x] Test folder navigation derived from flat paths.
- [x] Test `SKILL.md` delete/rename actions are unavailable.
- [x] Test text save calls API with `expectedSha256`.
- [x] Test conflict path keeps local edits and offers reload/download-local-version options.

Verification:

```bash
pnpm --filter @synapse/dashboard run test -- skill-repository
pnpm --filter @synapse/dashboard run test -- file-browser
```

## Task 14: Product Notes, Release Notes, And Final Verification

Files:

- `RELEASE_NOTES_PENDING.md`
- This plan file if checkboxes are updated during execution.

Steps:

- [x] Add a user-facing release note for private Skill Repository web management.
- [x] Run server focused tests.
- [x] Run Dashboard focused tests.
- [x] Run shared/server/dashboard typechecks.
- [x] Run a final search for forbidden UI patterns in new Dashboard files:

```bash
rg "style=|#[0-9A-Fa-f]{3,8}|rgb\\(|hsl\\(|from-|to-|gradient|console\\.log" dashboard/src/features/skill-repository dashboard/src/features/file-browser
```

- [x] Confirm no Phase 3 features were accidentally exposed as working UI.

Final verification commands:

```bash
pnpm --filter @synapse/shared run typecheck
pnpm --filter @synapse/server run test -- skill-repository
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run test -- file-browser
pnpm --filter @synapse/dashboard run test -- skill-repository
pnpm --filter @synapse/dashboard run typecheck
```

## Implementation Notes

- Preserve Phase 1's API shape: repository detail returns file metadata, not file content.
- Preserve private-only server scoping for Phase 2.
- Do not route by `ownerHandle/repoName` yet. Keep stable ID management routes to avoid Phase 3 public identity coupling.
- Reuse `CONTENT_STORE_STORAGE_PORT`; Skill Repository objects stay in the Content Store storage domain as established in Phase 1.
- Database rows store only metadata and storage keys; never store file bytes in PostgreSQL.
- Do not invent a signed download URL if the existing storage abstraction does not support it. Binary download can be completed in Phase 3 or added with a proper storage API extension.
- Keep Desktop out of this phase except for existing management URLs from Phase 1.
- If implementing repository name redirects, preserve existing old-name redirect rows and do not break current management URLs by repository ID.
