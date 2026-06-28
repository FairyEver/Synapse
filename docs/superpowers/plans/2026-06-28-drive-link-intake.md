# Drive Link Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build read-only Drive Link MCP tools so local Agents can resolve, list, read, materialize, and download Synapse Drive `/share`, `/sites`, and `/files` links.

**Architecture:** Add shared Drive Link DTOs, a server-side link intake service/controller that reuses existing Drive share/site/public asset access logic, Electron account-service methods for API calls and local cache writes, and Drive MCP dispatcher/capability wiring. Server endpoints project remote Drive links into Agent-friendly DTOs; Electron materialization writes cache copies under app `userData`.

**Tech Stack:** TypeScript, NestJS, Electron, Vitest, Zod, pnpm monorepo, existing Synapse Drive services and MCP capability registry.

---

## File Structure

- `shared/src/drive.ts`: Add Drive Link DTO types, link type enums, and path constants used by server, Electron, and MCP.
- `shared/src/drive.test.ts`: Unit tests for link DTO helper constants or URL parsing helpers added in `shared/src/drive.ts`.
- `server/src/drive/drive-link-intake.service.ts`: New focused service for resolving, listing, and reading Drive links by reusing `DriveService`, `DriveSiteService`, `DrivePublicAssetService`, and `DriveStoragePort`.
- `server/src/drive/drive-link-intake.service.spec.ts`: Tests for share, site, public asset, password, binary rejection, and path safety behavior.
- `server/src/drive/drive.controller.ts`: Add public `/api/drive/link-intake/*` endpoints in `DrivePublicController`.
- `server/src/drive/drive.controller.spec.ts`: Controller tests for validation and endpoint routing.
- `server/src/drive/drive.module.ts`: Register and export `DriveLinkIntakeService`.
- `desktop/electron/services/account-service.ts`: Add API methods and local materialization/download helpers.
- `desktop/electron/services/__tests__/account-service.test.ts`: Tests for URL construction, password POST body, redaction, and local cache output.
- `desktop/electron/modules/account/ipc.ts`: Add IPC schemas and bridge handlers for renderer/internal account API parity.
- `desktop/src/types/bridge.ts`: Add bridge account method types.
- `desktop/electron/capabilities/drive-dispatcher.ts`: Add dispatcher actions and account-service port methods for all five MCP tools.
- `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`: Tests for dispatch, audit metadata, local write authorization, and password redaction.
- `desktop/synapse-capabilities/shared/drive-domain.ts`: Add five capabilities and tool schemas.
- `desktop/synapse-capabilities/shared/drive-domain.test.ts`: Assert primary and legacy tool names, schemas, and mutating metadata.
- `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`: Teach Agents when to use link intake tools.
- `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`: Document the five tools.
- `website/developer/capability-naming-matrix.md`: Add capability naming rows.
- `RELEASE_NOTES_PENDING.md`: Add a user-facing note for Agent consumption of Drive links.

---

### Task 1: Shared Drive Link DTOs

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add these tests near the existing Drive URL helper tests in `shared/src/drive.test.ts`:

```ts
import {
  DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES,
  DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES,
  DRIVE_LINK_INTAKE_SCOPES,
  DRIVE_LINK_SUPPORTED_PATH_PREFIXES,
  type DriveLinkMaterializeScope,
  type DriveLinkResolveDto,
} from "./drive"

it("defines Drive link intake defaults and supported path prefixes", () => {
  expect(DRIVE_LINK_SUPPORTED_PATH_PREFIXES).toEqual(["/share", "/sites", "/files"])
  expect(DRIVE_LINK_INTAKE_SCOPES).toEqual(["entry", "text", "all"])
  expect(DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES).toBe(200)
  expect(DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES).toBe(50 * 1024 * 1024)
})

it("keeps Drive link intake DTOs typed around raw material output", () => {
  const scope: DriveLinkMaterializeScope = "text"
  const resolved: DriveLinkResolveDto = {
    ok: true,
    linkType: "share",
    access: {
      status: "ok",
      canRead: true,
      canList: true,
      canReadText: true,
      canDownload: true,
    },
    root: {
      name: "需求说明.md",
      type: "file",
      previewKind: "markdown",
    },
    ref: {
      kind: "share",
      shareId: "shr_123",
      itemId: null,
      siteId: null,
      path: null,
      assetId: null,
    },
  }

  expect(scope).toBe("text")
  expect(resolved.root.previewKind).toBe("markdown")
})
```

- [ ] **Step 2: Run shared tests and verify failure**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: fail because `DRIVE_LINK_*` exports and DTO types do not exist.

- [ ] **Step 3: Add shared DTOs and constants**

Append this block after the existing Drive browser DTOs in `shared/src/drive.ts`:

```ts
export const DRIVE_LINK_SUPPORTED_PATH_PREFIXES = [DRIVE_PUBLIC_PATH_PREFIX, DRIVE_SITE_PATH_PREFIX, DRIVE_PUBLIC_ASSET_PATH_PREFIX] as const
export const DRIVE_LINK_INTAKE_SCOPES = ["entry", "text", "all"] as const
export const DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES = 200
export const DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES = 50 * 1024 * 1024

export type DriveLinkType = "share" | "share_item" | "site" | "site_path" | "public_asset"
export type DriveLinkRefKind = "share" | "site" | "public_asset"
export type DriveLinkAccessStatus = "ok" | "password_required" | "login_required" | "not_found"
export type DriveLinkRootType = "file" | "folder" | "site" | "asset"
export type DriveLinkEntryType = "file" | "folder" | "site" | "asset"
export type DriveLinkPreviewKind = DriveBrowserPreviewKind | "html" | "text"
export type DriveLinkMaterializeScope = typeof DRIVE_LINK_INTAKE_SCOPES[number]
export type DriveLinkMaterializedFileKind = "markdown" | "html" | "text" | "image" | "binary" | "folder"

export interface DriveLinkAccessDto {
  readonly status: DriveLinkAccessStatus
  readonly canRead: boolean
  readonly canList: boolean
  readonly canReadText: boolean
  readonly canDownload: boolean
}

export interface DriveLinkRefDto {
  readonly kind: DriveLinkRefKind
  readonly shareId: string | null
  readonly itemId: string | null
  readonly siteId: string | null
  readonly path: string | null
  readonly assetId: string | null
}

export interface DriveLinkRootDto {
  readonly name: string
  readonly type: DriveLinkRootType
  readonly previewKind: DriveLinkPreviewKind
}

export interface DriveLinkResolveInput {
  readonly url: string
  readonly password?: string
}

export interface DriveLinkResolveDto {
  readonly ok: true
  readonly linkType: DriveLinkType
  readonly access: DriveLinkAccessDto
  readonly root: DriveLinkRootDto
  readonly ref: DriveLinkRefDto
}

export interface DriveLinkPageDto {
  readonly hasMore: boolean
  readonly nextOffset: number | null
}

export interface DriveLinkEntryDto {
  readonly path: string
  readonly name: string
  readonly type: DriveLinkEntryType
  readonly mimeType: string | null
  readonly previewKind: DriveLinkPreviewKind
  readonly size: string
  readonly itemId?: string | null
}

export interface DriveLinkListInput extends DriveLinkResolveInput {
  readonly path?: string
  readonly itemId?: string
  readonly offset?: number
  readonly limit?: number
}

export interface DriveLinkListDto {
  readonly items: readonly DriveLinkEntryDto[]
  readonly page: DriveLinkPageDto
}

export interface DriveLinkReadTextInput extends DriveLinkResolveInput {
  readonly itemId?: string
  readonly path?: string
  readonly maxBytes?: number
}

export interface DriveLinkReadTextDto {
  readonly path: string
  readonly mimeType: string | null
  readonly previewKind: DriveLinkPreviewKind
  readonly text: string
  readonly truncated: boolean
  readonly source: {
    readonly linkType: DriveLinkType
    readonly versionId?: string | null
  }
}

export interface DriveLinkMaterializeInput extends DriveLinkResolveInput {
  readonly scope?: DriveLinkMaterializeScope
  readonly maxFiles?: number
  readonly maxBytes?: number
}

export interface DriveLinkMaterializedFileDto {
  readonly relativePath: string
  readonly kind: DriveLinkMaterializedFileKind
  readonly size: string
}

export interface DriveLinkSkippedEntryDto {
  readonly path: string
  readonly reason: string
}

export interface DriveLinkMaterializeDto {
  readonly localRootPath: string
  readonly manifestPath: string
  readonly entryPath: string | null
  readonly files: readonly DriveLinkMaterializedFileDto[]
  readonly skipped: readonly DriveLinkSkippedEntryDto[]
  readonly warnings: readonly string[]
}

export interface DriveLinkDownloadFileInput extends DriveLinkResolveInput {
  readonly itemId?: string
  readonly path?: string
  readonly outputPath?: string
}

export interface DriveLinkDownloadFileDto {
  readonly localPath: string
  readonly mimeType: string | null
  readonly size: string
}
```

