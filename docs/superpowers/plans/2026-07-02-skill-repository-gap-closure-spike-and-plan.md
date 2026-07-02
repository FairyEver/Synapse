# Skill Repository Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified gaps between the original Skill Repository redesign and the current implementation.

**Architecture:** Keep the existing Skill Repository model and routes. Add the missing behavior as small extensions to the current service/controller/API/MCP surfaces instead of reopening the product model. Treat the Spike section as the first task: it records facts and locks final scope before code changes.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, NestJS, Prisma, shadcn/ui, Tailwind CSS 4, Vitest.

---

## Spike Scope

The audit found five concrete gaps or deviations:

1. Single repository file download is missing; binary files can be replaced but not downloaded.
2. MCP has no dedicated `app_skill_repository_set_visibility` tool.
3. Public Skill Repository admin hide/remove/restore flow is not implemented as a first-class admin surface.
4. Legacy Content Store `copiedFromContentId` is not mapped to `SkillRepository.forkedFromRepositoryId` during migration.
5. Desktop scan-detail compatibility upload creates Skill Repository records but does not write or read `.synapse.json`, so repeated uploads do not use stable repository identity.

## Files

- Modify: `shared/src/skill-repository.ts`
- Modify: `shared/src/skill-repository.test.ts`
- Modify: `server/src/skill-repository/skill-repository.service.ts`
- Modify: `server/src/skill-repository/skill-repository.service.spec.ts`
- Modify: `server/src/skill-repository/skill-repository.controller.ts`
- Modify: `server/src/skill-repository/skill-repository.controller.spec.ts`
- Modify: `server/src/skill-repository/skill-repository-legacy-migration.service.ts`
- Modify: `server/src/skill-repository/skill-repository-legacy-migration.service.spec.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`
- Modify: `dashboard/src/features/skill-repository/skill-repository-file-browser.tsx`
- Modify: `dashboard/src/features/skill-repository/skill-repository-pages.test.tsx`
- Create: `dashboard/src/features/skill-repository/skill-repository-admin.tsx`
- Create: `dashboard/src/features/skill-repository/skill-repository-admin.test.tsx`
- Create: `dashboard/src/routes/_authenticated/skill-repositories/admin.tsx`
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.test.ts`
- Modify: `desktop/synapse-capabilities/shared/skill-repository-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/skill-repository-domain.test.ts`
- Modify: `desktop/electron/capabilities/skill-repository-dispatcher.ts`
- Modify: `desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/content-store-upload-service.ts`
- Modify: `desktop/electron/services/__tests__/content-store-upload-service.test.ts`
- Modify: `desktop/electron/modules/editor-scan/__tests__/ipc.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

---

### Task 1: Spike Lockdown

**Files:**
- Read: `docs/superpowers/specs/2026-07-01-skill-repository-redesign.md`
- Read: `docs/superpowers/plans/2026-07-01-skill-repository-phase-1.md`
- Read: `docs/superpowers/plans/2026-07-02-skill-repository-phase-2.md`
- Read: `docs/superpowers/plans/2026-07-02-skill-repository-phase-3.md`
- Read: `docs/superpowers/plans/2026-07-02-skill-repository-phase-4.md`
- Read: all files listed in the plan's `Files` section before editing them

- [ ] **Step 1: Confirm the gap list still matches the code**

Run:

```bash
rg -n "downloadUrl|files/download|app_skill_repository_set_visibility|copiedFromContentId|forkedFromRepositoryId|readSkillRepositoryIdentity|writeSkillRepositoryIdentity|Legacy Content Store|Skill Repository" \
  shared/src/skill-repository.ts \
  server/src/skill-repository \
  dashboard/src/features/skill-repository \
  dashboard/src/features/content-store \
  dashboard/src/lib/api.ts \
  desktop/electron/services \
  desktop/electron/capabilities \
  desktop/synapse-capabilities/shared
```

Expected:
- `downloadUrl` exists, but no file download endpoint exists for Skill Repository files.
- `app_skill_repository_set_visibility` is absent.
- `copiedFromContentId` is not read by the legacy migration service.
- `skill-repository-upload-service.ts` uses `.synapse.json`, while `content-store-upload-service.ts` does not.

- [ ] **Step 2: Confirm admin placement before coding**

Run:

```bash
rg -n "content-store-admin|admin.*content-store|removed|featured|ContentStoreAdmin" server/src dashboard/src -g '*.{ts,tsx}'
```

Expected:
- Existing admin routes and dashboard UI are Content Store specific.
- The old admin page includes Content Store-specific type, featured, detail, and moderation concepts.
- Keep the implementation decision below unless the command reveals that a dedicated Skill Repository admin page already exists.

- [ ] **Step 3: Use the locked admin placement decision**

