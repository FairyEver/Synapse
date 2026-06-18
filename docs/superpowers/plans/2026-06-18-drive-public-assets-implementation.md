# Drive Public Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Drive `公开素材`, Drive trash lifecycle, public `/files/<assetId>` image URLs, admin inspection, desktop UI, and MCP support from the approved design.

**Architecture:** Keep Drive as the file ownership and storage foundation. Add focused public-asset and lifecycle helpers/services around the existing Drive service instead of turning public assets into a separate file system. UI remains a compact Drive table experience using existing shadcn/Radix components and token styling.

**Tech Stack:** NestJS, Prisma, Vitest, React 19, Electron bridge, shadcn/ui, Tailwind token classes, `@synapse/shared`, Synapse MCP capability registry.

---

## File Structure

Create:

- `server/src/drive/drive-public-asset-policy.ts`: public asset extension/MIME/signature policy.
- `server/src/drive/drive-public-asset.service.ts`: public asset upload, replace, list, get, rename, download, stats, and public URL resolution.
- `server/src/drive/drive-lifecycle.service.ts`: Drive active, trash, hidden, restore, quota, and restore conflict behavior.
- `server/src/drive/drive-public-asset-policy.spec.ts`: image policy tests.
- `server/src/drive/drive-public-asset.service.spec.ts`: public asset service tests.
- `server/src/drive/drive-lifecycle.service.spec.ts`: lifecycle and trash tests.
- `server/prisma/migrations/20260618160000_drive_public_assets_and_trash/migration.sql`: schema migration.
- `desktop/src/modules/drive/drive-public-assets-view.tsx`: user public asset list, detail sheet, upload result panel.
- `desktop/src/modules/drive/drive-trash-view.tsx`: user trash list and actions.
- `desktop/src/modules/drive/drive-system-entries.ts`: virtual root entry helpers.
- `desktop/src/modules/drive/__tests__/drive-public-assets-view.test.tsx`: public asset UI tests.
- `desktop/src/modules/drive/__tests__/drive-trash-view.test.tsx`: trash UI tests.
- `dashboard/src/features/drive-browser/admin-public-assets.tsx`: admin public asset list/detail.
- `dashboard/src/features/drive-browser/admin-drive-storage-summary.tsx`: admin storage summary panel.

Modify:

- `shared/src/drive.ts`: public asset, trash, lifecycle DTOs and URL helpers.
- `shared/src/drive.test.ts`: shared helper tests.
- `server/prisma/schema.prisma`: tables and fields.
- `server/src/drive/drive-token.ts`: asset id generation.
- `server/src/drive/drive-token.spec.ts`: asset id tests.
- `server/src/drive/drive.types.ts`: DTO conversion helpers.
- `server/src/drive/drive.constants.ts`: lifecycle constants and public asset size coupling to Drive max file size.
- `server/src/drive/drive.service.ts`: delegate delete/restore paths to lifecycle service and preserve share metadata.
- `server/src/drive/drive.controller.ts`: user, admin, and public routes.
- `server/src/drive/drive.module.ts`: register new services.
- `server/src/drive/drive.service.spec.ts`: update delete/share/version expectations.
- `server/src/drive/drive.controller.spec.ts`: new route tests.
- `server/src/drive/drive.e2e.spec.ts`: end-to-end Drive trash and public URL coverage.
- `desktop/electron/services/account-service.ts`: bridge API client methods and local upload orchestration.
- `desktop/src/types/bridge.ts`: bridge method types.
- `desktop/src/modules/drive/index.tsx`: route virtual root entries to new views and keep normal Drive behavior intact.
- `desktop/src/modules/drive/__tests__/drive-module.test.tsx`: root entries and search behavior.
- `dashboard/src/lib/api.ts`: admin API client methods and DTO types.
- `dashboard/src/lib/api.test.ts`: admin API client tests.
- `dashboard/src/features/drive-browser/drive-browser-page.tsx`: admin entry points and filters.
- `dashboard/src/features/drive-browser/drive-browser-page.test.ts`: admin UI tests.
- `desktop/synapse-capabilities/shared/drive-domain.ts`: new MCP capabilities and tool schemas.
- `desktop/synapse-capabilities/shared/drive-domain.test.ts`: capability naming/schema tests.
- `desktop/resources/templates/skills/synapse-drive-mcp/content.md`: user-facing MCP guide update.
- `desktop/resources/templates/skills/synapse-drive-mcp/files/api-reference.md`: API reference update if present; create it under this skill if missing.
- `RELEASE_NOTES_PENDING.md`: user-visible release note.

