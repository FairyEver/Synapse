# Drive Markdown Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build V1 cloud-drive Markdown image insertion and owner-only image transfer: paste/drop images upload to the current actor's public assets, Markdown preview/editor can inspect image sources, and document owners can transfer external/collaborator images into their own public assets.

**Architecture:** Keep ownership and quota in Public Asset service, image scanning/import in Drive Markdown Image service, and editor interactions in a renderer Markdown editor module. Finder/Drive Browser top toolbar remains a generic renderer action slot; Markdown preview/editor registers `图片来源`.

**Tech Stack:** TypeScript, React 19, Electron preload IPC, NestJS, Prisma, Vitest, MDXEditor 4.0.4, unified/remark for Markdown parsing.

---

## Scope Notes

This plan implements the V1 core from `docs/superpowers/specs/2026-06-26-drive-markdown-images-design.md`.

The plan intentionally keeps each stage independently testable:

- Shared DTOs and URL parsing.
- Server scan/import service and endpoints.
- Desktop account bridge support for binary public asset upload.
- Renderer Markdown editor upload adapter and image source panel.
- MDXEditor integration in the Drive browser flow.
- Lightweight inventory hooks after the core path works.

Do not implement automatic transfer, anonymous editing, owner-funded collaborator upload, SVG transfer, document attachment directories, or public asset delete blocking.

## File Map

### Shared

- Modify: `shared/src/drive.ts`
  - Add image source DTOs, import request/result DTOs, limits, and public asset URL parser.
- Modify: `shared/src/drive.test.ts`
  - Cover URL parsing, image source kinds, and import limit constants.

### Server

- Create: `server/src/drive/drive-document-image-types.ts`
  - Internal server types for parsed Markdown image references and transfer candidates.
- Create: `server/src/drive/drive-document-image-parser.ts`
  - Parse Markdown image references, normalize `src`, produce stable `imageKey`, and replace image URLs via Markdown AST.
- Create: `server/src/drive/drive-document-image-parser.spec.ts`
  - Unit tests for image parsing, dedupe, relative/data/external classification input, and AST replacement.
- Create: `server/src/drive/drive-remote-image-fetcher.ts`
  - Safe HTTP/HTTPS image downloader with SSRF, redirect, timeout, size, MIME, and signature guards.
- Create: `server/src/drive/drive-remote-image-fetcher.spec.ts`
  - Unit tests for internal-host rejection, non-image rejection, SVG rejection, size rejection, and success.
- Create: `server/src/drive/drive-document-image.service.ts`
  - Scan document images and import owner-approved images.
- Create: `server/src/drive/drive-document-image.service.spec.ts`
  - Service tests for owner/collaborator/external scan, owner-only import, version conflict, partial failures.
- Modify: `server/src/drive/drive.service.ts`
  - Expose focused helpers used by `DriveDocumentImageService`: current Markdown content lookup, owner/share access resolution, and text commit.
- Modify: `server/src/drive/drive.controller.ts`
  - Add scan/import endpoints for owner item and share item routes.
- Modify: `server/src/drive/drive.module.ts`
  - Register `DriveDocumentImageService` and `DriveRemoteImageFetcher`.

### Desktop Main / Preload

- Modify: `desktop/src/types/bridge.ts`
  - Add binary public asset upload request/result types and image source bridge methods.
- Modify: `desktop/electron/preload.ts`
  - Expose binary public asset upload, image-source scan, and image-source import bridge methods with sanitized failure logs.
- Modify: `desktop/electron/modules/account/ipc.ts`
  - Register account IPC handlers and zod schemas for binary upload and image-source methods.
- Modify: `desktop/electron/services/account-service.ts`
  - Add binary upload path using existing prepare/PUT/complete flow, plus server image-source scan/import wrappers.
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
  - Test binary upload ordering, prepare payloads, PUT body upload, cancellation, and scan/import wrappers.

### Desktop Renderer

- Modify: `desktop/package.json`
  - Add `@mdxeditor/editor` at `4.0.4` for the desktop package.
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-uploader.ts`
  - Convert `File` to binary bridge payload, enforce count/type limits, and normalize upload errors.
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts`
  - Unit tests for success, unsupported type, over-limit count, order preservation, and failed upload messages.
- Create: `desktop/src/modules/drive/markdown/drive-renderer-actions.tsx`
  - React context for Drive Browser renderer action registration.
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.tsx`
  - Side panel/Sheet for `图片来源`, grouped as `需处理` / `已托管`, owner-only import actions.
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx`
  - UI tests for owner actions, collaborator read-only view, conflict state, partial failure, empty states.
- Create: `desktop/src/modules/drive/markdown/drive-mdx-editor.tsx`
  - MDXEditor wrapper with official plugins, `imagePlugin({ imageUploadHandler })`, source/diff fallback, and editor ref save API.
- Create: `desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx`
  - Mock MDXEditor and verify imageUploadHandler, save-disabled while uploading, source/diff plugin config.
- Modify: `desktop/src/modules/drive/index.tsx`
  - Host renderer actions in the Drive browser top toolbar and render Markdown preview/editor actions.
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Cover renderer action slot and image source entry visibility.

### Docs / Release Notes

- Modify: `RELEASE_NOTES_PENDING.md`
  - Add user-facing note for Markdown image paste/drop upload and owner transfer.

---

## Task 1: Shared Image Source DTOs and Public Asset URL Parser

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add tests to `shared/src/drive.test.ts`:

```ts
import {
  DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES,
  parseDrivePublicAssetUrl,
  type DriveDocumentImageSource,
} from "./drive"

it("parses current public asset URLs", () => {
  expect(parseDrivePublicAssetUrl("https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")).toEqual({
    assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
  })
  expect(parseDrivePublicAssetUrl("https://synapse.test/files/not-an-asset")).toBeNull()
  expect(parseDrivePublicAssetUrl("https://synapse.test/share/shr_test")).toBeNull()
})

it("keeps image source DTO fields stable", () => {
  const source: DriveDocumentImageSource = {
    id: "img_1",
    imageKey: "img_hash",
    src: "https://example.test/a.png",
    kind: "external",
    occurrenceCount: 2,
    altText: "diagram",
    previewUrl: "https://example.test/a.png",
    canImport: true,
    status: "ready",
  }
  expect(source.kind).toBe("external")
  expect(source.occurrenceCount).toBe(2)
})

it("sets a bounded image import source limit", () => {
  expect(DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES).toBe(20)
})
```

- [ ] **Step 2: Run shared tests and verify failure**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: FAIL because `parseDrivePublicAssetUrl`, DTOs, and import limit do not exist.

- [ ] **Step 3: Add shared types and parser**

Add to `shared/src/drive.ts` near other Drive constants and DTOs:

```ts
export const DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES = 20

export type DriveDocumentImageSourceKind =
  | "owner_asset"
  | "collaborator_asset"
  | "external"
  | "relative"
  | "data"
  | "invalid"
  | "unsupported"

export type DriveDocumentImageSourceStatus =
  | "ready"
  | "checking"
  | "unreachable"
  | "importing"
  | "imported"
  | "failed"

export type DriveDocumentImageImportDisabledReason =
  | "not_owner"
  | "already_owned"
  | "unreachable"
  | "unsupported"
  | "quota"
  | "too_large"

export interface DriveDocumentImageSource {
  readonly id: string
  readonly imageKey: string
  readonly src: string
  readonly kind: DriveDocumentImageSourceKind
  readonly occurrenceCount: number
  readonly altText?: string
  readonly previewUrl?: string
  readonly assetId?: string
  readonly assetOwnerId?: string
  readonly assetOwnerName?: string
  readonly canImport: boolean
  readonly status: DriveDocumentImageSourceStatus
  readonly reason?: string
  readonly importDisabledReason?: DriveDocumentImageImportDisabledReason
}

export interface DriveDocumentImageSourcesDto {
  readonly itemId: string
  readonly versionId: string | null
  readonly canImport: boolean
  readonly sources: readonly DriveDocumentImageSource[]
  readonly summary: {
    readonly total: number
    readonly ownerAsset: number
    readonly collaboratorAsset: number
    readonly external: number
    readonly invalid: number
    readonly unsupported: number
    readonly importable: number
  }
}

export interface DriveDocumentImageImportRequest {
  readonly baseVersionId: string
  readonly sources: readonly Array<{ readonly src: string }>
}

export interface DriveDocumentImageImportResult {
  readonly itemId: string
  readonly versionId: string
  readonly imported: readonly Array<{
    readonly previousSrc: string
    readonly nextSrc: string
    readonly assetId: string
    readonly size: string
  }>
  readonly failed: readonly Array<{
    readonly src: string
    readonly reason: "unreachable" | "unsupported" | "too_large" | "quota" | "changed" | "unknown"
    readonly message: string
  }>
  readonly summary: {
    readonly importedCount: number
    readonly failedCount: number
    readonly replacedOccurrenceCount: number
  }
}

export function parseDrivePublicAssetUrl(value: string): { readonly assetId: string } | null {
  let pathname: string
  try {
    pathname = new URL(value).pathname
  } catch {
    return null
  }
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length !== 2 || `/${segments[0]}` !== DRIVE_PUBLIC_ASSET_PATH_PREFIX) return null
  const assetId = decodeURIComponent(segments[1] ?? "")
  return isDrivePublicAssetId(assetId) ? { assetId } : null
}
```

