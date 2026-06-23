# Drive Site Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Drive folder-to-static-site publishing with independent copied deployments, `/sites/<siteId>/` public serving, password/expiry access control, and Drive desktop management UI.

**Architecture:** Add a first-class `DriveSite` domain beside existing Drive shares and public assets. Server owns site persistence, folder snapshot publishing, static public serving, and access control; desktop owns creation and management UI through account bridge APIs; Synapse capability docs describe site publishing as distinct from share links and public assets.

**Tech Stack:** NestJS, Prisma, Express responses, Vitest, Supertest, Electron IPC, React 19, shadcn/Radix UI, Tailwind tokens, `@synapse/shared`.

---

## Scope Check

This plan covers one end-to-end feature with tightly coupled layers. Do not split it into separate feature plans: the server API, public route, desktop bridge, and UI are required together before users can create and manage a published site. Execution can still be parallelized by task after the shared contracts and schema land.

## File Structure

- Modify `shared/src/drive.ts`: add site constants, DTOs, input types, URL helpers.
- Modify `shared/src/drive.test.ts`: verify site URL helpers and DTO-compatible defaults.
- Modify `server/prisma/schema.prisma`: add `DriveSite`, `DriveSiteDeployment`, and `DriveSiteAsset`.
- Create `server/prisma/migrations/<timestamp>_drive_sites/migration.sql`: database migration.
- Modify `server/src/drive/drive-token.ts` and `server/src/drive/drive-token.spec.ts`: add `createDriveSiteId`.
- Create `server/src/drive/drive-site-path.ts` and `server/src/drive/drive-site-path.spec.ts`: relative path normalization and entry path helpers.
- Create `server/src/drive/drive-site.service.ts` and `server/src/drive/drive-site.service.spec.ts`: site creation, listing, access updates, disable/enable/delete, republish, and public resolution.
- Create `server/src/drive/drive-site-public.ts`: public route helpers for content type, cache headers, and safe error pages.
- Modify `server/src/drive/drive.controller.ts`: add user API routes and public `/sites` routes.
- Modify `server/src/drive/drive.controller.spec.ts`: cover API and public route behavior.
- Modify `server/src/drive/drive.module.ts`: register/export `DriveSiteService`.
- Modify `desktop/electron/services/account-service.ts` and `desktop/electron/services/__tests__/account-service.test.ts`: call site APIs and normalize public URLs.
- Modify `desktop/electron/modules/account/ipc.ts` and `desktop/electron/modules/account/__tests__/ipc.test.ts`: add IPC schemas and handlers.
- Modify `desktop/src/types/bridge.ts` and `desktop/src/types/__tests__/account.test.ts`: expose site methods to renderer.
- Create `desktop/src/modules/drive/drive-site-create-dialog.tsx`.
- Create `desktop/src/modules/drive/drive-sites-dialog.tsx`.
- Modify `desktop/src/modules/drive/drive-table-columns.tsx`: add site management table columns.
- Modify `desktop/src/modules/drive/index.tsx`: add folder row action and top-bar `站点` button.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`: UI flow tests.
- Modify `desktop/synapse-capabilities/shared/drive-domain.ts` and `desktop/electron/capabilities/drive-dispatcher.ts`: add MCP/capability actions for Drive site tools.
- Modify `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`: capability dispatch tests.
- Modify `desktop/resources/templates/skills/synapse-skill/files/drive/index.md` and `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`: agent-facing Drive site docs.
- Modify `desktop/electron/services/__tests__/repository-template-service.test.ts`: consolidated skill template expectations.
- Modify `RELEASE_NOTES_PENDING.md`: user-facing release note.

## Task 1: Shared Contracts And Database Schema

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_drive_sites/migration.sql`
- Modify: `server/src/drive/drive-token.ts`
- Modify: `server/src/drive/drive-token.spec.ts`

- [ ] **Step 1: Add failing shared tests**

Add tests to `shared/src/drive.test.ts`:

```ts
import {
  buildDriveSiteUrl,
  DRIVE_SITE_PATH_PREFIX,
  DRIVE_SITE_DEFAULT_PAGE_SIZE,
  DRIVE_SITE_MAX_PAGE_SIZE,
} from "./drive"

describe("Drive site URLs", () => {
  it("builds canonical site root URLs", () => {
    expect(DRIVE_SITE_PATH_PREFIX).toBe("/sites")
    expect(buildDriveSiteUrl({ publicAppUrl: "https://synapse.test/", siteId: "site_abc" })).toBe("https://synapse.test/sites/site_abc/")
  })

  it("keeps site page limits stable", () => {
    expect(DRIVE_SITE_DEFAULT_PAGE_SIZE).toBe(50)
    expect(DRIVE_SITE_MAX_PAGE_SIZE).toBe(200)
  })
})
```

- [ ] **Step 2: Run shared test to verify failure**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: fail because `DRIVE_SITE_PATH_PREFIX`, `DRIVE_SITE_DEFAULT_PAGE_SIZE`, `DRIVE_SITE_MAX_PAGE_SIZE`, and `buildDriveSiteUrl` are not defined.

- [ ] **Step 3: Add shared site constants, DTOs, and URL helper**

Add to `shared/src/drive.ts` near existing Drive public constants and types:

```ts
export const DRIVE_SITE_PATH_PREFIX = "/sites"
export const DRIVE_SITE_DEFAULT_PAGE_SIZE = 50
export const DRIVE_SITE_MAX_PAGE_SIZE = 200
export const DRIVE_SITE_MAX_FILES = 1000
export const DRIVE_SITE_MAX_TOTAL_BYTES = 200 * 1024 * 1024
export const DRIVE_SITE_MAX_TOTAL_SIZE_LABEL = "200MB"

export type DriveSiteStatus = "active" | "disabled" | "expired" | "deleted" | "failed"
export type DriveSiteAccessMode = "public" | "password"

export interface DriveSiteCreateInput {
  readonly sourceFolderItemId: string
  readonly name: string
  readonly entryPath?: string | null
  readonly accessMode: DriveSiteAccessMode
  readonly password?: string | null
  readonly expiresIn: DriveAccessExpiresIn
}

export interface DriveSiteAccessUpdateInput {
  readonly accessMode: DriveSiteAccessMode
  readonly password?: string | null
  readonly expiresIn: DriveAccessExpiresIn
}

export interface DriveSiteDto {
  readonly id: string
  readonly siteId: string
  readonly name: string
  readonly status: DriveSiteStatus
  readonly accessMode: DriveSiteAccessMode
  readonly url: string
  readonly expiresAt: string | null
  readonly sourceFolderItemId: string | null
  readonly sourceFolderName: string | null
  readonly entryPath: string | null
  readonly fileCount: number
  readonly totalBytes: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastPublishedAt: string | null
}

export interface DriveSitePreflightDto {
  readonly sourceFolderItemId: string
  readonly sourceFolderName: string
  readonly htmlFiles: readonly string[]
  readonly defaultEntryPath: string | null
  readonly fileCount: number
  readonly totalBytes: string
  readonly includesJavaScript: boolean
}

export interface DriveSiteListPageDto {
  readonly items: readonly DriveSiteDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveSiteListInput {
  readonly offset?: number
  readonly limit?: number
  readonly search?: string
  readonly status?: DriveSiteStatus | "all"
}

export function buildDriveSiteUrl(input: { readonly publicAppUrl: string; readonly siteId: string }): string {
  return `${input.publicAppUrl.trim().replace(/\/+$/u, "")}${DRIVE_SITE_PATH_PREFIX}/${encodeURIComponent(input.siteId)}/`
}
```

- [ ] **Step 4: Add Prisma models and migration**

Add models to `server/prisma/schema.prisma` near the other Drive models:

```prisma
model DriveSite {
  id                  String                @id @default(cuid())
  siteId              String                @unique @db.VarChar(48)
  userId              String
  user                User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  name                String                @db.VarChar(255)
  status              String                @db.VarChar(32)
  accessMode          String                @db.VarChar(32)
  passwordHash        String?
  expiresAt           DateTime?
  currentDeploymentId String?
  sourceFolderItemId  String?
  sourceFolderName    String?               @db.VarChar(255)
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt
  disabledAt          DateTime?
  deletedAt           DateTime?
  deployments         DriveSiteDeployment[]
  assets              DriveSiteAsset[]

  @@index([userId, createdAt])
  @@index([userId, status, updatedAt])
  @@index([sourceFolderItemId])
}

model DriveSiteDeployment {
  id          String           @id @default(cuid())
  driveSiteId String
  driveSite   DriveSite        @relation(fields: [driveSiteId], references: [id], onDelete: Cascade)
  status      String           @db.VarChar(32)
  entryPath   String           @db.VarChar(1024)
  fileCount   Int
  totalBytes  BigInt
  createdAt   DateTime         @default(now())
  activatedAt DateTime?
  error       String?
  assets      DriveSiteAsset[]

  @@index([driveSiteId, createdAt])
  @@index([status])
}

model DriveSiteAsset {
  id           String              @id @default(cuid())
  driveSiteId  String
  driveSite    DriveSite           @relation(fields: [driveSiteId], references: [id], onDelete: Cascade)
  deploymentId String
  deployment   DriveSiteDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)
  sourceItemId String?
  relativePath String              @db.VarChar(1024)
  storageKey   String              @unique
  contentType  String?             @db.VarChar(255)
  size         BigInt
  sha256       String?

  @@unique([deploymentId, relativePath])
  @@index([driveSiteId, deploymentId])
  @@index([sourceItemId])
}
```

Create migration SQL in `server/prisma/migrations/<timestamp>_drive_sites/migration.sql` matching those tables and indexes. Include foreign keys to `User`, `DriveSite`, and `DriveSiteDeployment`. Do not add a foreign key from `sourceFolderItemId` to `DriveItem`; source deletion must not affect site serving.

- [ ] **Step 5: Add site id token tests**

Add to `server/src/drive/drive-token.spec.ts`:

```ts
import { createDriveSiteId } from "./drive-token"

it("creates URL-safe Drive site ids", () => {
  expect(createDriveSiteId()).toMatch(/^site_[A-Za-z0-9_-]{32,}$/u)
})
```

- [ ] **Step 6: Implement site id generator**

Add to `server/src/drive/drive-token.ts`:

```ts
export function createDriveSiteId(): string {
  return `site_${randomBytes(24).toString("base64url")}`
}
```

If `randomBytes` is not already imported, add:

```ts
import { randomBytes } from "node:crypto"
```

- [ ] **Step 7: Run contract tests**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- drive-token.spec.ts
pnpm --filter @synapse/server exec prisma validate
```

Expected: all pass.

- [ ] **Step 8: Commit shared contracts and schema**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts server/prisma/schema.prisma server/prisma/migrations server/src/drive/drive-token.ts server/src/drive/drive-token.spec.ts
git commit -m "feat(drive): add site publishing contracts"
```