Do not modify `templates/`.

---

### Task 1: Shared Contracts And URL Helpers

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add tests that lock the public asset URL, lifecycle types, and status labels:

```ts
import {
  DRIVE_PUBLIC_ASSET_PATH_PREFIX,
  buildDrivePublicAssetUrl,
  isDrivePublicAssetId,
} from "./drive"

it("builds public asset URLs without filenames", () => {
  expect(DRIVE_PUBLIC_ASSET_PATH_PREFIX).toBe("/files")
  expect(buildDrivePublicAssetUrl({
    publicAppUrl: "https://synapse.example/",
    assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yu",
  })).toBe("https://synapse.example/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yu")
})

it("validates public asset ids", () => {
  expect(isDrivePublicAssetId("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yu")).toBe(true)
  expect(isDrivePublicAssetId("asset_short")).toBe(false)
  expect(isDrivePublicAssetId("shr_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yu")).toBe(false)
})
```

- [ ] **Step 2: Run the failing shared tests**

Run: `pnpm --filter @synapse/shared test -- drive.test.ts`

Expected: fail because the exported helpers and constants do not exist.

- [ ] **Step 3: Add shared DTOs and helpers**

Add these exports to `shared/src/drive.ts`:

```ts
export const DRIVE_PUBLIC_ASSET_PATH_PREFIX = "/files"

export type DriveItemLifecycleStatus = "active" | "trashed" | "hidden" | "legacy_missing"
export type DriveTrashItemKind = "normal" | "public_asset"

export interface DrivePublicAssetDto {
  readonly assetId: string
  readonly itemId: string
  readonly name: string
  readonly size: string
  readonly mimeType: string
  readonly url: string
  readonly lifecycleStatus: DriveItemLifecycleStatus
  readonly accessCount: string
  readonly responseBytes: string
  readonly lastAccessedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DrivePublicAssetListPageDto {
  readonly items: readonly DrivePublicAssetDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveTrashItemDto {
  readonly id: string
  readonly kind: DriveTrashItemKind
  readonly name: string
  readonly type: DriveItemType
  readonly size: string
  readonly mimeType: string | null
  readonly originalPath: string | null
  readonly assetId?: string
  readonly trashedAt: string
}

export interface DriveTrashListPageDto {
  readonly items: readonly DriveTrashItemDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export function buildDrivePublicAssetUrl(input: { readonly publicAppUrl: string; readonly assetId: string }): string {
  return `${input.publicAppUrl.replace(/\/+$/u, "")}${DRIVE_PUBLIC_ASSET_PATH_PREFIX}/${encodeURIComponent(input.assetId)}`
}

export function isDrivePublicAssetId(value: string): boolean {
  return /^asset_[0-9A-Za-z]{32}$/u.test(value)
}
```

- [ ] **Step 4: Run shared tests**

Run: `pnpm --filter @synapse/shared test -- drive.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(shared): add drive public asset contracts"
```

---

### Task 2: Prisma Schema, Migration, Constants, And Asset Ids

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260618160000_drive_public_assets_and_trash/migration.sql`
- Modify: `server/src/drive/drive.constants.ts`
- Modify: `server/src/drive/drive-token.ts`
- Modify: `server/src/drive/drive-token.spec.ts`
- Create: `server/src/drive/drive-public-asset-policy.ts`
- Create: `server/src/drive/drive-public-asset-policy.spec.ts`
- Test: `server/src/drive/drive-token.spec.ts`

- [ ] **Step 1: Write failing asset id and policy tests**

Add to `server/src/drive/drive-token.spec.ts`:

```ts
import { createDrivePublicAssetId } from "./drive-token"