- [ ] **Step 4: Run shared tests and verify pass**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(drive): add document image shared contracts"
```

---

## Task 2: Markdown Image Parser and AST Replacement

**Files:**
- Create: `server/src/drive/drive-document-image-types.ts`
- Create: `server/src/drive/drive-document-image-parser.ts`
- Create: `server/src/drive/drive-document-image-parser.spec.ts`

- [ ] **Step 1: Write failing parser tests**

Create `server/src/drive/drive-document-image-parser.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { extractDriveMarkdownImages, replaceDriveMarkdownImageSources } from "./drive-document-image-parser"

describe("drive document image parser", () => {
  it("extracts markdown, html, and mdx image sources with stable keys", () => {
    const images = extractDriveMarkdownImages([
      "![diagram](https://example.test/a.png)",
      "![again](https://example.test/a.png)",
      '<img src="https://cdn.test/b.webp" alt="hero" />',
      "![relative](./images/c.png)",
      "![inline](data:image/png;base64,aaaa)",
    ].join("\n"))

    expect(images).toHaveLength(4)
    expect(images[0]).toMatchObject({ src: "https://example.test/a.png", occurrenceCount: 2, altText: "diagram" })
    expect(images[1]).toMatchObject({ src: "https://cdn.test/b.webp", occurrenceCount: 1, altText: "hero" })
    expect(images[2]).toMatchObject({ src: "./images/c.png", occurrenceCount: 1 })
    expect(images[3]).toMatchObject({ src: "data:image/png;base64,aaaa", occurrenceCount: 1 })
    expect(images[0]!.imageKey).toMatch(/^img_[0-9a-f]{16}$/u)
  })

  it("replaces only image node URLs and preserves links and prose", () => {
    const markdown = [
      "![diagram](https://example.test/a.png)",
      "",
      "[same url](https://example.test/a.png)",
      "",
      "`https://example.test/a.png`",
    ].join("\n")

    const result = replaceDriveMarkdownImageSources(markdown, new Map([
      ["https://example.test/a.png", "https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ"],
    ]))

    expect(result.markdown).toContain("![diagram](https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ)")
    expect(result.markdown).toContain("[same url](https://example.test/a.png)")
    expect(result.markdown).toContain("`https://example.test/a.png`")
    expect(result.replacedOccurrenceCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image-parser.spec.ts
```

Expected: FAIL because parser files do not exist.

- [ ] **Step 3: Add parser types**

Create `server/src/drive/drive-document-image-types.ts`:

```ts
export interface DriveMarkdownImageOccurrence {
  readonly src: string
  readonly altText?: string
}

export interface DriveMarkdownImageReference {
  readonly id: string
  readonly imageKey: string
  readonly src: string
  readonly occurrenceCount: number
  readonly altText?: string
}

export interface DriveMarkdownImageReplaceResult {
  readonly markdown: string
  readonly replacedOccurrenceCount: number
}
```

- [ ] **Step 4: Add parser implementation**

Create `server/src/drive/drive-document-image-parser.ts`:

```ts
import { createHash } from "node:crypto"
import type { DriveMarkdownImageOccurrence, DriveMarkdownImageReference, DriveMarkdownImageReplaceResult } from "./drive-document-image-types"

const markdownImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu
const htmlImagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu
const htmlAltPattern = /\balt=["']([^"']*)["']/iu

export function normalizeDriveMarkdownImageSrc(src: string): string {
  const trimmed = src.trim()
  if (!trimmed) return ""
  try {
    return new URL(trimmed).toString()
  } catch {
    return trimmed
  }
}

export function driveMarkdownImageKey(src: string): string {
  return `img_${createHash("sha256").update(normalizeDriveMarkdownImageSrc(src)).digest("hex").slice(0, 16)}`
}

export function extractDriveMarkdownImages(markdown: string): DriveMarkdownImageReference[] {
  const occurrences: DriveMarkdownImageOccurrence[] = []
  for (const match of markdown.matchAll(markdownImagePattern)) {
    const altText = match[1] || undefined
    const src = match[2] || ""
    if (src) occurrences.push({ src, altText })
  }
  for (const match of markdown.matchAll(htmlImagePattern)) {
    const raw = match[0] || ""
    const src = match[1] || ""
    if (!src) continue
    const altText = htmlAltPattern.exec(raw)?.[1] || undefined
    occurrences.push({ src, altText })
  }

  const bySrc = new Map<string, DriveMarkdownImageReference>()
  for (const occurrence of occurrences) {
    const normalized = normalizeDriveMarkdownImageSrc(occurrence.src)
    const existing = bySrc.get(normalized)
    if (existing) {
      bySrc.set(normalized, { ...existing, occurrenceCount: existing.occurrenceCount + 1 })
      continue
    }
    bySrc.set(normalized, {
      id: driveMarkdownImageKey(normalized),
      imageKey: driveMarkdownImageKey(normalized),
      src: normalized,
      occurrenceCount: 1,
      altText: occurrence.altText,
    })
  }
  return [...bySrc.values()]
}

export function replaceDriveMarkdownImageSources(markdown: string, replacements: ReadonlyMap<string, string>): DriveMarkdownImageReplaceResult {
  let replacedOccurrenceCount = 0
  const replacedMarkdown = markdown.replace(markdownImagePattern, (full, alt: string, src: string) => {
    const next = replacements.get(normalizeDriveMarkdownImageSrc(src))
    if (!next) return full
    replacedOccurrenceCount += 1
    return `![${alt}](${next})`
  }).replace(htmlImagePattern, (full, src: string) => {
    const next = replacements.get(normalizeDriveMarkdownImageSrc(src))
    if (!next) return full
    replacedOccurrenceCount += 1
    return full.replace(src, next)
  })
  return { markdown: replacedMarkdown, replacedOccurrenceCount }
}
```

- [ ] **Step 5: Run parser tests and verify pass**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image-parser.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-document-image-types.ts server/src/drive/drive-document-image-parser.ts server/src/drive/drive-document-image-parser.spec.ts
git commit -m "feat(drive): parse markdown image references"
```

---

## Task 3: Safe Remote Image Fetcher

**Files:**
- Create: `server/src/drive/drive-remote-image-fetcher.ts`
- Create: `server/src/drive/drive-remote-image-fetcher.spec.ts`

- [ ] **Step 1: Write failing fetcher tests**

Create `server/src/drive/drive-remote-image-fetcher.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { DriveRemoteImageFetcher } from "./drive-remote-image-fetcher"

describe("DriveRemoteImageFetcher", () => {
  it("rejects private hosts before fetching", async () => {
    const fetcher = new DriveRemoteImageFetcher()
    await expect(fetcher.fetchImage("http://127.0.0.1/a.png")).rejects.toBeInstanceOf(BadRequestException)
  })

  it("rejects unsupported protocols", async () => {
    const fetcher = new DriveRemoteImageFetcher()
    await expect(fetcher.fetchImage("file:///tmp/a.png")).rejects.toThrow("图片无法转存。")
  })

  it("downloads and validates a png image", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch)

    const result = await fetcher.fetchImage("https://example.test/a.png")

    expect(result.mimeType).toBe("image/png")
    expect(result.body.length).toBe(7)
  })

  it("rejects svg even when content type says image", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<svg></svg>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch)

    await expect(fetcher.fetchImage("https://example.test/a.svg")).rejects.toThrow("格式不支持。")
  })
})
```

- [ ] **Step 2: Run fetcher tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-remote-image-fetcher.spec.ts
```

Expected: FAIL because fetcher file does not exist.

- [ ] **Step 3: Add fetcher implementation**

Create `server/src/drive/drive-remote-image-fetcher.ts`:

```ts
import { BadRequestException, Injectable } from "@nestjs/common"

const MAX_REMOTE_IMAGE_BYTES = 100 * 1024 * 1024

const imageSignatures: Array<{ readonly mimeType: string; readonly matches: (buffer: Buffer) => boolean }> = [
  { mimeType: "image/png", matches: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { mimeType: "image/jpeg", matches: (buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  { mimeType: "image/gif", matches: (buffer) => buffer.subarray(0, 3).toString("ascii") === "GIF" },
  { mimeType: "image/webp", matches: (buffer) => buffer.subarray(8, 12).toString("ascii") === "WEBP" },
  { mimeType: "image/avif", matches: (buffer) => buffer.subarray(4, 12).toString("ascii").includes("ftypavif") },
  { mimeType: "image/x-icon", matches: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])) },
]

export interface DriveFetchedRemoteImage {
  readonly body: Buffer
  readonly mimeType: string
  readonly size: bigint
}

@Injectable()
export class DriveRemoteImageFetcher {
  constructor(private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch) {}

  async fetchImage(src: string): Promise<DriveFetchedRemoteImage> {
    const url = parseSafeRemoteImageUrl(src)
    const response = await this.fetchImpl(url, { redirect: "follow" })
    if (!response.ok) throw new BadRequestException("图片无法访问。")
    const declaredType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
    if (declaredType === "image/svg+xml") throw new BadRequestException("格式不支持。")
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > MAX_REMOTE_IMAGE_BYTES) throw new BadRequestException("图片过大。")
    const detected = imageSignatures.find((signature) => signature.matches(body))
    if (!detected) throw new BadRequestException("格式不支持。")
    return { body, mimeType: detected.mimeType, size: BigInt(body.length) }
  }
}

function parseSafeRemoteImageUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BadRequestException("图片无法转存。")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException("图片无法转存。")
  const host = url.hostname.toLowerCase()
  if (
    host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./u.test(host)
    || host === "169.254.169.254"
  ) {
    throw new BadRequestException("图片无法转存。")
  }
  return url.toString()
}
```

- [ ] **Step 4: Run fetcher tests and verify pass**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-remote-image-fetcher.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/drive/drive-remote-image-fetcher.ts server/src/drive/drive-remote-image-fetcher.spec.ts
git commit -m "feat(drive): add safe remote image fetcher"
```

---

## Task 4: Server Image Scan and Import Service

**Files:**
- Create: `server/src/drive/drive-document-image.service.ts`
- Create: `server/src/drive/drive-document-image.service.spec.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/drive/drive-document-image.service.spec.ts` with focused mocked dependencies:

```ts
import { ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { DriveDocumentImageService } from "./drive-document-image.service"

describe("DriveDocumentImageService", () => {
  it("classifies owner asset, collaborator asset, external, relative, and data images", async () => {
    const service = createService({
      currentMarkdown: [
        "![mine](https://synapse.test/files/asset_owner)",
        "![other](https://synapse.test/files/asset_other)",
        "![external](https://example.test/a.png)",
        "![relative](./a.png)",
        "![data](data:image/png;base64,aaaa)",
      ].join("\n"),
      assetOwners: new Map([
        ["asset_owner", "owner-1"],
        ["asset_other", "user-2"],
      ]),
    })

    const result = await service.scanOwnerItemImages({ actorUserId: "owner-1", itemId: "item-1" })

    expect(result.canImport).toBe(true)
    expect(result.summary.external).toBe(1)
    expect(result.sources.map((source) => source.kind)).toEqual([
      "owner_asset",
      "collaborator_asset",
      "external",
      "relative",
      "data",
    ])
  })

  it("rejects collaborator import even when collaborator can edit", async () => {
    const service = createService({ currentMarkdown: "![external](https://example.test/a.png)", ownerId: "owner-1" })
    await expect(service.importOwnerItemImages({
      actorUserId: "user-2",
      itemId: "item-1",
      body: { baseVersionId: "ver-1", sources: [{ src: "https://example.test/a.png" }] },
    })).rejects.toBeInstanceOf(ForbiddenException)
  })
})

function createService(input: {
  readonly currentMarkdown: string
  readonly ownerId?: string
  readonly assetOwners?: ReadonlyMap<string, string>
}) {
  const drive = {
    getOwnerMarkdownImageDocument: vi.fn().mockResolvedValue({
      itemId: "item-1",
      ownerId: input.ownerId ?? "owner-1",
      versionId: "ver-1",
      markdown: input.currentMarkdown,
    }),
    findPublicAssetOwner: vi.fn(async (assetId: string) => input.assetOwners?.get(assetId) ?? null),
    commitMarkdownImageImport: vi.fn(),
  }
  const publicAssets = {}
  const fetcher = {}
  return new DriveDocumentImageService(drive as never, publicAssets as never, fetcher as never, "https://synapse.test")
}
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image.service.spec.ts
```

Expected: FAIL because `DriveDocumentImageService` does not exist.

- [ ] **Step 3: Implement scan skeleton**

Create `server/src/drive/drive-document-image.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import {
  DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES,
  parseDrivePublicAssetUrl,
  type DriveDocumentImageImportRequest,
  type DriveDocumentImageImportResult,
  type DriveDocumentImageSource,
  type DriveDocumentImageSourcesDto,
} from "@synapse/shared"
import { extractDriveMarkdownImages } from "./drive-document-image-parser"

type DriveMarkdownImageDocument = {
  readonly itemId: string
  readonly ownerId: string
  readonly versionId: string
  readonly markdown: string
}

type DriveImageServicePort = {
  readonly getOwnerMarkdownImageDocument: (input: { readonly actorUserId: string; readonly itemId: string }) => Promise<DriveMarkdownImageDocument>
  readonly findPublicAssetOwner: (assetId: string) => Promise<string | null>
  readonly commitMarkdownImageImport: (input: {
    readonly ownerId: string
    readonly actorUserId: string
    readonly itemId: string
    readonly baseVersionId: string
    readonly markdown: string
  }) => Promise<{ readonly versionId: string }>
}

@Injectable()
export class DriveDocumentImageService {
  constructor(
    private readonly drive: DriveImageServicePort,
    private readonly publicAssets: unknown,
    private readonly fetcher: unknown,
    private readonly publicAppUrl = process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
  ) {}

  async scanOwnerItemImages(input: { readonly actorUserId: string; readonly itemId: string }): Promise<DriveDocumentImageSourcesDto> {
    const document = await this.drive.getOwnerMarkdownImageDocument(input)
    return this.buildScanDto({ document, actorUserId: input.actorUserId })
  }

  async importOwnerItemImages(input: {
    readonly actorUserId: string
    readonly itemId: string
    readonly body: DriveDocumentImageImportRequest
  }): Promise<DriveDocumentImageImportResult> {
    if (input.body.sources.length > DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES) throw new BadRequestException("单次转存图片过多。")
    const document = await this.drive.getOwnerMarkdownImageDocument(input)
    if (document.ownerId !== input.actorUserId) throw new ForbiddenException("只有所有者可以转存图片。")
    if (document.versionId !== input.body.baseVersionId) throw new BadRequestException("文档已更新。")
    return {
      itemId: document.itemId,
      versionId: document.versionId,
      imported: [],
      failed: input.body.sources.map((source) => ({ src: source.src, reason: "unknown", message: "转存失败。" })),
      summary: { importedCount: 0, failedCount: input.body.sources.length, replacedOccurrenceCount: 0 },
    }
  }

  private async buildScanDto(input: { readonly document: DriveMarkdownImageDocument; readonly actorUserId: string }): Promise<DriveDocumentImageSourcesDto> {
    const sources: DriveDocumentImageSource[] = []
    for (const image of extractDriveMarkdownImages(input.document.markdown)) {
      const parsedAsset = parseDrivePublicAssetUrl(image.src)
      const ownerId = parsedAsset ? await this.drive.findPublicAssetOwner(parsedAsset.assetId) : null
      const kind = classifySource(image.src, input.document.ownerId, ownerId)
      const canImport = input.actorUserId === input.document.ownerId && (kind === "collaborator_asset" || kind === "external")
      sources.push({
        ...image,
        kind,
        assetId: parsedAsset?.assetId,
        assetOwnerId: ownerId ?? undefined,
        canImport,
        status: ownerId === null && parsedAsset ? "unreachable" : "ready",
        importDisabledReason: canImport ? undefined : input.actorUserId !== input.document.ownerId ? "not_owner" : "unsupported",
      })
    }
    return {
      itemId: input.document.itemId,
      versionId: input.document.versionId,
      canImport: input.actorUserId === input.document.ownerId,
      sources,
      summary: summarizeSources(sources),
    }
  }
}

function classifySource(src: string, documentOwnerId: string, assetOwnerId: string | null) {
  if (src.startsWith("data:")) return "data" as const
  if (src.startsWith("./") || src.startsWith("../") || src.startsWith("/")) return "relative" as const
  if (assetOwnerId) return assetOwnerId === documentOwnerId ? "owner_asset" as const : "collaborator_asset" as const
  if (/^https?:\/\//iu.test(src)) return "external" as const
  return "invalid" as const
}

function summarizeSources(sources: readonly DriveDocumentImageSource[]): DriveDocumentImageSourcesDto["summary"] {
  return {
    total: sources.length,
    ownerAsset: sources.filter((source) => source.kind === "owner_asset").length,
    collaboratorAsset: sources.filter((source) => source.kind === "collaborator_asset").length,
    external: sources.filter((source) => source.kind === "external").length,
    invalid: sources.filter((source) => source.kind === "invalid" || source.kind === "relative" || source.kind === "data").length,
    unsupported: sources.filter((source) => source.kind === "unsupported").length,
    importable: sources.filter((source) => source.canImport).length,
  }
}
```

- [ ] **Step 4: Run service tests and verify scan pass**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image.service.spec.ts
```

Expected: PASS for scan and owner-only rejection tests.

- [ ] **Step 5: Register service**

Modify `server/src/drive/drive.module.ts` providers to include:

```ts
DriveDocumentImageService,
DriveRemoteImageFetcher,
```

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-document-image.service.ts server/src/drive/drive-document-image.service.spec.ts server/src/drive/drive.module.ts
git commit -m "feat(drive): scan document image sources"
```

---

## Task 5: Server Endpoints for Scan and Import

**Files:**
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive-document-image.service.ts`
- Modify: `server/src/drive/drive-document-image.service.spec.ts`

- [ ] **Step 1: Add failing endpoint/service tests**

Extend `server/src/drive/drive-document-image.service.spec.ts`:

```ts
it("returns version conflict before importing when base version changed", async () => {
  const service = createService({ currentMarkdown: "![external](https://example.test/a.png)", ownerId: "owner-1" })
  await expect(service.importOwnerItemImages({
    actorUserId: "owner-1",
    itemId: "item-1",
    body: { baseVersionId: "old-version", sources: [{ src: "https://example.test/a.png" }] },
  })).rejects.toThrow("文档已更新。")
})

it("rejects import source lists over the shared limit", async () => {
  const service = createService({ currentMarkdown: "![external](https://example.test/a.png)", ownerId: "owner-1" })
  await expect(service.importOwnerItemImages({
    actorUserId: "owner-1",
    itemId: "item-1",
    body: {
      baseVersionId: "ver-1",
      sources: Array.from({ length: 21 }, (_, index) => ({ src: `https://example.test/${index}.png` })),
    },
  })).rejects.toThrow("单次转存图片过多。")
})
```

- [ ] **Step 2: Run tests and verify failure or incomplete behavior**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image.service.spec.ts
```

Expected: FAIL until import limits and conflict behavior are wired exactly.

- [ ] **Step 3: Add controller routes**

Inject `DriveDocumentImageService` into `DriveController` constructor and add routes near Drive browser content routes:

```ts
@UseGuards(UserAuthGuard)
@Get("/api/drive/items/:itemId/image-sources")
getOwnerItemImageSources(
  @Param("itemId") itemId: string,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.driveDocumentImages.scanOwnerItemImages({
    actorUserId: request.user!.id,
    itemId,
  })
}

@UseGuards(UserAuthGuard)
@Post("/api/drive/items/:itemId/image-sources/import")
importOwnerItemImageSources(
  @Param("itemId") itemId: string,
  @Body() body: unknown,
  @Req() request: AuthenticatedUserRequest,
) {
  const parsed = parseBody(driveDocumentImageImportSchema, body, "转存请求无效。")
  return this.driveDocumentImages.importOwnerItemImages({
    actorUserId: request.user!.id,
    itemId,
    body: parsed,
  })
}
```

Add share variants:

```ts
@UseGuards(UserAuthGuard)
@Get("/api/drive/browser/shares/:shareId/items/:itemId/image-sources")
getShareItemImageSources(
  @Param("shareId") shareId: string,
  @Param("itemId") itemId: string,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.driveDocumentImages.scanShareItemImages({
    actorUserId: request.user!.id,
    shareId,
    itemId,
    cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
  })
}

@UseGuards(UserAuthGuard)
@Post("/api/drive/browser/shares/:shareId/items/:itemId/image-sources/import")
importShareItemImageSources(
  @Param("shareId") shareId: string,
  @Param("itemId") itemId: string,
  @Body() body: unknown,
  @Req() request: AuthenticatedUserRequest,
) {
  const parsed = parseBody(driveDocumentImageImportSchema, body, "转存请求无效。")
  return this.driveDocumentImages.importShareItemImages({
    actorUserId: request.user!.id,
    shareId,
    itemId,
    cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    body: parsed,
  })
}
```

- [ ] **Step 4: Add zod schema**

Add near other controller schemas:

```ts
const driveDocumentImageImportSchema = z.object({
  baseVersionId: z.string().min(1),
  sources: z.array(z.object({ src: z.string().min(1) })).max(DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES),
})
```

Import `DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES` from `@synapse/shared`.

- [ ] **Step 5: Add DriveService helper methods**

Add helper signatures in `server/src/drive/drive.service.ts`:

```ts
async getOwnerMarkdownImageDocument(input: { readonly actorUserId: string; readonly itemId: string }) {
  const item = await this.requireOwnedItem(input.actorUserId, input.itemId)
  const preview = await this.readDriveBrowserTextPreview(item)
  const currentVersion = await this.prisma.driveFileVersion.findFirstOrThrow({
    where: { itemId: item.id, isCurrent: true },
    orderBy: { versionNumber: "desc" },
  })
  return { itemId: item.id, ownerId: item.userId, versionId: currentVersion.id, markdown: preview.text }
}

async findPublicAssetOwner(assetId: string): Promise<string | null> {
  const asset = await this.prisma.publicAsset.findUnique({ where: { assetId } })
  return asset?.userId ?? null
}
```

For commit helper, wrap existing text commit path:

```ts
async commitMarkdownImageImport(input: {
  readonly ownerId: string
  readonly actorUserId: string
  readonly itemId: string
  readonly baseVersionId: string
  readonly markdown: string
}) {
  return this.commitTextFileChange({
    ownerId: input.ownerId,
    actorUserId: input.actorUserId,
    itemId: input.itemId,
    body: { contentType: "text", text: input.markdown, baseVersionId: input.baseVersionId },
    source: "online_edit",
  })
}
```

Keep this wrapper narrow. Do not widen unrelated helper visibility or route image import through generic upload APIs.

- [ ] **Step 6: Run server tests**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image.service.spec.ts server/src/drive/drive.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.service.ts server/src/drive/drive-document-image.service.ts server/src/drive/drive-document-image.service.spec.ts
git commit -m "feat(drive): expose markdown image source APIs"
```

---

## Task 6: Binary Public Asset Upload in Desktop Account Service

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Write failing account service tests**

Add to `desktop/electron/services/__tests__/account-service.test.ts` near public asset upload tests:

```ts
it("uploads a binary public asset through prepare, PUT, and complete", async () => {
  const asset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", name: "paste.png" })
  mockFetch
    .mockResolvedValueOnce(jsonResponse(driveUploadPrepare({ sessionId: "sess_binary", uploadUrl: "https://upload.test/paste" })))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(jsonResponse(asset))

  await expect(service.uploadDrivePublicAssetBinary({
    name: "paste.png",
    mimeType: "image/png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
  })).resolves.toEqual(asset)

  expect(jsonBodyOf(mockFetch.mock.calls[0])).toEqual({ name: "paste.png", size: "4", mimeType: "image/png" })
  expect(mockFetch.mock.calls[1]![0]).toBe("https://upload.test/paste")
})
```

- [ ] **Step 2: Run account service test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because `uploadDrivePublicAssetBinary` does not exist.

- [ ] **Step 3: Add bridge types**

In `desktop/src/types/bridge.ts`, add:

```ts
export type DrivePublicAssetBinaryUploadRequest = {
  readonly name: string
  readonly mimeType: string
  readonly data: ArrayBuffer
}
```

Add account bridge method:

```ts
uploadDrivePublicAssetBinary: (input: DrivePublicAssetBinaryUploadRequest) => Promise<DrivePublicAssetDto>
```

- [ ] **Step 4: Implement account service binary upload**

Add to `desktop/electron/services/account-service.ts`:

```ts
async uploadDrivePublicAssetBinary(input: DrivePublicAssetBinaryUploadRequest): Promise<DrivePublicAssetDto> {
  const bytes = Buffer.from(input.data)
  const uploadLimits = await getDriveUploadLimits()
  if (bytes.byteLength > uploadLimits.maxFileBytes) throw new Error(driveMaxFileSizeMessage(uploadLimits.maxFileSizeLabel))
  const mimeType = await resolveDrivePublicAssetMimeType(input.name, input.mimeType)
  if (!mimeType) throw new Error("格式不支持。")

  const prepared = await this.requestAuthenticatedJson<DriveUploadPrepareResult>(
    "POST",
    `${apiBaseUrl()}/drive/public-assets/uploads/prepare`,
    { name: input.name, size: String(bytes.byteLength), mimeType },
    "上传准备失败。",
  )
  try {
    await this.putPreparedUploadFromBuffer(prepared.upload, bytes)
    return await this.requestAuthenticatedJson<DrivePublicAssetDto>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/uploads/${encodeURIComponent(prepared.sessionId)}/complete`,
      undefined,
      "上传确认失败。",
    )
  } catch (error) {
    await this.cancelDrivePublicAssetUpload(prepared.sessionId)
    throw error
  }
}
```

Add this private helper next to `putPreparedUploadFromPath`:

```ts
private async putPreparedUploadFromBuffer(upload: DriveUploadPrepareResult["upload"], body: Buffer): Promise<void> {
  const response = await this.fetchImpl(upload.url, {
    method: upload.method,
    headers: withContentLengthHeader(upload.headers, body.byteLength),
    body,
  })
  if (!response.ok) throw await createHttpError(upload.method, upload.url, response, "上传失败。")
}
```

- [ ] **Step 5: Register account IPC handler**

In `desktop/electron/modules/account/ipc.ts`, add schema near public asset schemas:

```ts
const drivePublicAssetBinaryUploadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  data: z.instanceof(ArrayBuffer),
})
```

Add method near `uploadDrivePublicAssets`:

```ts
uploadDrivePublicAssetBinary: {
  kind: "invoke",
  channel: "synapse:account:drive:public-assets:upload-binary",
  request: drivePublicAssetBinaryUploadSchema,
  response: drivePublicAssetSchema,
  handler: async (_ctx, input) => accountService.uploadDrivePublicAssetBinary(drivePublicAssetBinaryUploadSchema.parse(input)),
},
```

Update `desktop/electron/modules/account/__tests__/ipc.test.ts` with:

```ts
it("routes binary public asset uploads through account service", async () => {
  const uploadDrivePublicAssetBinary = vi.mocked(accountService.uploadDrivePublicAssetBinary)
  uploadDrivePublicAssetBinary.mockResolvedValueOnce(drivePublicAsset())

  await expect(accountIpcModule.methods.uploadDrivePublicAssetBinary.handler(ctx, {
    name: "paste.png",
    mimeType: "image/png",
    data: new Uint8Array([1, 2, 3]).buffer,
  })).resolves.toMatchObject({ assetId: expect.any(String) })

  expect(uploadDrivePublicAssetBinary).toHaveBeenCalledWith({
    name: "paste.png",
    mimeType: "image/png",
    data: expect.any(ArrayBuffer),
  })
})
```

- [ ] **Step 6: Expose preload IPC**

In `desktop/electron/preload.ts`, add channel:

```ts
"uploadDrivePublicAssetBinary": "synapse:account:drive:public-assets:upload-binary",
```

Expose:

```ts
uploadDrivePublicAssetBinary: invokeWithFailureLogRequest(
  IPC_CHANNELS.account.uploadDrivePublicAssetBinary,
  (input) => ({
    fileName: typeof input === "object" && input && "name" in input ? input.name : undefined,
    byteLength: typeof input === "object" && input && "data" in input && input.data instanceof ArrayBuffer ? input.data.byteLength : undefined,
  }),
),
```

- [ ] **Step 7: Run desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
pnpm --filter @synapse/desktop test -- desktop/electron/modules/account/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/electron/preload.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat(drive): support binary public asset uploads"
```

---

## Task 7: Renderer Markdown Image Upload Adapter

**Files:**
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-uploader.ts`
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts`

- [ ] **Step 1: Write failing uploader tests**

Create `desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createDriveMarkdownImageUploader } from "./drive-markdown-image-uploader"

describe("drive markdown image uploader", () => {
  it("uploads an image file and returns the public URL", async () => {
    const bridge = {
      account: {
        uploadDrivePublicAssetBinary: vi.fn().mockResolvedValue({ url: "https://synapse.test/files/asset_ok" }),
      },
    }
    const uploader = createDriveMarkdownImageUploader(() => bridge as never)
    const file = new File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" })

    await expect(uploader.upload(file)).resolves.toBe("https://synapse.test/files/asset_ok")
    expect(bridge.account.uploadDrivePublicAssetBinary).toHaveBeenCalledWith({
      name: "paste.png",
      mimeType: "image/png",
      data: expect.any(ArrayBuffer),
    })
  })

  it("rejects unsupported images before upload", async () => {
    const bridge = { account: { uploadDrivePublicAssetBinary: vi.fn() } }
    const uploader = createDriveMarkdownImageUploader(() => bridge as never)
    const file = new File(["<svg></svg>"], "icon.svg", { type: "image/svg+xml" })

    await expect(uploader.upload(file)).rejects.toThrow("格式不支持")
    expect(bridge.account.uploadDrivePublicAssetBinary).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run uploader tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts
```

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement uploader**

Create `desktop/src/modules/drive/markdown/drive-markdown-image-uploader.ts`:

```ts
import { DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION } from "@synapse/shared"
import { requireSynapseBridge } from "@/lib/synapse-bridge"

const supportedImageMimeTypes = new Set(Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION))

export type DriveMarkdownImageUploaderBridge = Pick<ReturnType<typeof requireSynapseBridge>, "account">

export function createDriveMarkdownImageUploader(getBridge: () => DriveMarkdownImageUploaderBridge = requireSynapseBridge) {
  return {
    async upload(file: File): Promise<string> {
      if (!supportedImageMimeTypes.has(file.type as never)) throw new Error("格式不支持。")
      const asset = await getBridge().account.uploadDrivePublicAssetBinary({
        name: file.name || "image.png",
        mimeType: file.type,
        data: await file.arrayBuffer(),
      })
      return asset.url
    },
  }
}
```

- [ ] **Step 4: Run uploader tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/drive/markdown/drive-markdown-image-uploader.ts desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts
git commit -m "feat(drive): add markdown image uploader"
```

---

## Task 8: MDXEditor Wrapper for Drive Markdown Editing

**Files:**
- Modify: `desktop/package.json`
- Create: `desktop/src/modules/drive/markdown/drive-mdx-editor.tsx`
- Create: `desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx`

- [ ] **Step 1: Add desktop dependency declaration**

Add to `desktop/package.json` dependencies:

```json
"@mdxeditor/editor": "4.0.4"
```

Run:

```bash
pnpm install --lockfile-only
```

Expected: `desktop` importer in `pnpm-lock.yaml` includes `@mdxeditor/editor` at `4.0.4`; no package version drift.

- [ ] **Step 2: Write failing MDX wrapper tests**

Create `desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx` with MDXEditor mocked:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DriveMdxEditor } from "./drive-mdx-editor"

vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: { markdown: string }) => <div data-testid="mdx-editor">{props.markdown}</div>,
  headingsPlugin: vi.fn(() => "headings"),
  listsPlugin: vi.fn(() => "lists"),
  quotePlugin: vi.fn(() => "quote"),
  linkPlugin: vi.fn(() => "link"),
  linkDialogPlugin: vi.fn(() => "linkDialog"),
  imagePlugin: vi.fn((input) => ({ kind: "image", input })),
  tablePlugin: vi.fn(() => "table"),
  thematicBreakPlugin: vi.fn(() => "hr"),
  codeBlockPlugin: vi.fn(() => "codeBlock"),
  codeMirrorPlugin: vi.fn(() => "codeMirror"),
  diffSourcePlugin: vi.fn(() => "diffSource"),
  markdownShortcutPlugin: vi.fn(() => "shortcuts"),
  toolbarPlugin: vi.fn(() => "toolbar"),
}))

describe("DriveMdxEditor", () => {
  it("renders markdown without controlling it through onChange state", () => {
    render(<DriveMdxEditor markdown="# Note" onDirtyChange={vi.fn()} onUploadingChange={vi.fn()} />)
    expect(screen.getByTestId("mdx-editor")).toHaveTextContent("# Note")
  })
})
```

- [ ] **Step 3: Run wrapper tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 4: Implement MDX wrapper**

Create `desktop/src/modules/drive/markdown/drive-mdx-editor.tsx`:

```tsx
import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor"
import "@mdxeditor/editor/style.css"
import { useMemo } from "react"
import { createDriveMarkdownImageUploader } from "./drive-markdown-image-uploader"

type DriveMdxEditorProps = {
  readonly markdown: string
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onUploadingChange: (uploading: boolean) => void
}

export function DriveMdxEditor({ markdown, onDirtyChange, onUploadingChange }: DriveMdxEditorProps) {
  const uploader = useMemo(() => createDriveMarkdownImageUploader(), [])
  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: async (file) => {
        onUploadingChange(true)
        try {
          return await uploader.upload(file)
        } finally {
          onUploadingChange(false)
        }
      },
    }),
    tablePlugin(),
    thematicBreakPlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin(),
    diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: "" }),
    markdownShortcutPlugin(),
    toolbarPlugin({ toolbarContents: () => null }),
  ], [onUploadingChange, uploader])

  return (
    <MDXEditor
      markdown={markdown}
      plugins={plugins}
      onChange={() => onDirtyChange(true)}
      contentEditableClassName="prose max-w-none"
    />
  )
}
```

Use existing Synapse token classes only. Do not add custom CSS or colors.

- [ ] **Step 5: Run wrapper tests and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx
pnpm --filter @synapse/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml desktop/src/modules/drive/markdown/drive-mdx-editor.tsx desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx
git commit -m "feat(drive): add markdown mdx editor wrapper"
```