Admin placement decision: create a dedicated `dashboard/src/features/skill-repository/skill-repository-admin.tsx` page backed by new methods in `server/src/admin/admin.controller.ts` and `server/src/admin/admin.service.ts`. Do not add Skill Repository controls to `dashboard/src/features/content-store/content-store-admin.tsx`, because that page still carries legacy type/featured/detail semantics.

---

### Task 2: Add Repository File Download

**Files:**
- Modify: `server/src/skill-repository/skill-repository.service.ts`
- Modify: `server/src/skill-repository/skill-repository.service.spec.ts`
- Modify: `server/src/skill-repository/skill-repository.controller.ts`
- Modify: `server/src/skill-repository/skill-repository.controller.spec.ts`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/features/skill-repository/skill-repository-file-browser.tsx`
- Modify: `dashboard/src/features/skill-repository/skill-repository-pages.test.tsx`

- [ ] **Step 1: Write service tests for file download**

Add tests covering:
- owner can download a private repository file;
- signed-in non-owner can download a public repository file;
- non-owner cannot download a private repository file;
- missing file returns not found;
- binary and text files both stream bytes, because the download action is separate from inline editing.

Use existing mocks in `server/src/skill-repository/skill-repository.service.spec.ts`; assert `storage.getObjectStream` is called with the file storage key.

- [ ] **Step 2: Implement `openFileDownload` in the service**

Add a method equivalent to:

```ts
async openFileDownload(userId: string, repositoryId: string, path: string) {
  await this.requireReadableActiveRepository(userId, repositoryId)
  const file = await this.requireRepositoryFile(repositoryId, path)
  if (!file.storageKey) throw new NotFoundException("Skill 文件不存在。")
  const object = await this.storage.getObjectStream({ key: file.storageKey })
  return {
    stream: object.stream,
    contentType: file.mimeType ?? "application/octet-stream",
    size: numberFromSize(file.size),
    filename: file.path.split("/").filter(Boolean).at(-1) ?? "skill-file",
  }
}
```

Use the repo's existing helper style for error handling and size conversion.

- [ ] **Step 3: Add controller download routes**

Add:

```text
GET /api/skill-repositories/:id/files/download?path=...
GET /api/skill-repositories/by-path/:ownerHandle/:repositoryName/files/download?path=...
```

Stream with headers:

```ts
response.setHeader("Content-Type", download.contentType)
response.setHeader("Content-Length", download.size.toString())
response.setHeader("Content-Disposition", `attachment; filename="${safeDownloadFilename(download.filename)}"`)
```

Keep the existing stream error pattern used by install package downloads.

- [ ] **Step 4: Add dashboard API URL builders**

Add functions that return URLs rather than JSON requests:

```ts
getSkillRepositoryFileDownloadUrl: (id: string, path: string) =>
  `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/files/download?${new URLSearchParams({ path }).toString()}`,
getSkillRepositoryFileDownloadUrlByPath: (ownerHandle: string, repositoryName: string, path: string) =>
  `${skillRepositoryApiBasePath}/by-path/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(repositoryName)}/files/download?${new URLSearchParams({ path }).toString()}`,
```

- [ ] **Step 5: Add UI download action**

In `SkillRepositoryFileBrowser`, add a `Download` dropdown action for every file row. For owner pages, show `下载`, `替换`, `重命名`, `删除`. For readonly public pages, show `下载` only.

Use a real anchor click:

```ts
function downloadFile(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}
```

Do not add custom colors or one-off CSS.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard exec vitest run src/features/skill-repository src/lib/api.test.ts
```

Expected: tests pass.

---

### Task 3: Add MCP `set_visibility`

**Files:**
- Modify: `desktop/synapse-capabilities/shared/skill-repository-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/skill-repository-domain.test.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/capabilities/skill-repository-dispatcher.ts`
- Modify: `desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`

- [ ] **Step 1: Add shared capability and tool test**

Expected tool:

```ts
{
  name: "app_skill_repository_set_visibility",
  inputSchema: {
    type: "object",
    properties: {
      repositoryId: repositoryIdProperty,
      visibility: {
        type: "string",
        enum: ["private", "public"],
        description: "Target Skill repository visibility.",
      },
      openInBrowser: openInBrowserProperty,
    },
    required: ["repositoryId", "visibility"],
  },
}
```

Test that `SKILL_REPOSITORY_MCP_TOOL_ACTIONS.app_skill_repository_set_visibility` maps to `app.skill_repository.item.set_visibility`.

- [ ] **Step 2: Add account service update method**

Add:

```ts
async updateSkillRepository(repositoryId: string, input: SkillRepositoryUpdateInput): Promise<SkillRepositoryDetailDto> {
  return this.requestAuthenticatedJson<SkillRepositoryDetailDto>(
    "PATCH",
    `${apiBaseUrl()}/skill-repositories/${encodeURIComponent(repositoryId)}`,
    input,
    "Skill 仓库更新失败。",
  )
}
```

- [ ] **Step 3: Add dispatcher handling**

Add `updateSkillRepository` to the dispatcher account port and route:

```ts
case "app.skill_repository.item.set_visibility":
  return setSkillRepositoryVisibility(deps, params)
```

Implementation:

```ts
async function setSkillRepositoryVisibility(deps: SkillRepositoryCapabilityDispatcherDeps, params: Record<string, unknown>): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const visibility = requireVisibility(params)
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  const repository = await deps.accountService.updateSkillRepository(repositoryId, { visibility })
  const { buildSkillRepositoryManagementUrl } = await sharedSkillRepositoryPromise
  const managementUrl = buildSkillRepositoryManagementUrl(deps.publicAppUrl, repository.id)
  if (openInBrowser === true && deps.openExternal) await deps.openExternal(managementUrl)
  return { ok: true, data: { repository, managementUrl } }
}
```

`requireVisibility` must accept only `private` or `public`.

- [ ] **Step 4: Preserve missing handle behavior**

Do not catch `USER_HANDLE_REQUIRED`; let the account service error propagate so the MCP caller sees the structured server failure. The tool description must explicitly say: if public fails with `USER_HANDLE_REQUIRED`, ask the user to set username in Dashboard settings and do not set it automatically.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop exec vitest run synapse-capabilities/shared/skill-repository-domain.test.ts electron/capabilities/__tests__/skill-repository-dispatcher.test.ts
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop typecheck
```

Expected: tests and typecheck pass.

---

### Task 4: Add Skill Repository Admin Moderation

**Files:**
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.spec.ts`
- Modify: `server/src/admin/admin.service.spec.ts`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.test.ts`
- Create: `dashboard/src/features/skill-repository/skill-repository-admin.tsx`
- Create: `dashboard/src/features/skill-repository/skill-repository-admin.test.tsx`
- Create: `dashboard/src/routes/_authenticated/skill-repositories/admin.tsx`

- [ ] **Step 1: Write admin server tests**

Cover:
- admin can list public active repositories;
- admin can mark a repository `removed`;
- admin can restore a removed repository to `active`;
- non-admin requests are rejected by existing admin guard;
- removed repositories disappear from public list and by-path resolution.

- [ ] **Step 2: Add minimal admin server routes**

Use routes shaped like:

```text
GET /api/admin/skill-repositories?status=active|removed&page=1&pageSize=20&query=...
POST /api/admin/skill-repositories/:id/removed
DELETE /api/admin/skill-repositories/:id/removed
```

The list should return repository id, owner handle/display name, name, title, visibility, status, updatedAt, and legacy install count. Do not add reviews, approvals, featured flags, tags, comments, or marketplace concepts.

- [ ] **Step 3: Add dashboard admin API methods**

Add methods next to existing admin APIs:

```ts
listAdminSkillRepositories(options)
setAdminSkillRepositoryRemoved(id)
restoreAdminSkillRepository(id)
```

Use existing `request` and query helpers.

- [ ] **Step 4: Add minimal admin UI**

Build a dense table with columns:
- repository;
- owner;
- visibility;
- status;
- updated time;
- actions.

Actions:
- `移除` for active repositories;
- `恢复` for removed repositories;
- `打开` to management page.

No publish/review/feature controls.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/admin src/skill-repository
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard exec vitest run src/components/layout src/features/skill-repository src/lib/api.test.ts
```

Expected: tests pass.

---

### Task 5: Map Legacy `copiedFromContentId` To Fork Source During Migration

**Files:**
- Modify: `server/src/skill-repository/skill-repository-legacy-migration.service.ts`
- Modify: `server/src/skill-repository/skill-repository-legacy-migration.service.spec.ts`

- [ ] **Step 1: Expand migration row type**

Add to `LegacyItemRow`:

```ts
readonly copiedFromContentId: string | null
```

Ensure the Prisma query selects or includes this field through the existing model row.

- [ ] **Step 2: Add failing migration test**

Create two legacy Skill items:
- source item migrates first to `repo-source`;
- copied item has `copiedFromContentId: "source-content-id"`.

Assert copied repository create data includes:

```ts
forkedFromRepositoryId: "repo-source"
```

- [ ] **Step 3: Implement lookup**

Before creating each repository, resolve fork source:

```ts
let forkedFromRepositoryId: string | null = null
if (item.copiedFromContentId) {
  const sourceRepository = await this.prisma.skillRepository.findUnique({
    where: { legacyContentStoreItemId: item.copiedFromContentId },
    select: { id: true },
  }) as LegacyRepositoryRow | null
  forkedFromRepositoryId = sourceRepository?.id ?? null
}
```