it("creates fixed-length public asset ids", () => {
  expect(createDrivePublicAssetId()).toMatch(/^asset_[0-9A-Za-z]{32}$/u)
  expect(createDrivePublicAssetId()).toHaveLength(38)
})
```

Add `server/src/drive/drive-public-asset-policy.spec.ts`:

```ts
import { detectPublicAssetImageType, validatePublicAssetNameAndMime } from "./drive-public-asset-policy"

describe("public asset policy", () => {
  it("accepts png names and mime", () => {
    expect(validatePublicAssetNameAndMime({ name: "logo.png", mimeType: "image/png" })).toEqual({
      extension: "png",
      mimeType: "image/png",
    })
  })

  it("rejects svg", () => {
    expect(() => validatePublicAssetNameAndMime({ name: "logo.svg", mimeType: "image/svg+xml" })).toThrow("仅支持图片")
  })

  it("detects png signature", () => {
    expect(detectPublicAssetImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png")
  })
})
```

- [ ] **Step 2: Run failing server tests**

Run: `pnpm --filter @synapse/server test -- drive-token.spec.ts drive-public-asset-policy.spec.ts`

Expected: fail because new helper exports do not exist or are incomplete.

- [ ] **Step 3: Implement asset id generator and policy**

Add to `server/src/drive/drive-token.ts`:

```ts
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export function createDrivePublicAssetId(): string {
  const bytes = randomBytes(32)
  let suffix = ""
  for (let index = 0; index < 32; index += 1) {
    suffix += BASE62_ALPHABET[bytes[index]! % BASE62_ALPHABET.length]
  }
  return `asset_${suffix}`
}
```

Implement `server/src/drive/drive-public-asset-policy.ts`:

```ts
const PUBLIC_ASSET_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
  ["ico", "image/x-icon"],
] as const)

export function validatePublicAssetNameAndMime(input: { readonly name: string; readonly mimeType?: string | null }) {
  const extension = input.name.split(".").pop()?.toLowerCase()
  if (!extension || !PUBLIC_ASSET_TYPES.has(extension)) throw new Error("仅支持图片。")
  const expected = PUBLIC_ASSET_TYPES.get(extension)!
  if (input.mimeType !== expected) throw new Error("文件类型与扩展名不匹配。")
  return { extension, mimeType: expected }
}

export function detectPublicAssetImageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif"
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  if (bytes.subarray(4, 12).toString("ascii") === "ftypavif") return "image/avif"
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon"
  return null
}
```

- [ ] **Step 4: Add Prisma schema and migration**

Update `DriveItem` with lifecycle fields, add `PublicAsset`, `PublicAssetAccessLog`, and `PublicAssetRevision`, and extend `DriveUploadSession`.

Migration SQL must add columns with defaults for existing active rows:

```sql
ALTER TABLE "DriveItem" ADD COLUMN "lifecycleStatus" VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE "DriveItem" ADD COLUMN "trashedAt" TIMESTAMP(3);
ALTER TABLE "DriveItem" ADD COLUMN "trashedBy" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "DriveItem" ADD COLUMN "hiddenBy" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "restoreParentId" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "restorePath" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "deleteRootId" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "objectMissing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DriveUploadSession" ADD COLUMN "purpose" VARCHAR(32) NOT NULL DEFAULT 'drive_upload';
ALTER TABLE "DriveUploadSession" ADD COLUMN "publicAssetId" TEXT;
ALTER TABLE "DriveUploadSession" ADD COLUMN "replacePreviousStorageKey" TEXT;

UPDATE "DriveItem"
SET "lifecycleStatus" = CASE WHEN "deletedAt" IS NULL THEN 'active' ELSE 'legacy_missing' END,
    "objectMissing" = CASE WHEN "deletedAt" IS NULL THEN false ELSE true END;