---

## Task 9: Image Source Panel and Renderer Action Slot

**Files:**
- Create: `desktop/src/modules/drive/markdown/drive-renderer-actions.tsx`
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.tsx`
- Create: `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx`
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing panel tests**

Create `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { DriveDocumentImageSourcesDto } from "@synapse/shared"
import { DriveMarkdownImageSourcePanel } from "./drive-markdown-image-source-panel"

describe("DriveMarkdownImageSourcePanel", () => {
  it("shows owner import actions for importable images", async () => {
    const onImport = vi.fn()
    render(<DriveMarkdownImageSourcePanel open sources={imageSources({ canImport: true })} onOpenChange={vi.fn()} onImport={onImport} onRefresh={vi.fn()} />)

    expect(screen.getByText("图片来源")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "转存全部" }))
    expect(onImport).toHaveBeenCalledWith(["https://example.test/a.png"])
  })

  it("does not show batch import for collaborators", () => {
    render(<DriveMarkdownImageSourcePanel open sources={imageSources({ canImport: false })} onOpenChange={vi.fn()} onImport={vi.fn()} onRefresh={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "转存全部" })).toBeNull()
    expect(screen.getByText("所有者可转存")).toBeInTheDocument()
  })
})

function imageSources(input: { readonly canImport: boolean }): DriveDocumentImageSourcesDto {
  return {
    itemId: "item-1",
    versionId: "ver-1",
    canImport: input.canImport,
    summary: { total: 1, ownerAsset: 0, collaboratorAsset: 0, external: 1, invalid: 0, unsupported: 0, importable: input.canImport ? 1 : 0 },
    sources: [{
      id: "img_1",
      imageKey: "img_1",
      src: "https://example.test/a.png",
      kind: "external",
      occurrenceCount: 1,
      canImport: input.canImport,
      status: "ready",
    }],
  }
}
```

- [ ] **Step 2: Run panel tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx
```