## Task 2: Server Site Publisher And Management Service

**Files:**
- Create: `server/src/drive/drive-site-path.ts`
- Create: `server/src/drive/drive-site-path.spec.ts`
- Create: `server/src/drive/drive-site.service.ts`
- Create: `server/src/drive/drive-site.service.spec.ts`
- Modify: `server/src/drive/drive.types.ts`
- Modify: `server/src/drive/drive.constants.ts`

- [ ] **Step 1: Write path helper tests**

Create `server/src/drive/drive-site-path.spec.ts`:

```ts
import { normalizeDriveSiteRelativePath, resolveDriveSiteRequestPath } from "./drive-site-path"

describe("Drive site path helpers", () => {
  it("normalizes safe slash-delimited paths", () => {
    expect(normalizeDriveSiteRelativePath("docs/index.html")).toBe("docs/index.html")
    expect(normalizeDriveSiteRelativePath("docs//guide.html")).toBe("docs/guide.html")
  })

  it("rejects unsafe paths", () => {
    for (const value of ["", "/index.html", "../secret.txt", "a/../b.html", "a\\b.html"]) {
      expect(() => normalizeDriveSiteRelativePath(value)).toThrow("站点路径无效。")
    }
  })

  it("resolves root and nested directory requests", () => {
    expect(resolveDriveSiteRequestPath("")).toEqual({ kind: "entry" })
    expect(resolveDriveSiteRequestPath("docs/")).toEqual({ kind: "asset", relativePath: "docs/index.html", directory: true })
    expect(resolveDriveSiteRequestPath("docs")).toEqual({ kind: "asset", relativePath: "docs", directory: false })
  })
})
```

- [ ] **Step 2: Implement path helpers**

Create `server/src/drive/drive-site-path.ts`:

```ts
export function normalizeDriveSiteRelativePath(input: string): string {
  const decoded = input.replaceAll("\\", "/")
  const segments = decoded.split("/").filter(Boolean)
  if (segments.length === 0 || decoded.startsWith("/")) throw new Error("站点路径无效。")
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("站点路径无效。")
  const normalized = segments.join("/")
  if (normalized.length > 1024) throw new Error("站点路径无效。")
  return normalized
}

export function resolveDriveSiteRequestPath(pathname: string):
  | { readonly kind: "entry" }
  | { readonly kind: "asset"; readonly relativePath: string; readonly directory: boolean } {
  const trimmed = pathname.replace(/^\/+/u, "")
  if (!trimmed) return { kind: "entry" }
  if (trimmed.endsWith("/")) {
    return { kind: "asset", relativePath: normalizeDriveSiteRelativePath(`${trimmed}index.html`), directory: true }
  }
  return { kind: "asset", relativePath: normalizeDriveSiteRelativePath(trimmed), directory: false }
}

export function isDriveSiteHtmlPath(pathname: string): boolean {
  return /\.html?$/iu.test(pathname)
}
```

- [ ] **Step 3: Add service tests for publishing semantics**

Create `server/src/drive/drive-site.service.spec.ts` with tests that build an in-memory Prisma stub using the existing Drive service test style. Cover these exact cases:

```ts
it("creates a site by copying active folder files into deployment assets", async () => {
  const result = await service.createSite("user-1", "https://synapse.test", {
    sourceFolderItemId: "folder-1",
    name: "原型",
    entryPath: null,
    accessMode: "password",
    password: "secret-123",
    expiresIn: "30d",
  })

  expect(result.siteId).toMatch(/^site_/u)
  expect(result.url).toContain("/sites/")
  expect(result.entryPath).toBe("index.html")
  expect(result.fileCount).toBe(3)
  expect(storage.copiedKeys()).toEqual([
    ["drive/index", expect.stringMatching(/^drive-sites\/site_/u)],
    ["drive/app", expect.stringMatching(/assets\/app\.js$/u)],
    ["drive/logo", expect.stringMatching(/assets\/logo\.png$/u)],
  ])
})

it("keeps an existing deployment active when republish copy fails", async () => {
  storage.failNextCopy("copy failed")
  await expect(service.republishSite("user-1", "site_existing", "https://synapse.test", { entryPath: "index.html" })).rejects.toThrow("copy failed")
  await expect(service.resolvePublicSite("site_existing", { cookie: null })).resolves.toMatchObject({
    status: "ok",
    asset: { relativePath: "index.html" },
  })
})
```

- [ ] **Step 4: Implement constants and DTO mapper**

Add to `server/src/drive/drive.constants.ts`:

```ts
export const DRIVE_SITE_STATUS = {
  active: "active",
  disabled: "disabled",
  failed: "failed",
  deleted: "deleted",
} as const

export const DRIVE_SITE_DEPLOYMENT_STATUS = {
  pending: "pending",
  active: "active",
  failed: "failed",
} as const

export const DRIVE_SITE_ACCESS_MODE = {
  public: "public",
  password: "password",
} as const
```

Add a mapper to `server/src/drive/drive.types.ts`:

```ts
import { buildDriveSiteUrl, type DriveSiteDto } from "@synapse/shared"

export function toDriveSiteDto(site: {
  readonly id: string
  readonly siteId: string
  readonly name: string
  readonly status: string
  readonly accessMode: string
  readonly expiresAt: Date | null
  readonly sourceFolderItemId: string | null
  readonly sourceFolderName: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly currentDeployment?: {
    readonly entryPath: string
    readonly fileCount: number
    readonly totalBytes: bigint
    readonly activatedAt: Date | null
  } | null
}, publicAppUrl: string): DriveSiteDto {
  const expired = site.expiresAt !== null && site.expiresAt.getTime() <= Date.now()
  return {
    id: site.id,
    siteId: site.siteId,
    name: site.name,
    status: expired && site.status === "active" ? "expired" : site.status as DriveSiteDto["status"],
    accessMode: site.accessMode as DriveSiteDto["accessMode"],
    url: buildDriveSiteUrl({ publicAppUrl, siteId: site.siteId }),
    expiresAt: site.expiresAt?.toISOString() ?? null,
    sourceFolderItemId: site.sourceFolderItemId,
    sourceFolderName: site.sourceFolderName,
    entryPath: site.currentDeployment?.entryPath ?? null,
    fileCount: site.currentDeployment?.fileCount ?? 0,
    totalBytes: (site.currentDeployment?.totalBytes ?? 0n).toString(),
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
    lastPublishedAt: site.currentDeployment?.activatedAt?.toISOString() ?? null,
  }
}
```

- [ ] **Step 5: Implement `DriveSiteService`**

Create `server/src/drive/drive-site.service.ts` with this public API:

```ts
@Injectable()
export class DriveSiteService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
  ) {}

  async preflightSite(userId: string, sourceFolderItemId: string): Promise<DriveSitePreflightDto> {}
  async createSite(userId: string, publicAppUrl: string, input: DriveSiteCreateInput): Promise<DriveSiteDto> {}
  async listSites(userId: string, publicAppUrl: string, input: DriveSiteListInput = {}): Promise<DriveSiteListPageDto> {}
  async updateSiteAccess(userId: string, siteId: string, publicAppUrl: string, input: DriveSiteAccessUpdateInput): Promise<DriveSiteDto> {}
  async disableSite(userId: string, siteId: string, publicAppUrl: string): Promise<DriveSiteDto> {}
  async enableSite(userId: string, siteId: string, publicAppUrl: string): Promise<DriveSiteDto> {}
  async deleteSite(userId: string, siteId: string): Promise<{ ok: true }> {}
  async republishSite(userId: string, siteId: string, publicAppUrl: string, input: { readonly entryPath?: string | null }): Promise<DriveSiteDto> {}
  async resolvePublicSite(siteId: string, input: { readonly cookie: string | null; readonly relativePath?: string }): Promise<DriveResolvedSiteAccess> {}
}
```

Implementation rules:

- Use `bcryptjs` for password hashing and comparison, matching current server dependencies.
- Calculate `expiresAt` from the existing `DriveAccessExpiresIn` values: `3d`, `7d`, `30d`, `1y`, `forever`.
- Gather the recursive Drive file tree from `DriveItem` rows owned by `userId` where `lifecycleStatus = active`.
- Only include files with `storageKey`, `storageStatus = active`, and `uploadStatus = completed`.
- Normalize relative paths with `normalizeDriveSiteRelativePath`.
- Prefer root `index.html` when `entryPath` is empty.
- Copy each object to `drive-sites/<siteId>/<deploymentId>/<relativePath>`.
- Create a failed deployment row and leave `currentDeploymentId` unchanged if copying fails.

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive-site-path.spec.ts drive-site.service.spec.ts
```

Expected: pass.

- [ ] **Step 7: Commit server publisher**

```bash
git add server/src/drive/drive-site-path.ts server/src/drive/drive-site-path.spec.ts server/src/drive/drive-site.service.ts server/src/drive/drive-site.service.spec.ts server/src/drive/drive.types.ts server/src/drive/drive.constants.ts
git commit -m "feat(drive): add site publisher service"
```

## Task 3: Server APIs And Public `/sites` Routes

**Files:**
- Create: `server/src/drive/drive-site-public.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`
- Modify: `server/src/drive/drive.module.ts`

- [ ] **Step 1: Add controller tests**

Add tests to `server/src/drive/drive.controller.spec.ts`:

```ts
it("creates a Drive site through the authenticated Drive API", async () => {
  const response = await request(app!.getHttpServer())
    .post("/api/drive/sites")
    .set(authHeader())
    .send({
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      entryPath: null,
      accessMode: "public",
      expiresIn: "forever",
    })
    .expect(201)

  expect(response.body.siteId).toMatch(/^site_/u)
  expect(response.body.url).toContain("/sites/")
})

it("serves nested static site assets from the copied deployment", async () => {
  await request(app!.getHttpServer()).get("/sites/site_public/").expect(200).expect("Content-Type", /text\/html/u)
  await request(app!.getHttpServer()).get("/sites/site_public/assets/app.css").expect(200).expect("Content-Type", /text\/css/u)
})

it("does not leak protected static assets without a site cookie", async () => {
  await request(app!.getHttpServer()).get("/sites/site_secret/assets/app.js").expect(404)
})
```

- [ ] **Step 2: Add public helpers**

Create `server/src/drive/drive-site-public.ts`:

```ts
export function driveSiteContentType(relativePath: string, storedContentType?: string | null): string {
  if (storedContentType) return storedContentType
  const lower = relativePath.toLowerCase()
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8"
  if (lower.endsWith(".css")) return "text/css; charset=utf-8"
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (lower.endsWith(".json")) return "application/json; charset=utf-8"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".ico")) return "image/x-icon"
  if (lower.endsWith(".woff")) return "font/woff"
  if (lower.endsWith(".woff2")) return "font/woff2"
  return "application/octet-stream"
}