```

Create the three public asset tables with the indexes from the design spec.

- [ ] **Step 5: Generate Prisma client and run tests**

Run:

```bash
pnpm --filter @synapse/server prisma:generate
pnpm --filter @synapse/server test -- drive-token.spec.ts drive-public-asset-policy.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260618160000_drive_public_assets_and_trash/migration.sql server/src/drive/drive.constants.ts server/src/drive/drive-token.ts server/src/drive/drive-token.spec.ts server/src/drive/drive-public-asset-policy.ts server/src/drive/drive-public-asset-policy.spec.ts
git commit -m "feat(drive): add public asset schema and policy"
```

---

### Task 3: Drive Lifecycle And Trash Service

**Files:**
- Create: `server/src/drive/drive-lifecycle.service.ts`
- Create: `server/src/drive/drive-lifecycle.service.spec.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.module.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.service.spec.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create tests covering:

```ts
it("moves active files to trash without deleting storage objects or releasing quota", async () => {
  const file = await seedActiveDriveFile({ userId: "user-1", name: "a.png", size: 10n })
  await lifecycle.trashItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })
  expect(await readDriveItem(file.id)).toMatchObject({ lifecycleStatus: "trashed", storageStatus: "active" })
  expect(storage.deleteObject).not.toHaveBeenCalled()
  expect(await usedBytes("user-1")).toBe(10n)
})

it("hides trashed files and releases user quota while keeping storage", async () => {
  const file = await seedTrashedDriveFile({ userId: "user-1", name: "a.png", size: 10n })
  await lifecycle.hideTrashedItem({ userId: "user-1", itemId: file.id, actorId: "user-1", ipAddress: "127.0.0.1" })
  expect(await readDriveItem(file.id)).toMatchObject({ lifecycleStatus: "hidden" })
  expect(storage.deleteObject).not.toHaveBeenCalled()
  expect(await usedBytes("user-1")).toBe(0n)
})

it("restores to root and auto-renames when original parent is unavailable and name conflicts", async () => {
  await seedActiveDriveFile({ userId: "user-1", parentId: null, name: "a.png", size: 1n })
  const trashed = await seedTrashedDriveFile({ userId: "user-1", parentId: "missing-folder", name: "a.png", size: 1n })
  const restored = await lifecycle.restoreItem({ userId: "user-1", itemId: trashed.id, actorId: "user-1", ipAddress: "127.0.0.1" })
  expect(restored.parentId).toBeNull()
  expect(restored.name).toBe("a 1.png")
})
```

Use existing Drive service test fake Prisma patterns. Name local helpers clearly inside the test file.

- [ ] **Step 2: Run failing lifecycle tests**

Run: `pnpm --filter @synapse/server test -- drive-lifecycle.service.spec.ts`

Expected: fail because the lifecycle service does not exist.

- [ ] **Step 3: Implement lifecycle service**

Implement methods:

```ts
trashItem(input)
hideTrashedItem(input)
restoreItem(input)
listTrash(userId, input)
```

Rules:

- trash updates subtree `lifecycleStatus=trashed`, stores `restoreParentId`, `restorePath`, and `deleteRootId`.
- trash does not call `storage.deleteObject`.
- trash does not decrement quota.
- hide updates subtree `lifecycleStatus=hidden`.
- hide decrements user quota for current file objects in the subtree.
- restore checks quota, restores subtree to active, clears delete metadata, and auto-renames normal Drive conflicts.
- public asset conflict handling is skipped because duplicate names are allowed.

- [ ] **Step 4: Wire existing delete to lifecycle**

Modify `DriveService.deleteItem()` and admin delete semantics:

```ts
async deleteItem(userId: string, itemId: string, actorEmail = userId, ipAddress = "system") {
  await this.lifecycle.trashItem({ userId, itemId, actorId: userId, ipAddress })
  return { ok: true }
}
```

Public share access checks must require `item.lifecycleStatus === "active"` in addition to existing enabled/share rules.

- [ ] **Step 5: Add trash routes**

Add to `DriveUserController`:

```ts
@Get("/trash")
listTrash(...)

@Post("/items/:id/restore")
restoreItem(...)

@Delete("/trash/:id")
hideTrashItem(...)
```