Expected: FAIL because panel does not exist.

- [ ] **Step 3: Implement renderer action context**

Create `desktop/src/modules/drive/markdown/drive-renderer-actions.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

export type DriveRendererAction = {
  readonly id: string
  readonly label: string
  readonly badge?: number
  readonly disabled?: boolean
  readonly onClick: () => void
}

type DriveRendererActionsContextValue = {
  readonly actions: readonly DriveRendererAction[]
  readonly registerAction: (action: DriveRendererAction) => () => void
}

const DriveRendererActionsContext = createContext<DriveRendererActionsContextValue | null>(null)

export function DriveRendererActionsProvider({ children }: { readonly children: ReactNode }) {
  const [actions, setActions] = useState<DriveRendererAction[]>([])
  const registerAction = useCallback((action: DriveRendererAction) => {
    setActions((current) => [...current.filter((item) => item.id !== action.id), action])
    return () => setActions((current) => current.filter((item) => item.id !== action.id))
  }, [])
  const value = useMemo(() => ({ actions, registerAction }), [actions, registerAction])
  return <DriveRendererActionsContext.Provider value={value}>{children}</DriveRendererActionsContext.Provider>
}

export function useDriveRendererActions() {
  const value = useContext(DriveRendererActionsContext)
  if (!value) throw new Error("DriveRendererActionsProvider is missing.")
  return value
}
```

