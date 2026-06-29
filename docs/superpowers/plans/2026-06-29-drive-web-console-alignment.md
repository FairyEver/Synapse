# Web Drive Console Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web Drive Console that matches the desktop client's cloud-side Drive capabilities while excluding sync and folder upload.

**Architecture:** Add a dashboard-only Drive Console shell under `dashboard/src/features/drive-console/`. Keep the existing `drive-browser` preview/reader stack for file rendering, Markdown editing, comments, Markdown image import, and version history. Extend `dashboard/src/lib/api.ts` with user Drive methods, then compose focused console components for listing, upload, file actions, sharing, public assets, trash, and sites.

**Tech Stack:** React 19, TypeScript 6, TanStack Query, TanStack Router, shadcn/ui, Tailwind CSS 4, Vitest/jsdom, existing Nest Drive API, `@synapse/shared` Drive DTOs.

---

## File Structure

Create these dashboard files:

- `dashboard/src/features/drive-console/drive-console-page.tsx`
  Page shell for root and folder console routes. Owns active subview, toolbar, dialogs, and integration with existing file reader for file targets.
- `dashboard/src/features/drive-console/use-drive-console.ts`
  Hook for current Drive browser snapshot, usage, refresh, and shared mutation helpers.
- `dashboard/src/features/drive-console/drive-file-table.tsx`
  File/folder table, root system rows, row actions, and drag-drop target.
- `dashboard/src/features/drive-console/drive-upload.ts`
  Web `File` upload sequencing through prepare -> PUT -> complete.
- `dashboard/src/features/drive-console/drive-move-dialog.tsx`
  Folder tree selector and move submit.
- `dashboard/src/features/drive-console/drive-share-dialogs.tsx`
  Share settings, share success, and My Shares dialog.
- `dashboard/src/features/drive-console/drive-trash-view.tsx`
  Web trash list, restore, remove, pagination, and refresh.
- `dashboard/src/features/drive-console/drive-public-assets-view.tsx`
  Web public asset list, upload, replace, rename, copy/open, trash, pagination, and refresh.
- `dashboard/src/features/drive-console/drive-sites-dialogs.tsx`
  Publish site and site management dialogs.
- `dashboard/src/features/drive-console/drive-console.test.tsx`
  Console shell, toolbar, root entries, file actions, and upload behavior tests.
- `dashboard/src/features/drive-console/drive-upload.test.ts`
  Upload sequencing and folder rejection tests.
- `dashboard/src/features/drive-console/drive-share-dialogs.test.tsx`
  Share settings and My Shares behavior tests.
- `dashboard/src/features/drive-console/drive-trash-public-sites.test.tsx`
  Trash, public assets, and site behavior tests.

Modify these existing files:

- `dashboard/src/lib/api.ts`
  Add `driveApi` for user Drive management endpoints.
- `dashboard/src/lib/api.test.ts`
  Add API serialization, upload, and auth-expired tests.
- `dashboard/src/routes/_authenticated/drive/index.tsx`
  Import Drive console page from `@/features/drive-console/drive-console-page`.
- `dashboard/src/routes/_authenticated/drive/folders/$folderId.tsx`
  Import Drive console item page from `@/features/drive-console/drive-console-page`.
- `dashboard/src/routes/_authenticated/drive/items/$browserItemId.tsx`
  Import Drive console item page from `@/features/drive-console/drive-console-page`.
- `RELEASE_NOTES_PENDING.md`
  Add a user-facing note for the web Drive console alignment.

Do not modify `desktop/src/modules/drive/*` for this feature.

---

### Task 1: Add User Drive API Client

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Add `driveApi` to the import in `dashboard/src/lib/api.test.ts`:

```ts
import { adminApi, dashboardApi, driveApi, driveBrowserApi, driveFileVersionsApi, shouldNotifyAuthExpired, subscribeAuthExpired } from './api'
```

Add this test block after the existing `describe('driveBrowserApi', ...)` block:

```ts
describe('driveApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mockJsonResponse(payload: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      )
    )
  }

  it('uses user Drive management endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveApi.getUsage()
    await driveApi.prepareUpload({ parentId: 'folder/id', name: 'a.md', size: '12', mimeType: 'text/markdown' })
    await driveApi.completeUpload('session/id')
    await driveApi.cancelUpload('session/id')
    await driveApi.createFolder({ parentId: 'folder/id', name: 'Docs' })
    await driveApi.renameItem('item/id', 'Next.md')
    await driveApi.moveItem('item/id', null)
    await driveApi.deleteItem('item/id')
    await driveApi.listTrash({ offset: 10, limit: 20, search: 'old' })
    await driveApi.restoreItem('item/id')
    await driveApi.deleteTrashItem('item/id')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/drive/usage', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/drive/uploads/prepare', expect.objectContaining({
      body: JSON.stringify({ parentId: 'folder/id', name: 'a.md', size: '12', mimeType: 'text/markdown' }),
      credentials: 'include',
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/drive/uploads/session%2Fid/complete', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/drive/uploads/session%2Fid/cancel', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/drive/folders', expect.objectContaining({
      body: JSON.stringify({ parentId: 'folder/id', name: 'Docs' }),
      credentials: 'include',
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/drive/items/item%2Fid', expect.objectContaining({
      body: JSON.stringify({ name: 'Next.md' }),
      credentials: 'include',
      method: 'PATCH',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/drive/items/item%2Fid', expect.objectContaining({
      body: JSON.stringify({ parentId: null }),
      credentials: 'include',
      method: 'PATCH',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/drive/items/item%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(9, '/api/drive/trash?offset=10&limit=20&search=old', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(10, '/api/drive/items/item%2Fid/restore', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(11, '/api/drive/trash/item%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
  })

  it('uses share, site, and public asset endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await driveApi.createShare('item/id', { passwordEnabled: true, expiresIn: '3d', accessMode: 'link_edit', editorEmails: [] })
    await driveApi.disableShare('share/id')
    await driveApi.getShare('share/id')
    await driveApi.listShares({ offset: 20, limit: 10 })
    await driveApi.preflightSite('folder/id')
    await driveApi.createSite({ sourceFolderItemId: 'folder/id', name: 'Docs', entryPath: 'index.html', accessMode: 'public', expiresIn: 'forever' })
    await driveApi.listSites({ offset: 5, limit: 10, search: 'docs', status: 'active' })
    await driveApi.updateSiteAccess('site/id', { accessMode: 'password', password: 'pw', expiresIn: '7d' })
    await driveApi.disableSite('site/id')
    await driveApi.enableSite('site/id')
    await driveApi.republishSite('site/id', { entryPath: 'index.html' })
    await driveApi.deleteSite('site/id')
    await driveApi.listPublicAssets({ offset: 0, limit: 20 })
    await driveApi.preparePublicAssetUpload({ name: 'logo.png', size: '10', mimeType: 'image/png' })
    await driveApi.completePublicAssetUpload('session/id')
    await driveApi.cancelPublicAssetUpload('session/id')
    await driveApi.preparePublicAssetReplace('asset/id', { name: 'logo.png', size: '10', mimeType: 'image/png' })
    await driveApi.completePublicAssetReplace('asset/id', 'session/id')
    await driveApi.cancelPublicAssetReplace('asset/id', 'session/id')
    await driveApi.renamePublicAsset('asset/id', 'logo.png')
    await driveApi.trashPublicAsset('asset/id')
    await driveApi.restorePublicAsset('asset/id')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/drive/items/item%2Fid/share', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/drive/shares/share%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/drive/shares/share%2Fid', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/drive/shares?offset=20&limit=10', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/drive/sites/preflight?sourceFolderItemId=folder%2Fid', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/drive/sites', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/drive/sites?offset=5&limit=10&search=docs&status=active', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/drive/sites/site%2Fid/access', expect.objectContaining({ credentials: 'include', method: 'PATCH' }))
    expect(fetchMock).toHaveBeenNthCalledWith(9, '/api/drive/sites/site%2Fid/disable', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(10, '/api/drive/sites/site%2Fid/enable', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(11, '/api/drive/sites/site%2Fid/republish', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(12, '/api/drive/sites/site%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(13, '/api/drive/public-assets?offset=0&limit=20', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(14, '/api/drive/public-assets/uploads/prepare', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(15, '/api/drive/public-assets/uploads/session%2Fid/complete', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(16, '/api/drive/public-assets/uploads/session%2Fid/cancel', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(17, '/api/drive/public-assets/asset%2Fid/replace/prepare', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(18, '/api/drive/public-assets/asset%2Fid/replace/session%2Fid/complete', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(19, '/api/drive/public-assets/asset%2Fid/replace/session%2Fid/cancel', expect.objectContaining({ credentials: 'include', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(20, '/api/drive/public-assets/asset%2Fid', expect.objectContaining({ credentials: 'include', method: 'PATCH' }))
    expect(fetchMock).toHaveBeenNthCalledWith(21, '/api/drive/public-assets/asset%2Fid', expect.objectContaining({ credentials: 'include', method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(22, '/api/drive/public-assets/asset%2Fid/restore', expect.objectContaining({ credentials: 'include', method: 'POST' }))
  })

  it('notifies auth expiration for protected user Drive requests', async () => {
    const authExpired = vi.fn()
    const unsubscribe = subscribeAuthExpired(authExpired)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '会话已过期。' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    )

    try {
      await expect(driveApi.getUsage()).rejects.toMatchObject({ status: 401 })
      expect(authExpired).toHaveBeenCalledOnce()
    } finally {
      unsubscribe()
    }
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts
```