- [ ] **Step 6: Run focused server tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive-lifecycle.service.spec.ts drive.service.spec.ts drive.controller.spec.ts
```

Expected: pass after updating expectations that deletion no longer removes storage or disables share metadata.

- [ ] **Step 7: Commit**

```bash
git add server/src/drive/drive-lifecycle.service.ts server/src/drive/drive-lifecycle.service.spec.ts server/src/drive/drive.service.ts server/src/drive/drive.module.ts server/src/drive/drive.controller.ts server/src/drive/drive.service.spec.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat(drive): add trash lifecycle"
```

---

### Task 4: Public Asset Service And Public URL

**Files:**
- Create: `server/src/drive/drive-public-asset.service.ts`
- Create: `server/src/drive/drive-public-asset.service.spec.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.module.ts`
- Modify: `server/src/drive/drive.types.ts`
- Modify: `server/src/drive/drive.e2e.spec.ts`

- [ ] **Step 1: Write failing public asset service tests**

Add tests for:

```ts
it("creates a public asset through prepare and complete", async () => {
  const prepared = await service.prepareUpload("user-1", {
    name: "logo.png",
    size: "8",
    mimeType: "image/png",
    publicAppUrl: "https://synapse.example",
  })
  await storage.putObject({ key: prepared.upload.storageKeyForTest, body: pngSignatureBuffer(), contentType: "image/png" })
  const completed = await service.completeUpload("user-1", prepared.sessionId, { ipAddress: "127.0.0.1" })
  expect(completed.url).toMatch(/^https:\/\/synapse\.example\/files\/asset_[0-9A-Za-z]{32}$/u)
  expect(completed.name).toBe("logo.png")
})

it("replaces content without changing assetId", async () => {
  const asset = await seedPublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yu", name: "logo.png", size: 8n })
  const prepared = await service.prepareReplace("user-1", asset.assetId, { name: "logo.webp", size: "12", mimeType: "image/webp" })
  await storage.putObject({ key: prepared.upload.storageKeyForTest, body: webpSignatureBuffer(), contentType: "image/webp" })
  const replaced = await service.completeReplace("user-1", asset.assetId, prepared.sessionId, { ipAddress: "127.0.0.1" })
  expect(replaced.assetId).toBe(asset.assetId)
  expect(replaced.name).toBe("logo.webp")
})
```

- [ ] **Step 2: Run failing service tests**

Run: `pnpm --filter @synapse/server test -- drive-public-asset.service.spec.ts`

Expected: fail because the public asset service is missing.

- [ ] **Step 3: Implement public asset service**

Implement methods:

```ts
listAssets(userId, publicAppUrl, input)
getAsset(userId, assetId, publicAppUrl)
prepareUpload(userId, input)
completeUpload(userId, sessionId, auditContext)
cancelUpload(userId, sessionId, auditContext)
prepareReplace(userId, assetId, input)
completeReplace(userId, assetId, sessionId, auditContext)
cancelReplace(userId, assetId, sessionId, auditContext)
renameAsset(userId, assetId, name, auditContext)
trashAsset(userId, assetId, auditContext)
restoreAsset(userId, assetId, auditContext)
openAssetDownload(userId, assetId)
resolvePublicAsset(assetId, requestHeaders)
recordAccessSafely(input)
```

Use `DriveStoragePort.headObject`, `getObjectStream`, and a small header read for signature validation. For local storage tests, use `putObject`.

- [ ] **Step 4: Add user and public routes**

In `DriveUserController`, add `/public-assets` endpoints from the design.

In `DrivePublicController`, add:

```ts
@Get("/files/:assetId")
@Head("/files/:assetId")
```

Response behavior:

- `active` returns 200 or 304.
- `trashed`, `hidden`, missing, and object missing return 404.
- write stats asynchronously after response outcome.

- [ ] **Step 5: Run public asset tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive-public-asset.service.spec.ts drive.controller.spec.ts drive.e2e.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-public-asset.service.ts server/src/drive/drive-public-asset.service.spec.ts server/src/drive/drive.controller.ts server/src/drive/drive.module.ts server/src/drive/drive.types.ts server/src/drive/drive.e2e.spec.ts
git commit -m "feat(drive): add public asset service"
```