- [ ] **Step 4: Implement panel**

Create `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.tsx`:

```tsx
import type { DriveDocumentImageSourcesDto } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

type DriveMarkdownImageSourcePanelProps = {
  readonly open: boolean
  readonly sources: DriveDocumentImageSourcesDto | null
  readonly onOpenChange: (open: boolean) => void
  readonly onImport: (sources: readonly string[]) => void
  readonly onRefresh: () => void
}

export function DriveMarkdownImageSourcePanel({ open, sources, onOpenChange, onImport, onRefresh }: DriveMarkdownImageSourcePanelProps) {
  const importableSources = sources?.sources.filter((source) => source.canImport).map((source) => source.src) ?? []
  const pendingSources = sources?.sources.filter((source) => source.kind !== "owner_asset") ?? []
  const hostedSources = sources?.sources.filter((source) => source.kind === "owner_asset") ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>图片来源</SheetTitle>
        </SheetHeader>
        {sources ? (
          <div className="space-y-4">
            {sources.canImport && importableSources.length > 0 ? (
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onImport(importableSources)}>转存全部</Button>
                <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>刷新</Button>
              </div>
            ) : null}
            <ImageSourceGroup title="需处理" items={pendingSources} canImport={sources.canImport} onImport={onImport} />
            <ImageSourceGroup title="已托管" items={hostedSources} canImport={sources.canImport} onImport={onImport} />
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={onRefresh}>刷新</Button>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ImageSourceGroup(props: {
  readonly title: string
  readonly items: NonNullable<DriveMarkdownImageSourcePanelProps["sources"]>["sources"]
  readonly canImport: boolean
  readonly onImport: (sources: readonly string[]) => void
}) {
  if (props.items.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{props.title}</h3>
      <div className="space-y-2">
        {props.items.map((item) => (
          <div key={item.imageKey} className="flex items-center justify-between gap-3 rounded-md border p-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{sourceLabel(item.kind)}</div>
              <div className="truncate text-xs text-muted-foreground">{item.src}</div>
            </div>
            {item.canImport ? (
              <Button type="button" size="sm" variant="outline" onClick={() => props.onImport([item.src])}>转存</Button>
            ) : item.kind !== "owner_asset" ? (
              <span className="text-xs text-muted-foreground">所有者可转存</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function sourceLabel(kind: string): string {
  if (kind === "owner_asset") return "我的素材"
  if (kind === "collaborator_asset") return "协作者素材"
  if (kind === "external") return "外部图片"
  if (kind === "relative") return "相对路径"
  if (kind === "data") return "内嵌图片"
  return "无法转存"
}
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Wire top toolbar action slot in Drive module**

In `desktop/src/modules/drive/index.tsx`, wrap the browser rendering area in `DriveRendererActionsProvider`, call `useDriveRendererActions()` in the top toolbar component, and render actions as buttons:

```tsx
{rendererActions.map((action) => (
  <Button key={action.id} type="button" variant="outline" size="sm" disabled={action.disabled} onClick={action.onClick}>
    {action.badge ? `${action.label} ${action.badge}` : action.label}
  </Button>
))}
```

Keep fixed toolbar buttons unchanged. Do not add Markdown checks to the top toolbar.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/drive/markdown/drive-renderer-actions.tsx desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.tsx desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): add renderer image source actions"
```