Expected: FAIL because `driveApi` is not exported.

- [ ] **Step 3: Implement `driveApi`**

Add missing type imports to `dashboard/src/lib/api.ts`:

```ts
  DriveAccessSettingsInput,
  DrivePublicAssetListPageDto,
  DrivePublicLinksPageInput,
  DriveShareDto,
  DriveShareListPageDto,
  DriveSiteAccessUpdateInput,
  DriveSiteCreateInput,
  DriveSiteDto,
  DriveSiteListInput,
  DriveSiteListPageDto,
  DriveSitePreflightDto,
  DriveTrashListPageDto,
  DriveUsageDto,
```

Add helper functions near `driveBrowserQuerySuffix`:

```ts
type DriveChildrenPageOptions = {
  offset?: number
  limit?: number
  search?: string
}

function driveOffsetQuerySuffix(options: DriveChildrenPageOptions = {}) {
  return querySuffix({
    offset: options.offset,
    limit: options.limit,
    search: options.search,
  })
}

function driveSiteQuerySuffix(options: DriveSiteListInput = {}) {
  return querySuffix({
    offset: options.offset,
    limit: options.limit,
    search: options.search,
    status: options.status,
  })
}

```

Export `driveApi` before `driveBrowserApi`:

```ts
export const driveApi = {
  getUsage: () =>
    request<DriveUsageDto>(`${driveApiBasePath}/usage`),
  prepareUpload: (input: { readonly parentId?: string | null; readonly name: string; readonly size: string; readonly mimeType?: string | null }) =>
    request<DriveUploadPrepareResult>(`${driveApiBasePath}/uploads/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        parentId: input.parentId ?? null,
        name: input.name,
        size: input.size,
        mimeType: input.mimeType ?? null,
      }),
    }),
  completeUpload: (sessionId: string) =>
    request<DriveItemDto>(`${driveApiBasePath}/uploads/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }),
  cancelUpload: (sessionId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/uploads/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  createFolder: (input: { readonly parentId?: string | null; readonly name: string }) =>
    request<DriveItemDto>(`${driveApiBasePath}/folders`, {
      method: 'POST',
      body: JSON.stringify({ parentId: input.parentId ?? null, name: input.name }),
    }),
  renameItem: (itemId: string, name: string) =>
    request<DriveItemDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  moveItem: (itemId: string, parentId: string | null) =>
    request<DriveItemDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId }),
    }),
  deleteItem: (itemId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  listTrash: (options: DriveChildrenPageOptions = {}) =>
    request<DriveTrashListPageDto>(`${driveApiBasePath}/trash${driveOffsetQuerySuffix(options)}`),
  restoreItem: (itemId: string) =>
    request<DriveItemDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}/restore`, { method: 'POST' }),
  deleteTrashItem: (itemId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/trash/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  createShare: (itemId: string, settings: DriveAccessSettingsInput) =>
    request<DriveShareDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}/share`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  disableShare: (shareId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
  getShare: (shareId: string) =>
    request<DriveShareDto>(`${driveApiBasePath}/shares/${encodeURIComponent(shareId)}`),
  listShares: (options: DrivePublicLinksPageInput = {}) =>
    request<DriveShareListPageDto>(`${driveApiBasePath}/shares${driveOffsetQuerySuffix(options)}`),
  preflightSite: (sourceFolderItemId: string) =>
    request<DriveSitePreflightDto>(`${driveApiBasePath}/sites/preflight?${new URLSearchParams({ sourceFolderItemId }).toString()}`),
  createSite: (input: DriveSiteCreateInput) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites`, { method: 'POST', body: JSON.stringify(input) }),
  listSites: (options: DriveSiteListInput = {}) =>
    request<DriveSiteListPageDto>(`${driveApiBasePath}/sites${driveSiteQuerySuffix(options)}`),
  updateSiteAccess: (siteId: string, input: DriveSiteAccessUpdateInput) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/access`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  disableSite: (siteId: string) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/disable`, { method: 'POST' }),
  enableSite: (siteId: string) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/enable`, { method: 'POST' }),
  republishSite: (siteId: string, input: { readonly entryPath?: string | null }) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/republish`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteSite: (siteId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}`, { method: 'DELETE' }),
  listPublicAssets: (options: DriveChildrenPageOptions = {}) =>
    request<DrivePublicAssetListPageDto>(`${driveApiBasePath}/public-assets${driveOffsetQuerySuffix(options)}`),
  preparePublicAssetUpload: (input: { readonly name: string; readonly size: string; readonly mimeType?: string | null }) =>
    request<DriveUploadPrepareResult>(`${driveApiBasePath}/public-assets/uploads/prepare`, {
      method: 'POST',
      body: JSON.stringify({ name: input.name, size: input.size, mimeType: input.mimeType ?? null }),
    }),
  completePublicAssetUpload: (sessionId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/uploads/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }),
  cancelPublicAssetUpload: (sessionId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/public-assets/uploads/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  preparePublicAssetReplace: (assetId: string, input: { readonly name: string; readonly size: string; readonly mimeType?: string | null }) =>
    request<DriveUploadPrepareResult>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/replace/prepare`, {
      method: 'POST',
      body: JSON.stringify({ name: input.name, size: input.size, mimeType: input.mimeType ?? null }),
    }),
  completePublicAssetReplace: (assetId: string, sessionId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/replace/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }),
  cancelPublicAssetReplace: (assetId: string, sessionId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/replace/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  renamePublicAsset: (assetId: string, name: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  trashPublicAsset: (assetId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
  restorePublicAsset: (assetId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/restore`, { method: 'POST' }),
  publicAssetDownloadUrl: (assetId: string) =>
    `${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/download`,
}
```

- [ ] **Step 4: Run API tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts
git commit -m "feat: add web drive api client"
```

---

### Task 2: Add Web Upload Helper

**Files:**
- Create: `dashboard/src/features/drive-console/drive-upload.ts`
- Create: `dashboard/src/features/drive-console/drive-upload.test.ts`

- [ ] **Step 1: Write failing upload tests**

Create `dashboard/src/features/drive-console/drive-upload.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveUploadPrepareResult } from '@synapse/shared'
import { ApiError, driveApi } from '@/lib/api'
import { uploadDriveFiles } from './drive-upload'

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  driveApi: {
    prepareUpload: vi.fn(),
    completeUpload: vi.fn(),
    cancelUpload: vi.fn(),
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('uploadDriveFiles', () => {
  it('uploads loose files through prepare, PUT, and complete', async () => {
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    vi.mocked(driveApi.prepareUpload).mockResolvedValue({
      sessionId: 'session-1',
      item: {} as never,
      upload: {
        method: 'PUT',
        url: 'https://upload.example/one',
        expiresAt: '2026-06-29T00:00:00.000Z',
        headers: { 'content-type': 'text/markdown' },
      },
    })
    vi.mocked(driveApi.completeUpload).mockResolvedValue({} as never)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    const result = await uploadDriveFiles({ parentId: 'folder-1', files: [file] })

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 })
    expect(driveApi.prepareUpload).toHaveBeenCalledWith({
      parentId: 'folder-1',
      name: 'notes.md',
      size: String(file.size),
      mimeType: 'text/markdown',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://upload.example/one', {
      method: 'PUT',
      headers: { 'content-type': 'text/markdown' },
      body: file,
    })
    expect(driveApi.completeUpload).toHaveBeenCalledWith('session-1')
    expect(driveApi.cancelUpload).not.toHaveBeenCalled()
  })

  it('skips folder-like files and never calls prepare for them', async () => {
    const folderFile = new File(['x'], 'nested.md', { type: 'text/markdown' })
    Object.defineProperty(folderFile, 'webkitRelativePath', { value: 'Folder/nested.md' })

    const result = await uploadDriveFiles({ parentId: null, files: [folderFile] })

    expect(result).toEqual({
      completed: 0,
      failed: 0,
      skipped: 1,
      message: '不支持文件夹上传',
    })
    expect(driveApi.prepareUpload).not.toHaveBeenCalled()
  })

  it('continues after one file fails and cancels the failed session', async () => {
    const first = new File(['bad'], 'bad.md')
    const second = new File(['ok'], 'ok.md')
    vi.mocked(driveApi.prepareUpload)
      .mockResolvedValueOnce({
        sessionId: 'session-bad',
        item: {} as never,
        upload: { method: 'PUT', url: 'https://upload.example/bad', expiresAt: '', headers: {} },
      })
      .mockResolvedValueOnce({
        sessionId: 'session-ok',
        item: {} as never,
        upload: { method: 'PUT', url: 'https://upload.example/ok', expiresAt: '', headers: {} },
      })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'upload failed' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.mocked(driveApi.completeUpload).mockResolvedValue({} as never)
    vi.mocked(driveApi.cancelUpload).mockResolvedValue({ ok: true })

    const result = await uploadDriveFiles({ parentId: null, files: [first, second] })

    expect(result.completed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.message).toBe('upload failed')
    expect(driveApi.cancelUpload).toHaveBeenCalledWith('session-bad')
    expect(driveApi.completeUpload).toHaveBeenCalledWith('session-ok')
  })

  it('keeps the original failure message when cancel also fails', async () => {
    const file = new File(['bad'], 'bad.md')
    vi.mocked(driveApi.prepareUpload).mockResolvedValue({
      sessionId: 'session-bad',
      item: {} as never,
      upload: { method: 'PUT', url: 'https://upload.example/bad', expiresAt: '', headers: {} },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'upload failed' }), { status: 500 }))
    vi.mocked(driveApi.cancelUpload).mockRejectedValue(new Error('cancel failed'))

    const result = await uploadDriveFiles({ parentId: null, files: [file] })

    expect(result).toMatchObject({ completed: 0, failed: 1, skipped: 0, message: 'upload failed' })
  })

  it('uses ApiError messages from prepare failures', async () => {
    const file = new File(['large'], 'large.bin')
    vi.mocked(driveApi.prepareUpload).mockRejectedValue(new ApiError('文件超过 100MB 限制。', 400))

    const result = await uploadDriveFiles({ parentId: null, files: [file] })

    expect(result).toMatchObject({ completed: 0, failed: 1, skipped: 0, message: '文件超过 100MB 限制。' })
  })
})
```

- [ ] **Step 2: Run upload tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-upload.test.ts
```

Expected: FAIL because `drive-upload.ts` does not exist.

- [ ] **Step 3: Implement upload helper**

Create `dashboard/src/features/drive-console/drive-upload.ts`:

```ts
import { ApiError, driveApi } from '@/lib/api'

export type DriveWebUploadInput = {
  readonly parentId: string | null
  readonly files: readonly File[]
}

export type DriveWebUploadResult = {
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly message?: string
}

export async function uploadDriveFiles(input: DriveWebUploadInput): Promise<DriveWebUploadResult> {
  let completed = 0
  let failed = 0
  let skipped = 0
  let firstMessage: string | undefined

  for (const file of input.files) {
    if (isFolderLikeFile(file)) {
      skipped += 1
      firstMessage ??= '不支持文件夹上传'
      continue
    }

    const result = await uploadOneDriveFile(input.parentId, file)
    completed += result.completed
    failed += result.failed
    skipped += result.skipped
    firstMessage ??= result.message
  }

  return {
    completed,
    failed,
    skipped,
    ...(firstMessage ? { message: firstMessage } : {}),
  }
}

function isFolderLikeFile(file: File): boolean {
  const relativePath = (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath
  return typeof relativePath === 'string' && relativePath.includes('/')
}

async function uploadOneDriveFile(parentId: string | null, file: File): Promise<DriveWebUploadResult> {
  let prepared: DriveUploadPrepareResult
  try {
    prepared = await driveApi.prepareUpload({
      parentId,
      name: file.name,
      size: String(file.size),
      mimeType: file.type || null,
    })
  } catch (error) {
    return { completed: 0, failed: 1, skipped: 0, message: errorMessage(error, '上传准备失败') }
  }

  try {
    const response = await fetch(prepared.upload.url, {
      method: prepared.upload.method,
      headers: prepared.upload.headers,
      body: file,
    })
    if (!response.ok) {
      throw new ApiError(await uploadResponseMessage(response), response.status)
    }
    await driveApi.completeUpload(prepared.sessionId)
    return { completed: 1, failed: 0, skipped: 0 }
  } catch (error) {
    try {
      await driveApi.cancelUpload(prepared.sessionId)
    } catch {
      // The original upload failure is more useful to the user than a cleanup failure.
    }
    return { completed: 0, failed: 1, skipped: 0, message: errorMessage(error, '上传失败') }
  }
}

async function uploadResponseMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: unknown }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  } catch {
    return response.statusText || '上传失败'
  }
  return response.statusText || '上传失败'
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
```

- [ ] **Step 4: Run upload tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-upload.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-console/drive-upload.ts dashboard/src/features/drive-console/drive-upload.test.ts
git commit -m "feat: add web drive upload helper"
```

---

### Task 3: Add Console Shell, Routes, Toolbar, Usage, And Root Entries

**Files:**
- Create: `dashboard/src/features/drive-console/use-drive-console.ts`
- Create: `dashboard/src/features/drive-console/drive-console-page.tsx`
- Create: `dashboard/src/features/drive-console/drive-file-table.tsx`
- Create: `dashboard/src/features/drive-console/drive-console.test.tsx`
- Modify: `dashboard/src/routes/_authenticated/drive/index.tsx`
- Modify: `dashboard/src/routes/_authenticated/drive/folders/$folderId.tsx`
- Modify: `dashboard/src/routes/_authenticated/drive/items/$browserItemId.tsx`

- [ ] **Step 1: Write failing console shell tests**

Create `dashboard/src/features/drive-console/drive-console.test.tsx` with these initial tests:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto, DriveUsageDto } from '@synapse/shared'
import { DriveConsolePage, DriveConsoleItemPage } from './drive-console-page'
import { useDriveBrowser } from '@/features/drive-browser/use-drive-browser'
import { driveApi } from '@/lib/api'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/features/drive-browser/use-drive-browser', () => ({
  useDriveBrowser: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  driveApi: {
    getUsage: vi.fn(),
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveConsolePage', () => {
  it('renders cloud management toolbar without sync', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsolePage />)

    expect(document.body.textContent).toContain('上传文件')
    expect(document.body.textContent).toContain('新建文件夹')
    expect(document.body.textContent).toContain('我的分享')
    expect(document.body.textContent).toContain('站点')
    expect(document.body.textContent).toContain('刷新')
    expect(document.body.textContent).toContain('公开素材')
    expect(document.body.textContent).toContain('回收站')
    expect(document.body.textContent).not.toContain('同步')
  })

  it('uses existing single file reader for file item routes', async () => {
    mockReadySnapshot(fileSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsoleItemPage itemId="file-1" surface="console" />)

    expect(document.body.textContent).toContain('notes.md')
    expect(document.body.textContent).not.toContain('公开素材')
  })
})

function mockReadySnapshot(snapshot: DriveBrowserSnapshotDto) {
  vi.mocked(useDriveBrowser).mockReturnValue({
    status: 'ready',
    snapshot,
    loadingMoreChildren: false,
    loadMoreChildrenError: null,
    reload: vi.fn(async () => snapshot),
    reloading: false,
    saveText: vi.fn(),
    savingText: false,
  })
}

async function render(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(element)
  })
}

function usage(): DriveUsageDto {
  return {
    usedBytes: '1048576',
    reservedBytes: '0',
    quotaBytes: '5368709120',
  }
}

function folderSnapshot(): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'console',
    current: {
      id: 'root',
      name: '根目录',
      type: 'folder',
      size: '0',
      mimeType: null,
      updatedAt: '2026-06-29T00:00:00.000Z',
      previewKind: 'download-only',
      browserUrl: '/console/drive',
      downloadUrl: '/drive/items/root/download',
    },
    breadcrumbs: [{ id: 'root', name: '我的空间', browserUrl: '/console/drive' }],
    children: [
      {
        id: 'folder-1',
        name: '文档',
        type: 'folder',
        size: '0',
        mimeType: null,
        updatedAt: '2026-06-28T00:00:00.000Z',
        previewKind: 'download-only',
        browserUrl: '/console/drive/folders/folder-1',
        downloadUrl: '/drive/items/folder-1/download',
      },
    ],
    preview: null,
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: true,
  }
}

function fileSnapshot(): DriveBrowserSnapshotDto {
  return {
    ...folderSnapshot(),
    current: {
      id: 'file-1',
      name: 'notes.md',
      type: 'file',
      size: '10',
      mimeType: 'text/markdown',
      updatedAt: '2026-06-28T00:00:00.000Z',
      previewKind: 'markdown',
      browserUrl: '/console/drive/items/file-1?surface=console',
      downloadUrl: '/drive/items/file-1/download',
    },
    children: [],
    preview: { kind: 'markdown', text: '# Notes', html: '<h1>Notes</h1>', outline: [], truncated: false, imageUrl: null, visitUrl: null },
    canZip: false,
  }
}
```

- [ ] **Step 2: Run console tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-console.test.tsx
```

Expected: FAIL because the new console files do not exist.

- [ ] **Step 3: Implement hook and basic table**

Create `dashboard/src/features/drive-console/use-drive-console.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { DriveBrowserSurface, DriveUsageDto } from '@synapse/shared'
import { driveApi } from '@/lib/api'
import { useDriveBrowser, type DriveBrowserState } from '@/features/drive-browser/use-drive-browser'

export type DriveConsoleInput =
  | { readonly context: 'root' }
  | { readonly context: 'item'; readonly itemId: string; readonly surface: DriveBrowserSurface }

export type DriveConsoleState = {
  readonly browser: DriveBrowserState
  readonly usage: DriveUsageDto | null
  readonly usageLoading: boolean
  readonly usageError: string | null
  readonly refresh: () => Promise<void>
}

export function useDriveConsole(input: DriveConsoleInput): DriveConsoleState {
  const browser = useDriveBrowser(
    input.context === 'root'
      ? { context: 'console-root' }
      : { context: 'owner', itemId: input.itemId, surface: input.surface }
  )
  const [usage, setUsage] = useState<DriveUsageDto | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)

  const loadUsage = useCallback(async () => {
    setUsageLoading(true)
    setUsageError(null)
    try {
      setUsage(await driveApi.getUsage())
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : '用量加载失败')
    } finally {
      setUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  const refresh = useCallback(async () => {
    await Promise.all([
      browser.status === 'ready' ? browser.reload() : Promise.resolve(),
      loadUsage(),
    ])
  }, [browser, loadUsage])

  return { browser, usage, usageLoading, usageError, refresh }
}
```

Create `dashboard/src/features/drive-console/drive-file-table.tsx`:

```tsx
import type { DriveBrowserItemDto, DriveBrowserSnapshotDto } from '@synapse/shared'
import { Folder, Image, Trash2 } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDriveBrowserSize } from '@/features/drive-browser/shared/drive-format'
import { DriveBrowserItemIcon } from '@/features/drive-browser/shared/drive-icons'

export type DriveConsoleSystemView = 'files' | 'public-assets' | 'trash'

export function DriveFileTable({
  snapshot,
  activeView,
  onOpenSystemView,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly activeView: DriveConsoleSystemView
  readonly onOpenSystemView: (view: DriveConsoleSystemView) => void
}) {
  if (activeView !== 'files') return null

  const rootSystemRows = snapshot.breadcrumbs.length <= 1
  return (
    <div className='rounded-lg border bg-background'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40 text-right'>更新时间</TableHead>
            <TableHead className='w-52 text-right' aria-label='操作' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rootSystemRows ? (
            <>
              <SystemRow icon={<Image className='size-4' />} name='公开素材' onOpen={() => onOpenSystemView('public-assets')} />
              <SystemRow icon={<Trash2 className='size-4' />} name='回收站' onOpen={() => onOpenSystemView('trash')} />
            </>
          ) : null}
          {snapshot.children.map((item) => (
            <DriveFileRow key={item.id} item={item} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SystemRow({ icon, name, onOpen }: { readonly icon: React.ReactNode; readonly name: string; readonly onOpen: () => void }) {
  return (
    <TableRow className='cursor-pointer' onClick={onOpen}>
      <TableCell>
        <div className='flex min-w-0 items-center gap-2'>
          {icon}
          <span className='truncate font-medium'>{name}</span>
        </div>
      </TableCell>
      <TableCell className='text-right text-muted-foreground'>-</TableCell>
      <TableCell className='text-right text-muted-foreground'>-</TableCell>
      <TableCell aria-label={`${name} 操作`} />
    </TableRow>
  )
}

function DriveFileRow({ item }: { readonly item: DriveBrowserItemDto }) {
  return (
    <TableRow
      role='link'
      tabIndex={0}
      className='cursor-pointer'
      onClick={() => window.location.assign(item.browserUrl)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') window.location.assign(item.browserUrl)
      }}
    >
      <TableCell>
        <div className='flex min-w-0 items-center gap-2'>
          {item.type === 'folder' ? <Folder className='size-4' /> : <DriveBrowserItemIcon item={item} />}
          <span className='min-w-0 truncate font-medium'>{item.name}</span>
        </div>
      </TableCell>
      <TableCell className='text-right text-muted-foreground'>{formatDriveBrowserSize(item)}</TableCell>
      <TableCell className='text-right text-muted-foreground'><RelativeTime value={item.updatedAt} /></TableCell>
      <TableCell className='text-right'>
        <Button type='button' variant='ghost' size='xs'>预览</Button>
      </TableCell>
    </TableRow>
  )
}
```

- [ ] **Step 4: Implement console page and route imports**

Create `dashboard/src/features/drive-console/drive-console-page.tsx`:

```tsx
import type { DriveBrowserSurface, DriveUsageDto } from '@synapse/shared'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { DriveSingleFileReaderView } from '@/features/drive-browser/drive-browser-page'
import { shouldRenderDriveSingleFileReader } from '@/features/drive-browser/shared/drive-view-model'
import { DriveFileTable, type DriveConsoleSystemView } from './drive-file-table'
import { useDriveConsole } from './use-drive-console'
import { useState } from 'react'

export function DriveConsolePage() {
  return <DriveConsoleRoot />
}

export function DriveConsoleItemPage({
  itemId,
  surface = 'console',
}: {
  readonly itemId: string
  readonly surface?: DriveBrowserSurface
}) {
  const state = useDriveConsole({ context: 'item', itemId, surface })
  if (state.browser.status === 'ready' && shouldRenderDriveSingleFileReader(state.browser.snapshot)) {
    return <DriveSingleFileReaderView snapshot={state.browser.snapshot} editContext={state.browser} />
  }
  return <DriveConsoleContent state={state} />
}

function DriveConsoleRoot() {
  const state = useDriveConsole({ context: 'root' })
  return <DriveConsoleContent state={state} />
}

function DriveConsoleContent({ state }: { readonly state: ReturnType<typeof useDriveConsole> }) {
  const [activeView, setActiveView] = useState<DriveConsoleSystemView>('files')
  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <h1 className='text-lg font-semibold'>网盘</h1>
          <DriveUsage usage={state.usage} loading={state.usageLoading} />
        </div>
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button type='button' variant='outline' size='sm'>
            <Upload data-icon='inline-start' />
            上传文件
          </Button>
          <Button type='button' variant='outline' size='sm'>新建文件夹</Button>
          <Button type='button' variant='outline' size='sm'>我的分享</Button>
          <Button type='button' variant='outline' size='sm'>站点</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => { void state.refresh() }}>刷新</Button>
        </div>
      </div>
      {state.browser.status === 'loading' ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
      {state.browser.status === 'error' ? <div className='text-sm text-destructive'>{state.browser.message}</div> : null}
      {state.browser.status === 'ready' ? (
        <DriveFileTable snapshot={state.browser.snapshot} activeView={activeView} onOpenSystemView={setActiveView} />
      ) : null}
    </div>
  )
}

function DriveUsage({ usage, loading }: { readonly usage: DriveUsageDto | null; readonly loading: boolean }) {
  if (!usage) return loading ? <span className='text-xs text-muted-foreground'>用量加载中</span> : null
  const used = Number(usage.usedBytes)
  const quota = Number(usage.quotaBytes)
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  return (
    <div className='flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
      <Progress className='h-2 w-40' value={percent} aria-label='云盘容量' />
      <span>{formatBytes(usage.usedBytes)} / {formatBytes(usage.quotaBytes)}</span>
    </div>
  )
}

function formatBytes(value: string) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
```

Modify route imports:

```ts
import { DriveConsolePage } from '@/features/drive-console/drive-console-page'
```

and:

```ts
import { DriveConsoleItemPage } from '@/features/drive-console/drive-console-page'
```

- [ ] **Step 5: Run console tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-console.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-console dashboard/src/routes/_authenticated/drive
git commit -m "feat: add web drive console shell"
```

---

### Task 4: Add File Actions, Move Dialog, And Folder Creation

**Files:**
- Modify: `dashboard/src/features/drive-console/drive-console-page.tsx`
- Modify: `dashboard/src/features/drive-console/drive-file-table.tsx`
- Create: `dashboard/src/features/drive-console/drive-move-dialog.tsx`
- Modify: `dashboard/src/features/drive-console/drive-console.test.tsx`

- [ ] **Step 1: Add failing action tests**

Append tests to `dashboard/src/features/drive-console/drive-console.test.tsx`. Extend the `vi.mock('@/lib/api', ...)` object with:

```ts
    createFolder: vi.fn(),
    renameItem: vi.fn(),
    moveItem: vi.fn(),
    deleteItem: vi.fn(),
```

Add:

```tsx
it('creates folders in the current folder and refreshes', async () => {
  const snapshot = folderSnapshot()
  const reload = vi.fn(async () => snapshot)
  vi.mocked(useDriveBrowser).mockReturnValue({
    status: 'ready',
    snapshot,
    loadingMoreChildren: false,
    loadMoreChildrenError: null,
    reload,
    reloading: false,
    saveText: vi.fn(),
    savingText: false,
  })
  vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
  vi.mocked(driveApi.createFolder).mockResolvedValue({} as never)
  await render(<DriveConsolePage />)

  await click(button('新建文件夹'))
  await input('文件夹名称', '资料')
  await click(button('新建'))

  expect(driveApi.createFolder).toHaveBeenCalledWith({ parentId: 'root', name: '资料' })
  expect(reload).toHaveBeenCalled()
})

it('does not render sync in row actions', async () => {
  mockReadySnapshot(folderSnapshot())
  vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

  await render(<DriveConsolePage />)

  expect(document.body.textContent).toContain('更多')
  expect(document.body.textContent).not.toContain('同步')
})
```

Add helper functions:

```ts
async function click(element: HTMLElement | null) {
  if (!element) throw new Error('missing element')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function button(text: string) {
  return Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text)) ?? null
}

async function input(labelText: string, value: string) {
  const label = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.includes(labelText))
  const id = label?.getAttribute('for')
  const field = id ? document.getElementById(id) : null
  if (!(field instanceof HTMLInputElement)) throw new Error(`missing input ${labelText}`)
  await act(async () => {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-console.test.tsx
```

Expected: FAIL because folder creation dialog and row actions are incomplete.

- [ ] **Step 3: Implement dialogs and action props**

Create `dashboard/src/features/drive-console/drive-move-dialog.tsx` with a simple folder-target form that can be expanded in Task 8:

```tsx
import type { DriveBrowserItemDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function DriveMoveDialog({
  item,
  open,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  readonly item: DriveBrowserItemDto | null
  readonly open: boolean
  readonly submitting: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (parentId: string | null) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动</DialogTitle>
        </DialogHeader>
        <div className='text-sm text-muted-foreground'>{item?.name}</div>
        <DialogFooter>
          <Button type='button' variant='outline' disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type='button' disabled={submitting} onClick={() => onSubmit(null)}>移动到根目录</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Modify `DriveFileTable` props to accept row handlers:

```tsx
  readonly onDelete: (item: DriveBrowserItemDto) => void
  readonly onMove: (item: DriveBrowserItemDto) => void
  readonly onRename: (item: DriveBrowserItemDto) => void
  readonly onShare: (item: DriveBrowserItemDto) => void
```

Add row buttons:

```tsx
<Button type='button' variant='ghost' size='xs' onClick={(event) => { event.stopPropagation(); onShare(item) }}>
  分享
</Button>
<Button type='button' variant='ghost' size='xs' onClick={(event) => { event.stopPropagation(); window.location.assign(item.browserUrl) }}>
  预览
</Button>
<Button type='button' variant='ghost' size='xs' onClick={(event) => { event.stopPropagation(); onDelete(item) }}>
  删除
</Button>
<Button type='button' variant='ghost' size='xs' onClick={(event) => { event.stopPropagation(); onRename(item) }}>
  更多
</Button>
```

In `drive-console-page.tsx`, add create/rename/delete/move state and mutations:

```tsx
type NameDialogState =
  | { readonly mode: 'create'; readonly item: null; readonly value: string }
  | { readonly mode: 'rename'; readonly item: DriveBrowserItemDto; readonly value: string }
```

Use `driveApi.createFolder`, `driveApi.renameItem`, `driveApi.moveItem`, and `driveApi.deleteItem`, then call `state.refresh()` on success. The create submit parent id is:

```ts
const parentId = state.browser.status === 'ready' && state.browser.snapshot.current.type === 'folder'
  ? state.browser.snapshot.current.id
  : null
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-console.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-console
git commit -m "feat: add web drive file actions"
```

---

### Task 5: Wire Button Upload And Drag-Drop Upload

**Files:**
- Modify: `dashboard/src/features/drive-console/drive-console-page.tsx`
- Modify: `dashboard/src/features/drive-console/drive-file-table.tsx`
- Modify: `dashboard/src/features/drive-console/drive-console.test.tsx`

- [ ] **Step 1: Add failing upload UI tests**

Mock `uploadDriveFiles` at the top of `drive-console.test.tsx`:

```ts
vi.mock('./drive-upload', () => ({
  uploadDriveFiles: vi.fn(),
}))
```

Import:

```ts
import { uploadDriveFiles } from './drive-upload'
```

Add tests:

```tsx
it('uploads selected files to the current folder and refreshes', async () => {
  const snapshot = folderSnapshot()
  const reload = vi.fn(async () => snapshot)
  vi.mocked(useDriveBrowser).mockReturnValue({
    status: 'ready',
    snapshot,
    loadingMoreChildren: false,
    loadMoreChildrenError: null,
    reload,
    reloading: false,
    saveText: vi.fn(),
    savingText: false,
  })
  vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
  vi.mocked(uploadDriveFiles).mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
  await render(<DriveConsolePage />)

  const fileInput = document.querySelector('input[type="file"]')
  if (!(fileInput instanceof HTMLInputElement)) throw new Error('missing file input')
  const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  })

  expect(uploadDriveFiles).toHaveBeenCalledWith({ parentId: 'root', files: [file] })
  expect(reload).toHaveBeenCalled()
})

it('passes dropped loose files to upload helper', async () => {
  mockReadySnapshot(folderSnapshot())
  vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
  vi.mocked(uploadDriveFiles).mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
  await render(<DriveConsolePage />)

  const dropzone = document.querySelector('[data-testid="drive-console-dropzone"]')
  if (!(dropzone instanceof HTMLElement)) throw new Error('missing dropzone')
  const file = new File(['hello'], 'drop.md')
  const event = new Event('drop', { bubbles: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: [file], items: [], types: ['Files'], dropEffect: 'copy' },
  })
  await act(async () => {
    dropzone.dispatchEvent(event)
  })

  expect(uploadDriveFiles).toHaveBeenCalledWith({ parentId: 'root', files: [file] })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-console.test.tsx
```

Expected: FAIL because upload UI is not wired.

- [ ] **Step 3: Implement upload UI**

In `drive-console-page.tsx`, add:

```tsx
const fileInputRef = useRef<HTMLInputElement>(null)
const [uploading, setUploading] = useState(false)
```

Add hidden input:

```tsx
<input
  ref={fileInputRef}
  type='file'
  multiple
  className='hidden'
  onChange={(event) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void runUpload(files)
  }}
/>
```

Change upload button:

```tsx
<Button type='button' variant='outline' size='sm' disabled={uploading} onClick={() => fileInputRef.current?.click()}>
  <Upload data-icon='inline-start' />
  上传文件
</Button>
```

Add upload runner:

```ts
const runUpload = async (files: readonly File[]) => {
  if (state.browser.status !== 'ready' || state.browser.snapshot.current.type !== 'folder' || files.length === 0) return
  setUploading(true)
  try {
    const result = await uploadDriveFiles({ parentId: state.browser.snapshot.current.id, files })
    toast(uploadResultMessage(result))
    await state.refresh()
  } catch (error) {
    toast(error instanceof Error ? error.message : '上传失败')
  } finally {
    setUploading(false)
  }
}
```

Add helper:

```ts
function uploadResultMessage(result: { readonly completed: number; readonly failed: number; readonly skipped: number; readonly message?: string }) {
  if (result.completed > 0 && result.failed === 0 && result.skipped === 0) return `已上传 ${result.completed} 个文件`
  if (result.completed > 0) return `已上传 ${result.completed} 个文件，失败 ${result.failed} 个，跳过 ${result.skipped} 个`
  if (result.skipped > 0 && result.failed === 0) return result.message ?? `已跳过 ${result.skipped} 个文件`
  return result.message ?? '上传失败'
}
```

Pass `onDropFiles={runUpload}` to `DriveFileTable`.

In `drive-file-table.tsx`, add drop handling to the wrapper:

```tsx
export function DriveFileTable({ ..., onDropFiles }: { ...; readonly onDropFiles: (files: readonly File[]) => void }) {
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    onDropFiles(files)
  }

  return (
    <div
      data-testid='drive-console-dropzone'
      className='rounded-lg border bg-background'
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={handleDrop}
    >
      ...
    </div>
  )
}
```

- [ ] **Step 4: Run upload UI and upload helper tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-console.test.tsx src/features/drive-console/drive-upload.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-console
git commit -m "feat: add web drive file upload"
```