---

### Task 5: Admin APIs And Dashboard Surfaces

**Files:**
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive-public-asset.service.ts`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`
- Create: `dashboard/src/features/drive-browser/admin-public-assets.tsx`
- Create: `dashboard/src/features/drive-browser/admin-drive-storage-summary.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Write failing admin API tests**

In `dashboard/src/lib/api.test.ts`, add tests for:

```ts
it("lists admin public assets", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20 }))
  await adminDrivePublicAssetsApi.list({ lifecycleStatus: "hidden", search: "asset_abc" })
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/drive/public-assets"), expect.any(Object))
})

it("downloads a public asset revision", async () => {
  fetchMock.mockResponseOnce(new Blob(["x"]))
  await adminDrivePublicAssetsApi.downloadRevision("asset_x", "rev_1")
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/drive/public-assets/asset_x/revisions/rev_1/download"), expect.any(Object))
})
```

- [ ] **Step 2: Run failing dashboard API tests**

Run: `pnpm --filter @synapse/dashboard vitest run src/lib/api.test.ts`

Expected: fail because admin API client methods do not exist.

- [ ] **Step 3: Add server admin routes**

Add routes for:

```text
GET /api/admin/drive/public-assets
GET /api/admin/drive/public-assets/:assetId
GET /api/admin/drive/public-assets/:assetId/access-logs
GET /api/admin/drive/public-assets/:assetId/revisions
GET /api/admin/drive/public-assets/:assetId/revisions/:revisionId/download
GET /api/admin/drive/items/:id/download
POST /api/admin/drive/items/:id/restore
```

Each admin download and restore writes an audit record.

- [ ] **Step 4: Add dashboard API client**

Add typed API helpers in `dashboard/src/lib/api.ts` using the existing `request` wrapper. Include lifecycle status, owner, search, page, and pageSize query parameters.

- [ ] **Step 5: Add admin UI components**

Use dense table components and existing dashboard patterns. UI text should be operational:

- `公开素材`
- `访问明细`
- `替换历史`
- `恢复`
- `下载`

Do not add explanatory paragraphs.

- [ ] **Step 6: Run dashboard tests and typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard vitest run src/lib/api.test.ts src/features/drive-browser/drive-browser-page.test.ts
pnpm --filter @synapse/dashboard tsc
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.service.ts server/src/drive/drive-public-asset.service.ts dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts dashboard/src/features/drive-browser/admin-public-assets.tsx dashboard/src/features/drive-browser/admin-drive-storage-summary.tsx dashboard/src/features/drive-browser/drive-browser-page.tsx dashboard/src/features/drive-browser/drive-browser-page.test.ts
git commit -m "feat(drive): add admin public asset views"
```

---

### Task 6: Desktop Bridge And User Drive UI

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Create: `desktop/src/modules/drive/drive-system-entries.ts`
- Create: `desktop/src/modules/drive/drive-public-assets-view.tsx`
- Create: `desktop/src/modules/drive/drive-trash-view.tsx`
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
- Create: `desktop/src/modules/drive/__tests__/drive-public-assets-view.test.tsx`
- Create: `desktop/src/modules/drive/__tests__/drive-trash-view.test.tsx`

- [ ] **Step 1: Write failing desktop UI tests**

Add tests for root system entries:

```tsx
it("shows public assets and trash as fixed root entries", async () => {
  render(<DriveModule />)
  expect(await screen.findByText("公开素材")).toBeInTheDocument()
  expect(await screen.findByText("回收站")).toBeInTheDocument()
})
```

Add public asset list test:

```tsx
it("opens public assets and copies links", async () => {
  bridge.account.listDrivePublicAssets.mockResolvedValue({
    items: [assetFixture({ name: "logo.png", url: "https://synapse.example/files/asset_abc" })],
    total: 1,
    page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
  })
  render(<DrivePublicAssetsView />)
  expect(await screen.findByText("logo.png")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "复制链接" }))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://synapse.example/files/asset_abc")
})
```

