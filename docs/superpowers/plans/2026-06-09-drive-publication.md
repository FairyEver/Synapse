# Drive HTML Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add snapshot-based HTML page and static site publishing to Synapse Drive, separate from existing share links.

**Architecture:** Add a `Publication + Deployment + Asset` model on the server, snapshot source Drive objects into a private publication prefix, and serve public page/site URLs through the Synapse server proxy. Desktop Drive UI exposes row-level publish actions plus top-bar share/publication management, while deletion flows can optionally disable affected active publications.

**Tech Stack:** NestJS, Prisma, Tencent COS storage abstraction, Electron IPC/preload bridge, React, shadcn/Radix UI, TypeScript, Vitest.

---

## File Structure

Server:

- Modify `server/prisma/schema.prisma` with `DrivePublication`, `DrivePublicationDeployment`, and `DrivePublicationAsset`.
- Create `server/prisma/migrations/20260609000000_drive_publications/migration.sql`.
- Modify `server/src/drive/drive.constants.ts` with publication type/status constants and public route prefixes.
- Modify `server/src/drive/drive-token.ts` with `createDrivePublishId()` and publication storage key helpers.
- Modify `server/src/drive/drive-storage.ts` to add `copyObject()` and `getObjectStream()` to `DriveStoragePort`, with local and COS implementations.
- Modify `server/src/drive/drive.types.ts` with publication DTOs, share list DTOs, and delete impact DTOs.
- Modify `server/src/drive/drive.service.ts` with publication creation, redeploy, disable, list, delete-impact, and public asset resolution.
- Modify `server/src/drive/drive.controller.ts` with authenticated publication APIs, delete impact, body parsing for delete options, share listing, and public page/site routes.
- Modify `server/src/app.module.ts` only if controller/module registration changes are required by existing module shape.
- Test in `server/src/drive/drive-token.spec.ts`, `server/src/drive/drive-storage.spec.ts`, `server/src/drive/drive.service.spec.ts`, and `server/src/drive/drive.controller.spec.ts`.

Shared:

- Modify `shared/src/drive.ts` with `DrivePublicationDto`, `DriveDeleteImpactDto`, `DriveShareListItemDto`, URL builders, and URL masking.
- Modify `shared/src/drive.test.ts`.

Desktop Electron:

- Modify `desktop/src/types/bridge.ts` with new account bridge methods.
- Modify `desktop/electron/modules/account/ipc.ts` with request/response schemas and handlers.
- Modify `desktop/electron/preload.ts` and regenerate `desktop/electron/generated/ipc-channels.generated.ts`.
- Modify `desktop/electron/services/account-service.ts` with REST client methods.
- Modify tests in `desktop/electron/modules/account/__tests__/ipc.test.ts`, `desktop/electron/__tests__/preload.test.ts`, and `desktop/electron/services/__tests__/account-service.test.ts`.

Desktop Renderer:

- Modify `desktop/src/modules/drive/index.tsx` surgically. Keep the existing single-module pattern unless implementation becomes too large.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`.

Dashboard:

- No first-version dashboard UI change is required. If server admin DTOs need type additions, keep dashboard compatible with existing rows.

Docs:

- Modify `RELEASE_NOTES_PENDING.md` with a user-facing summary after implementation.

---

## Task 1: Shared Publication Contracts

**Files:**

- Modify: `shared/src/drive.ts`
- Test: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared URL and DTO tests**

Add tests to `shared/src/drive.test.ts`:

```ts
it("builds public drive page publication URLs", () => {
  expect(buildDrivePublicationUrl({
    publicAppUrl: "https://synapse.d2.pub/",
    publishId: "pub_abc",
    type: "page",
  })).toBe("https://synapse.d2.pub/pages/pub_abc")
})

it("builds public drive site publication URLs", () => {
  expect(buildDrivePublicationUrl({
    publicAppUrl: "https://synapse.d2.pub",
    publishId: "pub_a/b",
    type: "site",
  })).toBe("https://synapse.d2.pub/sites/pub_a%2Fb/")
})

it("masks drive publication URLs for logs", () => {
  expect(maskDrivePublicUrl("https://synapse.d2.pub/pages/pub_secret"))
    .toBe("https://synapse.d2.pub/pages/***")
  expect(maskDrivePublicUrl("https://synapse.d2.pub/sites/pub_secret/app.js"))
    .toBe("https://synapse.d2.pub/sites/***/app.js")
})
```

- [ ] **Step 2: Run the failing shared tests**

Run:

```bash
pnpm --filter @synapse/shared run test -- drive.test.ts
```

Expected: FAIL because `buildDrivePublicationUrl` and `maskDrivePublicUrl` do not exist.

- [ ] **Step 3: Add shared publication types and helpers**

Add to `shared/src/drive.ts`:

```ts
export const DRIVE_PAGE_PUBLIC_PATH_PREFIX = "/pages"
export const DRIVE_SITE_PUBLIC_PATH_PREFIX = "/sites"

export type DrivePublicationType = "page" | "site"
export type DrivePublicationStatus = "active" | "disabled"

export interface DrivePublicationDto {
  readonly id: string
  readonly publishId: string
  readonly type: DrivePublicationType
  readonly name: string
  readonly status: DrivePublicationStatus
  readonly sourceItemId: string | null
  readonly sourceDeleted: boolean
  readonly url: string
  readonly currentDeploymentId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DriveDeleteImpactDto {
  readonly publications: DrivePublicationDto[]
}

export type DriveShareItemType = "file" | "folder"

export interface DriveShareListItemDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly itemName: string
  readonly itemType: DriveShareItemType
  readonly sourceDeleted: boolean
  readonly url: string
  readonly createdAt: string
}

export function buildDrivePublicationUrl(input: {
  readonly publicAppUrl: string
  readonly publishId: string
  readonly type: DrivePublicationType
}): string {
  const base = normalizePublicAppUrl(input.publicAppUrl)
  const encoded = encodeURIComponent(input.publishId)
  return input.type === "site"
    ? `${base}${DRIVE_SITE_PUBLIC_PATH_PREFIX}/${encoded}/`
    : `${base}${DRIVE_PAGE_PUBLIC_PATH_PREFIX}/${encoded}`
}