- [ ] **Step 4: Run shared tests and verify pass**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat: add drive link intake shared types"
```

---

### Task 2: Server Resolve/List/Read Service

**Files:**
- Create: `server/src/drive/drive-link-intake.service.ts`
- Create: `server/src/drive/drive-link-intake.service.spec.ts`
- Modify: `server/src/drive/drive.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/drive/drive-link-intake.service.spec.ts`:

```ts
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DriveLinkIntakeService } from "./drive-link-intake.service"

const publicAppUrl = "https://synapse.test"

function createService(overrides: Partial<ConstructorParameters<typeof DriveLinkIntakeService>[0]> = {}) {
  const drive = {
    resolvePublicShareAccess: vi.fn(async () => ({
      status: "ok",
      value: {
        id: "share-record-1",
        shareId: "shr_123",
        ownerId: "owner-1",
        type: "file",
        storageKey: "objects/req.md",
        accessMode: "link_read",
        editorEmails: [],
        item: {
          id: "item-1",
          parentId: null,
          type: "file",
          name: "需求说明.md",
          size: "12",
          mimeType: "text/markdown",
          storageStatus: "active",
          shared: true,
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      },
    })),
    getShareBrowserSnapshot: vi.fn(async () => ({
      context: "share",
      surface: "standalone",
      current: {
        id: "item-1",
        name: "需求说明.md",
        type: "file",
        size: "12",
        mimeType: "text/markdown",
        updatedAt: "2026-06-28T00:00:00.000Z",
        previewKind: "markdown",
        browserUrl: "/share/shr_123",
        downloadUrl: "/share/shr_123/download",
      },
      breadcrumbs: [],
      children: [],
      childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
      preview: {
        kind: "markdown",
        text: "# 需求\n正文",
        html: "<h1>需求</h1><p>正文</p>",
        outline: [],
        truncated: false,
        imageUrl: null,
        visitUrl: null,
      },
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: false,
    })),
    openShareBrowserItemDownload: vi.fn(),
  }
  const sites = {
    resolvePublicSite: vi.fn(async () => ({
      status: "ok",
      asset: { relativePath: "index.html", storageKey: "site/index.html", contentType: "text/html" },
    })),
  }
  const publicAssets = {
    resolvePublicAsset: vi.fn(async () => ({
      status: "ok",
      publicAssetId: "asset_123",
      userId: "owner-1",
      name: "screen.png",
      mimeType: "image/png",
      size: 12n,
      storageKey: "assets/screen.png",
      etag: "etag",
    })),
  }
  const storage = {
    getObjectStream: vi.fn(async () => ({
      stream: Readable.from("<html>ok</html>"),
      size: 15n,
      contentType: "text/html",
    })),
  }

  return {
    drive,
    sites,
    publicAssets,
    storage,
    service: new DriveLinkIntakeService({ drive, sites, publicAssets, storage, publicAppUrl, ...overrides } as never),
  }
}

describe("DriveLinkIntakeService", () => {
  it("resolves a share markdown link", async () => {
    const { service } = createService()
    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123` })).resolves.toMatchObject({
      ok: true,
      linkType: "share",
      access: { status: "ok", canRead: true, canReadText: true },
      root: { name: "需求说明.md", type: "file", previewKind: "markdown" },
      ref: { kind: "share", shareId: "shr_123", itemId: null },
    })
  })

  it("returns password_required without echoing password", async () => {
    const { service, drive } = createService()
    drive.resolvePublicShareAccess.mockResolvedValueOnce({ status: "password_required" })
    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123`, password: "secret" })).resolves.toMatchObject({
      access: { status: "password_required", canRead: false },
    })
    await expect(service.resolve({ url: `${publicAppUrl}/share/shr_123`, password: "secret" }))
      .resolves.not.toHaveProperty("password")
  })

  it("lists share folder children from a browser snapshot", async () => {
    const { service, drive } = createService()
    drive.getShareBrowserSnapshot.mockResolvedValueOnce({
      context: "share",
      surface: "standalone",
      current: { id: "folder-1", name: "交付包", type: "folder", size: "0", mimeType: null, updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "download-only", browserUrl: "/share/shr_123", downloadUrl: "/share/shr_123/download" },
      breadcrumbs: [],
      children: [{ id: "item-1", name: "需求说明.md", type: "file", size: "12", mimeType: "text/markdown", updatedAt: "2026-06-28T00:00:00.000Z", previewKind: "markdown", browserUrl: "/share/shr_123/items/item-1", downloadUrl: "/share/shr_123/items/item-1/download" }],
      childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
      preview: null,
      edit: null,
      annotation: null,
      canDownload: true,
      canZip: true,
    })

    await expect(service.list({ url: `${publicAppUrl}/share/shr_123` })).resolves.toEqual({
      items: [{ path: "需求说明.md", name: "需求说明.md", type: "file", mimeType: "text/markdown", previewKind: "markdown", size: "12", itemId: "item-1" }],
      page: { hasMore: false, nextOffset: null },
    })
  })

  it("reads markdown text from a share link", async () => {
    const { service } = createService()
    await expect(service.readText({ url: `${publicAppUrl}/share/shr_123`, maxBytes: 64 })).resolves.toMatchObject({
      path: "需求说明.md",
      mimeType: "text/markdown",
      previewKind: "markdown",
      text: "# 需求\n正文",
      truncated: false,
      source: { linkType: "share" },
    })
  })

  it("rejects public asset text reads", async () => {
    const { service } = createService()
    await expect(service.readText({ url: `${publicAppUrl}/files/asset_123` })).rejects.toThrow("该链接不是可读取的文本内容")
  })
})
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive-link-intake.service.spec.ts
```

Expected: fail because `drive-link-intake.service.ts` does not exist.

- [ ] **Step 3: Implement the service skeleton**

Create `server/src/drive/drive-link-intake.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import {
  DRIVE_PUBLIC_ASSET_PATH_PREFIX,
  DRIVE_PUBLIC_PATH_PREFIX,
  DRIVE_SITE_PATH_PREFIX,
  type DriveBrowserSnapshotDto,
  type DriveBrowserItemDto,
  type DriveLinkListDto,
  type DriveLinkListInput,
  type DriveLinkReadTextDto,
  type DriveLinkReadTextInput,
  type DriveLinkRefDto,
  type DriveLinkResolveDto,
  type DriveLinkResolveInput,
  type DriveLinkType,
} from "@synapse/shared"