export function renderDriveSiteNotFoundPage(): string {
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>站点不可访问</title></head><body>站点不可访问</body></html>"
}
```

- [ ] **Step 3: Register service in module**

Modify `server/src/drive/drive.module.ts`:

```ts
import { DriveSiteService } from "./drive-site.service"
```

Then insert `DriveSiteService` in the existing `providers` array immediately after `DrivePublicAssetService`, and insert it in the existing `exports` array immediately after `DrivePublicAssetService`:

```ts
DrivePublicAssetService,
DriveSiteService,
DriveService,
```

```ts
exports: [DriveService, DriveLifecycleService, DrivePublicAssetService, DriveSiteService, DriveAnnotationService],
```

- [ ] **Step 4: Add user API routes**

In `DriveUserController` in `server/src/drive/drive.controller.ts`, inject `DriveSiteService` and add:

```ts
@Get("/sites/preflight")
preflightSite(@Query("sourceFolderItemId") sourceFolderItemId: string, @Req() request: AuthenticatedUserRequest) {
  return this.sites.preflightSite(request.user!.id, sourceFolderItemId)
}

@Post("/sites")
createSite(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const parsed = parseBody(driveSiteCreateSchema, body, "站点发布请求无效。")
  return this.sites.createSite(request.user!.id, resolveRequestPublicAppUrl(request), parsed)
}