---

### Task 6: Add Sharing Dialogs And My Shares

**Files:**
- Create: `dashboard/src/features/drive-console/drive-share-dialogs.tsx`
- Create: `dashboard/src/features/drive-console/drive-share-dialogs.test.tsx`
- Modify: `dashboard/src/features/drive-console/drive-console-page.tsx`
- Modify: `dashboard/src/features/drive-console/drive-file-table.tsx`

- [ ] **Step 1: Write failing share tests**

Create `dashboard/src/features/drive-console/drive-share-dialogs.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveShareSettingsDialog, DriveSharesDialog } from './drive-share-dialogs'
import { driveApi } from '@/lib/api'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveApi: {
    listShares: vi.fn(),
    disableShare: vi.fn(),
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveShareSettingsDialog', () => {
  it('submits desktop-compatible share settings', async () => {
    const onConfirm = vi.fn(async () => undefined)
    render(<DriveShareSettingsDialog open itemName='notes.md' submitting={false} onOpenChange={() => undefined} onConfirm={onConfirm} />)

    await click(textButton('确定'))

    expect(onConfirm).toHaveBeenCalledWith({
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'link_read',
      editorEmails: [],
    })
  })
})

describe('DriveSharesDialog', () => {
  it('lists shares and cancels a share', async () => {
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [{
        id: 'share-db-id',
        shareId: 'shr_1',
        itemId: 'item-1',
        itemName: 'notes.md',
        itemType: 'file',
        sourceDeleted: false,
        url: 'https://example.com/share/shr_1',
        urlWithPassword: 'https://example.com/share/shr_1?p=abc',
        passwordEnabled: true,
        password: 'abc',
        expiresAt: null,
        accessMode: 'link_read',
        editorEmails: [],
        createdAt: '2026-06-29T00:00:00.000Z',
      }],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.disableShare).mockResolvedValue({ ok: true })
    render(<DriveSharesDialog open onOpenChange={() => undefined} onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('notes.md')
    await click(textButton('取消分享'))
    expect(driveApi.disableShare).toHaveBeenCalledWith('share-db-id')
  })
})

function render(element: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

async function flush() {
  await act(async () => undefined)
}

function textButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`missing button ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
```

- [ ] **Step 2: Run share tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-share-dialogs.test.tsx
```