type DriveLinkIntakeDeps = {
  readonly drive: {
    readonly resolvePublicShareAccess: (input: { readonly shareId: string; readonly password?: string; readonly cookie?: string | null }) => Promise<{ readonly status: "ok"; readonly value: { readonly item: { readonly id: string; readonly name: string; readonly type: "file" | "folder"; readonly mimeType: string | null } } } | { readonly status: "password_required" }>
    readonly getShareBrowserSnapshot: (input: { readonly shareId: string; readonly itemId?: string; readonly password?: string; readonly cookie?: string | null; readonly childrenPage?: { readonly offset?: number; readonly limit?: number } }) => Promise<DriveBrowserSnapshotDto>
  }
  readonly sites: {
    readonly resolvePublicSite: (siteId: string, input: { readonly cookie: string | null; readonly relativePath: string }) => Promise<{ readonly status: "ok"; readonly asset: { readonly relativePath: string; readonly storageKey: string; readonly contentType: string | null } } | { readonly status: "password_required" } | { readonly status: string }>
  }
  readonly publicAssets: {
    readonly resolvePublicAsset: (assetId: string, headers?: Record<string, unknown>) => Promise<{ readonly status: "ok"; readonly name: string; readonly mimeType: string; readonly size: bigint; readonly storageKey: string } | { readonly status: string }>
  }
  readonly storage: {
    readonly getObjectStream: (input: { readonly key: string }) => Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }>
  }
  readonly publicAppUrl: string
}

type ParsedDriveLink =
  | { readonly linkType: "share"; readonly shareId: string; readonly itemId: string | null }
  | { readonly linkType: "site"; readonly siteId: string; readonly path: string }
  | { readonly linkType: "public_asset"; readonly assetId: string }

@Injectable()
export class DriveLinkIntakeService {
  constructor(private readonly deps: DriveLinkIntakeDeps) {}

  async resolve(input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType === "share") return this.resolveShare(parsed, input)
    if (parsed.linkType === "site") return this.resolveSite(parsed, input)
    return this.resolvePublicAsset(parsed)
  }

  async list(input: DriveLinkListInput): Promise<DriveLinkListDto> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType !== "share") {
      if (parsed.linkType === "site") return { items: [], page: { hasMore: false, nextOffset: null } }
      throw new BadRequestException("公开素材链接没有目录。")
    }
    const snapshot = await this.deps.drive.getShareBrowserSnapshot({
      shareId: parsed.shareId,
      itemId: input.itemId ?? parsed.itemId ?? undefined,
      password: input.password,
      cookie: null,
      childrenPage: { offset: input.offset, limit: input.limit },
    })
    return {
      items: snapshot.children.map(toDriveLinkEntry),
      page: {
        hasMore: Boolean(snapshot.childrenPage?.hasMore),
        nextOffset: snapshot.childrenPage?.nextOffset ?? null,
      },
    }
  }

  async readText(input: DriveLinkReadTextInput): Promise<DriveLinkReadTextDto> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType === "share") {
      const snapshot = await this.deps.drive.getShareBrowserSnapshot({
        shareId: parsed.shareId,
        itemId: input.itemId ?? parsed.itemId ?? undefined,
        password: input.password,
        cookie: null,
      })
      return textFromSnapshot(snapshot, parsed.itemId ? "share_item" : "share", input.maxBytes)
    }
    if (parsed.linkType === "site") {
      const access = await this.deps.sites.resolvePublicSite(parsed.siteId, { cookie: null, relativePath: input.path ?? parsed.path })
      if (access.status === "password_required") throw new BadRequestException("该站点需要密码。")
      if (access.status !== "ok") throw new NotFoundException("链接不可访问。")
      const object = await this.deps.storage.getObjectStream({ key: access.asset.storageKey })
      const text = await readStreamText(object.stream, input.maxBytes)
      return {
        path: access.asset.relativePath,
        mimeType: object.contentType ?? access.asset.contentType ?? null,
        previewKind: "html",
        text: text.value,
        truncated: text.truncated,
        source: { linkType: parsed.path ? "site_path" : "site" },
      }
    }
    throw new BadRequestException("该链接不是可读取的文本内容，请使用下载工具。")
  }

  private async resolveShare(parsed: Extract<ParsedDriveLink, { readonly linkType: "share" }>, input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    const access = await this.deps.drive.resolvePublicShareAccess({ shareId: parsed.shareId, password: input.password, cookie: null })
    if (access.status === "password_required") return passwordRequiredResolve(parsed.itemId ? "share_item" : "share", shareRef(parsed.shareId, parsed.itemId))
    const snapshot = await this.deps.drive.getShareBrowserSnapshot({ shareId: parsed.shareId, itemId: parsed.itemId ?? undefined, password: input.password, cookie: null })
    return okResolve(parsed.itemId ? "share_item" : "share", snapshot.current, shareRef(parsed.shareId, parsed.itemId))
  }

  private async resolveSite(parsed: Extract<ParsedDriveLink, { readonly linkType: "site" }>, _input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    const access = await this.deps.sites.resolvePublicSite(parsed.siteId, { cookie: null, relativePath: parsed.path })
    if (access.status === "password_required") return passwordRequiredResolve(parsed.path ? "site_path" : "site", siteRef(parsed.siteId, parsed.path))
    if (access.status !== "ok") throw new NotFoundException("链接不可访问。")
    return {
      ok: true,
      linkType: parsed.path ? "site_path" : "site",
      access: { status: "ok", canRead: true, canList: true, canReadText: true, canDownload: true },
      root: { name: access.asset.relativePath || "index.html", type: "site", previewKind: "html" },
      ref: siteRef(parsed.siteId, parsed.path),
    }
  }

  private async resolvePublicAsset(parsed: Extract<ParsedDriveLink, { readonly linkType: "public_asset" }>): Promise<DriveLinkResolveDto> {
    const asset = await this.deps.publicAssets.resolvePublicAsset(parsed.assetId)
    if (asset.status !== "ok") throw new NotFoundException("链接不可访问。")
    return {
      ok: true,
      linkType: "public_asset",
      access: { status: "ok", canRead: true, canList: false, canReadText: false, canDownload: true },
      root: { name: asset.name, type: "asset", previewKind: asset.mimeType.startsWith("image/") ? "image" : "download-only" },
      ref: { kind: "public_asset", shareId: null, itemId: null, siteId: null, path: null, assetId: parsed.assetId },
    }
  }
}

function parseDriveLinkUrl(value: string): ParsedDriveLink {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BadRequestException("云盘链接无效。")
  }
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment))
  if (segments[0] === DRIVE_PUBLIC_PATH_PREFIX.slice(1) && segments[1]) {
    return { linkType: "share", shareId: segments[1], itemId: segments[2] === "items" ? segments[3] ?? null : null }
  }
  if (segments[0] === DRIVE_SITE_PATH_PREFIX.slice(1) && segments[1]) {
    return { linkType: "site", siteId: segments[1], path: safeRelativePath(segments.slice(2).join("/")) }
  }
  if (segments[0] === DRIVE_PUBLIC_ASSET_PATH_PREFIX.slice(1) && segments[1]) {
    return { linkType: "public_asset", assetId: segments[1] }
  }
  throw new BadRequestException("不支持的云盘链接。")
}