@Get("/sites")
listSites(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {
  return this.sites.listSites(request.user!.id, resolveRequestPublicAppUrl(request), parseDriveSiteListQuery(query))
}

@Patch("/sites/:siteId/access")
updateSiteAccess(@Param("siteId") siteId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const parsed = parseBody(driveSiteAccessUpdateSchema, body, "站点访问设置无效。")
  return this.sites.updateSiteAccess(request.user!.id, siteId, resolveRequestPublicAppUrl(request), parsed)
}

@Post("/sites/:siteId/disable")
disableSite(@Param("siteId") siteId: string, @Req() request: AuthenticatedUserRequest) {
  return this.sites.disableSite(request.user!.id, siteId, resolveRequestPublicAppUrl(request))
}

@Post("/sites/:siteId/enable")
enableSite(@Param("siteId") siteId: string, @Req() request: AuthenticatedUserRequest) {
  return this.sites.enableSite(request.user!.id, siteId, resolveRequestPublicAppUrl(request))
}

@Post("/sites/:siteId/republish")
republishSite(@Param("siteId") siteId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const parsed = parseBody(driveSiteRepublishSchema, body, "站点重新发布请求无效。")
  return this.sites.republishSite(request.user!.id, siteId, resolveRequestPublicAppUrl(request), parsed)
}

@Delete("/sites/:siteId")
deleteSite(@Param("siteId") siteId: string, @Req() request: AuthenticatedUserRequest) {
  return this.sites.deleteSite(request.user!.id, siteId)
}
```

Add matching Zod schemas near existing Drive schemas:

```ts
const driveSiteCreateSchema = z.object({
  sourceFolderItemId: z.string().min(1),
  name: z.string().min(1).max(255),
  entryPath: z.string().min(1).max(1024).nullable().optional(),
  accessMode: z.enum(["public", "password"]),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
}).strict()

const driveSiteAccessUpdateSchema = z.object({
  accessMode: z.enum(["public", "password"]),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
}).strict()

const driveSiteRepublishSchema = z.object({
  entryPath: z.string().min(1).max(1024).nullable().optional(),
}).strict()
```

- [ ] **Step 5: Add public site routes**

In `DrivePublicController`, inject `DriveSiteService` and add:

```ts
@Get("/sites/:siteId")
async redirectSiteRoot(@Param("siteId") siteId: string, @Res() response: Response) {
  response.redirect(302, `/sites/${encodeURIComponent(siteId)}/`)
}

@Get("/sites/:siteId/*path")
async serveSite(@Param("siteId") siteId: string, @Param("path") pathSegments: string[] | string | undefined, @Req() request: Request, @Res() response: Response) {
  const relativePath = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments ?? ""
  const access = await this.sites.resolvePublicSite(siteId, {
    cookie: readDriveAccessCookie(request, { kind: "site", publicId: siteId }),
    relativePath,
  })
  if (access.status === "password_required") {
    response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
    return
  }
  if (access.status !== "ok") {
    response.status(404).type("html").send(renderDriveSiteNotFoundPage())
    return
  }
  const object = await this.storage.getObjectStream({ key: access.asset.storageKey })
  response.type(driveSiteContentType(access.asset.relativePath, object.contentType ?? access.asset.contentType))
  response.setHeader("Cache-Control", access.asset.relativePath.endsWith(".html") ? "no-cache" : "public, max-age=300")
  await pipeline(object.stream, response)
}
```

Extend `DriveAccessCookieKind` to include `"site"` and make `setDriveAccessCookie`/`readDriveAccessCookie` accept it.

- [ ] **Step 6: Run server API tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts drive-site.service.spec.ts drive-site-path.spec.ts
pnpm --filter @synapse/server typecheck
```

Expected: pass.

- [ ] **Step 7: Commit server routes**

```bash
git add server/src/drive/drive-site-public.ts server/src/drive/drive.controller.ts server/src/drive/drive.controller.spec.ts server/src/drive/drive.module.ts
git commit -m "feat(drive): serve published sites"
```

## Task 4: Desktop Account Bridge And IPC

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/types/__tests__/account.test.ts`

- [ ] **Step 1: Add account service tests**

Add to `desktop/electron/services/__tests__/account-service.test.ts`:

```ts
it("calls Drive site APIs and rewrites URLs to the configured public app URL", async () => {
  const site = createDriveSite({ siteId: "site_abc", url: "https://server.example/sites/site_abc/" })
  mockJsonResponse("/drive/sites", site)

  await expect(service.createDriveSite({
    sourceFolderItemId: "folder-1",
    name: "产品原型",
    entryPath: null,
    accessMode: "public",
    expiresIn: "forever",
  })).resolves.toMatchObject({
    siteId: "site_abc",
    url: `${expectedPublicAppUrl}/sites/site_abc/`,
  })
})
```

- [ ] **Step 2: Add bridge type imports and methods**

In `desktop/src/types/bridge.ts`, import site shared types:

```ts
DriveSiteAccessUpdateInput,
DriveSiteCreateInput,
DriveSiteDto,
DriveSiteListInput,
DriveSiteListPageDto,
DriveSitePreflightDto,
```

Add methods under `account`:

```ts
preflightDriveSite: (input: { sourceFolderItemId: string }) => Promise<DriveSitePreflightDto>
createDriveSite: (input: DriveSiteCreateInput) => Promise<DriveSiteDto>
listDriveSites: (input?: DriveSiteListInput) => Promise<DriveSiteListPageDto>
updateDriveSiteAccess: (input: { siteId: string } & DriveSiteAccessUpdateInput) => Promise<DriveSiteDto>
disableDriveSite: (input: { siteId: string }) => Promise<DriveSiteDto>
enableDriveSite: (input: { siteId: string }) => Promise<DriveSiteDto>
deleteDriveSite: (input: { siteId: string }) => Promise<{ ok: true }>
republishDriveSite: (input: { siteId: string; entryPath?: string | null }) => Promise<DriveSiteDto>
```

- [ ] **Step 3: Implement account service calls**

In `desktop/electron/services/account-service.ts`, import site types and add methods:

```ts
async preflightDriveSite(input: { readonly sourceFolderItemId: string }): Promise<DriveSitePreflightDto> {
  const query = new URLSearchParams({ sourceFolderItemId: input.sourceFolderItemId })
  return this.getAuthenticatedJson<DriveSitePreflightDto>(`${apiBaseUrl()}/drive/sites/preflight?${query}`, "站点预检失败。")
}

async createDriveSite(input: DriveSiteCreateInput): Promise<DriveSiteDto> {
  return withCurrentDriveSiteUrl(await this.requestAuthenticatedJson<DriveSiteDto>("POST", `${apiBaseUrl()}/drive/sites`, input, "站点发布失败。"))
}

async listDriveSites(input?: DriveSiteListInput): Promise<DriveSiteListPageDto> {
  const query = new URLSearchParams()
  if (input?.offset !== undefined) query.set("offset", String(input.offset))
  if (input?.limit !== undefined) query.set("limit", String(input.limit))
  if (input?.search) query.set("search", input.search)
  if (input?.status && input.status !== "all") query.set("status", input.status)
  const suffix = query.size > 0 ? `?${query}` : ""
  const result = await this.getAuthenticatedJson<DriveSiteListPageDto>(`${apiBaseUrl()}/drive/sites${suffix}`, "站点列表加载失败。")
  return { ...result, items: result.items.map(rewriteDriveSiteUrl) }
}
```

Add helper:

```ts
function rewriteDriveSiteUrl<T extends { readonly siteId: string; readonly url: string }>(site: T): T {
  return { ...site, url: `${publicAppUrl().trim().replace(/\/+$/u, "")}/sites/${encodeURIComponent(site.siteId)}/` }
}
```

Implement update, disable, enable, delete, and republish with the same endpoint paths from Task 3.

- [ ] **Step 4: Add IPC schemas and handlers**

In `desktop/electron/modules/account/ipc.ts`, add Zod schemas:

```ts
const driveSiteIdSchema = z.object({ siteId: z.string().min(1) })
const driveSitePreflightSchema = z.object({ sourceFolderItemId: z.string().min(1) })
const driveSiteCreateSchema = z.object({
  sourceFolderItemId: z.string().min(1),
  name: z.string().min(1),
  entryPath: z.string().nullable().optional(),
  accessMode: z.enum(["public", "password"]),
  password: z.string().nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
})
const driveSiteAccessUpdateSchema = driveSiteIdSchema.extend({
  accessMode: z.enum(["public", "password"]),
  password: z.string().nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
})
const driveSiteListSchema = z.object({
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  search: z.string().optional(),
  status: z.enum(["active", "disabled", "expired", "deleted", "failed", "all"]).optional(),
}).strict().optional()
const driveSiteRepublishSchema = driveSiteIdSchema.extend({ entryPath: z.string().nullable().optional() })
```

Add handlers under `account`:

```ts
preflightDriveSite: {
  kind: "invoke",
  input: driveSitePreflightSchema,
  output: z.any(),
  handler: async (_ctx, input) => accountService.preflightDriveSite(driveSitePreflightSchema.parse(input)),
},
createDriveSite: {
  kind: "invoke",
  input: driveSiteCreateSchema,
  output: z.any(),
  handler: async (_ctx, input) => accountService.createDriveSite(driveSiteCreateSchema.parse(input)),
},
```

Add the remaining handlers with the corresponding account service methods.

- [ ] **Step 5: Run bridge tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- account-service.test.ts ipc.test.ts account.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: pass.

- [ ] **Step 6: Commit bridge layer**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/src/types/bridge.ts desktop/src/types/__tests__/account.test.ts
git commit -m "feat(drive): expose site APIs to desktop"
```

## Task 5: Drive Renderer UI

**Files:**
- Create: `desktop/src/modules/drive/drive-site-create-dialog.tsx`
- Create: `desktop/src/modules/drive/drive-sites-dialog.tsx`
- Modify: `desktop/src/modules/drive/drive-table-columns.tsx`
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Add renderer tests**

Add tests to `desktop/src/modules/drive/__tests__/drive-module.test.tsx`:

```tsx
it("shows publish site only for folder rows", async () => {
  mockDriveItems([
    createDriveItem({ id: "folder-1", type: "folder", name: "原型" }),
    createDriveItem({ id: "file-1", type: "file", name: "index.html", mimeType: "text/html" }),
  ])
  renderDriveModule()

  expect(await rowButton("原型", "更多")).toBeTruthy()
  await openRowMenu("原型")
  expect(screen.getByText("发布站点")).toBeTruthy()

  await openRowMenu("index.html")
  expect(screen.queryByText("发布站点")).toBeNull()
})

it("opens the site management dialog from the Drive top bar", async () => {
  mocks.listDriveSites.mockResolvedValue(createDriveSitePage([]))
  renderDriveModule()
  await userEvent.click(screen.getByRole("button", { name: "站点" }))
  expect(await screen.findByRole("dialog", { name: "站点" })).toBeTruthy()
  expect(mocks.listDriveSites).toHaveBeenCalledWith({ offset: 0, limit: 50 })
})
```

- [ ] **Step 2: Create site creation dialog**

Create `desktop/src/modules/drive/drive-site-create-dialog.tsx` with props:

```ts
type DriveSiteCreateDialogProps = {
  readonly folder: DriveItemDto | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onCreated: (site: DriveSiteDto) => void
}
```

Behavior:

- On open, call `requireSynapseBridge().account.preflightDriveSite({ sourceFolderItemId: folder.id })`.
- Default `name` to `folder.name`.
- Default `entryPath` to `preflight.defaultEntryPath`.
- Show an HTML select when multiple HTML files are present or default entry is null.
- Disable submit when no HTML files exist.
- Use existing `Dialog`, `Input`, `Label`, `Button`, `ToggleGroup`, and `Switch` components.
- Do not use inline styles or custom colors.
- Submit calls `createDriveSite`.
- Completion state shows the created URL with copy and open buttons.

- [ ] **Step 3: Create site management dialog**

Create `desktop/src/modules/drive/drive-sites-dialog.tsx` with props:

```ts
type DriveSitesDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}
```

Behavior:

- On open, call `listDriveSites({ offset: 0, limit: 50 })`.
- Render a large `DialogContent` with `max-w-5xl`, `max-h-[85vh]`, and a scrollable table body using existing utility classes only.
- Table columns: site, status, access, expires, updated, size, actions.
- Use `DriveTableColumns` with `DRIVE_SITE_TABLE_COLUMNS`.
- Put row actions in one `DropdownMenu`.
- Confirm disable and delete with existing `AlertDialog`.
- Access settings action opens a compact nested dialog or reuses a local panel in the same dialog.

- [ ] **Step 4: Add table columns**

Modify `desktop/src/modules/drive/drive-table-columns.tsx`:

```ts
const DRIVE_SITE_TABLE_COLUMNS = ["w-auto", "w-24", "w-24", "w-36", "w-36", "w-28", "w-16"] as const
```

Export `DRIVE_SITE_TABLE_COLUMNS`.

- [ ] **Step 5: Wire dialogs into Drive module**

In `desktop/src/modules/drive/index.tsx`:

- Add `Globe2` or `PanelTop` icon from `lucide-react`.
- Add state:

```ts
const [siteCreateTarget, setSiteCreateTarget] = useState<DriveItemDto | null>(null)
const [sitesOpen, setSitesOpen] = useState(false)
```

- Add top bar button:

```tsx
<Button type="button" variant="outline" size="sm" onClick={() => setSitesOpen(true)}>
  <Globe2 className="size-4" />
  站点
</Button>
```

- Add folder row action only when `item.type === "folder"`:

```tsx
<DropdownMenuItem onClick={() => setSiteCreateTarget(item)}>
  发布站点
</DropdownMenuItem>
```

- Render:

```tsx
<DriveSiteCreateDialog
  folder={siteCreateTarget}
  open={siteCreateTarget !== null}
  onOpenChange={(open) => { if (!open) setSiteCreateTarget(null) }}
  onCreated={() => setSitesOpen(true)}
/>
<DriveSitesDialog open={sitesOpen} onOpenChange={setSitesOpen} />
```

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-module.test.tsx
pnpm --filter @synapse/desktop typecheck
```

Expected: pass.

- [ ] **Step 7: Commit renderer UI**

```bash
git add desktop/src/modules/drive/drive-site-create-dialog.tsx desktop/src/modules/drive/drive-sites-dialog.tsx desktop/src/modules/drive/drive-table-columns.tsx desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): add site publishing UI"
```

## Task 6: MCP Capabilities, Built-In Skill, And Release Notes

**Files:**
- Modify: `desktop/synapse-capabilities/shared/drive-domain.ts`
- Modify: `desktop/electron/capabilities/drive-dispatcher.ts`
- Modify: `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`
- Modify: `desktop/electron/services/__tests__/repository-template-service.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add capability tests**