Expected: FAIL because the share dialog file does not exist.

- [ ] **Step 3: Implement share dialogs**

Create `dashboard/src/features/drive-console/drive-share-dialogs.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { DRIVE_DEFAULT_ACCESS_SETTINGS, type DriveAccessSettingsInput, type DriveShareAccessMode, type DriveShareListItemDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { driveApi } from '@/lib/api'

type ShareFilter = 'file' | 'folder'

export function DriveShareSettingsDialog({
  itemName,
  open,
  submitting,
  onConfirm,
  onOpenChange,
}: {
  readonly itemName: string
  readonly open: boolean
  readonly submitting: boolean
  readonly onConfirm: (settings: DriveAccessSettingsInput) => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [settings, setSettings] = useState<DriveAccessSettingsInput>(() => ({ ...DRIVE_DEFAULT_ACCESS_SETTINGS, editorEmails: [] }))
  const accessMode = settings.accessMode ?? 'link_read'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分享设置</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='text-sm text-muted-foreground'>{itemName}</div>
          <div className='grid gap-2'>
            <Label>权限</Label>
            <ToggleGroup type='single' variant='outline' size='sm' value={accessMode} onValueChange={(value) => {
              if (value) setSettings((current) => ({ ...current, accessMode: value as DriveShareAccessMode }))
            }}>
              <ToggleGroupItem value='link_read'>可阅读</ToggleGroupItem>
              <ToggleGroupItem value='link_edit'>登录用户可编辑</ToggleGroupItem>
              <ToggleGroupItem value='specified_users_edit'>指定用户可编辑</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <label className='flex items-center justify-between gap-3' htmlFor='drive-share-password-enabled'>
            <span className='text-sm font-medium'>需要密码</span>
            <Switch id='drive-share-password-enabled' checked={settings.passwordEnabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, passwordEnabled: checked }))} />
          </label>
          <div className='grid gap-2'>
            <Label>有效时长</Label>
            <ToggleGroup type='single' variant='outline' size='sm' value={settings.expiresIn} onValueChange={(value) => {
              if (value) setSettings((current) => ({ ...current, expiresIn: value as DriveAccessSettingsInput['expiresIn'] }))
            }}>
              <ToggleGroupItem value='3d'>3 天</ToggleGroupItem>
              <ToggleGroupItem value='7d'>7 天</ToggleGroupItem>
              <ToggleGroupItem value='30d'>30 天</ToggleGroupItem>
              <ToggleGroupItem value='1y'>1 年</ToggleGroupItem>
              <ToggleGroupItem value='forever'>永久</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type='button' disabled={submitting} onClick={() => { void onConfirm({ ...settings, editorEmails: settings.editorEmails ?? [] }) }}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DriveSharesDialog({
  open,
  onChanged,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onChanged: () => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<DriveShareListItemDto[]>([])
  const [filter, setFilter] = useState<ShareFilter>('file')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const page = await driveApi.listShares({ offset: 0, limit: 50 })
      setItems([...page.items])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const visible = items.filter((item) => item.itemType === filter)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>我的分享</DialogTitle>
        </DialogHeader>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as ShareFilter)}>
          <TabsList>
            <TabsTrigger value='file'>文件</TabsTrigger>
            <TabsTrigger value='folder'>文件夹</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='grid gap-2'>
          {loading ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
          {!loading && visible.length === 0 ? <div className='text-sm text-muted-foreground'>暂无分享</div> : null}
          {visible.map((item) => (
            <div key={item.id} className='flex items-center justify-between gap-3 border-b py-2'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>{item.itemName}</div>
                <Input value={item.password ? item.urlWithPassword : item.url} readOnly className='mt-1 font-mono text-xs' />
              </div>
              <Button type='button' variant='ghost' size='sm' onClick={() => {
                void driveApi.disableShare(item.id).then(async () => {
                  await load()
                  await onChanged()
                })
              }}>
                取消分享
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Wire dialogs into console page**

In `drive-console-page.tsx`, add state for selected share item, share dialog open, and My Shares open. Use:

```ts
await driveApi.createShare(item.id, settings)
await state.refresh()
```

Pass `onShare` from `DriveFileTable` to open `DriveShareSettingsDialog`. Change toolbar `我的分享` button to open `DriveSharesDialog`.

- [ ] **Step 5: Run share tests and console tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-share-dialogs.test.tsx src/features/drive-console/drive-console.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-console
git commit -m "feat: add web drive sharing"
```