function safeRelativePath(value: string): string {
  if (!value) return ""
  if (value.startsWith("/") || value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new BadRequestException("路径无效。")
  }
  return value
}

function toDriveLinkEntry(item: DriveBrowserItemDto) {
  return {
    path: item.name,
    name: item.name,
    type: item.type,
    mimeType: item.mimeType,
    previewKind: item.previewKind,
    size: item.size,
    itemId: item.id,
  }
}

function okResolve(linkType: DriveLinkType, current: DriveBrowserItemDto, ref: DriveLinkRefDto): DriveLinkResolveDto {
  return {
    ok: true,
    linkType,
    access: { status: "ok", canRead: true, canList: current.type === "folder", canReadText: ["markdown", "html-source", "text"].includes(current.previewKind), canDownload: true },
    root: { name: current.name, type: current.type, previewKind: current.previewKind },
    ref,
  }
}

function passwordRequiredResolve(linkType: DriveLinkType, ref: DriveLinkRefDto): DriveLinkResolveDto {
  return {
    ok: true,
    linkType,
    access: { status: "password_required", canRead: false, canList: false, canReadText: false, canDownload: false },
    root: { name: "", type: "file", previewKind: "download-only" },
    ref,
  }
}

function shareRef(shareId: string, itemId: string | null): DriveLinkRefDto {
  return { kind: "share", shareId, itemId, siteId: null, path: null, assetId: null }
}

function siteRef(siteId: string, path: string): DriveLinkRefDto {
  return { kind: "site", shareId: null, itemId: null, siteId, path: path || null, assetId: null }
}

function textFromSnapshot(snapshot: DriveBrowserSnapshotDto, linkType: DriveLinkType, maxBytes: number | undefined): DriveLinkReadTextDto {
  if (!snapshot.preview?.text) throw new BadRequestException("该链接不是可读取的文本内容，请使用下载工具。")
  const limited = limitText(snapshot.preview.text, maxBytes)
  return {
    path: snapshot.current.name,
    mimeType: snapshot.current.mimeType,
    previewKind: snapshot.preview.kind,
    text: limited.value,
    truncated: snapshot.preview.truncated || limited.truncated,
    source: { linkType },
  }
}

async function readStreamText(stream: NodeJS.ReadableStream, maxBytes = 128 * 1024): Promise<{ readonly value: string; readonly truncated: boolean }> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))])
    if (buffer.byteLength > maxBytes) return { value: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true }
  }
  return { value: buffer.toString("utf8"), truncated: false }
}

function limitText(value: string, maxBytes = 128 * 1024): { readonly value: string; readonly truncated: boolean } {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.byteLength <= maxBytes) return { value, truncated: false }
  return { value: bytes.subarray(0, maxBytes).toString("utf8"), truncated: true }
}
```

- [ ] **Step 4: Register the service**

Modify `server/src/drive/drive.module.ts`:

```ts
import { DriveLinkIntakeService } from "./drive-link-intake.service"
```

Add `DriveLinkIntakeService` to `providers` and `exports`.

- [ ] **Step 5: Run service tests and verify pass**

Run:

```bash
pnpm --filter @synapse/server test -- drive-link-intake.service.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-link-intake.service.ts server/src/drive/drive-link-intake.service.spec.ts server/src/drive/drive.module.ts
git commit -m "feat: add drive link intake service"
```

---

### Task 3: Server Link Intake API Endpoints

**Files:**
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Add tests to `server/src/drive/drive.controller.spec.ts` near Drive public controller tests:

```ts
describe("DrivePublicController link intake", () => {
  it("resolves a Drive link without requiring user auth", async () => {
    const links = { resolve: vi.fn(async () => ({ ok: true, linkType: "share", access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true }, root: { name: "需求说明.md", type: "file", previewKind: "markdown" }, ref: { kind: "share", shareId: "shr_123", itemId: null, siteId: null, path: null, assetId: null } })) }
    const controller = new DrivePublicController({} as never, {} as never, undefined, undefined, undefined, undefined, undefined, links as never)

    await expect(controller.resolveDriveLink({ url: "https://synapse.test/share/shr_123" })).resolves.toMatchObject({
      linkType: "share",
      root: { name: "需求说明.md" },
    })
  })
})
```

This test assumes `DriveLinkIntakeService` is injected as the last optional `DrivePublicController` constructor argument after `documentImages`.

- [ ] **Step 2: Run controller tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts
```

Expected: fail because `DrivePublicController.resolveDriveLink` and routes do not exist.

- [ ] **Step 3: Add request schemas and controller methods**

In `server/src/drive/drive.controller.ts`, import the service and constants:

```ts
import { DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES, DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES } from "@synapse/shared"
import { DriveLinkIntakeService } from "./drive-link-intake.service"
```

Add schemas near existing Drive schemas:

```ts
const appDriveLinkResolveSchema = z.object({
  url: z.string().url(),
  password: z.string().min(1).max(256).optional(),
}).strict()

const appDriveLinkListSchema = appDriveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(200).optional(),
}).strict()

const appDriveLinkReadTextSchema = appDriveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  maxBytes: z.number().int().positive().max(DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES).optional(),
}).strict()

const appDriveLinkMaterializeSchema = appDriveLinkResolveSchema.extend({
  scope: z.enum(["entry", "text", "all"]).optional(),
  maxFiles: z.number().int().positive().max(DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES).optional(),
  maxBytes: z.number().int().positive().max(DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES).optional(),
}).strict()

const appDriveLinkDownloadFileSchema = appDriveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
}).strict()
```

Extend `DrivePublicController` constructor with:

```ts
@Optional() private readonly linkIntake?: DriveLinkIntakeService,
```

Add methods:

```ts
@Post("/api/drive/link-intake/resolve")
resolveDriveLink(@Body() body: unknown) {
  return requireDriveLinkIntakeService(this.linkIntake).resolve(parseBody(appDriveLinkResolveSchema, body, "云盘链接无效。"))
}

@Post("/api/drive/link-intake/list")
listDriveLink(@Body() body: unknown) {
  return requireDriveLinkIntakeService(this.linkIntake).list(parseBody(appDriveLinkListSchema, body, "云盘链接目录请求无效。"))
}

@Post("/api/drive/link-intake/read-text")
readDriveLinkText(@Body() body: unknown) {
  return requireDriveLinkIntakeService(this.linkIntake).readText(parseBody(appDriveLinkReadTextSchema, body, "云盘链接正文请求无效。"))
}

@Post("/api/drive/link-intake/materialize-plan")
planDriveLinkMaterialize(@Body() body: unknown) {
  return requireDriveLinkIntakeService(this.linkIntake).list(parseBody(appDriveLinkMaterializeSchema, body, "云盘链接落盘请求无效。"))
}

@Post("/api/drive/link-intake/download-file-plan")
planDriveLinkDownloadFile(@Body() body: unknown) {
  return requireDriveLinkIntakeService(this.linkIntake).resolve(parseBody(appDriveLinkDownloadFileSchema, body, "云盘链接下载请求无效。"))
}
```

Add helper:

```ts
function requireDriveLinkIntakeService(linkIntake: DriveLinkIntakeService | undefined): DriveLinkIntakeService {
  if (!linkIntake) throw new Error("DriveLinkIntakeService is not available.")
  return linkIntake
}
```

The two `*-plan` endpoints are intentionally remote read projections. Local file writes happen in the Electron account service work in Task 4.