Add to `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`:

```ts
it("dispatches Drive site creation separately from share creation", async () => {
  account.createDriveSite.mockResolvedValue(createDriveSite({ siteId: "site_abc" }))

  await expect(dispatcher.dispatch({
    actionId: "drive.site.create",
    input: {
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      accessMode: "public",
      expiresIn: "forever",
    },
  })).resolves.toMatchObject({ siteId: "site_abc" })

  expect(account.shareDriveItem).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Add Drive site capability definitions**

In `desktop/synapse-capabilities/shared/drive-domain.ts`, add actions:

```ts
{ id: "drive.site.create" as CapabilityId, title: "Create Drive site", description: "Publish a Drive folder as an independent read-only static site at /sites/<siteId>/.", mutates: true },
{ id: "drive.site.list" as CapabilityId, title: "List Drive sites", description: "List current user's Drive-published static sites.", mutates: false },
{ id: "drive.site.update_access" as CapabilityId, title: "Update Drive site access", description: "Update password and expiry settings for a Drive-published site without changing Drive shares.", mutates: true },
{ id: "drive.site.disable" as CapabilityId, title: "Disable Drive site", description: "Disable public access to a Drive-published site while keeping its record and deployment.", mutates: true },
{ id: "drive.site.delete" as CapabilityId, title: "Delete Drive site", description: "Delete a Drive-published site and make its /sites/<siteId>/ URL inaccessible.", mutates: true },
{ id: "drive.site.republish" as CapabilityId, title: "Republish Drive site", description: "Copy the remembered source folder into a new site deployment and switch only after success.", mutates: true },
```

Add MCP tools named:

- `drive_site_create`
- `drive_site_list`
- `drive_site_update_access`
- `drive_site_disable`
- `drive_site_delete`
- `drive_site_republish`

- [ ] **Step 3: Dispatch to account bridge**

In `desktop/electron/capabilities/drive-dispatcher.ts`, map the new actions to account service methods. Keep destructive actions guarded by existing dispatcher confirmation conventions.

- [ ] **Step 4: Update consolidated built-in skill docs**

In `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`, add concise guidance:

```md
If the user asks to publish a Drive folder as a static website or multi-page HTML prototype, use Drive site tools. Sites use `/sites/<siteId>/`, are copied from the folder at publish time, and do not grant Drive edit or folder-browse access.
```

In `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`, add a `Drive Site Tools` section documenting each tool input and the distinction from shares and public assets.

- [ ] **Step 5: Update release notes**

Append to `RELEASE_NOTES_PENDING.md`:

```md
- 云盘新增文件夹发布站点设计与能力入口：可以把包含多个 HTML、CSS、JS 和图片资源的文件夹复制发布为独立静态站点，站点访问与云盘分享、编辑权限分离。
```

- [ ] **Step 6: Run capability and docs tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- drive-dispatcher.test.ts repository-template-service.test.ts
pnpm --filter @synapse/desktop typecheck
```