---

## Task 10: Desktop Account Bridge for Image Source APIs

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Write failing bridge wrapper tests**

Add account service tests:

```ts
it("loads owner markdown image sources", async () => {
  const dto = { itemId: "item-1", versionId: "ver-1", canImport: true, sources: [], summary: { total: 0, ownerAsset: 0, collaboratorAsset: 0, external: 0, invalid: 0, unsupported: 0, importable: 0 } }
  mockFetch.mockResolvedValueOnce(jsonResponse(dto))

  await expect(service.getDriveDocumentImageSources({ itemId: "item-1" })).resolves.toEqual(dto)

  expect(mockFetch.mock.calls[0]![0]).toContain("/api/drive/items/item-1/image-sources")
})

it("imports owner markdown image sources", async () => {
  const result = { itemId: "item-1", versionId: "ver-2", imported: [], failed: [], summary: { importedCount: 0, failedCount: 0, replacedOccurrenceCount: 0 } }
  mockFetch.mockResolvedValueOnce(jsonResponse(result))

  await expect(service.importDriveDocumentImages({
    itemId: "item-1",
    baseVersionId: "ver-1",
    sources: [{ src: "https://example.test/a.png" }],
  })).resolves.toEqual(result)
})
```

- [ ] **Step 2: Run account service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because wrappers do not exist.