export function maskDrivePublicUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 3 && (parts[1] === "pages" || parts[1] === "sites")) {
      parts[2] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return value
      .replace(/\/pages\/[^/?#]+/u, "/pages/***")
      .replace(/\/sites\/[^/?#]+/u, "/sites/***")
  }
  return value
    .replace(/\/pages\/[^/?#]+/u, "/pages/***")
    .replace(/\/sites\/[^/?#]+/u, "/sites/***")
}
```

- [ ] **Step 4: Run shared tests**

Run:

```bash
pnpm --filter @synapse/shared run test -- drive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared contracts**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(shared): add drive publication contracts"
```

---

## Task 2: Prisma Publication Schema

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260609000000_drive_publications/migration.sql`

- [ ] **Step 1: Add Prisma models**

Append after `DriveUploadSession` in `server/prisma/schema.prisma`:

```prisma
model DrivePublication {
  id                  String                       @id @default(cuid())
  publishId           String                       @unique
  userId              String
  user                User                         @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceItemId         String?
  sourceItem           DriveItem?                  @relation(fields: [sourceItemId], references: [id], onDelete: SetNull)
  type                String                       @db.VarChar(16)
  name                String                       @db.VarChar(255)
  status              String                       @db.VarChar(32)
  currentDeploymentId String?
  currentDeployment   DrivePublicationDeployment?  @relation("CurrentPublicationDeployment", fields: [currentDeploymentId], references: [id], onDelete: SetNull)
  createdAt           DateTime                     @default(now())
  updatedAt           DateTime                     @updatedAt
  disabledAt          DateTime?
  deployments         DrivePublicationDeployment[] @relation("PublicationDeployments")
  assets              DrivePublicationAsset[]

  @@index([userId, createdAt])
  @@index([sourceItemId, status])
  @@index([status])
}

model DrivePublicationDeployment {
  id                    String                    @id @default(cuid())
  publicationId          String
  publication            DrivePublication          @relation("PublicationDeployments", fields: [publicationId], references: [id], onDelete: Cascade)
  currentForPublications DrivePublication[]        @relation("CurrentPublicationDeployment")
  status                 String                    @db.VarChar(32)
  createdAt              DateTime                  @default(now())
  activatedAt            DateTime?
  error                  String?
  assets                 DrivePublicationAsset[]

  @@index([publicationId, createdAt])
  @@index([status])
}

model DrivePublicationAsset {
  id            String                     @id @default(cuid())
  publicationId String
  publication   DrivePublication           @relation(fields: [publicationId], references: [id], onDelete: Cascade)
  deploymentId  String
  deployment    DrivePublicationDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)
  sourceItemId  String?
  sourceItem    DriveItem?                  @relation(fields: [sourceItemId], references: [id], onDelete: SetNull)
  relativePath  String                     @db.VarChar(1024)
  storageKey    String                     @unique
  contentType   String?                    @db.VarChar(255)
  size          BigInt
  sha256        String?                    @db.VarChar(64)

  @@unique([deploymentId, relativePath])
  @@index([sourceItemId])
  @@index([publicationId, deploymentId])
}
```

Add relation fields to `User`:

```prisma
  drivePublications DrivePublication[]
```

Add relation fields to `DriveItem`:

```prisma
  publications       DrivePublication[]
  publicationAssets  DrivePublicationAsset[]
```

- [ ] **Step 2: Create migration SQL**

Create `server/prisma/migrations/20260609000000_drive_publications/migration.sql`:

```sql
CREATE TABLE "DrivePublication" (
  "id" TEXT NOT NULL,
  "publishId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "type" VARCHAR(16) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "currentDeploymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "DrivePublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DrivePublicationDeployment" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "DrivePublicationDeployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DrivePublicationAsset" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "relativePath" VARCHAR(1024) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentType" VARCHAR(255),
  "size" BIGINT NOT NULL,
  "sha256" VARCHAR(64),
  CONSTRAINT "DrivePublicationAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DrivePublication_publishId_key" ON "DrivePublication"("publishId");
CREATE INDEX "DrivePublication_userId_createdAt_idx" ON "DrivePublication"("userId", "createdAt");
CREATE INDEX "DrivePublication_sourceItemId_status_idx" ON "DrivePublication"("sourceItemId", "status");
CREATE INDEX "DrivePublication_status_idx" ON "DrivePublication"("status");
CREATE INDEX "DrivePublicationDeployment_publicationId_createdAt_idx" ON "DrivePublicationDeployment"("publicationId", "createdAt");
CREATE INDEX "DrivePublicationDeployment_status_idx" ON "DrivePublicationDeployment"("status");
CREATE UNIQUE INDEX "DrivePublicationAsset_storageKey_key" ON "DrivePublicationAsset"("storageKey");
CREATE UNIQUE INDEX "DrivePublicationAsset_deploymentId_relativePath_key" ON "DrivePublicationAsset"("deploymentId", "relativePath");
CREATE INDEX "DrivePublicationAsset_sourceItemId_idx" ON "DrivePublicationAsset"("sourceItemId");
CREATE INDEX "DrivePublicationAsset_publicationId_deploymentId_idx" ON "DrivePublicationAsset"("publicationId", "deploymentId");

ALTER TABLE "DrivePublication" ADD CONSTRAINT "DrivePublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublication" ADD CONSTRAINT "DrivePublication_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DriveItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DrivePublication" ADD CONSTRAINT "DrivePublication_currentDeploymentId_fkey" FOREIGN KEY ("currentDeploymentId") REFERENCES "DrivePublicationDeployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationDeployment" ADD CONSTRAINT "DrivePublicationDeployment_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "DrivePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationAsset" ADD CONSTRAINT "DrivePublicationAsset_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "DrivePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationAsset" ADD CONSTRAINT "DrivePublicationAsset_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "DrivePublicationDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationAsset" ADD CONSTRAINT "DrivePublicationAsset_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DriveItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
```

Expected: Prisma client generated successfully.

- [ ] **Step 4: Commit schema**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260609000000_drive_publications/migration.sql
git commit -m "feat(server): add drive publication schema"
```

---

## Task 3: Storage And Token Helpers

**Files:**

- Modify: `server/src/drive/drive.constants.ts`
- Modify: `server/src/drive/drive-token.ts`
- Modify: `server/src/drive/drive-storage.ts`
- Test: `server/src/drive/drive-token.spec.ts`
- Test: `server/src/drive/drive-storage.spec.ts`

- [ ] **Step 1: Write failing helper tests**

Add to `server/src/drive/drive-token.spec.ts`:

```ts
it("creates URL-safe publish ids", () => {
  expect(createDrivePublishId()).toMatch(/^pub_[A-Za-z0-9_-]{32,}$/u)
})

it("builds publication storage keys", () => {
  expect(drivePublicationStorageKey({
    publicationId: "pub-row-1",
    deploymentId: "dep-1",
    relativePath: "assets/app.js",
  })).toBe("drive-publications/pub-row-1/dep-1/assets/app.js")
})

it("rejects unsafe publication relative paths", () => {
  expect(() => drivePublicationStorageKey({
    publicationId: "pub-row-1",
    deploymentId: "dep-1",
    relativePath: "../secret.txt",
  })).toThrow("Invalid drive publication relative path.")
})
```

Add to `server/src/drive/drive-storage.spec.ts`:

```ts
it("copies and streams local drive objects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
  const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
  const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/html" })
  await storage.acceptUpload(upload.url.split("/").at(-1)!, Readable.from("<h1>Hello</h1>"))

  await storage.copyObject({ fromKey: "drive/item-1", toKey: "drive-publications/pub-1/dep-1/index.html", contentType: "text/html" })
  const object = await storage.getObjectStream({ key: "drive-publications/pub-1/dep-1/index.html" })

  expect(object.contentType).toBe("text/html")
  await expect(new Response(object.stream as unknown as ReadableStream).text()).resolves.toBe("<h1>Hello</h1>")
})
```

If the `Response` stream conversion is awkward in Node, use a local helper:

```ts
async function streamToText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString("utf8")
}
```

- [ ] **Step 2: Run failing server helper tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive-token.spec.ts drive-storage.spec.ts
```

Expected: FAIL because helpers and storage methods are missing.

- [ ] **Step 3: Add constants and token helpers**

Add to `server/src/drive/drive.constants.ts`:

```ts
export const DRIVE_PUBLICATION_TYPE = {
  page: "page",
  site: "site",
} as const

export const DRIVE_PUBLICATION_STATUS = {
  active: "active",
  disabled: "disabled",
} as const

export const DRIVE_PUBLICATION_DEPLOYMENT_STATUS = {
  pending: "pending",
  active: "active",
  failed: "failed",
} as const

export const DRIVE_PUBLICATION_INDEX_PATH = "index.html"
```

Add to `server/src/drive/drive-token.ts`:

```ts
export function createDrivePublishId(): string {
  return `pub_${randomBytes(24).toString("base64url")}`
}

export function drivePublicationStorageKey(input: {
  readonly publicationId: string
  readonly deploymentId: string
  readonly relativePath: string
}): string {
  const path = normalizePublicationRelativePath(input.relativePath)
  return `drive-publications/${input.publicationId}/${input.deploymentId}/${path}`
}

export function normalizePublicationRelativePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/").replace(/^\/+/u, "")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid drive publication relative path.")
  }
  return parts.join("/")
}
```

- [ ] **Step 4: Extend storage port**

Modify `DriveStoragePort` in `server/src/drive/drive-storage.ts`:

```ts
  copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void>
  getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }>
```

Implement local storage:

```ts
private readonly contentTypes = new Map<string, string | null>()

async copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void> {
  const targetPath = this.pathForKey(input.toKey)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await pipeline(createReadStream(this.pathForKey(input.fromKey)), createWriteStream(targetPath))
  this.contentTypes.set(input.toKey, input.contentType ?? this.contentTypes.get(input.fromKey) ?? null)
}

async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
  const info = await stat(this.pathForKey(input.key))
  return {
    stream: createReadStream(this.pathForKey(input.key)),
    size: BigInt(info.size),
    contentType: this.contentTypes.get(input.key) ?? null,
  }
}
```

In `acceptUpload()`, store content type when available by including `contentType` in `LocalStorageToken` and passing it from `createUploadInstruction()`.

Implement COS storage:

```ts
async copyObject(input: { readonly fromKey: string; readonly toKey: string; readonly contentType?: string | null }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const client = this.getClient()
    client.cos.putObjectCopy({
      Bucket: client.bucket,
      Region: client.region,
      Key: input.toKey,
      CopySource: `${client.bucket}.cos.${client.region}.myqcloud.com/${encodeURIComponent(input.fromKey).replace(/%2F/gu, "/")}`,
      MetadataDirective: input.contentType ? "Replaced" : "Copy",
      ContentType: input.contentType ?? undefined,
    }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
  const object = await new Promise<{ readonly Body?: NodeJS.ReadableStream; readonly headers?: Record<string, string> }>((resolve, reject) => {
    const client = this.getClient()
    client.cos.getObject({ Bucket: client.bucket, Region: client.region, Key: input.key }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
  if (!object.Body) throw new Error("Drive storage object body missing.")
  return {
    stream: object.Body,
    size: object.headers?.["content-length"] ? BigInt(object.headers["content-length"]) : undefined,
    contentType: object.headers?.["content-type"] ?? null,
  }
}
```

- [ ] **Step 5: Run storage tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive-token.spec.ts drive-storage.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit storage helpers**

```bash
git add server/src/drive/drive.constants.ts server/src/drive/drive-token.ts server/src/drive/drive-storage.ts server/src/drive/drive-token.spec.ts server/src/drive/drive-storage.spec.ts
git commit -m "feat(server): extend drive storage for publications"
```

---

## Task 4: Server Publication Service

**Files:**

- Modify: `server/src/drive/drive.types.ts`
- Modify: `server/src/drive/drive.service.ts`
- Test: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Add failing service tests for page publication**

Add tests to `server/src/drive/drive.service.spec.ts` near existing share tests:

```ts
it("publishes an html file as a snapshot page", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const prepared = await service.prepareUpload(user.id, {
    parentId: null,
    name: "report.html",
    size: "14",
    mimeType: "text/html",
    publicAppUrl: "https://synapse.test",
  })
  await uploadPrepared(storage, prepared, "<h1>Hello</h1>")
  await service.completeUpload(user.id, prepared.sessionId)

  const publication = await service.publishPage(user.id, prepared.item.id, "https://synapse.test")

  expect(publication.type).toBe("page")
  expect(publication.url).toMatch(/^https:\/\/synapse\.test\/pages\/pub_/u)
  const assets = await prisma.drivePublicationAsset.findMany({ where: { publicationId: publication.id } })
  expect(assets).toMatchObject([{ relativePath: "index.html", sourceItemId: prepared.item.id, contentType: "text/html" }])
})

it("rejects non-html page publication", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const item = await createActiveDriveFile(prisma, user.id, { name: "notes.txt", mimeType: "text/plain" })

  await expect(service.publishPage(user.id, item.id, "https://synapse.test"))
    .rejects.toThrow("只能发布 HTML 文件。")
})
```

Use or add test helpers:

```ts
async function uploadPrepared(storage: DriveStoragePort, prepared: DriveUploadPrepareResult, content: string) {
  const token = prepared.upload.url.split("/").at(-1)
  if (storage instanceof LocalDriveStorage && token) {
    await storage.acceptUpload(token, Readable.from(content))
  }
}
```

- [ ] **Step 2: Add failing service tests for site publication and redeploy**

Add:

```ts
it("publishes a folder with index html as a snapshot site", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const folder = await service.createFolder(user.id, { parentId: null, name: "site" })
  const index = await createCompletedUpload(service, storage, user.id, {
    parentId: folder.id,
    name: "index.html",
    content: "<link rel=\"stylesheet\" href=\"assets/style.css\">",
    mimeType: "text/html",
  })
  const assetsFolder = await service.createFolder(user.id, { parentId: folder.id, name: "assets" })
  const css = await createCompletedUpload(service, storage, user.id, {
    parentId: assetsFolder.id,
    name: "style.css",
    content: "body{}",
    mimeType: "text/css",
  })

  const publication = await service.publishSite(user.id, folder.id, "https://synapse.test")
  const assets = await prisma.drivePublicationAsset.findMany({ where: { publicationId: publication.id }, orderBy: { relativePath: "asc" } })

  expect(publication.url).toMatch(/^https:\/\/synapse\.test\/sites\/pub_.+\/$/u)
  expect(assets.map((asset) => [asset.relativePath, asset.sourceItemId])).toEqual([
    ["assets/style.css", css.id],
    ["index.html", index.id],
  ])
})

it("requires root index html for site publication", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const folder = await service.createFolder(user.id, { parentId: null, name: "site" })

  await expect(service.publishSite(user.id, folder.id, "https://synapse.test"))
    .rejects.toThrow("站点根目录需要 index.html。")
})

it("keeps the previous deployment active when redeploy fails", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const file = await createCompletedUpload(service, storage, user.id, {
    parentId: null,
    name: "report.html",
    content: "<h1>v1</h1>",
    mimeType: "text/html",
  })
  const first = await service.publishPage(user.id, file.id, "https://synapse.test")
  const firstDeploymentId = first.currentDeploymentId
  vi.spyOn(storage, "copyObject").mockRejectedValueOnce(new Error("copy failed"))

  await expect(service.redeployPublication(user.id, first.id, "https://synapse.test")).rejects.toThrow("copy failed")
  const current = await prisma.drivePublication.findUniqueOrThrow({ where: { id: first.id } })
  expect(current.currentDeploymentId).toBe(firstDeploymentId)
})
```

- [ ] **Step 3: Run failing service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive.service.spec.ts
```

Expected: FAIL because service methods are missing.

- [ ] **Step 4: Add DTO conversion helpers**

Add to `server/src/drive/drive.types.ts`:

```ts
import { buildDrivePublicationUrl, buildDriveShareUrl, type DriveDeleteImpactDto, type DrivePublicationDto, type DriveShareListItemDto } from "@synapse/shared"

export type DrivePublicationRecord = {
  readonly id: string
  readonly publishId: string
  readonly type: string
  readonly name: string
  readonly status: string
  readonly sourceItemId: string | null
  readonly currentDeploymentId: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly sourceItem?: { readonly deletedAt: Date | null } | null
}

export function toDrivePublicationDto(item: DrivePublicationRecord, publicAppUrl: string): DrivePublicationDto {
  const type = item.type === "site" ? "site" : "page"
  return {
    id: item.id,
    publishId: item.publishId,
    type,
    name: item.name,
    status: item.status === "disabled" ? "disabled" : "active",
    sourceItemId: item.sourceItemId,
    sourceDeleted: item.sourceItem?.deletedAt !== null && item.sourceItem?.deletedAt !== undefined,
    url: buildDrivePublicationUrl({ publicAppUrl, publishId: item.publishId, type }),
    currentDeploymentId: item.currentDeploymentId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 5: Implement publication service methods**

Add imports in `server/src/drive/drive.service.ts`:

```ts
import {
  DRIVE_PUBLICATION_DEPLOYMENT_STATUS,
  DRIVE_PUBLICATION_INDEX_PATH,
  DRIVE_PUBLICATION_STATUS,
  DRIVE_PUBLICATION_TYPE,
} from "./drive.constants"
import {
  createDrivePublishId,
  drivePublicationStorageKey,
  normalizePublicationRelativePath,
} from "./drive-token"
import { toDrivePublicationDto, type DrivePublicationRecord } from "./drive.types"
```

Add methods:

```ts
async listPublications(userId: string, publicAppUrl: string): Promise<DrivePublicationDto[]> {
  const publications = await this.prisma.drivePublication.findMany({
    where: { userId },
    include: { sourceItem: { select: { deletedAt: true } } },
    orderBy: { updatedAt: "desc" },
  })
  return publications.map((publication) => toDrivePublicationDto(publication, publicAppUrl))
}

async publishPage(userId: string, itemId: string, publicAppUrl: string): Promise<DrivePublicationDto> {
  const item = await this.requireOwnedItem(userId, itemId)
  if (item.type !== DRIVE_ITEM_TYPE.file || !item.storageKey || item.storageStatus !== DRIVE_STORAGE_STATUS.active) {
    throw new BadRequestException("只能发布 HTML 文件。")
  }
  if (!isHtmlDriveItem(item.name, item.mimeType)) throw new BadRequestException("只能发布 HTML 文件。")
  const publication = await this.findOrCreatePublication(userId, item.id, DRIVE_PUBLICATION_TYPE.page, item.name)
  return this.createDeploymentFromAssets(userId, publication.id, publicAppUrl, [{
    sourceItemId: item.id,
    sourceStorageKey: item.storageKey,
    relativePath: DRIVE_PUBLICATION_INDEX_PATH,
    contentType: "text/html",
    size: item.size,
  }])
}

async publishSite(userId: string, itemId: string, publicAppUrl: string): Promise<DrivePublicationDto> {
  const folder = await this.requireOwnedFolder(userId, itemId)
  const files = await this.collectPublicationSiteFiles(userId, folder.id)
  if (!files.some((file) => file.relativePath.toLowerCase() === DRIVE_PUBLICATION_INDEX_PATH)) {
    throw new BadRequestException("站点根目录需要 index.html。")
  }
  const publication = await this.findOrCreatePublication(userId, folder.id, DRIVE_PUBLICATION_TYPE.site, folder.name)
  return this.createDeploymentFromAssets(userId, publication.id, publicAppUrl, files)
}

async redeployPublication(userId: string, publicationId: string, publicAppUrl: string): Promise<DrivePublicationDto> {
  const publication = await this.prisma.drivePublication.findFirst({
    where: { id: publicationId, userId, status: DRIVE_PUBLICATION_STATUS.active },
  })
  if (!publication || !publication.sourceItemId) throw new NotFoundException("发布不存在。")
  return publication.type === DRIVE_PUBLICATION_TYPE.site
    ? this.publishSite(userId, publication.sourceItemId, publicAppUrl)
    : this.publishPage(userId, publication.sourceItemId, publicAppUrl)
}

async disablePublication(userId: string, publicationId: string): Promise<{ readonly ok: true }> {
  const result = await this.prisma.drivePublication.updateMany({
    where: { id: publicationId, userId, status: DRIVE_PUBLICATION_STATUS.active },
    data: { status: DRIVE_PUBLICATION_STATUS.disabled, disabledAt: new Date() },
  })
  if (result.count === 0) throw new NotFoundException("发布不存在。")
  return { ok: true }
}
```

Add private helpers:

```ts
private async findOrCreatePublication(userId: string, sourceItemId: string, type: string, name: string) {
  const existing = await this.prisma.drivePublication.findFirst({
    where: { userId, sourceItemId, type, status: DRIVE_PUBLICATION_STATUS.active },
  })
  if (existing) return existing
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await this.prisma.drivePublication.create({
        data: { userId, sourceItemId, type, name, status: DRIVE_PUBLICATION_STATUS.active, publishId: createDrivePublishId() },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }
  throw new Error("Unable to create unique drive publish id.")
}

private async createDeploymentFromAssets(
  userId: string,
  publicationId: string,
  publicAppUrl: string,
  assets: readonly {
    readonly sourceItemId: string
    readonly sourceStorageKey: string
    readonly relativePath: string
    readonly contentType: string | null
    readonly size: bigint
  }[],
): Promise<DrivePublicationDto> {
  const publication = await this.prisma.drivePublication.findFirst({ where: { id: publicationId, userId } })
  if (!publication) throw new NotFoundException("发布不存在。")
  const deployment = await this.prisma.drivePublicationDeployment.create({
    data: { publicationId, status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.pending },
  })
  try {
    const assetRows = []
    for (const asset of assets) {
      const relativePath = normalizePublicationRelativePath(asset.relativePath)
      const storageKey = drivePublicationStorageKey({ publicationId, deploymentId: deployment.id, relativePath })
      await this.storage.copyObject({ fromKey: asset.sourceStorageKey, toKey: storageKey, contentType: asset.contentType })
      assetRows.push({
        publicationId,
        deploymentId: deployment.id,
        sourceItemId: asset.sourceItemId,
        relativePath,
        storageKey,
        contentType: asset.contentType,
        size: asset.size,
      })
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.drivePublicationAsset.createMany({ data: assetRows })
      await tx.drivePublicationDeployment.update({
        where: { id: deployment.id },
        data: { status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.active, activatedAt: new Date() },
      })
      return tx.drivePublication.update({
        where: { id: publicationId },
        data: { currentDeploymentId: deployment.id, status: DRIVE_PUBLICATION_STATUS.active },
        include: { sourceItem: { select: { deletedAt: true } } },
      })
    })
    return toDrivePublicationDto(updated, publicAppUrl)
  } catch (error) {
    await this.prisma.drivePublicationDeployment.update({
      where: { id: deployment.id },
      data: { status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.failed, error: error instanceof Error ? error.message : "Publication failed." },
    })
    throw error
  }
}
```

Add helper functions near the bottom:

```ts
function isHtmlDriveItem(name: string, mimeType: string | null): boolean {
  const lowerName = name.toLowerCase()
  return lowerName.endsWith(".html") || lowerName.endsWith(".htm") || mimeType === "text/html"
}
```

- [ ] **Step 6: Implement site file collection**

Add private method:

```ts
private async collectPublicationSiteFiles(userId: string, rootId: string): Promise<Array<{
  readonly sourceItemId: string
  readonly sourceStorageKey: string
  readonly relativePath: string
  readonly contentType: string | null
  readonly size: bigint
}>> {
  const result: Array<{
    readonly sourceItemId: string
    readonly sourceStorageKey: string
    readonly relativePath: string
    readonly contentType: string | null
    readonly size: bigint
  }> = []
  const queue: Array<{ readonly parentId: string; readonly prefix: string }> = [{ parentId: rootId, prefix: "" }]
  const seenPaths = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = await this.prisma.driveItem.findMany({
      where: { userId, parentId: current.parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    })
    for (const child of children) {
      const relativePath = current.prefix ? `${current.prefix}/${child.name}` : child.name
      if (child.type === DRIVE_ITEM_TYPE.folder) {
        queue.push({ parentId: child.id, prefix: normalizePublicationRelativePath(relativePath) })
        continue
      }
      if (!child.storageKey) continue
      const normalized = normalizePublicationRelativePath(relativePath)
      const key = normalized.toLowerCase()
      if (seenPaths.has(key)) throw new BadRequestException("站点文件路径重复。")
      seenPaths.add(key)
      result.push({
        sourceItemId: child.id,
        sourceStorageKey: child.storageKey,
        relativePath: normalized,
        contentType: child.mimeType,
        size: child.size,
      })
    }
  }
  return result
}
```

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit publication service**

```bash
git add server/src/drive/drive.types.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(server): publish drive html snapshots"
```

---

## Task 5: Public Serving And User APIs

**Files:**

- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.service.ts`
- Test: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Add tests to `server/src/drive/drive.controller.spec.ts`:

```ts
it("serves a published page through the server proxy", async () => {
  const app = await createDriveTestApp()
  const user = await createAuthenticatedUser(app)
  const item = await uploadHtmlDriveFile(app, user, "report.html", "<h1>Hello</h1>")
  const publication = await request(app.getHttpServer())
    .post(`/api/drive/items/${item.id}/publications/page`)
    .set(authHeader(user))
    .expect(201)
    .then((response) => response.body as DrivePublicationDto)

  await request(app.getHttpServer())
    .get(`/pages/${publication.publishId}`)
    .expect(200)
    .expect("Content-Type", /text\/html/u)
    .expect("X-Content-Type-Options", "nosniff")
    .expect((response) => {
      expect(response.text).toBe("<h1>Hello</h1>")
    })
})

it("serves site assets through the server proxy", async () => {
  const app = await createDriveTestApp()
  const user = await createAuthenticatedUser(app)
  const folder = await createDriveFolder(app, user, null, "site")
  await uploadDriveFile(app, user, folder.id, "index.html", "<script src=\"app.js\"></script>", "text/html")
  await uploadDriveFile(app, user, folder.id, "app.js", "window.ok = true", "application/javascript")
  const publication = await request(app.getHttpServer())
    .post(`/api/drive/items/${folder.id}/publications/site`)
    .set(authHeader(user))
    .expect(201)
    .then((response) => response.body as DrivePublicationDto)

  await request(app.getHttpServer())
    .get(`/sites/${publication.publishId}/app.js`)
    .expect(200)
    .expect("Content-Type", /javascript/u)
    .expect((response) => {
      expect(response.text).toBe("window.ok = true")
    })
})

it("returns the same public not found text for missing publications", async () => {
  const app = await createDriveTestApp()
  await request(app.getHttpServer())
    .get("/pages/pub_missing")
    .expect(404)
    .expect((response) => {
      expect(response.text).toContain("网页未找到")
    })
})
```

- [ ] **Step 2: Run failing controller tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive.controller.spec.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Add authenticated controller routes**

In `DriveUserController` add:

```ts
@Get("/publications")
listPublications(@Req() request: AuthenticatedUserRequest) {
  return this.drive.listPublications(request.user!.id, resolveRequestPublicAppUrl(request))
}

@Post("/items/:id/publications/page")
publishPage(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.publishPage(request.user!.id, id, resolveRequestPagesPublicUrl(request))
}

@Post("/items/:id/publications/site")
publishSite(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.publishSite(request.user!.id, id, resolveRequestPagesPublicUrl(request))
}

@Post("/publications/:id/redeploy")
redeployPublication(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.redeployPublication(request.user!.id, id, resolveRequestPagesPublicUrl(request))
}

@Delete("/publications/:id")
disablePublication(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.disablePublication(request.user!.id, id)
}

@Get("/items/:id/delete-impact")
getDeleteImpact(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.getDeleteImpact(request.user!.id, id, resolveRequestPagesPublicUrl(request))
}

@Get("/shares")
listShares(@Req() request: AuthenticatedUserRequest) {
  return this.drive.listShares(request.user!.id, resolveRequestPublicAppUrl(request))
}
```

Add:

```ts
function resolveRequestPagesPublicUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.PAGES_PUBLIC_URL ?? process.env.APP_PUBLIC_URL, request })
}
```

- [ ] **Step 4: Add public controller routes**

In `DrivePublicController` add before `/files` routes if needed:

```ts
@Get("/pages/:publishId")
async openPublishedPage(@Param("publishId") publishId: string, @Res() response: Response) {
  await sendPublishedAsset(response, await this.drive.resolvePublishedAsset({
    publishId,
    type: "page",
    relativePath: "index.html",
  }))
}

@Get("/sites/:publishId")
openPublishedSiteRoot(@Param("publishId") publishId: string, @Res() response: Response) {
  response.redirect(302, `/sites/${encodeURIComponent(publishId)}/`)
}

@Get("/sites/:publishId/*")
async openPublishedSiteAsset(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
  const prefix = `/sites/${encodeURIComponent(publishId)}/`
  const relativePath = decodeURIComponent(request.path.startsWith(prefix) ? request.path.slice(prefix.length) : "")
  await sendPublishedAsset(response, await this.drive.resolvePublishedAsset({
    publishId,
    type: "site",
    relativePath: relativePath || "index.html",
  }))
}
```

Add helpers:

```ts
async function sendPublishedAsset(response: Response, asset: {
  readonly stream: NodeJS.ReadableStream
  readonly contentType: string
  readonly size?: bigint
}) {
  response.setHeader("Content-Type", asset.contentType)
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader("Content-Security-Policy", "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';")
  if (asset.size !== undefined) response.setHeader("Content-Length", asset.size.toString())
  asset.stream.pipe(response)
}
```

- [ ] **Step 5: Add public asset resolver in service**

Add to `DriveService`:

```ts
async resolvePublishedAsset(input: {
  readonly publishId: string
  readonly type: "page" | "site"
  readonly relativePath: string
}): Promise<{ readonly stream: NodeJS.ReadableStream; readonly contentType: string; readonly size?: bigint }> {
  const relativePath = normalizePublicationRelativePath(input.relativePath || DRIVE_PUBLICATION_INDEX_PATH)
  const publication = await this.prisma.drivePublication.findFirst({
    where: {
      publishId: input.publishId,
      type: input.type,
      status: DRIVE_PUBLICATION_STATUS.active,
      currentDeploymentId: { not: null },
    },
  })
  if (!publication?.currentDeploymentId) throw new NotFoundException("网页未找到")
  const asset = await this.prisma.drivePublicationAsset.findUnique({
    where: { deploymentId_relativePath: { deploymentId: publication.currentDeploymentId, relativePath } },
  })
  if (!asset) throw new NotFoundException("网页未找到")
  const object = await this.storage.getObjectStream({ key: asset.storageKey })
  return {
    stream: object.stream,
    size: object.size ?? asset.size,
    contentType: resolvePublicationContentType(asset.relativePath, asset.contentType ?? object.contentType),
  }
}
```

Add helper:

```ts
function resolvePublicationContentType(relativePath: string, stored: string | null | undefined): string {
  const lower = relativePath.toLowerCase()
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8"
  if (lower.endsWith(".css")) return "text/css; charset=utf-8"
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript; charset=utf-8"
  if (lower.endsWith(".json")) return "application/json; charset=utf-8"
  return stored || "application/octet-stream"
}
```

- [ ] **Step 6: Normalize public not found handling**

If Nest default JSON 404 is returned, add route-level handling:

```ts
function sendPublicNotFound(response: Response) {
  response.status(404).type("text/plain; charset=utf-8").send("网页未找到")
}
```

Wrap public route methods:

```ts
try {
  await sendPublishedAsset(response, await this.drive.resolvePublishedAsset(...))
} catch {
  sendPublicNotFound(response)
}
```

Do not log publish ids with full user paths or secrets.

- [ ] **Step 7: Run controller tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit API and public serving**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.service.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat(server): serve drive publications"
```

---

## Task 6: Delete Impact And Share Listing

**Files:**

- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Test: `server/src/drive/drive.service.spec.ts`
- Test: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing delete-impact tests**

Add to `server/src/drive/drive.service.spec.ts`:

```ts
it("detects a published site child resource when deleting one file", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const folder = await service.createFolder(user.id, { parentId: null, name: "site" })
  await createCompletedUpload(service, storage, user.id, { parentId: folder.id, name: "index.html", content: "<img src=\"logo.png\">", mimeType: "text/html" })
  const logo = await createCompletedUpload(service, storage, user.id, { parentId: folder.id, name: "logo.png", content: "png", mimeType: "image/png" })
  const publication = await service.publishSite(user.id, folder.id, "https://synapse.test")

  const impact = await service.getDeleteImpact(user.id, logo.id, "https://synapse.test")

  expect(impact.publications.map((item) => item.id)).toEqual([publication.id])
})

it("disables affected publications when deleting with disablePublications", async () => {
  const user = await createUser(prisma)
  const service = createDriveService(prisma, storage)
  const file = await createCompletedUpload(service, storage, user.id, { parentId: null, name: "report.html", content: "<h1/>", mimeType: "text/html" })
  const publication = await service.publishPage(user.id, file.id, "https://synapse.test")

  await service.deleteItem(user.id, file.id, user.id, "127.0.0.1", { disablePublications: true, publicAppUrl: "https://synapse.test" })

  await expect(prisma.drivePublication.findUniqueOrThrow({ where: { id: publication.id } }))
    .resolves.toMatchObject({ status: "disabled" })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive.service.spec.ts
```

Expected: FAIL because delete impact is missing and `deleteItem` signature has not changed.

- [ ] **Step 3: Implement delete impact service**

Add types to the `deleteItem` signature:

```ts
async deleteItem(
  userId: string,
  itemId: string,
  actorEmail = userId,
  ipAddress = "system",
  options: { readonly disablePublications?: boolean; readonly publicAppUrl?: string } = {},
): Promise<{ readonly ok: true }> {
  await this.deleteItemInternal({ itemId, userId, actorEmail, ipAddress, admin: false, disablePublications: options.disablePublications ?? false, publicAppUrl: options.publicAppUrl })
  return { ok: true }
}
```

Add:

```ts
async getDeleteImpact(userId: string, itemId: string, publicAppUrl: string): Promise<DriveDeleteImpactDto> {
  const root = await this.requireOwnedItem(userId, itemId)
  const items = root.type === DRIVE_ITEM_TYPE.folder ? await this.collectSubtree(root.id) : [root]
  const itemIds = items.map((item) => item.id)
  const publications = await this.findActivePublicationsReferencingItems(userId, itemIds)
  return { publications: publications.map((publication) => toDrivePublicationDto(publication, publicAppUrl)) }
}

private async findActivePublicationsReferencingItems(userId: string, itemIds: readonly string[]) {
  if (itemIds.length === 0) return []
  const publications = await this.prisma.drivePublication.findMany({
    where: {
      userId,
      status: DRIVE_PUBLICATION_STATUS.active,
    },
    include: {
      sourceItem: { select: { deletedAt: true } },
      assets: { where: { sourceItemId: { in: [...itemIds] } }, select: { deploymentId: true } },
    },
    orderBy: { updatedAt: "desc" },
  })
  return publications.filter((publication) =>
    itemIds.includes(publication.sourceItemId ?? "")
    || publication.assets.some((asset) => asset.deploymentId === publication.currentDeploymentId)
  )
}
```

- [ ] **Step 4: Disable publications during delete**

Modify `deleteItemInternal` input type:

```ts
readonly disablePublications?: boolean
readonly publicAppUrl?: string
```

Before the transaction, compute impacted publication ids:

```ts
const impactedPublications = input.disablePublications
  ? await this.findActivePublicationsReferencingItems(root.userId, itemIds)
  : []
```

Inside the transaction:

```ts
if (impactedPublications.length > 0) {
  await tx.drivePublication.updateMany({
    where: { id: { in: impactedPublications.map((publication) => publication.id) } },
    data: { status: DRIVE_PUBLICATION_STATUS.disabled, disabledAt: deletedAt },
  })
}
```

- [ ] **Step 5: Implement share listing**

Add to `DriveService`:

```ts
async listShares(userId: string, publicAppUrl: string): Promise<DriveShareListItemDto[]> {
  const shares = await this.prisma.driveShare.findMany({
    where: { userId, enabled: true },
    include: { item: { select: { id: true, name: true, type: true, deletedAt: true } } },
    orderBy: { createdAt: "desc" },
  })
  return shares.map((share) => ({
    id: share.id,
    shareId: share.shareId,
    itemId: share.itemId,
    itemName: share.item.name,
    itemType: share.item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
    sourceDeleted: share.item.deletedAt !== null,
    url: buildDriveShareUrl({ publicAppUrl, shareId: share.shareId }),
    createdAt: share.createdAt.toISOString(),
  }))
}
```

- [ ] **Step 6: Update delete controller body parsing**

In `DriveUserController.deleteItem`, parse optional body:

```ts
const deleteItemSchema = z.object({
  disablePublications: z.boolean().optional(),
}).strict()
```

Update method:

```ts
@Delete("/items/:id")
deleteItem(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const parsed = body === undefined ? { disablePublications: false } : parseBody(deleteItemSchema, body, "删除请求无效。")
  return this.drive.deleteItem(request.user!.id, id, request.user!.id, request.ip, {
    disablePublications: parsed.disablePublications ?? false,
    publicAppUrl: resolveRequestPagesPublicUrl(request),
  })
}
```

- [ ] **Step 7: Run delete-impact and full drive server tests**

Run:

```bash
pnpm --filter @synapse/server run test -- drive.service.spec.ts drive.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit delete impact**

```bash
git add server/src/drive/drive.service.ts server/src/drive/drive.controller.ts server/src/drive/drive.service.spec.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat(server): track drive publication delete impact"
```

---

## Task 7: Desktop Bridge And Account Service

**Files:**

- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/preload.ts`
- Generated: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`
- Test: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Write failing bridge tests**

In `desktop/electron/__tests__/preload.test.ts`, add calls:

```ts
await bridge.account.listDrivePublications()
await bridge.account.publishDrivePage({ itemId: "item-1" })
await bridge.account.publishDriveSite({ itemId: "folder-1" })
await bridge.account.redeployDrivePublication({ publicationId: "pub-row-1" })
await bridge.account.disableDrivePublication({ publicationId: "pub-row-1" })
await bridge.account.getDriveDeleteImpact({ itemId: "item-1" })
await bridge.account.listDriveShares()
```

In IPC tests, assert schemas accept:

```ts
expect(accountIpcModule.methods.publishDrivePage.request.parse({ itemId: "item-1" })).toEqual({ itemId: "item-1" })
expect(accountIpcModule.methods.getDriveDeleteImpact.request.parse({ itemId: "item-1" })).toEqual({ itemId: "item-1" })
```

- [ ] **Step 2: Run failing desktop IPC/preload tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- electron/__tests__/preload.test.ts electron/modules/account/__tests__/ipc.test.ts
```

Expected: FAIL because methods do not exist.

- [ ] **Step 3: Add bridge types**

In `desktop/src/types/bridge.ts`, import shared DTOs and add:

```ts
    listDrivePublications: () => Promise<DrivePublicationDto[]>
    publishDrivePage: (input: { itemId: string }) => Promise<DrivePublicationDto>
    publishDriveSite: (input: { itemId: string }) => Promise<DrivePublicationDto>
    redeployDrivePublication: (input: { publicationId: string }) => Promise<DrivePublicationDto>
    disableDrivePublication: (input: { publicationId: string }) => Promise<{ ok: true }>
    getDriveDeleteImpact: (input: { itemId: string }) => Promise<DriveDeleteImpactDto>
    listDriveShares: () => Promise<DriveShareListItemDto[]>
```

Update `deleteDriveItem`:

```ts
    deleteDriveItem: (input: { itemId: string; disablePublications?: boolean }) => Promise<{ ok: true }>
```

- [ ] **Step 4: Add account service methods**

In `desktop/electron/services/account-service.ts` add:

```ts
async listDrivePublications(): Promise<DrivePublicationDto[]> {
  return this.getAuthenticatedJson<DrivePublicationDto[]>(`${apiBaseUrl()}/drive/publications`, "发布列表加载失败。")
}

async publishDrivePage(itemId: string): Promise<DrivePublicationDto> {
  return this.requestAuthenticatedJson<DrivePublicationDto>("POST", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/publications/page`, undefined, "发布网页失败。")
}

async publishDriveSite(itemId: string): Promise<DrivePublicationDto> {
  return this.requestAuthenticatedJson<DrivePublicationDto>("POST", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/publications/site`, undefined, "发布站点失败。")
}

async redeployDrivePublication(publicationId: string): Promise<DrivePublicationDto> {
  return this.requestAuthenticatedJson<DrivePublicationDto>("POST", `${apiBaseUrl()}/drive/publications/${encodeURIComponent(publicationId)}/redeploy`, undefined, "重新发布失败。")
}

async disableDrivePublication(publicationId: string): Promise<{ ok: true }> {
  return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/publications/${encodeURIComponent(publicationId)}`, undefined, "取消发布失败。")
}

async getDriveDeleteImpact(itemId: string): Promise<DriveDeleteImpactDto> {
  return this.getAuthenticatedJson<DriveDeleteImpactDto>(`${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/delete-impact`, "删除影响加载失败。")
}

async listDriveShares(): Promise<DriveShareListItemDto[]> {
  return this.getAuthenticatedJson<DriveShareListItemDto[]>(`${apiBaseUrl()}/drive/shares`, "分享列表加载失败。")
}
```

Change `deleteDriveItem`:

```ts
async deleteDriveItem(itemId: string, input: { readonly disablePublications?: boolean } = {}): Promise<{ ok: true }> {
  return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}`, input, "删除失败。")
}
```

- [ ] **Step 5: Add IPC schemas and handlers**

In `desktop/electron/modules/account/ipc.ts`, add schemas:

```ts
const drivePublicationSchema = z.object({
  id: z.string(),
  publishId: z.string(),
  type: z.enum(["page", "site"]),
  name: z.string(),
  status: z.enum(["active", "disabled"]),
  sourceItemId: z.string().nullable(),
  sourceDeleted: z.boolean(),
  url: z.string(),
  currentDeploymentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const driveDeleteImpactSchema = z.object({ publications: z.array(drivePublicationSchema) })
const drivePublicationIdSchema = z.object({ publicationId: z.string() })
const driveDeleteItemSchema = z.object({ itemId: z.string(), disablePublications: z.boolean().optional() })
const driveShareListItemSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  itemType: z.enum(["file", "folder"]),
  sourceDeleted: z.boolean(),
  url: z.string(),
  createdAt: z.string(),
})
```

Add methods:

```ts
listDrivePublications: {
  response: z.array(drivePublicationSchema),
  handler: async () => accountService.listDrivePublications(),
},
publishDrivePage: {
  request: driveItemIdSchema,
  response: drivePublicationSchema,
  handler: async (_ctx, input) => accountService.publishDrivePage(driveItemIdSchema.parse(input).itemId),
},
publishDriveSite: {
  request: driveItemIdSchema,
  response: drivePublicationSchema,
  handler: async (_ctx, input) => accountService.publishDriveSite(driveItemIdSchema.parse(input).itemId),
},
redeployDrivePublication: {
  request: drivePublicationIdSchema,
  response: drivePublicationSchema,
  handler: async (_ctx, input) => accountService.redeployDrivePublication(drivePublicationIdSchema.parse(input).publicationId),
},
disableDrivePublication: {
  request: drivePublicationIdSchema,
  response: z.object({ ok: z.literal(true) }),
  handler: async (_ctx, input) => accountService.disableDrivePublication(drivePublicationIdSchema.parse(input).publicationId),
},
getDriveDeleteImpact: {
  request: driveItemIdSchema,
  response: driveDeleteImpactSchema,
  handler: async (_ctx, input) => accountService.getDriveDeleteImpact(driveItemIdSchema.parse(input).itemId),
},
listDriveShares: {
  response: z.array(driveShareListItemSchema),
  handler: async () => accountService.listDriveShares(),
},
```

Update existing `deleteDriveItem` to use `driveDeleteItemSchema` and pass `disablePublications`.

- [ ] **Step 6: Update preload and regenerate IPC**

Add channel mappings in `desktop/electron/preload.ts` for the new account methods. Then run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` updates.

- [ ] **Step 7: Run desktop bridge tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- electron/__tests__/preload.test.ts electron/modules/account/__tests__/ipc.test.ts electron/services/__tests__/account-service.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 8: Commit bridge**

```bash
git add desktop/src/types/bridge.ts desktop/electron/modules/account/ipc.ts desktop/electron/services/account-service.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat(desktop): bridge drive publications"
```

---

## Task 8: Desktop Drive UI

**Files:**

- Modify: `desktop/src/modules/drive/index.tsx`
- Test: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing UI tests for top-bar and row actions**

Add to `drive-module.test.tsx`:

```ts
it("shows share and publication management actions in the drive top bar", async () => {
  mocks.listDriveItems.mockResolvedValue([])
  renderDriveModule()
  expect(await screen.findByRole("button", { name: "已分享" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "已发布" })).toBeInTheDocument()
})

it("shows publish page only for html files", async () => {
  mocks.listDriveItems.mockResolvedValue([
    createDriveItem({ id: "html-1", name: "report.html", type: "file", mimeType: "text/html" }),
    createDriveItem({ id: "txt-1", name: "notes.txt", type: "file", mimeType: "text/plain" }),
  ])
  renderDriveModule()
  await openRowMenu("report.html")
  expect(screen.getByRole("menuitem", { name: "发布网页" })).toBeInTheDocument()
  await closeMenu()
  await openRowMenu("notes.txt")
  expect(screen.queryByRole("menuitem", { name: "发布网页" })).not.toBeInTheDocument()
})

it("shows publish site for folders", async () => {
  mocks.listDriveItems.mockResolvedValue([
    createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
  ])
  renderDriveModule()
  await openRowMenu("site")
  expect(screen.getByRole("menuitem", { name: "发布站点" })).toBeInTheDocument()
})
```

- [ ] **Step 2: Write failing UI tests for delete impact**

Add:

```ts
it("passes disablePublications when the delete checkbox is selected", async () => {
  mocks.listDriveItems.mockResolvedValue([
    createDriveItem({ id: "file-1", name: "report.html", type: "file", mimeType: "text/html" }),
  ])
  mocks.getDriveDeleteImpact.mockResolvedValue({
    publications: [createDrivePublication({ id: "pub-row-1", name: "report.html", type: "page" })],
  })
  renderDriveModule()

  await openRowMenu("report.html")
  await userEvent.click(screen.getByRole("menuitem", { name: "删除" }))
  expect(await screen.findByText("会影响 1 个已发布内容")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("checkbox", { name: "同时取消相关发布" }))
  await userEvent.click(screen.getByRole("button", { name: "删除" }))

  expect(mocks.deleteDriveItem).toHaveBeenCalledWith({ itemId: "file-1", disablePublications: true })
})
```

- [ ] **Step 3: Run failing renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because UI and bridge mocks are missing.

- [ ] **Step 4: Extend Drive module state and handlers**

In `desktop/src/modules/drive/index.tsx`, add imports:

```ts
import { Copy, ExternalLink, Globe2, Link2, RotateCw, X } from "lucide-react"
import type { DriveDeleteImpactDto, DrivePublicationDto, DriveShareListItemDto } from "@synapse/shared"
import { Checkbox } from "@/components/ui/checkbox"
```

Add state:

```ts
const [publicationsOpen, setPublicationsOpen] = useState(false)
const [sharesOpen, setSharesOpen] = useState(false)
const [deleteImpact, setDeleteImpact] = useState<DriveDeleteImpactDto | null>(null)
const [disablePublicationsOnDelete, setDisablePublicationsOnDelete] = useState(false)
```

Change `handleDelete`:

```ts
const handleDelete = useCallback(async (item: DriveItemDto) => {
  setDeleteTarget(item)
  setDeleteImpact(null)
  setDisablePublicationsOnDelete(false)
  try {
    setDeleteImpact(await requireSynapseBridge().account.getDriveDeleteImpact({ itemId: item.id }))
  } catch (rawError) {
    toast(errorMessage(rawError, "删除影响加载失败"))
  }
}, [])
```

Change `confirmDelete`:

```ts
await requireSynapseBridge().account.deleteDriveItem({
  itemId: deleteTarget.id,
  disablePublications: disablePublicationsOnDelete,
})
```

Add publish handlers:

```ts
const handlePublishPage = useCallback(async (item: DriveItemDto) => {
  try {
    const publication = await requireSynapseBridge().account.publishDrivePage({ itemId: item.id })
    await navigator.clipboard.writeText(publication.url)
    toast("发布链接已复制")
    await loadItems()
  } catch (rawError) {
    toast(errorMessage(rawError, "发布网页失败"))
  }
}, [loadItems])

const handlePublishSite = useCallback(async (item: DriveItemDto) => {
  try {
    const publication = await requireSynapseBridge().account.publishDriveSite({ itemId: item.id })
    await navigator.clipboard.writeText(publication.url)
    toast("发布链接已复制")
    await loadItems()
  } catch (rawError) {
    toast(errorMessage(rawError, "发布站点失败"))
  }
}, [loadItems])
```

- [ ] **Step 5: Add top-bar buttons**

In `ModulePage.actions`, add before upload buttons:

```tsx
<Button variant="outline" size="sm" disabled={!accountAuthenticated} onClick={() => setSharesOpen(true)}>
  <Link2 data-icon="inline-start" />
  已分享
</Button>
<Button variant="outline" size="sm" disabled={!accountAuthenticated} onClick={() => setPublicationsOpen(true)}>
  <Globe2 data-icon="inline-start" />
  已发布
</Button>
```

- [ ] **Step 6: Add row menu publication actions**

In `DriveFileListRow` props, pass `onPublishPage` and `onPublishSite`.

Add helpers:

```ts
function isHtmlDriveItem(item: DriveItemDto): boolean {
  const name = item.name.toLowerCase()
  return item.type === "file" && (name.endsWith(".html") || name.endsWith(".htm") || item.mimeType === "text/html")
}
```

Inside row dropdown menu:

```tsx
{isHtmlDriveItem(item) ? (
  <DropdownMenuItem onClick={(event) => {
    event.stopPropagation()
    void onPublishPage(item)
  }}>
    <Globe2 data-icon="inline-start" />
    发布网页
  </DropdownMenuItem>
) : null}
{item.type === "folder" ? (
  <DropdownMenuItem onClick={(event) => {
    event.stopPropagation()
    void onPublishSite(item)
  }}>
    <Globe2 data-icon="inline-start" />
    发布站点
  </DropdownMenuItem>
) : null}
```

- [ ] **Step 7: Add management dialogs**

Add compact components in the same file:

```tsx
function DrivePublicationList({
  items,
  loading,
  onReload,
}: {
  readonly items: readonly DrivePublicationDto[]
  readonly loading: boolean
  readonly onReload: () => Promise<void>
}) {
  if (loading) return <div className="text-sm text-muted-foreground">加载中</div>
  if (items.length === 0) return <div className="text-sm text-muted-foreground">暂无发布</div>
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.name}</div>
            <div className="text-xs text-muted-foreground">
              {item.type === "site" ? "站点" : "网页"} · {item.sourceDeleted ? "来源已删除" : "来源正常"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`复制 ${item.name}`} onClick={() => { void navigator.clipboard.writeText(item.url) }}>
              <Copy />
            </Button>
            {item.status === "active" ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`打开 ${item.name}`} onClick={() => { void requireSynapseBridge().shell.openExternal(item.url) }}>
                <ExternalLink />
              </Button>
            ) : null}
            {item.status === "active" && !item.sourceDeleted ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`重新发布 ${item.name}`} onClick={async () => {
                await requireSynapseBridge().account.redeployDrivePublication({ publicationId: item.id })
                await onReload()
              }}>
                <RotateCw />
              </Button>
            ) : null}
            {item.status === "active" ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`取消发布 ${item.name}`} onClick={async () => {
                await requireSynapseBridge().account.disableDrivePublication({ publicationId: item.id })
                await onReload()
              }}>
                <X />
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function DrivePublicationsDialog({ open, onOpenChange }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<DrivePublicationDto[]>([])
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await requireSynapseBridge().account.listDrivePublications())
    } catch (rawError) {
      toast(errorMessage(rawError, "已发布加载失败"))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (open) void load()
  }, [load, open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialog title="已发布" onSubmit={(event) => event.preventDefault()} footer={<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>}>
        <DrivePublicationList items={items} loading={loading} onReload={load} />
      </FormDialog>
    </Dialog>
  )
}
```

Add the share list and dialog:

```tsx
function DriveShareList({ items, loading, onReload }: {
  readonly items: readonly DriveShareListItemDto[]
  readonly loading: boolean
  readonly onReload: () => Promise<void>
}) {
  if (loading) return <div className="text-sm text-muted-foreground">加载中</div>
  if (items.length === 0) return <div className="text-sm text-muted-foreground">暂无分享</div>
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.itemName}</div>
            <div className="text-xs text-muted-foreground">
              {item.itemType === "folder" ? "文件夹" : "文件"} · {item.sourceDeleted ? "来源已删除" : "来源正常"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`复制 ${item.itemName}`} onClick={() => { void navigator.clipboard.writeText(item.url) }}>
              <Copy />
            </Button>
            {!item.sourceDeleted ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`打开 ${item.itemName}`} onClick={() => { void requireSynapseBridge().shell.openExternal(item.url) }}>
                <ExternalLink />
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`取消分享 ${item.itemName}`} onClick={async () => {
              await requireSynapseBridge().account.disableDriveShare({ shareId: item.id })
              await onReload()
            }}>
              <X />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function DriveSharesDialog({ open, onOpenChange }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<DriveShareListItemDto[]>([])
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await requireSynapseBridge().account.listDriveShares())
    } catch (rawError) {
      toast(errorMessage(rawError, "已分享加载失败"))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (open) void load()
  }, [load, open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialog title="已分享" onSubmit={(event) => event.preventDefault()} footer={<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>}>
        <DriveShareList items={items} loading={loading} onReload={load} />
      </FormDialog>
    </Dialog>
  )
}
```

- [ ] **Step 8: Add delete checkbox to confirmation**

Inside `AlertDialogDescription`, add after existing sentence:

```tsx
{deleteImpact?.publications.length ? (
  <div className="mt-3 grid gap-2">
    <div>会影响 {deleteImpact.publications.length} 个已发布内容</div>
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={disablePublicationsOnDelete}
        onCheckedChange={(checked) => setDisablePublicationsOnDelete(checked === true)}
      />
      <span>同时取消相关发布</span>
    </label>
  </div>
) : null}
```

- [ ] **Step 9: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit desktop UI**

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(desktop): manage drive publications"
```