Expected: pass.

- [ ] **Step 7: Commit capabilities and docs**

```bash
git add desktop/synapse-capabilities/shared/drive-domain.ts desktop/electron/capabilities/drive-dispatcher.ts desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts desktop/resources/templates/skills/synapse-skill/files/drive/index.md desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md desktop/electron/services/__tests__/repository-template-service.test.ts RELEASE_NOTES_PENDING.md
git commit -m "feat(drive): document site publishing tools"
```

## Task 7: End-To-End Verification

**Files:**
- Read: `docs/superpowers/specs/2026-06-23-drive-site-publishing-design.md`
- Read: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Run targeted test suites**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- drive-site-path.spec.ts drive-site.service.spec.ts drive.controller.spec.ts
pnpm --filter @synapse/desktop test -- account-service.test.ts ipc.test.ts drive-module.test.tsx drive-dispatcher.test.ts repository-template-service.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run type checks**

Run:

```bash
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/desktop typecheck
```

Expected: both pass.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass. If it flags UI styles, remove custom colors, inline styles, nested cards, or text overflow risks.

- [ ] **Step 4: Manual browser check if a dev server is already running**

Only if the app/server is already running, create a folder with:

```text
index.html
about.html
assets/app.css
assets/app.js
assets/logo.png
```

Publish the folder from the Drive row menu and verify:

- `/sites/<siteId>/` opens `index.html`.
- Link to `about.html` works.
- CSS, JS, and image load from relative paths.
- Password mode blocks asset access before unlock.
- Source folder deletion does not break the site.
- Site management modal scrolls without horizontal overflow.

- [ ] **Step 5: Final commit if verification caused fixes**

If verification required edits:

```bash
git add <changed-files>
git commit -m "fix(drive): stabilize site publishing"
```

If no edits were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan includes folder menu creation, one-way copy, independent management modal, `/sites/<siteId>/` serving, relative static assets, password/expiry, source deletion survival, republish failure safety, MCP docs, and release notes.
- Placeholder scan: No open implementation blanks remain in task steps.
- Type consistency: Shared names use `DriveSite*`, public identity is `siteId`, database foreign key is `driveSiteId`, and desktop bridge methods use `DriveSiteCreateInput`, `DriveSiteAccessUpdateInput`, `DriveSiteDto`, `DriveSiteListInput`, `DriveSiteListPageDto`, and `DriveSitePreflightDto`.