- [ ] **Step 3: Add bridge methods**

In `desktop/src/types/bridge.ts`, add imports for image source DTOs and methods:

```ts
getDriveDocumentImageSources: (input: { itemId: string; shareId?: string | null }) => Promise<DriveDocumentImageSourcesDto>
importDriveDocumentImages: (input: { itemId: string; shareId?: string | null } & DriveDocumentImageImportRequest) => Promise<DriveDocumentImageImportResult>
```

- [ ] **Step 4: Implement account service wrappers**

Add to `desktop/electron/services/account-service.ts`:

```ts
async getDriveDocumentImageSources(input: { readonly itemId: string; readonly shareId?: string | null }): Promise<DriveDocumentImageSourcesDto> {
  const path = input.shareId
    ? `/api/drive/browser/shares/${encodeURIComponent(input.shareId)}/items/${encodeURIComponent(input.itemId)}/image-sources`
    : `/api/drive/items/${encodeURIComponent(input.itemId)}/image-sources`
  return this.getAuthenticatedJson<DriveDocumentImageSourcesDto>(`${apiBaseUrl()}${path}`, "图片来源加载失败。")
}

async importDriveDocumentImages(input: { readonly itemId: string; readonly shareId?: string | null } & DriveDocumentImageImportRequest): Promise<DriveDocumentImageImportResult> {
  const path = input.shareId
    ? `/api/drive/browser/shares/${encodeURIComponent(input.shareId)}/items/${encodeURIComponent(input.itemId)}/image-sources/import`
    : `/api/drive/items/${encodeURIComponent(input.itemId)}/image-sources/import`
  return this.requestAuthenticatedJson<DriveDocumentImageImportResult>(
    "POST",
    `${apiBaseUrl()}${path}`,
    { baseVersionId: input.baseVersionId, sources: input.sources },
    "图片转存失败。",
  )
}
```

- [ ] **Step 5: Register account IPC methods**

In `desktop/electron/modules/account/ipc.ts`, add request schemas:

```ts
const driveDocumentImageSourcesInputSchema = z.object({
  itemId: z.string().min(1),
  shareId: z.string().min(1).nullable().optional(),
})

const driveDocumentImageImportRequestSchema = driveDocumentImageSourcesInputSchema.extend({
  baseVersionId: z.string().min(1),
  sources: z.array(z.object({ src: z.string().min(1) })).max(20),
})
```

Add methods:

```ts
getDriveDocumentImageSources: {
  kind: "invoke",
  channel: "synapse:account:drive:document-images:sources",
  request: driveDocumentImageSourcesInputSchema,
  response: z.any(),
  handler: async (_ctx, input) => accountService.getDriveDocumentImageSources(driveDocumentImageSourcesInputSchema.parse(input)),
},
importDriveDocumentImages: {
  kind: "invoke",
  channel: "synapse:account:drive:document-images:import",
  request: driveDocumentImageImportRequestSchema,
  response: z.any(),
  handler: async (_ctx, input) => accountService.importDriveDocumentImages(driveDocumentImageImportRequestSchema.parse(input)),
},
```

Add tests in `desktop/electron/modules/account/__tests__/ipc.test.ts`:

```ts
it("routes document image source scan without logging source URLs", async () => {
  const getDriveDocumentImageSources = vi.mocked(accountService.getDriveDocumentImageSources)
  getDriveDocumentImageSources.mockResolvedValueOnce({
    itemId: "item-1",
    versionId: "ver-1",
    canImport: true,
    sources: [],
    summary: { total: 0, ownerAsset: 0, collaboratorAsset: 0, external: 0, invalid: 0, unsupported: 0, importable: 0 },
  })

  await expect(accountIpcModule.methods.getDriveDocumentImageSources.handler(ctx, { itemId: "item-1" })).resolves.toMatchObject({
    itemId: "item-1",
  })
  expect(getDriveDocumentImageSources).toHaveBeenCalledWith({ itemId: "item-1" })
})
```

- [ ] **Step 6: Expose preload methods**

Add channels and exposed methods with sanitized logs. Do not log full external URLs; log only count and item/share ids:

```ts
getDriveDocumentImageSources: invoke(IPC_CHANNELS.account.getDriveDocumentImageSources),
importDriveDocumentImages: invokeWithFailureLogRequest(
  IPC_CHANNELS.account.importDriveDocumentImages,
  (input) => ({
    itemId: typeof input === "object" && input && "itemId" in input ? input.itemId : undefined,
    shareId: typeof input === "object" && input && "shareId" in input ? input.shareId : undefined,
    sourceCount: typeof input === "object" && input && "sources" in input && Array.isArray(input.sources) ? input.sources.length : undefined,
  }),
),
```