Pass `forkedFromRepositoryId` only when present.

- [ ] **Step 4: Add warning for unmapped copied source**

If `copiedFromContentId` exists but no migrated source repository exists, add `SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING` to `skillRepositoryErrorCodes` and shared tests. Emit a migration warning with that code and continue migrating the copied Skill as an independent repository.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/shared test -- skill-repository
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository/skill-repository-legacy-migration.service.spec.ts
```

Expected: tests pass.

---

### Task 6: Make Desktop Scan Upload Use Cloud Repository Identity

**Files:**
- Modify: `desktop/electron/services/content-store-upload-service.ts`
- Modify: `desktop/electron/services/__tests__/content-store-upload-service.test.ts`
- Modify: `desktop/electron/modules/editor-scan/__tests__/ipc.test.ts`

- [ ] **Step 1: Add tests for identity read/update/write**

Cover:
- no identity: upload creates repository and writes `.synapse.json`;
- existing `cloud-skill-repository` identity: upload passes `repositoryId`;
- identity write failure does not block the compatibility upload result;
- browser URL remains the Skill Repository management URL.

- [ ] **Step 2: Reuse `SkillRepositoryUploadService` through an injected port**

Replace duplicated upload code in `ContentStoreUploadService.uploadSkillDraftToContentStore` with a constructor-injected uploader port:

```ts
type SkillRepositoryCompatibilityUploader = {
  readonly importLocal: (
    input: SkillRepositoryLocalImportInput,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ) => Promise<SkillRepositoryLocalImportResult>
}
```

Default the port to `skillRepositoryUploadService`. Call it with:

```ts
const result = await skillRepositoryUploadService.importLocal({
  sourceDirectoryPath: request.itemPath,
  name: request.itemName,
  openInBrowser: false,
}, security)
```

Then adapt result back to the legacy scan result shape:

```ts
return {
  draftId: result.repositoryId,
  itemId: result.repositoryId,
  revision: 1,
  consoleEditUrl: result.managementUrl,
  dashboardEditUrl: result.managementUrl,
}
```

Keep `EditorScanContentStoreUploadResult` unchanged.

- [ ] **Step 3: Preserve legacy UI contract**

Do not rename renderer labels in this task. The scan detail button can still be the compatibility entry, but the backend behavior must use Skill Repository stable identity.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop exec vitest run electron/services/__tests__/content-store-upload-service.test.ts electron/modules/editor-scan/__tests__/ipc.test.ts
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop typecheck
```

Expected: tests and typecheck pass.

---

### Task 7: Documentation And Release Notes

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update built-in MCP Skill docs**

Add:
- `app_skill_repository_set_visibility`;
- missing-handle behavior;
- install/download distinction;
- statement that public/admin removal is not publishing review.

- [ ] **Step 2: Update API reference examples**

Add example input:

```json
{
  "repositoryId": "repo-id",
  "visibility": "public",
  "openInBrowser": true
}
```

Add example output shape with `repository` and `managementUrl`.

- [ ] **Step 3: Update release notes**

Add one user-facing bullet:

```md
- Skill Repository 补齐了单文件下载、MCP 切换公开状态、旧复制关系迁移和扫描上传更新识别，公开仓库也支持后台移除/恢复。
```

---

### Task 8: Final Focused Verification

**Files:**
- No code files unless verification reveals a failure.

- [ ] **Step 1: Run shared tests**

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/shared test -- skill-repository
```

Expected: pass.

- [ ] **Step 2: Run server tests**

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository src/content-store src/admin
```

Expected: pass.

- [ ] **Step 3: Run dashboard tests and build**

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard exec vitest run src/features/skill-repository src/features/content-store src/components/layout src/lib/api.test.ts
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard build
```

Expected: tests pass; build passes. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 4: Run desktop tests and typecheck**

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop exec vitest run synapse-capabilities/shared/skill-repository-domain.test.ts electron/capabilities/__tests__/skill-repository-dispatcher.test.ts electron/services/__tests__/content-store-upload-service.test.ts electron/modules/editor-scan/__tests__/ipc.test.ts
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Run diff hygiene**

```bash
git diff --check
```

Expected: no output.

---

## Self-Review

- Spec coverage: every verified gap has a task.
- Placeholder scan: no `TBD` or open-ended implementation steps remain.
- Type consistency: all new names use existing Skill Repository naming style and avoid introducing release/history/review semantics.
- Scope: this plan does not reopen Prompt/Rule cloud sharing, releases, version history, team collaboration, ratings, comments, or marketplace promotion.