- [ ] **Step 4: Run controller tests and verify pass**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat: expose drive link intake endpoints"
```

---

### Task 4: Electron AccountService Link Methods and Local Cache

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Write failing AccountService tests**

Add tests to `desktop/electron/services/__tests__/account-service.test.ts`:

```ts
it("posts Drive link resolve requests without leaking password into URL", async () => {
  const { service, requestJson } = createAccountServiceHarness()
  requestJson.mockResolvedValueOnce({
    ok: true,
    linkType: "share",
    access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true },
    root: { name: "需求说明.md", type: "file", previewKind: "markdown" },
    ref: { kind: "share", shareId: "shr_123", itemId: null, siteId: null, path: null, assetId: null },
  })

  await service.resolveDriveLink({ url: "https://synapse.test/share/shr_123", password: "secret" })

  expect(requestJson).toHaveBeenCalledWith(
    "POST",
    expect.stringContaining("/drive/link-intake/resolve"),
    { url: "https://synapse.test/share/shr_123", password: "secret" },
    "云盘链接解析失败。",
  )
  expect(String(requestJson.mock.calls[0][1])).not.toContain("secret")
})

it("materializes Drive link text into a local cache manifest", async () => {
  const { service, requestJson, tempRoot } = createAccountServiceHarness()
  requestJson
    .mockResolvedValueOnce({
      items: [{ path: "需求说明.md", name: "需求说明.md", type: "file", mimeType: "text/markdown", previewKind: "markdown", size: "12", itemId: "item-1" }],
      page: { hasMore: false, nextOffset: null },
    })
    .mockResolvedValueOnce({
      path: "需求说明.md",
      mimeType: "text/markdown",
      previewKind: "markdown",
      text: "# 需求\n正文",
      truncated: false,
      source: { linkType: "share" },
    })

  const result = await service.materializeDriveLink({ url: "https://synapse.test/share/shr_123", scope: "text" })

  expect(result.localRootPath).toContain(tempRoot)
  expect(result.entryPath).toContain("需求说明.md")
  expect(result.files).toEqual([{ relativePath: "需求说明.md", kind: "markdown", size: "13" }])
  expect(await readFile(result.manifestPath, "utf8")).not.toContain("secret")
})
```

Use the existing AccountService test harness names if they differ. The implementation should expose or inject a `appDriveLinkIntakeRoot` only in tests if the existing harness does not already allow a temp userData root.

- [ ] **Step 2: Run AccountService tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- account-service.test.ts
```

Expected: fail because `resolveDriveLink` and `materializeDriveLink` do not exist.

- [ ] **Step 3: Add imports and methods**

In `desktop/electron/services/account-service.ts`, import the new shared types:

```ts
import type {
  DriveLinkDownloadFileDto,
  DriveLinkDownloadFileInput,
  DriveLinkListDto,
  DriveLinkListInput,
  DriveLinkMaterializeDto,
  DriveLinkMaterializeInput,
  DriveLinkReadTextDto,
  DriveLinkReadTextInput,
  DriveLinkResolveDto,
  DriveLinkResolveInput,
} from "@synapse/shared" with { "resolution-mode": "import" }
```

Add methods near existing Drive methods:

```ts
async resolveDriveLink(input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
  return this.requestAuthenticatedJson<DriveLinkResolveDto>("POST", `${apiBaseUrl()}/drive/link-intake/resolve`, input, "云盘链接解析失败。")
}

async listDriveLink(input: DriveLinkListInput): Promise<DriveLinkListDto> {
  return this.requestAuthenticatedJson<DriveLinkListDto>("POST", `${apiBaseUrl()}/drive/link-intake/list`, input, "云盘链接目录加载失败。")
}

async readDriveLinkText(input: DriveLinkReadTextInput): Promise<DriveLinkReadTextDto> {
  return this.requestAuthenticatedJson<DriveLinkReadTextDto>("POST", `${apiBaseUrl()}/drive/link-intake/read-text`, input, "云盘链接正文读取失败。")
}

async materializeDriveLink(input: DriveLinkMaterializeInput): Promise<DriveLinkMaterializeDto> {
  const page = await this.listDriveLink(input)
  const root = await createDriveLinkIntakeRunDirectory()
  const files: DriveLinkMaterializeDto["files"] = []
  const skipped: DriveLinkMaterializeDto["skipped"] = []
  const warnings: string[] = []
  let totalBytes = 0
  const maxFiles = input.maxFiles ?? 200
  const maxBytes = input.maxBytes ?? 50 * 1024 * 1024

  for (const item of page.items.slice(0, maxFiles)) {
    if (!["markdown", "html-source", "text"].includes(item.previewKind)) {
      skipped.push({ path: item.path, reason: "not-text" })
      continue
    }
    const text = await this.readDriveLinkText({ url: input.url, password: input.password, itemId: item.itemId ?? undefined, path: item.path })
    const relativePath = safeDriveLinkOutputPath(item.path)
    const outputPath = path.join(root.contentPath, relativePath)
    const bytes = Buffer.byteLength(text.text, "utf8")
    if (totalBytes + bytes > maxBytes) {
      skipped.push({ path: item.path, reason: "max-bytes" })
      continue
    }
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, text.text, "utf8")
    totalBytes += bytes
    files.push({ relativePath, kind: appDriveLinkFileKind(text.previewKind, text.mimeType), size: String(bytes) })
  }

  if (page.page.hasMore) warnings.push("目录还有更多文件，本次只处理第一页。")
  const entryPath = files[0] ? path.join(root.contentPath, files[0].relativePath) : null
  const manifest = { sourceUrl: input.url, fetchedAt: new Date().toISOString(), scope: input.scope ?? "text", files, skipped, warnings }
  await writeFile(root.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return { localRootPath: root.rootPath, manifestPath: root.manifestPath, entryPath, files, skipped, warnings }
}

async downloadDriveLinkFile(input: DriveLinkDownloadFileInput): Promise<DriveLinkDownloadFileDto> {
  const targetPath = input.outputPath ?? path.join((await createDriveLinkIntakeRunDirectory()).contentPath, "download")
  const resolved = await this.resolveDriveLink(input)
  const response = await this.fetchImpl(input.url)
  if (!response.ok) throw await createHttpError("GET", input.url, response, "云盘链接下载失败。")
  await writeResponseBodyToFile(response, targetPath)
  const stat = await safeLocalFileStat(targetPath)
  return { localPath: targetPath, mimeType: null, size: String(stat?.size ?? 0), ...("root" in resolved ? {} : {}) }
}
```

Add helpers near existing file helper functions:

```ts
async function createDriveLinkIntakeRunDirectory(): Promise<{ readonly rootPath: string; readonly contentPath: string; readonly manifestPath: string }> {
  const rootPath = path.join(app.getPath("userData"), "drive-link-intake", `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  const contentPath = path.join(rootPath, "content")
  await mkdir(contentPath, { recursive: true })
  return { rootPath, contentPath, manifestPath: path.join(rootPath, "manifest.json") }
}

function safeDriveLinkOutputPath(value: string): string {
  const normalized = value.replace(/\\/gu, "/").split("/").filter(Boolean).join("/")
  if (!normalized || normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("云盘链接路径无效。")
  }
  return normalized
}

function appDriveLinkFileKind(previewKind: string, mimeType: string | null): "markdown" | "html" | "text" | "image" | "binary" | "folder" {
  if (previewKind === "markdown") return "markdown"
  if (previewKind === "html-source" || mimeType === "text/html") return "html"
  return "text"
}
```

If `app` from Electron is not already imported, add `import { app } from "electron"` and ensure tests mock `app.getPath("userData")`.

- [ ] **Step 4: Run AccountService tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- account-service.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat: add drive link account methods"
```