---

## Task 9: Release Notes And Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise user-facing bullet:

```md
- 云盘新增 HTML 发布能力：HTML 文件可以发布为网页，包含 `index.html` 的文件夹可以发布为站点；发布内容使用快照，删除源文件时可选择是否同步取消相关发布。
```

- [ ] **Step 2: Run targeted verification**

Run:

```bash
pnpm --filter @synapse/shared run test -- drive.test.ts
pnpm --filter @synapse/server run test -- drive-token.spec.ts drive-storage.spec.ts drive.service.spec.ts drive.controller.spec.ts
pnpm --filter @synapse/desktop run test -- electron/__tests__/preload.test.ts electron/modules/account/__tests__/ipc.test.ts electron/services/__tests__/account-service.test.ts src/modules/drive/__tests__/drive-module.test.tsx
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: all commands PASS.

- [ ] **Step 3: Run typechecks**

Run:

```bash
pnpm --filter @synapse/shared run typecheck
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/desktop run typecheck
```

Expected: all commands PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Commit release note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive publication feature"
```

---

## Implementation Notes

- Keep public serving unauthenticated and independent of account cookies.
- Do not start local dev servers for verification unless the user explicitly asks.
- Do not add new dependencies.
- Avoid custom UI styling. Use existing shadcn/Radix components and Tailwind token classes.
- Keep publication snapshot cleanup out of the first implementation.
- Keep dashboard publication management out of the first implementation.
- Ensure logs and errors do not expose COS credentials or signed URLs.