- [ ] **Step 2: Run failing desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/drive/__tests__/drive-module.test.tsx src/modules/drive/__tests__/drive-public-assets-view.test.tsx src/modules/drive/__tests__/drive-trash-view.test.tsx
```

Expected: fail because new views and bridge methods do not exist.

- [ ] **Step 3: Add bridge types and account-service methods**

Add methods listed in the spec to `desktop/src/types/bridge.ts` and implement corresponding authenticated requests in `desktop/electron/services/account-service.ts`.

Batch upload orchestration should run three concurrent file jobs and return ordered results:

```ts
const concurrency = 3
const results = new Array(files.length)
```

Each job performs prepare, PUT, complete, and records success or error.

- [ ] **Step 4: Add system entry helper**

Create helper returning root-only virtual rows:

```ts
export const DRIVE_PUBLIC_ASSETS_ENTRY_ID = "__drive_public_assets__"
export const DRIVE_TRASH_ENTRY_ID = "__drive_trash__"
```

Normal folders do not receive these entries.

- [ ] **Step 5: Add public asset and trash views**

Use existing UI primitives only:

- `Button`
- `Table`
- `DropdownMenu`
- `Sheet`
- `AlertDialog`
- `Input`
- `Badge`

Keep classNames layout-focused. Use token classes only. No thumbnails.

- [ ] **Step 6: Wire Drive module navigation**

`desktop/src/modules/drive/index.tsx` should route virtual entries to views while keeping normal Drive path navigation intact.

Root table actions for system entries:

- click opens view
- no context menu actions for rename, move, share, delete

- [ ] **Step 7: Run desktop tests and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/drive/__tests__/drive-module.test.tsx src/modules/drive/__tests__/drive-public-assets-view.test.tsx src/modules/drive/__tests__/drive-trash-view.test.tsx
pnpm --filter @synapse/desktop typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/electron/services/account-service.ts desktop/src/modules/drive/drive-system-entries.ts desktop/src/modules/drive/drive-public-assets-view.tsx desktop/src/modules/drive/drive-trash-view.tsx desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx desktop/src/modules/drive/__tests__/drive-public-assets-view.test.tsx desktop/src/modules/drive/__tests__/drive-trash-view.test.tsx
git commit -m "feat(desktop): add drive public assets UI"
```

---

### Task 7: MCP Capabilities And Built-In Drive Guide

**Files:**
- Modify: `desktop/synapse-capabilities/shared/drive-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/drive-domain.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-drive-mcp/content.md`
- Create or modify: `desktop/resources/templates/skills/synapse-drive-mcp/files/api-reference.md`

- [ ] **Step 1: Write failing capability tests**

Add tests:

```ts
it("registers public asset and trash tools", () => {
  expect(DRIVE_MCP_TOOL_ACTIONS.drive_direct_link_upload).toBe("drive.direct_link.upload")
  expect(DRIVE_MCP_TOOL_ACTIONS.drive_trash_list).toBe("drive.trash.list")
  expect(DRIVE_MCP_TOOL_ACTIONS.drive_item_restore).toBe("drive.item.restore")
})
```

- [ ] **Step 2: Run failing capability tests**

Run: `pnpm --filter @synapse/desktop test -- synapse-capabilities/shared/drive-domain.test.ts`

Expected: fail because new capabilities are not registered.

- [ ] **Step 3: Add capability definitions and schemas**

Add:

```ts
{ id: "drive.direct_link.upload" as CapabilityId, title: "Upload public asset", description: "Upload an image to Drive 公开素材, also known as 图床, 外链, 直链, public asset, or direct link.", mutates: true }
{ id: "drive.direct_link.list" as CapabilityId, title: "List public assets", description: "List current user's Drive 公开素材 public assets. Access logs are not returned.", mutates: false }
{ id: "drive.direct_link.get" as CapabilityId, title: "Get public asset", description: "Get one public asset by assetId without access-log detail.", mutates: false }
{ id: "drive.direct_link.update" as CapabilityId, title: "Replace public asset", description: "Replace a public asset file while preserving its /files/<assetId> URL.", mutates: true }
{ id: "drive.direct_link.delete" as CapabilityId, title: "Delete public asset", description: "Move a public asset to Drive trash. Its public URL returns 404 until restored.", mutates: true, risk: "high" }
{ id: "drive.direct_link.restore" as CapabilityId, title: "Restore public asset", description: "Restore a trashed public asset and make the same public URL available again.", mutates: true }
{ id: "drive.trash.list" as CapabilityId, title: "List Drive trash", description: "List user-visible Drive trash, including normal Drive files and public assets.", mutates: false }
{ id: "drive.trash.delete" as CapabilityId, title: "Delete from Drive trash", description: "Hide a trashed Drive item from the user. Admins can still see and restore it.", mutates: true, risk: "high" }
{ id: "drive.item.restore" as CapabilityId, title: "Restore Drive item", description: "Restore a Drive item from trash.", mutates: true }
```

Add matching `buildDriveTools()` schemas. Do not expose access logs.

- [ ] **Step 4: Update built-in MCP guide**

Update `content.md` and API reference so natural language maps are clear:

```text
“上传到公开素材”
“上传到图床”
“生成直链”
“生成外链”
→ drive_direct_link_upload

“分享云盘文件”
→ drive_share_create
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- synapse-capabilities/shared/drive-domain.test.ts
pnpm --filter @synapse/desktop typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/synapse-capabilities/shared/drive-domain.ts desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/resources/templates/skills/synapse-drive-mcp/content.md desktop/resources/templates/skills/synapse-drive-mcp/files/api-reference.md
git commit -m "feat(mcp): add drive public asset tools"
```

---

### Task 8: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise user-facing entry:

```md
- 云盘新增“公开素材”和“回收站”：图片可以生成稳定公开链接，删除后的云盘文件和公开素材会先进入回收站，恢复后原链接继续可用。
```

- [ ] **Step 2: Run full targeted verification**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- drive-token.spec.ts drive-public-asset-policy.spec.ts drive-lifecycle.service.spec.ts drive-public-asset.service.spec.ts drive.service.spec.ts drive.controller.spec.ts drive.e2e.spec.ts
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/desktop test -- src/modules/drive/__tests__/drive-module.test.tsx src/modules/drive/__tests__/drive-public-assets-view.test.tsx src/modules/drive/__tests__/drive-trash-view.test.tsx synapse-capabilities/shared/drive-domain.test.ts
pnpm --filter @synapse/desktop typecheck
pnpm --filter @synapse/dashboard tsc
```

Expected: all commands pass.

- [ ] **Step 3: Check hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass. This catches UI style violations such as forbidden colors or inline styles.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: only files from this plan and user-existing unrelated changes appear. Do not revert unrelated pre-existing changes.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive public assets release"
```

---

## Self-Review

Spec coverage:

- Public asset naming, URL shape, asset id, image-only policy, upload, replace, rename, duplicate names, stats, and public GET are covered by Tasks 1, 2, and 4.
- Two-stage Drive trash, restore, hidden quota behavior, share reactivation, folder delete roots, and legacy missing migration are covered by Tasks 2 and 3.
- Admin visibility, downloads, access logs, replacement history, and storage summary are covered by Task 5.
- Desktop UI root entries, public asset list/detail/upload result, trash, and style constraints are covered by Task 6.
- MCP tools, naming, permission posture, and built-in guide updates are covered by Task 7.
- Release note and verification are covered by Task 8.

Placeholder scan:

- No unchecked step contains placeholder wording such as "TBD", "fill in later", or "add tests" without concrete test examples.

Type consistency:

- Public asset user-facing identifiers use `assetId`.
- Drive lifecycle values are consistently `active`, `trashed`, `hidden`, and `legacy_missing`.
- MCP resource naming uses `drive.direct_link.*` and tool names use dot-to-underscore conversion.