---

### Task 5: IPC and Bridge Types

**Files:**
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write failing typecheck target**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected before implementation: current typecheck passes, but after adding AccountService methods in Task 4 the bridge does not expose them. The implementation in this task should keep typecheck green.

- [ ] **Step 2: Add imports in bridge type file**

Modify the `@synapse/shared` import block in `desktop/src/types/bridge.ts` to include:

```ts
  DriveLinkDownloadFileDto,
  DriveLinkDownloadFileInput,
  DriveLinkListDto,
  DriveLinkListInput,
  DriveLinkMaterializeDto,
  DriveLinkMaterializeInput,
  DriveLinkReadTextDto,
  DriveLinkReadTextInput,
  DriveLinkResolveDto,
  DriveLinkResolveInput,
```

Add methods to the `account` bridge:

```ts
    resolveDriveLink: (input: DriveLinkResolveInput) => Promise<DriveLinkResolveDto>
    listDriveLink: (input: DriveLinkListInput) => Promise<DriveLinkListDto>
    readDriveLinkText: (input: DriveLinkReadTextInput) => Promise<DriveLinkReadTextDto>
    materializeDriveLink: (input: DriveLinkMaterializeInput) => Promise<DriveLinkMaterializeDto>
    downloadDriveLinkFile: (input: DriveLinkDownloadFileInput) => Promise<DriveLinkDownloadFileDto>
```

- [ ] **Step 3: Add IPC schemas and handlers**

In `desktop/electron/modules/account/ipc.ts`, add schemas:

```ts
const appDriveLinkResolveSchema = z.object({
  url: z.string().url(),
  password: z.string().min(1).max(256).optional(),
}).strict()

const appDriveLinkListSchema = appDriveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).strict()

const appDriveLinkReadTextSchema = appDriveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  maxBytes: z.number().int().positive().optional(),
}).strict()

const appDriveLinkMaterializeSchema = appDriveLinkResolveSchema.extend({
  scope: z.enum(["entry", "text", "all"]).optional(),
  maxFiles: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
}).strict()

const appDriveLinkDownloadFileSchema = appDriveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
}).strict()

const appDriveLinkAccessSchema = z.object({
  status: z.enum(["ok", "password_required", "login_required", "not_found"]),
  canRead: z.boolean(),
  canList: z.boolean(),
  canReadText: z.boolean(),
  canDownload: z.boolean(),
})

const appDriveLinkRefSchema = z.object({
  kind: z.enum(["share", "site", "public_asset"]),
  shareId: z.string().nullable(),
  itemId: z.string().nullable(),
  siteId: z.string().nullable(),
  path: z.string().nullable(),
  assetId: z.string().nullable(),
})

const appDriveLinkResolveResponseSchema = z.object({
  ok: z.literal(true),
  linkType: z.enum(["share", "share_item", "site", "site_path", "public_asset"]),
  access: appDriveLinkAccessSchema,
  root: z.object({
    name: z.string(),
    type: z.enum(["file", "folder", "site", "asset"]),
    previewKind: z.string(),
  }),
  ref: appDriveLinkRefSchema,
})

const appDriveLinkEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "folder", "site", "asset"]),
  mimeType: z.string().nullable(),
  previewKind: z.string(),
  size: z.string(),
  itemId: z.string().nullable().optional(),
})

const appDriveLinkListResponseSchema = z.object({
  items: z.array(appDriveLinkEntrySchema),
  page: z.object({ hasMore: z.boolean(), nextOffset: z.number().int().nonnegative().nullable() }),
})

const appDriveLinkReadTextResponseSchema = z.object({
  path: z.string(),
  mimeType: z.string().nullable(),
  previewKind: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  source: z.object({ linkType: z.string(), versionId: z.string().nullable().optional() }),
})

const appDriveLinkMaterializeResponseSchema = z.object({
  localRootPath: z.string(),
  manifestPath: z.string(),
  entryPath: z.string().nullable(),
  files: z.array(z.object({ relativePath: z.string(), kind: z.string(), size: z.string() })),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
})

const appDriveLinkDownloadFileResponseSchema = z.object({
  localPath: z.string(),
  mimeType: z.string().nullable(),
  size: z.string(),
})
```

Add handlers in the account IPC module:

```ts
    resolveDriveLink: {
      kind: "invoke",
      channel: "synapse:account:drive:links:resolve",
      request: appDriveLinkResolveSchema,
      response: appDriveLinkResolveResponseSchema,
      handler: async (_ctx, input) => accountService.resolveDriveLink(appDriveLinkResolveSchema.parse(input)),
    },
    listDriveLink: {
      kind: "invoke",
      channel: "synapse:account:drive:links:list",
      request: appDriveLinkListSchema,
      response: appDriveLinkListResponseSchema,
      handler: async (_ctx, input) => accountService.listDriveLink(appDriveLinkListSchema.parse(input)),
    },
    readDriveLinkText: {
      kind: "invoke",
      channel: "synapse:account:drive:links:read-text",
      request: appDriveLinkReadTextSchema,
      response: appDriveLinkReadTextResponseSchema,
      handler: async (_ctx, input) => accountService.readDriveLinkText(appDriveLinkReadTextSchema.parse(input)),
    },
    materializeDriveLink: {
      kind: "invoke",
      channel: "synapse:account:drive:links:materialize",
      request: appDriveLinkMaterializeSchema,
      response: appDriveLinkMaterializeResponseSchema,
      handler: async (_ctx, input) => accountService.materializeDriveLink(appDriveLinkMaterializeSchema.parse(input)),
    },
    downloadDriveLinkFile: {
      kind: "invoke",
      channel: "synapse:account:drive:links:download-file",
      request: appDriveLinkDownloadFileSchema,
      response: appDriveLinkDownloadFileResponseSchema,
      handler: async (_ctx, input) => accountService.downloadDriveLinkFile(appDriveLinkDownloadFileSchema.parse(input)),
    },
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/account/ipc.ts desktop/src/types/bridge.ts
git commit -m "feat: expose drive link bridge methods"
```

---

### Task 6: MCP Capability Domain and Dispatcher

**Files:**
- Modify: `desktop/synapse-capabilities/shared/drive-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/drive-domain.test.ts`
- Modify: `desktop/electron/capabilities/drive-dispatcher.ts`
- Modify: `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`

- [ ] **Step 1: Write failing capability tests**

In `desktop/synapse-capabilities/shared/drive-domain.test.ts`, extend the existing tool-name expectations with:

```ts
expect(toolNames).toContain("app_drive_link_resolve")
expect(toolNames).toContain("app_drive_link_list")
expect(toolNames).toContain("app_drive_link_read_text")
expect(toolNames).toContain("app_drive_link_materialize")
expect(toolNames).toContain("app_drive_link_download_file")
expect(toolNames).toContain("drive_link_resolve")
expect(toolNames).toContain("drive_link_list")
expect(toolNames).toContain("drive_link_read_text")
expect(toolNames).toContain("drive_link_materialize")
expect(toolNames).toContain("drive_link_download_file")

expect(capabilities.get("app.drive.link.resolve")).toMatchObject({ mutates: false })
expect(capabilities.get("app.drive.link.materialize")).toMatchObject({ mutates: true })

expect(tools.get("app_drive_link_read_text")?.inputSchema).toMatchObject({
  type: "object",
  properties: {
    url: { type: "string" },
    password: { type: "string" },
    maxBytes: { type: "number" },
  },
  required: ["url"],
})
```