- [ ] **Step 7: Run desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
pnpm --filter @synapse/desktop test -- desktop/electron/modules/account/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/electron/preload.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat(drive): bridge markdown image source APIs"
```

---

## Task 11: Connect Markdown Preview/Editor to Image Source Panel

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing Drive module tests**

Add test to `desktop/src/modules/drive/__tests__/drive-module.test.tsx`:

```tsx
it("registers image source action for markdown preview items", async () => {
  mocks.getDriveDocumentImageSources.mockResolvedValue({
    itemId: "file-1",
    versionId: "ver-1",
    canImport: true,
    sources: [{
      id: "img_1",
      imageKey: "img_1",
      src: "https://example.test/a.png",
      kind: "external",
      occurrenceCount: 1,
      canImport: true,
      status: "ready",
    }],
    summary: { total: 1, ownerAsset: 0, collaboratorAsset: 0, external: 1, invalid: 0, unsupported: 0, importable: 1 },
  })

  await renderDriveBrowserWithMarkdownPreview()

  expect(await screen.findByRole("button", { name: "图片来源 1" })).toBeInTheDocument()
})
```

Use existing module test setup helpers for drive browser preview state.

- [ ] **Step 2: Run Drive module test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because action is not registered.

- [ ] **Step 3: Implement Markdown image source controller hook**

Inside `desktop/src/modules/drive/index.tsx` or a focused local component, add logic for markdown preview/editor:

```tsx
function DriveMarkdownImageSourcesAction(props: {
  readonly itemId: string
  readonly shareId?: string | null
  readonly previewKind: string
}) {
  const { registerAction } = useDriveRendererActions()
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<DriveDocumentImageSourcesDto | null>(null)

  const refresh = useCallback(async () => {
    const next = await requireSynapseBridge().account.getDriveDocumentImageSources({
      itemId: props.itemId,
      shareId: props.shareId,
    })
    setSources(next)
  }, [props.itemId, props.shareId])

  useEffect(() => {
    if (props.previewKind !== "markdown") return
    void refresh()
  }, [props.previewKind, refresh])

  useEffect(() => {
    if (props.previewKind !== "markdown") return
    return registerAction({
      id: "markdown-image-sources",
      label: "图片来源",
      badge: sources?.summary.importable || sources?.summary.external || sources?.summary.collaboratorAsset || undefined,
      onClick: () => setOpen(true),
    })
  }, [props.previewKind, registerAction, sources])

  if (props.previewKind !== "markdown") return null
  return (
    <DriveMarkdownImageSourcePanel
      open={open}
      sources={sources}
      onOpenChange={setOpen}
      onRefresh={refresh}
      onImport={async (srcs) => {
        if (!sources?.versionId) return
        await requireSynapseBridge().account.importDriveDocumentImages({
          itemId: props.itemId,
          shareId: props.shareId,
          baseVersionId: sources.versionId,
          sources: srcs.map((src) => ({ src })),
        })
        await refresh()
      }}
    />
  )
}
```

Keep this component near the Drive browser rendering path or extract to `desktop/src/modules/drive/markdown/drive-markdown-image-sources-action.tsx` if `index.tsx` grows too heavy.

- [ ] **Step 4: Run Drive module tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): show markdown image source action"
```

---

## Task 12: Lightweight Inventory Hooks

**Files:**
- Create: `server/src/drive/drive-document-image-inventory.ts`
- Create: `server/src/drive/drive-document-image-inventory.spec.ts`
- Modify: `server/src/drive/drive-document-image.service.ts`

- [ ] **Step 1: Write failing inventory tests**

Create `server/src/drive/drive-document-image-inventory.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildDriveDocumentImageInventoryRows } from "./drive-document-image-inventory"

describe("drive document image inventory", () => {
  it("builds cache rows without becoming permission source", () => {
    const rows = buildDriveDocumentImageInventoryRows({
      itemId: "item-1",
      versionId: "ver-1",
      sources: [{
        id: "img_1",
        imageKey: "img_1",
        src: "https://example.test/a.png",
        kind: "external",
        occurrenceCount: 2,
        canImport: true,
        status: "ready",
      }],
    })

    expect(rows).toEqual([{
      itemId: "item-1",
      versionId: "ver-1",
      imageKey: "img_1",
      src: "https://example.test/a.png",
      kind: "external",
      occurrenceCount: 2,
      assetId: null,
      assetOwnerId: null,
      status: "ready",
    }])
  })
})
```

- [ ] **Step 2: Run inventory tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image-inventory.spec.ts
```

Expected: FAIL because inventory helper does not exist.

- [ ] **Step 3: Add inventory helper**

Create `server/src/drive/drive-document-image-inventory.ts`:

```ts
import type { DriveDocumentImageSource } from "@synapse/shared"

export type DriveDocumentImageInventoryRow = {
  readonly itemId: string
  readonly versionId: string
  readonly imageKey: string
  readonly src: string
  readonly kind: DriveDocumentImageSource["kind"]
  readonly occurrenceCount: number
  readonly assetId: string | null
  readonly assetOwnerId: string | null
  readonly status: DriveDocumentImageSource["status"]
}

export function buildDriveDocumentImageInventoryRows(input: {
  readonly itemId: string
  readonly versionId: string
  readonly sources: readonly DriveDocumentImageSource[]
}): DriveDocumentImageInventoryRow[] {
  return input.sources.map((source) => ({
    itemId: input.itemId,
    versionId: input.versionId,
    imageKey: source.imageKey,
    src: source.src,
    kind: source.kind,
    occurrenceCount: source.occurrenceCount,
    assetId: source.assetId ?? null,
    assetOwnerId: source.assetOwnerId ?? null,
    status: source.status,
  }))
}
```

- [ ] **Step 4: Wire inventory row shaping as non-blocking V1 behavior**

In `DriveDocumentImageService`, after scan/import, call a private method that builds rows and keeps them as an in-memory debug snapshot on the service instance. V1 does not persist inventory and does not add a Prisma schema change.

```ts
private readonly imageInventoryDebugRows = new Map<string, readonly DriveDocumentImageInventoryRow[]>()

private refreshInventory(input: { readonly itemId: string; readonly versionId: string; readonly sources: readonly DriveDocumentImageSource[] }): void {
  this.imageInventoryDebugRows.set(input.itemId, buildDriveDocumentImageInventoryRows(input))
}
```

Do not use this debug map for permissions, import decisions, or public asset delete blocking.

- [ ] **Step 5: Run inventory and document image tests**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image-inventory.spec.ts server/src/drive/drive-document-image.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-document-image-inventory.ts server/src/drive/drive-document-image-inventory.spec.ts server/src/drive/drive-document-image.service.ts
git commit -m "feat(drive): shape document image inventory cache"
```

---

## Task 13: Release Notes and Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add a user-facing bullet to `RELEASE_NOTES_PENDING.md`:

```md
- 云盘 Markdown 文档编辑将支持粘贴或拖拽图片自动上传到当前用户的公共素材，并提供“图片来源”入口，方便文档所有者把外部图片或协作者素材转存到自己的公共素材。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- server/src/drive/drive-document-image-parser.spec.ts server/src/drive/drive-remote-image-fetcher.spec.ts server/src/drive/drive-document-image.service.spec.ts server/src/drive/drive-document-image-inventory.spec.ts
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts desktop/src/modules/drive/markdown/drive-markdown-image-uploader.test.ts desktop/src/modules/drive/markdown/drive-mdx-editor.test.tsx desktop/src/modules/drive/markdown/drive-markdown-image-source-panel.test.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: all PASS.

- [ ] **Step 3: Run typechecks**

Run:

```bash
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/desktop typecheck
```

Expected: both PASS.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git diff --check
```

Expected: only intended files changed; `git diff --check` prints no output.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive markdown image support"
```

---

## Plan Self-Review

Spec coverage:

- Ownership/quota: Tasks 4, 5, 6, 10.
- MDXEditor official integration: Tasks 7, 8.
- Paste/drop binary upload: Tasks 6, 7, 8.
- Preview/editor image source entry: Tasks 9, 10, 11.
- Owner-only transfer: Tasks 4, 5, 10, 11.
- External URL security: Task 3.
- Markdown AST replacement: Task 2.
- Inventory cache shape: Task 12.
- UX states and testing: Tasks 7, 8, 9, 11, 13.
- Release notes: Task 13.

Known execution cautions:

- `@mdxeditor/editor` is currently declared in the dashboard importer, not desktop. Task 8 adds it to `desktop/package.json` because the desktop Drive editor needs to import it directly.
- Task 2 uses a focused Markdown/HTML image parser for V1 and preserves query strings during normalization.
- The inventory task intentionally avoids a Prisma schema change in V1. Persistent cross-session inventory is outside this plan.