---

### Task 7: Add Public Assets And Trash Subviews

**Files:**
- Create: `dashboard/src/features/drive-console/drive-public-assets-view.tsx`
- Create: `dashboard/src/features/drive-console/drive-trash-view.tsx`
- Create: `dashboard/src/features/drive-console/drive-trash-public-sites.test.tsx`
- Modify: `dashboard/src/features/drive-console/drive-console-page.tsx`

- [ ] **Step 1: Write failing public assets and trash tests**

Create `dashboard/src/features/drive-console/drive-trash-public-sites.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveTrashView } from './drive-trash-view'
import { DrivePublicAssetsView } from './drive-public-assets-view'
import { driveApi } from '@/lib/api'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveApi: {
    listTrash: vi.fn(),
    restoreItem: vi.fn(),
    deleteTrashItem: vi.fn(),
    listPublicAssets: vi.fn(),
    preparePublicAssetUpload: vi.fn(),
    completePublicAssetUpload: vi.fn(),
    cancelPublicAssetUpload: vi.fn(),
    preparePublicAssetReplace: vi.fn(),
    completePublicAssetReplace: vi.fn(),
    cancelPublicAssetReplace: vi.fn(),
    renamePublicAsset: vi.fn(),
    trashPublicAsset: vi.fn(),
    restorePublicAsset: vi.fn(),
    publicAssetDownloadUrl: vi.fn((assetId: string) => `/api/drive/public-assets/${assetId}/download`),
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveTrashView', () => {
  it('restores and removes trash items', async () => {
    vi.mocked(driveApi.listTrash).mockResolvedValue({
      items: [{ id: 'item-1', kind: 'normal', name: 'old.md', type: 'file', size: '10', mimeType: 'text/markdown', originalPath: '/old.md', trashedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.restoreItem).mockResolvedValue({} as never)
    vi.mocked(driveApi.deleteTrashItem).mockResolvedValue({ ok: true })
    render(<DriveTrashView onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('old.md')
    await click(textButton('恢复'))
    expect(driveApi.restoreItem).toHaveBeenCalledWith('item-1')
    await click(textButton('删除'))
    expect(driveApi.deleteTrashItem).toHaveBeenCalledWith('item-1')
  })
})

describe('DrivePublicAssetsView', () => {
  it('lists public assets and moves one to trash', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [{ assetId: 'asset-1', itemId: 'item-1', name: 'logo.png', size: '10', mimeType: 'image/png', url: '/files/asset-1', lifecycleStatus: 'active', accessCount: '0', responseBytes: '0', lastAccessedAt: null, createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.trashPublicAsset).mockResolvedValue({} as never)
    render(<DrivePublicAssetsView onChanged={async () => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('logo.png')
    await click(textButton('删除'))
    expect(driveApi.trashPublicAsset).toHaveBeenCalledWith('asset-1')
  })

  it('uploads, renames, and replaces public assets', async () => {
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [{ assetId: 'asset-1', itemId: 'item-1', name: 'logo.png', size: '10', mimeType: 'image/png', url: '/files/asset-1', lifecycleStatus: 'active', accessCount: '0', responseBytes: '0', lastAccessedAt: null, createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.preparePublicAssetUpload).mockResolvedValue({ sessionId: 'upload-1', item: {} as never, upload: { method: 'PUT', url: 'https://upload.example/new', expiresAt: '', headers: {} } })
    vi.mocked(driveApi.preparePublicAssetReplace).mockResolvedValue({ sessionId: 'replace-1', item: {} as never, upload: { method: 'PUT', url: 'https://upload.example/replace', expiresAt: '', headers: {} } })
    vi.mocked(driveApi.completePublicAssetUpload).mockResolvedValue({} as never)
    vi.mocked(driveApi.completePublicAssetReplace).mockResolvedValue({} as never)
    vi.mocked(driveApi.renamePublicAsset).mockResolvedValue({} as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    render(<DrivePublicAssetsView onChanged={async () => undefined} />)
    await flush()

    const uploadInput = document.querySelector('input[aria-label="上传公开素材"]')
    if (!(uploadInput instanceof HTMLInputElement)) throw new Error('missing upload input')
    const nextFile = new File(['new'], 'new-logo.png', { type: 'image/png' })
    Object.defineProperty(uploadInput, 'files', { value: [nextFile], configurable: true })
    await act(async () => uploadInput.dispatchEvent(new Event('change', { bubbles: true })))
    expect(driveApi.preparePublicAssetUpload).toHaveBeenCalledWith({ name: 'new-logo.png', size: String(nextFile.size), mimeType: 'image/png' })
    expect(driveApi.completePublicAssetUpload).toHaveBeenCalledWith('upload-1')

    await click(textButton('重命名'))
    await input('素材名称', 'renamed.png')
    await click(textButton('保存'))
    expect(driveApi.renamePublicAsset).toHaveBeenCalledWith('asset-1', 'renamed.png')

    await click(textButton('替换'))
    const replaceInput = document.querySelector('input[aria-label="替换公开素材"]')
    if (!(replaceInput instanceof HTMLInputElement)) throw new Error('missing replace input')
    const replaceFile = new File(['replace'], 'replace.png', { type: 'image/png' })
    Object.defineProperty(replaceInput, 'files', { value: [replaceFile], configurable: true })
    await act(async () => replaceInput.dispatchEvent(new Event('change', { bubbles: true })))
    expect(driveApi.preparePublicAssetReplace).toHaveBeenCalledWith('asset-1', { name: 'replace.png', size: String(replaceFile.size), mimeType: 'image/png' })
    expect(driveApi.completePublicAssetReplace).toHaveBeenCalledWith('asset-1', 'replace-1')
  })
})

function render(element: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

async function flush() {
  await act(async () => undefined)
}

function textButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`missing button ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function input(labelText: string, value: string) {
  const label = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.includes(labelText))
  const id = label?.getAttribute('for')
  const field = id ? document.getElementById(id) : null
  if (!(field instanceof HTMLInputElement)) throw new Error(`missing input ${labelText}`)
  await act(async () => {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-trash-public-sites.test.tsx
```

Expected: FAIL because public asset and trash views do not exist.

- [ ] **Step 3: Implement trash view**

Create `dashboard/src/features/drive-console/drive-trash-view.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { DriveTrashItemDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { driveApi } from '@/lib/api'

export function DriveTrashView({ onChanged }: { readonly onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<DriveTrashItemDto[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const page = await driveApi.listTrash({ offset: 0, limit: 50 })
      setItems([...page.items])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading) return <div className='text-sm text-muted-foreground'>加载中</div>
  if (items.length === 0) return <div className='rounded-lg border p-6 text-center text-sm text-muted-foreground'>回收站为空</div>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>原路径</TableHead>
          <TableHead className='text-right'>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>{item.name}</TableCell>
            <TableCell className='text-muted-foreground'>{item.originalPath ?? '-'}</TableCell>
            <TableCell className='text-right'>
              <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.restoreItem(item.id).then(async () => { await load(); await onChanged() }) }}>恢复</Button>
              <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.deleteTrashItem(item.id).then(async () => { await load(); await onChanged() }) }}>删除</Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 4: Implement public assets view**

Create `dashboard/src/features/drive-console/drive-public-assets-view.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { DrivePublicAssetDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { driveApi } from '@/lib/api'

export function DrivePublicAssetsView({ onChanged }: { readonly onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<DrivePublicAssetDto[]>([])
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<DrivePublicAssetDto | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const replaceTargetRef = useRef<DrivePublicAssetDto | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const page = await driveApi.listPublicAssets({ offset: 0, limit: 50 })
      setItems([...page.items])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const uploadPublicAsset = async (file: File, target: DrivePublicAssetDto | null) => {
    const prepared = target
      ? await driveApi.preparePublicAssetReplace(target.assetId, { name: file.name, size: String(file.size), mimeType: file.type || null })
      : await driveApi.preparePublicAssetUpload({ name: file.name, size: String(file.size), mimeType: file.type || null })
    try {
      const response = await fetch(prepared.upload.url, { method: prepared.upload.method, headers: prepared.upload.headers, body: file })
      if (!response.ok) throw new Error(response.statusText || '上传失败')
      if (target) {
        await driveApi.completePublicAssetReplace(target.assetId, prepared.sessionId)
      } else {
        await driveApi.completePublicAssetUpload(prepared.sessionId)
      }
      await load()
      await onChanged()
    } catch (error) {
      if (target) {
        await driveApi.cancelPublicAssetReplace(target.assetId, prepared.sessionId)
      } else {
        await driveApi.cancelPublicAssetUpload(prepared.sessionId)
      }
      throw error
    }
  }

  if (loading) return <div className='text-sm text-muted-foreground'>加载中</div>
  if (items.length === 0) return <div className='rounded-lg border p-6 text-center text-sm text-muted-foreground'>暂无公开素材</div>
  return (
    <div className='grid gap-3'>
      <div className='flex justify-end'>
        <input
          ref={uploadInputRef}
          aria-label='上传公开素材'
          type='file'
          accept='image/png,image/jpeg,image/gif,image/webp,image/avif,image/x-icon'
          className='hidden'
          onChange={(event) => {
            const [file] = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (file) void uploadPublicAsset(file, null)
          }}
        />
        <input
          ref={replaceInputRef}
          aria-label='替换公开素材'
          type='file'
          accept='image/png,image/jpeg,image/gif,image/webp,image/avif,image/x-icon'
          className='hidden'
          onChange={(event) => {
            const [file] = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            const target = replaceTargetRef.current
            replaceTargetRef.current = null
            if (file && target) void uploadPublicAsset(file, target)
          }}
        />
        <Button type='button' variant='outline' size='sm' onClick={() => uploadInputRef.current?.click()}>上传公开素材</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='text-right'>大小</TableHead>
            <TableHead className='text-right'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.assetId}>
              <TableCell>{item.name}</TableCell>
              <TableCell className='text-right text-muted-foreground'>{item.size} B</TableCell>
              <TableCell className='text-right'>
                <Button type='button' variant='ghost' size='sm' asChild><a href={item.url} target='_blank' rel='noreferrer'>打开</a></Button>
                <Button type='button' variant='ghost' size='sm' onClick={() => { setRenameTarget(item); setRenameValue(item.name) }}>重命名</Button>
                <Button type='button' variant='ghost' size='sm' onClick={() => { replaceTargetRef.current = item; replaceInputRef.current?.click() }}>替换</Button>
                <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.trashPublicAsset(item.assetId).then(async () => { await load(); await onChanged() }) }}>删除</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>重命名</DialogTitle></DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='drive-public-asset-name'>素材名称</Label>
            <Input id='drive-public-asset-name' value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setRenameTarget(null)}>取消</Button>
            <Button type='button' disabled={!renameTarget || renameValue.trim().length === 0} onClick={() => {
              if (!renameTarget) return
              void driveApi.renamePublicAsset(renameTarget.assetId, renameValue.trim()).then(async () => {
                setRenameTarget(null)
                await load()
                await onChanged()
              })
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 5: Wire subviews into console page**

In `drive-console-page.tsx`, render:

```tsx
{state.browser.status === 'ready' && activeView === 'public-assets' ? (
  <DrivePublicAssetsView onChanged={state.refresh} />
) : null}
{state.browser.status === 'ready' && activeView === 'trash' ? (
  <DriveTrashView onChanged={state.refresh} />
) : null}
{state.browser.status === 'ready' && activeView === 'files' ? (
  <DriveFileTable ... />
) : null}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-trash-public-sites.test.tsx src/features/drive-console/drive-console.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/features/drive-console
git commit -m "feat: add web drive public assets and trash"
```

---

### Task 8: Add Site Publishing And Site Management

**Files:**
- Create: `dashboard/src/features/drive-console/drive-sites-dialogs.tsx`
- Modify: `dashboard/src/features/drive-console/drive-trash-public-sites.test.tsx`
- Modify: `dashboard/src/features/drive-console/drive-console-page.tsx`
- Modify: `dashboard/src/features/drive-console/drive-file-table.tsx`

- [ ] **Step 1: Add failing site tests**

Extend the API mock in `drive-trash-public-sites.test.tsx`:

```ts
    preflightSite: vi.fn(),
    createSite: vi.fn(),
    listSites: vi.fn(),
    updateSiteAccess: vi.fn(),
    disableSite: vi.fn(),
    enableSite: vi.fn(),
    republishSite: vi.fn(),
    deleteSite: vi.fn(),
```

Import:

```ts
import { DriveSiteCreateDialog, DriveSitesDialog } from './drive-sites-dialogs'
```

Add:

```tsx
describe('Drive site dialogs', () => {
  it('creates a site from a folder', async () => {
    vi.mocked(driveApi.preflightSite).mockResolvedValue({
      sourceFolderItemId: 'folder-1',
      sourceFolderName: '站点',
      htmlFiles: ['index.html'],
      defaultEntryPath: 'index.html',
      fileCount: 1,
      totalBytes: '10',
      includesJavaScript: false,
    })
    vi.mocked(driveApi.createSite).mockResolvedValue({} as never)
    render(<DriveSiteCreateDialog folder={{ id: 'folder-1', name: '站点' } as never} open onOpenChange={() => undefined} onCreated={async () => undefined} />)
    await flush()

    await click(textButton('发布'))
    expect(driveApi.createSite).toHaveBeenCalledWith({
      sourceFolderItemId: 'folder-1',
      name: '站点',
      entryPath: 'index.html',
      accessMode: 'public',
      expiresIn: 'forever',
    })
  })

  it('lists sites and disables one', async () => {
    vi.mocked(driveApi.listSites).mockResolvedValue({
      items: [{ id: 'db-1', siteId: 'site-1', name: 'Docs', status: 'active', accessMode: 'public', url: '/sites/site-1', urlWithPassword: '/sites/site-1', passwordEnabled: false, password: null, expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '站点', entryPath: 'index.html', fileCount: 1, totalBytes: '10', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveApi.disableSite).mockResolvedValue({} as never)
    render(<DriveSitesDialog open onOpenChange={() => undefined} />)
    await flush()

    expect(document.body.textContent).toContain('Docs')
    await click(textButton('停用'))
    expect(driveApi.disableSite).toHaveBeenCalledWith('site-1')
    await click(textButton('访问设置'))
    await click(textButton('保存访问'))
    expect(driveApi.updateSiteAccess).toHaveBeenCalledWith('site-1', {
      accessMode: 'public',
      expiresIn: 'forever',
    })
  })
})
```

- [ ] **Step 2: Run site tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-trash-public-sites.test.tsx
```

Expected: FAIL because site dialogs do not exist.

- [ ] **Step 3: Implement site dialogs**

Create `dashboard/src/features/drive-console/drive-sites-dialogs.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { DriveBrowserItemDto, DriveSiteAccessMode, DriveSiteDto, DriveSitePreflightDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { driveApi } from '@/lib/api'

export function DriveSiteCreateDialog({
  folder,
  open,
  onCreated,
  onOpenChange,
}: {
  readonly folder: Pick<DriveBrowserItemDto, 'id' | 'name'> | null
  readonly open: boolean
  readonly onCreated: () => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [preflight, setPreflight] = useState<DriveSitePreflightDto | null>(null)
  useEffect(() => {
    if (open && folder) void driveApi.preflightSite(folder.id).then(setPreflight)
  }, [folder, open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发布站点</DialogTitle>
        </DialogHeader>
        <div className='text-sm text-muted-foreground'>{folder?.name}</div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button>
          <Button type='button' disabled={!folder || !preflight} onClick={() => {
            if (!folder || !preflight) return
            void driveApi.createSite({
              sourceFolderItemId: folder.id,
              name: folder.name,
              entryPath: preflight.defaultEntryPath,
              accessMode: 'public',
              expiresIn: 'forever',
            }).then(async () => {
              await onCreated()
              onOpenChange(false)
            })
          }}>发布</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DriveSitesDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const [sites, setSites] = useState<DriveSiteDto[]>([])
  const [accessTarget, setAccessTarget] = useState<DriveSiteDto | null>(null)
  const [accessMode, setAccessMode] = useState<DriveSiteAccessMode>('public')
  const load = async () => {
    const page = await driveApi.listSites({ offset: 0, limit: 50 })
    setSites([...page.items])
  }
  useEffect(() => {
    if (open) void load()
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>站点</DialogTitle>
        </DialogHeader>
        <div className='grid gap-2'>
          {sites.length === 0 ? <div className='text-sm text-muted-foreground'>暂无站点</div> : null}
          {sites.map((site) => (
            <div key={site.siteId} className='flex items-center justify-between gap-3 border-b py-2'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>{site.name}</div>
                <div className='truncate text-xs text-muted-foreground'>{site.url}</div>
              </div>
              <div className='flex items-center gap-1'>
                <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.republishSite(site.siteId, { entryPath: site.entryPath }).then(load) }}>重发</Button>
                <Button type='button' variant='ghost' size='sm' onClick={() => { setAccessTarget(site); setAccessMode(site.accessMode) }}>访问设置</Button>
                {site.status === 'active' ? (
                  <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.disableSite(site.siteId).then(load) }}>停用</Button>
                ) : (
                  <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.enableSite(site.siteId).then(load) }}>启用</Button>
                )}
                <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.deleteSite(site.siteId).then(load) }}>删除</Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
        <Dialog open={accessTarget !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setAccessTarget(null) }}>
          <DialogContent>
            <DialogHeader><DialogTitle>访问设置</DialogTitle></DialogHeader>
            <ToggleGroup type='single' variant='outline' value={accessMode} onValueChange={(value) => {
              if (value) setAccessMode(value as DriveSiteAccessMode)
            }}>
              <ToggleGroupItem value='public'>公开</ToggleGroupItem>
              <ToggleGroupItem value='password'>密码</ToggleGroupItem>
            </ToggleGroup>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setAccessTarget(null)}>取消</Button>
              <Button type='button' onClick={() => {
                if (!accessTarget) return
                void driveApi.updateSiteAccess(accessTarget.siteId, {
                  accessMode,
                  expiresIn: 'forever',
                }).then(async () => {
                  setAccessTarget(null)
                  await load()
                })
              }}>保存访问</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Wire site actions into table and toolbar**

Add `onPublishSite` to `DriveFileTable` row props. Render `发布站点` in the `更多` action only for folder rows. In `drive-console-page.tsx`, open `DriveSiteCreateDialog` with the selected folder and `DriveSitesDialog` from the toolbar `站点` button.

- [ ] **Step 5: Run site tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-console/drive-trash-public-sites.test.tsx src/features/drive-console/drive-console.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-console
git commit -m "feat: add web drive site management"
```

---

### Task 9: Polish Console Completeness And Regression Coverage

**Files:**
- Modify: `dashboard/src/features/drive-console/*`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.tsx`
- Modify: `dashboard/src/features/drive-browser/use-drive-browser.test.ts`

- [ ] **Step 1: Add regression expectations**

Add a test to `dashboard/src/features/drive-browser/drive-browser-page.test.tsx` that still renders the current folder browser component for standalone or share views. Use existing helper `mockDriveBrowserState`:

```tsx
it('keeps standalone owner file reader behavior outside the console shell', () => {
  mockDriveBrowserState({
    status: 'ready',
    snapshot: createSnapshot({
      surface: 'standalone',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        previewKind: 'markdown',
      },
    }),
    loadingMoreChildren: false,
    loadMoreChildrenError: null,
    reload: vi.fn(async () => createSnapshot()),
    reloading: false,
    saveText: vi.fn(),
    savingText: false,
  })

  renderPage(<DriveBrowserPage context='owner' surface='standalone' itemId='file' />)

  expect(document.body.textContent).toContain('notes.md')
})
```

- [ ] **Step 2: Run existing browser tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser/drive-browser-page.test.tsx src/features/drive-browser/use-drive-browser.test.ts
```

Expected: PASS.

- [ ] **Step 3: Polish UI to match rules**

Inspect `dashboard/src/features/drive-console/*` and ensure:

```text
No inline style={{...}}
No hex/rgb/hsl literal colors
No Tailwind arbitrary color classes
No card-inside-card layout
No visible sync action
No folder upload input
Numeric table columns right-aligned
Buttons use existing shadcn variants
Empty/error text is short and operational
```

Use this command:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|同步|webkitdirectory|上传文件夹" dashboard/src/features/drive-console
```

Expected: no matches except intentional test assertions that check sync is absent.

- [ ] **Step 4: Run focused dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/features/drive-console src/features/drive-browser/drive-browser-page.test.tsx src/features/drive-browser/use-drive-browser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/drive-console dashboard/src/features/drive-browser
git commit -m "test: cover web drive console regressions"
```

---

### Task 10: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add one bullet under the most relevant pending release section in `RELEASE_NOTES_PENDING.md`:

```md
- Web 端网盘补齐了文件上传、文件夹管理、分享、站点、公开素材和回收站能力，和客户端的云端操作保持一致；网页端仍不提供同步和文件夹上传。
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/features/drive-console src/features/drive-browser/drive-browser-page.test.tsx src/features/drive-browser/use-drive-browser.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit release notes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note web drive console alignment"
```

---

## Self-Review

Spec coverage:

- Web management shell: Tasks 3-5.
- Cloud file upload without folder upload: Tasks 2 and 5.
- No sync exposure: Tasks 3 and 9.
- File operations: Task 4.
- Sharing and My Shares: Task 6.
- Public assets: Task 7.
- Trash: Task 7.
- Sites: Task 8.
- Existing reader/browser compatibility: Tasks 3 and 9.
- API client coverage: Task 1.
- Release notes: Task 10.

Placeholder scan:

- The plan contains no unresolved placeholder markers or unspecified task placeholders.
- Each task lists exact files, commands, expected results, and commit commands.

Type consistency:

- `driveApi` methods introduced in Task 1 are the methods consumed by Tasks 2, 4, 6, 7, and 8.
- Console routes import from `@/features/drive-console/drive-console-page` after Task 3.
- `uploadDriveFiles` result shape is used consistently in Tasks 2 and 5.