- [ ] **Step 2: Write failing dispatcher tests**

Add tests to `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`:

```ts
it("dispatches Drive link read tools without exposing passwords in audit metadata", async () => {
  const accountService = createAccountService({
    resolveDriveLink: vi.fn(async () => ({ ok: true, linkType: "share", access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true }, root: { name: "需求说明.md", type: "file", previewKind: "markdown" }, ref: { kind: "share", shareId: "shr_123", itemId: null, siteId: null, path: null, assetId: null } })),
  })
  const auditSink = createAuditSink()
  const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

  await expect(dispatcher.dispatch("drive.link.resolve", { url: "https://synapse.test/share/shr_123", password: "secret" }, { source: "mcp-stdio" }))
    .resolves.toMatchObject({ ok: true, data: { linkType: "share" } })

  expect(accountService.resolveDriveLink).toHaveBeenCalledWith({ url: "https://synapse.test/share/shr_123", password: "secret" })
  expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret")
})

it("authorizes Drive link materialize as a local write", async () => {
  const materialized = { localRootPath: "/tmp/intake", manifestPath: "/tmp/intake/manifest.json", entryPath: "/tmp/intake/content/req.md", files: [], skipped: [], warnings: [] }
  const accountService = createAccountService({
    materializeDriveLink: vi.fn(async () => materialized),
  })
  const dispatcher = createDriveCapabilityDispatcher({ accountService })

  await expect(dispatcher.dispatch("drive.link.materialize", { url: "https://synapse.test/share/shr_123", scope: "text" }, { source: "mcp-stdio" }))
    .resolves.toEqual({ ok: true, data: materialized })
})
```

Update the local `createAccountService` test helper type defaults in the same file to include the five new account service methods as `vi.fn()`.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-domain.test.ts drive-dispatcher.test.ts
```

Expected: fail because capabilities and dispatcher cases do not exist.

- [ ] **Step 4: Add capability definitions and schemas**

In `desktop/synapse-capabilities/shared/drive-domain.ts`, add these definitions to `driveCapabilities`:

```ts
  { id: "app.drive.link.resolve" as CapabilityId, title: "Resolve Drive link", description: "Resolve a Synapse Drive /share, /sites, or /files URL for Agent consumption.", mutates: false },
  { id: "app.drive.link.list" as CapabilityId, title: "List Drive link", description: "List children or resources for a resolved Synapse Drive link.", mutates: false },
  { id: "app.drive.link.read_text" as CapabilityId, title: "Read Drive link text", description: "Read previewable Markdown, HTML source, or text from a Synapse Drive link.", mutates: false },
  { id: "app.drive.link.materialize" as CapabilityId, title: "Materialize Drive link", description: "Download a Synapse Drive link into a local cache directory for local Agent tools.", mutates: true },
  { id: "app.drive.link.download_file" as CapabilityId, title: "Download Drive link file", description: "Download one file or public asset from a Synapse Drive link to a local path or cache.", mutates: true },
```

Add shared schema property helpers:

```ts
const driveLinkBaseProperties = {
  url: stringField("Absolute Synapse Drive /share, /sites, or /files URL."),
  password: stringField("Optional link password. Used only for this call and never returned."),
}
```

Add tools to `buildDriveTools()`:

```ts
    {
      name: "drive_link_resolve",
      description: "Resolve a Synapse Drive /share, /sites, or /files URL and return access state plus an Agent-friendly reference.",
      inputSchema: { type: "object", properties: driveLinkBaseProperties, required: ["url"] },
    },
    {
      name: "drive_link_list",
      description: "List children for a Drive share folder or resources for a Drive site link. Public assets have no children.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          path: stringField("Optional site or share-relative path."),
          itemId: stringField("Optional Drive item id inside a share."),
          ...pageInputProperties,
        },
        required: ["url"],
      },
    },
    {
      name: "drive_link_read_text",
      description: "Read Markdown, HTML source, JSON, or other previewable text from a Drive link. Use drive_link_download_file for binary files.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          path: stringField("Optional site or share-relative path."),
          itemId: stringField("Optional Drive item id inside a share."),
          maxBytes: { type: "number", description: "Maximum UTF-8 bytes to return." },
        },
        required: ["url"],
      },
    },
    {
      name: "drive_link_materialize",
      description: "Download a Drive link into the local Drive link intake cache. Use for HTML prototypes, folders, assets, or local analysis tools.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          scope: { type: "string", enum: ["entry", "text", "all"], description: "entry downloads only the entry; text downloads previewable text; all downloads all allowed files within limits." },
          maxFiles: { type: "number", description: "Maximum files to write." },
          maxBytes: { type: "number", description: "Maximum total bytes to write." },
        },
        required: ["url"],
      },
    },
    {
      name: "drive_link_download_file",
      description: "Download one file, site asset, or public asset from a Drive link. outputPath is optional; omitted writes to cache.",
      inputSchema: {
        type: "object",
        properties: {
          ...driveLinkBaseProperties,
          path: stringField("Optional site or share-relative path."),
          itemId: stringField("Optional Drive item id inside a share."),
          outputPath: stringField("Optional absolute local output path."),
        },
        required: ["url"],
      },
    },
```

- [ ] **Step 5: Add dispatcher cases**

In `desktop/electron/capabilities/drive-dispatcher.ts`, extend `DriveAccountServicePort` with:

```ts
  readonly resolveDriveLink: (input: DriveLinkResolveInput) => Promise<DriveLinkResolveDto>
  readonly listDriveLink: (input: DriveLinkListInput) => Promise<DriveLinkListDto>
  readonly readDriveLinkText: (input: DriveLinkReadTextInput) => Promise<DriveLinkReadTextDto>
  readonly materializeDriveLink: (input: DriveLinkMaterializeInput) => Promise<DriveLinkMaterializeDto>
  readonly downloadDriveLinkFile: (input: DriveLinkDownloadFileInput) => Promise<DriveLinkDownloadFileDto>
```

Import those types from `@synapse/shared`.

Add dispatch cases:

```ts
        case "drive.link.resolve":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.resolveDriveLink(parseDriveLinkResolveInput(params)),
          }))
        case "drive.link.list":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.listDriveLink(parseDriveLinkListInput(params)),
          }))
        case "drive.link.read_text":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.readDriveLinkText(parseDriveLinkReadTextInput(params)),
          }))
        case "drive.link.materialize":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.materializeDriveLink(parseDriveLinkMaterializeInput(params)),
          }))
        case "drive.link.download_file":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.downloadDriveLinkFile(parseDriveLinkDownloadFileInput(params)),
          }))
```

Add parsers near existing parse helpers:

```ts
function parseDriveLinkResolveInput(params: Record<string, unknown>): DriveLinkResolveInput {
  return { url: requireString(params, "url"), password: optionalString(params.password) }
}

function parseDriveLinkListInput(params: Record<string, unknown>): DriveLinkListInput {
  return { ...parseDriveLinkResolveInput(params), path: optionalString(params.path), itemId: optionalString(params.itemId), offset: optionalNumber(params.offset), limit: optionalNumber(params.limit) }
}

function parseDriveLinkReadTextInput(params: Record<string, unknown>): DriveLinkReadTextInput {
  return { ...parseDriveLinkResolveInput(params), path: optionalString(params.path), itemId: optionalString(params.itemId), maxBytes: optionalNumber(params.maxBytes) }
}

function parseDriveLinkMaterializeInput(params: Record<string, unknown>): DriveLinkMaterializeInput {
  return { ...parseDriveLinkResolveInput(params), scope: optionalDriveLinkScope(params.scope), maxFiles: optionalNumber(params.maxFiles), maxBytes: optionalNumber(params.maxBytes) }
}

function parseDriveLinkDownloadFileInput(params: Record<string, unknown>): DriveLinkDownloadFileInput {
  return { ...parseDriveLinkResolveInput(params), path: optionalString(params.path), itemId: optionalString(params.itemId), outputPath: optionalString(params.outputPath) }
}

function optionalDriveLinkScope(value: unknown): DriveLinkMaterializeInput["scope"] {
  if (value === undefined) return undefined
  if (value === "entry" || value === "text" || value === "all") return value
  throw new Error("scope must be entry, text, or all.")
}
```

Update audit metadata collection to never copy `password`; if there is a metadata allowlist, do not add `password`.

- [ ] **Step 6: Run capability and dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-domain.test.ts drive-dispatcher.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/synapse-capabilities/shared/drive-domain.ts desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/electron/capabilities/drive-dispatcher.ts desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts
git commit -m "feat: add drive link mcp tools"
```

---

### Task 7: Documentation, Built-In Skill, and Release Notes

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`
- Modify: `website/developer/capability-naming-matrix.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update the Drive skill guide**

In `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`, add these tools to the Scope list:

```md
- `app_drive_link_resolve`
- `app_drive_link_list`
- `app_drive_link_read_text`
- `app_drive_link_materialize`
- `app_drive_link_download_file`
```

Add this section after the Default Flow introduction:

```md
## Drive Link Intake Flow

When the user provides a Synapse `/share/...`, `/sites/...`, or `/files/...` URL, use Drive Link tools instead of owner Drive item tools.

1. Call `app_drive_link_resolve` with `url` and optional `password`.
2. If the result is a folder or site, call `app_drive_link_list` before reading content.
3. For Markdown, HTML source, JSON, or text, call `app_drive_link_read_text`.
4. For HTML prototypes, folders, images, or binary attachments that need local inspection, call `app_drive_link_materialize`.
5. For one specific linked file or public asset, call `app_drive_link_download_file`.

Do not use these tools to edit shared files, create comments, import shared content into the user's Drive, or crawl arbitrary websites.
Do not repeat passwords in the final answer.
```

Add Common Requests:

```md
- "分析这个云盘分享链接": call `app_drive_link_resolve`, then `app_drive_link_list` or `app_drive_link_read_text`.
- "读取这个需求链接": call `app_drive_link_read_text`.
- "分析这个 HTML 原型站点": call `app_drive_link_resolve`, `app_drive_link_list`, then `app_drive_link_materialize` when local files are useful.
- "下载这个公开素材": call `app_drive_link_download_file`.
```

- [ ] **Step 2: Update the API reference**

In `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`, add a section:

```md
## Drive Link Intake Tools

Use these tools for Synapse `/share/...`, `/sites/...`, and `/files/...` URLs sent by another person. They do not modify remote Drive content.

### `app_drive_link_resolve`

Input:

- `url` required.
- `password` optional.

Output includes `linkType`, `access`, `root`, and `ref`.

### `app_drive_link_list`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `offset` optional.
- `limit` optional.

Output includes `items` and `page`.

### `app_drive_link_read_text`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `maxBytes` optional.

Use for Markdown, HTML source, JSON, and text. Binary files should use `app_drive_link_download_file`.

### `app_drive_link_materialize`

Input:

- `url` required.
- `password` optional.
- `scope` optional: `entry`, `text`, or `all`.
- `maxFiles` optional.
- `maxBytes` optional.

Writes a local cache directory and returns `localRootPath`, `manifestPath`, `entryPath`, `files`, `skipped`, and `warnings`.

### `app_drive_link_download_file`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `outputPath` optional.

Downloads one linked file or public asset. When `outputPath` is omitted, Synapse writes to the Drive link intake cache.
```

- [ ] **Step 3: Update capability naming matrix**

Add rows to `website/developer/capability-naming-matrix.md`:

```md
| `app.drive.link.resolve` | `app_drive_link_resolve` | `app.drive.link.resolve` | `appDriveLinkResolve` |
| `app.drive.link.list` | `app_drive_link_list` | `app.drive.link.list` | `appDriveLinkList` |
| `app.drive.link.read_text` | `app_drive_link_read_text` | `app.drive.link.read_text` | `appDriveLinkReadText` |
| `app.drive.link.materialize` | `app_drive_link_materialize` | `app.drive.link.materialize` | `appDriveLinkMaterialize` |
| `app.drive.link.download_file` | `app_drive_link_download_file` | `app.drive.link.download_file` | `appDriveLinkDownloadFile` |
```

- [ ] **Step 4: Update release notes**

Add to `RELEASE_NOTES_PENDING.md`:

```md
- 云盘 MCP 新增链接摄入能力，本地 Agent 可以解析产品经理发来的分享链接、站点链接和公开素材链接，按需读取 Markdown/HTML 正文或落盘到本机缓存目录继续分析。
```

- [ ] **Step 5: Run docs-related tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-domain.test.ts
```

Expected: pass. If there is a docs lint command in the repo, run it as well.

- [ ] **Step 6: Commit**

```bash
git add desktop/resources/templates/skills/synapse-skill/files/drive/index.md desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md website/developer/capability-naming-matrix.md RELEASE_NOTES_PENDING.md
git commit -m "docs: document drive link intake tools"
```

---

### Task 8: End-to-End Verification Sweep

**Files:**
- No new files expected.
- Modify only files needed to fix verification failures introduced by Tasks 1-7.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- drive-link-intake.service.spec.ts drive.controller.spec.ts
pnpm --filter @synapse/desktop test -- account-service.test.ts drive-domain.test.ts drive-dispatcher.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run typechecks**

Run:

```bash
pnpm --filter @synapse/shared run typecheck
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/desktop run typecheck
```

Expected: all pass.

- [ ] **Step 3: Inspect password redaction**

Run:

```bash
rg -n "password|secret" desktop/electron/capabilities/drive-dispatcher.ts desktop/electron/services/account-service.ts server/src/drive/drive-link-intake.service.ts
```

Expected: password appears only in input parsing, request bodies, and explicit comments about not returning or logging it. No audit metadata allowlist includes `password`.

- [ ] **Step 4: Inspect unsupported web crawl boundary**

Run:

```bash
rg -n "new URL|fetch\\(" server/src/drive/drive-link-intake.service.ts desktop/electron/services/account-service.ts
```

Expected: server accepts only `/share`, `/sites`, and `/files`; Electron downloads only through the explicit link download path and does not implement arbitrary crawl behavior.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required code changes, stage the Drive Link Intake files touched by the fix:

```bash
git add shared/src/drive.ts shared/src/drive.test.ts server/src/drive/drive-link-intake.service.ts server/src/drive/drive-link-intake.service.spec.ts server/src/drive/drive.controller.ts server/src/drive/drive.controller.spec.ts server/src/drive/drive.module.ts desktop/electron/services/account-service.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/account-types.ts desktop/src/types/bridge.ts desktop/electron/capabilities/drive-dispatcher.ts desktop/synapse-capabilities/shared/drive-domain.ts desktop/resources/templates/skills/synapse-skill/files/drive/index.md desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md website/developer/capability-naming-matrix.md RELEASE_NOTES_PENDING.md
git commit -m "fix: harden drive link intake verification"
```

If no changes were needed, do not create an empty commit.
