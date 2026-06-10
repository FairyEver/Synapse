# Content Store Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side Content Store foundation for cloud Skill / Rule / Prompt drafts, immutable published versions, package storage, install sessions, admin governance, and installation statistics.

**Architecture:** Add a dedicated NestJS `content-store` module backed by Prisma models and a `ContentStoreStoragePort` abstraction. PostgreSQL stores business state, version snapshots, search fields, and audit records; the new Content Store object storage bucket stores draft files and immutable Skill / Rule installation packages. This plan deliberately stops at server APIs so Dashboard and Desktop can be implemented against a stable contract in separate plans.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Zod, COS/local storage, Node streams, `archiver`, Vitest, `@synapse/shared`.

---

## Scope Split

This plan implements server foundation only:

- Content Store database schema and migration.
- Shared DTOs for server/dashboard/desktop contracts.
- Content Store storage abstraction and environment config.
- File validation, text/binary detection, package manifest builder.
- User APIs for store listing, details, drafts, publish, public visibility, copying, install sessions, package download, and install completion.
- Admin APIs for listing, detail, featured, removed/restored state.
- Tests for service, storage, package, controller, and env behavior.

Dashboard UI, Monaco Skill editor, Dashboard fallback page, Desktop protocol routing, Desktop independent install window, and Desktop installation adapter are separate implementation plans.

## Files

- Create: `shared/src/content-store.ts`
- Modify: `shared/src/index.ts`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260609010000_content_store/migration.sql`
- Modify: `server/src/config/env.ts`
- Modify: `server/.env.example`
- Create: `server/src/content-store/content-store.constants.ts`
- Create: `server/src/content-store/content-store.types.ts`
- Create: `server/src/content-store/content-store-storage.ts`
- Create: `server/src/content-store/content-store-file-rules.ts`
- Create: `server/src/content-store/content-store-package.ts`
- Create: `server/src/content-store/content-store.service.ts`
- Create: `server/src/content-store/content-store.controller.ts`
- Create: `server/src/content-store/content-store.module.ts`
- Modify: `server/src/app.module.ts`
- Create: `server/src/content-store/content-store-file-rules.spec.ts`
- Create: `server/src/content-store/content-store-package.spec.ts`
- Create: `server/src/content-store/content-store-storage.spec.ts`
- Create: `server/src/content-store/content-store.service.spec.ts`
- Create: `server/src/content-store/content-store.controller.spec.ts`
- Modify: `server/src/config/env.spec.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

## Data Contract

Use these stable enum strings throughout the implementation:

```ts
export const CONTENT_STORE_TYPES = ["skill", "rule", "prompt"] as const
export const CONTENT_STORE_VISIBILITIES = ["private", "public"] as const
export const CONTENT_STORE_MODERATION_STATUSES = ["normal", "removed"] as const
export const CONTENT_STORE_FILE_KINDS = ["text", "binary"] as const
export const CONTENT_STORE_INSTALL_SESSION_STATUSES = ["pending", "consumed", "expired"] as const
```

Use these limits:

```ts
export const contentStoreSkillMaxTotalBytes = 50 * 1024 * 1024
export const contentStoreSkillMaxFileBytes = 20 * 1024 * 1024
export const contentStoreSkillMaxFileCount = 200
export const contentStoreTextMaxBytes = 1024 * 1024
export const contentStoreInstallSessionTtlSeconds = 5 * 60
```

Use these object keys:

```ts
content-store/drafts/<userId>/<draftId>/<sha256>
content-store/packages/<contentId>/<versionId>.zip
```

---

### Task 1: Shared DTOs

**Files:**
- Create: `shared/src/content-store.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write the shared type file**

Create `shared/src/content-store.ts` with:

```ts
export type ContentStoreType = "skill" | "rule" | "prompt"
export type ContentStoreVisibility = "private" | "public"
export type ContentStoreModerationStatus = "normal" | "removed"
export type ContentStoreFileKind = "text" | "binary"

export interface ContentStoreOwnerDto {
  readonly id: string
  readonly displayName: string | null
}

export interface ContentStoreFileDto {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: ContentStoreFileKind
  readonly mimeType: string | null
  readonly text?: string
}

export interface ContentStoreItemDto {
  readonly id: string
  readonly type: ContentStoreType
  readonly title: string
  readonly description: string | null
  readonly visibility: ContentStoreVisibility
  readonly moderationStatus: ContentStoreModerationStatus
  readonly featured: boolean
  readonly owner: ContentStoreOwnerDto
  readonly latestVersionId: string | null
  readonly latestVersionNumber: number | null
  readonly installCount: number
  readonly copiedFromContentId: string | null
  readonly copiedFromVersionId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ContentStoreVersionDto {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly packageKey: string | null
  readonly packageSha256: string | null
  readonly packageSize: string | null
  readonly createdAt: string
}

export interface ContentStoreDetailDto extends ContentStoreItemDto {
  readonly latestVersion: ContentStoreVersionDto | null
  readonly body: string | null
  readonly files: ContentStoreFileDto[]
}

export interface ContentStoreDraftDto {
  readonly id: string
  readonly itemId: string
  readonly baseVersionId: string | null
  readonly revision: number
  readonly title: string
  readonly description: string | null
  readonly body: string | null
  readonly files: ContentStoreFileDto[]
  readonly updatedAt: string
}

export interface ContentStoreInstallSessionDto {
  readonly id: string
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly packageSha256: string
  readonly expiresAt: string
  readonly deepLinkUrl: string
}

export interface ContentStoreInstallManifestFile {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: ContentStoreFileKind
}

export interface ContentStoreInstallManifest {
  readonly schemaVersion: 1
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly mainFile: "content/SKILL.md" | "content/RULE.md"
  readonly files: ContentStoreInstallManifestFile[]
}
```

- [ ] **Step 2: Export the DTOs**

Modify `shared/src/index.ts`:

```ts
export * from "./content-store"
```

- [ ] **Step 3: Verify shared package builds**

Run:

```bash
pnpm --filter @synapse/shared run build
```

Expected: command exits 0.

- [ ] **Step 4: Commit**

```bash
git add shared/src/content-store.ts shared/src/index.ts
git commit -m "feat(shared): add content store contracts"
```

---

### Task 2: Prisma Schema and Migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260609010000_content_store/migration.sql`

- [ ] **Step 1: Add Prisma models**

Append these models and relations to `server/prisma/schema.prisma`. Also add relation fields on `User`:

```prisma
model User {
  id                          String                       @id @default(cuid())
  email                       String                       @unique
  displayName                 String?                      @db.VarChar(40)
  passwordHash                String
  passwordChangedAt           DateTime?
  status                      UserStatus                   @default(active)
  memberships                 TeamMembership[]
  createdTeams                Team[]                       @relation("TeamCreator")
  sessions                    UserSession[]
  desktopLoginCodes           DesktopLoginCode[]
  passwordResetTokens         UserPasswordResetToken[]
  acceptedInvitations         Invitation[]                 @relation("AcceptedInvitations")
  createdInvitations          Invitation[]                 @relation("UserCreatedInvitations")
  modulePermissions           UserModulePermission[]
  webhooks                    UserWebhook[]
  devices                     UserDevice[]
  driveItems                  DriveItem[]
  driveUsage                  DriveUsage?
  driveUploadSessions         DriveUploadSession[]
  drivePublications           DrivePublication[]
  contentStoreItems           ContentStoreItem[]
  contentStoreDrafts          ContentStoreDraft[]
  contentStoreInstallSessions ContentStoreInstallSession[]
  contentStoreInstallEvents   ContentStoreInstallEvent[]
  createdAt                   DateTime                     @default(now())
  updatedAt                   DateTime                     @updatedAt
}

model ContentStoreItem {
  id                    String                     @id @default(cuid())
  type                  String                     @db.VarChar(16)
  title                 String                     @db.VarChar(160)
  description           String?
  ownerUserId           String
  owner                 User                       @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  visibility            String                     @db.VarChar(16)
  moderationStatus      String                     @db.VarChar(16)
  featured              Boolean                    @default(false)
  copiedFromContentId   String?
  copiedFromVersionId   String?
  localSourceFingerprint String?                   @db.VarChar(128)
  latestVersionId       String?
  createdAt             DateTime                   @default(now())
  updatedAt             DateTime                   @updatedAt
  versions              ContentStoreVersion[]
  drafts                ContentStoreDraft[]
  installSessions       ContentStoreInstallSession[]
  installEvents         ContentStoreInstallEvent[]

  @@index([type, visibility, moderationStatus, featured, updatedAt])
  @@index([ownerUserId, type, updatedAt])
  @@index([ownerUserId, localSourceFingerprint])
}

model ContentStoreDraft {
  id            String             @id @default(cuid())
  itemId        String
  item          ContentStoreItem    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  ownerUserId   String
  owner         User                @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  baseVersionId String?
  revision      Int                @default(1)
  title         String             @db.VarChar(160)
  description   String?
  body          String?
  files         ContentStoreFile[]
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  @@unique([itemId])
  @@index([ownerUserId, updatedAt])
}

model ContentStoreVersion {
  id              String             @id @default(cuid())
  itemId          String
  item            ContentStoreItem    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  versionNumber   Int
  title           String             @db.VarChar(160)
  description     String?
  body            String?
  packageKey      String?            @unique
  packageSha256   String?            @db.VarChar(64)
  packageSize     BigInt?
  searchText      String
  files           ContentStoreFile[]
  installSessions ContentStoreInstallSession[]
  installEvents   ContentStoreInstallEvent[]
  createdAt       DateTime           @default(now())

  @@unique([itemId, versionNumber])
  @@index([itemId, createdAt])
  @@index([searchText])
}

model ContentStoreFile {
  id        String               @id @default(cuid())
  draftId   String?
  draft     ContentStoreDraft?   @relation(fields: [draftId], references: [id], onDelete: Cascade)
  versionId String?
  version   ContentStoreVersion? @relation(fields: [versionId], references: [id], onDelete: Cascade)
  path      String               @db.VarChar(1024)
  size      BigInt
  sha256    String               @db.VarChar(64)
  kind      String               @db.VarChar(16)
  mimeType  String?              @db.VarChar(255)
  storageKey String?
  text      String?
  createdAt DateTime             @default(now())

  @@unique([draftId, path])
  @@unique([versionId, path])
  @@index([sha256])
}

model ContentStoreInstallSession {
  id          String              @id @default(cuid())
  userId      String
  user        User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  itemId      String
  item        ContentStoreItem    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  versionId   String
  version     ContentStoreVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  type        String              @db.VarChar(16)
  status      String              @db.VarChar(16)
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime            @default(now())

  @@index([userId, status, expiresAt])
  @@index([itemId, versionId])
}

model ContentStoreInstallEvent {
  id               String              @id @default(cuid())
  userId           String
  user             User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  itemId           String
  item             ContentStoreItem    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  versionId        String
  version          ContentStoreVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  clientInstanceId String              @db.VarChar(120)
  createdAt        DateTime            @default(now())

  @@unique([userId, itemId, versionId, clientInstanceId])
  @@index([itemId, versionId])
}
```

- [ ] **Step 2: Create SQL migration**

Create `server/prisma/migrations/20260609010000_content_store/migration.sql` with SQL matching the Prisma models. Use `TEXT` for long body fields, `BIGINT` for file sizes, foreign keys with cascade where the Prisma model declares cascade, and indexes matching the model definitions. Generate the migration from the server package with:

```bash
pnpm --filter @synapse/server exec prisma migrate dev --name content_store --create-only
```

Then inspect the generated `migration.sql` and confirm it contains `CREATE TABLE` statements for every `ContentStore*` model plus indexes matching the Prisma model definitions.

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
```

Expected: Prisma client generation exits 0.

- [ ] **Step 4: Run schema validation**

Run:

```bash
pnpm --filter @synapse/server exec prisma validate --schema server/prisma/schema.prisma
```

Expected: `The schema at server/prisma/schema.prisma is valid`.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260609010000_content_store/migration.sql
git commit -m "feat(server): add content store schema"
```

---

### Task 3: Environment and Storage Port

**Files:**
- Modify: `server/src/config/env.ts`
- Modify: `server/.env.example`
- Modify: `server/src/config/env.spec.ts`
- Create: `server/src/content-store/content-store.constants.ts`
- Create: `server/src/content-store/content-store-storage.ts`
- Create: `server/src/content-store/content-store-storage.spec.ts`

- [ ] **Step 1: Add constants**

Create `server/src/content-store/content-store.constants.ts`:

```ts
export const CONTENT_STORE_STORAGE_PORT = "ContentStoreStoragePort"
export const contentStoreLocalRootEnvKey = "SYNAPSE_CONTENT_STORE_LOCAL_ROOT"
export const contentStoreSkillMaxTotalBytes = 50 * 1024 * 1024
export const contentStoreSkillMaxFileBytes = 20 * 1024 * 1024
export const contentStoreSkillMaxFileCount = 200
export const contentStoreTextMaxBytes = 1024 * 1024
export const contentStoreInstallSessionTtlSeconds = 5 * 60
```

- [ ] **Step 2: Extend env schema**

Modify `server/src/config/env.ts` by adding fields to `envSchema`, `ServerEnv`, `loadEnv`, and a new helper:

```ts
CONTENT_STORE_COS_SECRET_ID: z.string().optional(),
CONTENT_STORE_COS_SECRET_KEY: z.string().optional(),
CONTENT_STORE_COS_BUCKET: z.string().optional(),
CONTENT_STORE_COS_REGION: z.string().optional(),
```

```ts
readonly contentStoreCosSecretId?: string
readonly contentStoreCosSecretKey?: string
readonly contentStoreCosBucket?: string
readonly contentStoreCosRegion?: string
```

```ts
contentStoreCosSecretId: result.data.CONTENT_STORE_COS_SECRET_ID,
contentStoreCosSecretKey: result.data.CONTENT_STORE_COS_SECRET_KEY,
contentStoreCosBucket: result.data.CONTENT_STORE_COS_BUCKET,
contentStoreCosRegion: result.data.CONTENT_STORE_COS_REGION,
```

```ts
export function isContentStoreCosConfigured(env: ServerEnv): boolean {
  return !!(
    env.contentStoreCosSecretId
    && env.contentStoreCosSecretKey
    && env.contentStoreCosBucket
    && env.contentStoreCosRegion
  )
}
```

- [ ] **Step 3: Add env tests**

Modify `server/src/config/env.spec.ts` with:

```ts
it("loads Content Store COS settings independently", () => {
  const env = loadEnv({
    ...validEnv(),
    CONTENT_STORE_COS_SECRET_ID: "content-secret-id",
    CONTENT_STORE_COS_SECRET_KEY: "content-secret-key",
    CONTENT_STORE_COS_BUCKET: "content-bucket",
    CONTENT_STORE_COS_REGION: "ap-beijing",
  })

  expect(env.contentStoreCosSecretId).toBe("content-secret-id")
  expect(env.contentStoreCosSecretKey).toBe("content-secret-key")
  expect(env.contentStoreCosBucket).toBe("content-bucket")
  expect(env.contentStoreCosRegion).toBe("ap-beijing")
  expect(isContentStoreCosConfigured(env)).toBe(true)
})
```

- [ ] **Step 4: Add `.env.example` comments**

Modify `server/.env.example` by adding:

```dotenv
# Content Store COS 配置
# Content Store 在线 Skill / Rule 安装包和草稿文件所在 COS SecretId；示例文件中必须留空。
CONTENT_STORE_COS_SECRET_ID=
# Content Store 在线 Skill / Rule 安装包和草稿文件所在 COS SecretKey；示例文件中必须留空。
CONTENT_STORE_COS_SECRET_KEY=
# Content Store 在线内容独立 COS 存储桶，不复用 Drive 存储桶。
CONTENT_STORE_COS_BUCKET=synapse-content-store-1252371654
# Content Store 在线内容独立 COS 存储桶地域。
CONTENT_STORE_COS_REGION=ap-beijing
```

- [ ] **Step 5: Implement storage port**

Create `server/src/content-store/content-store-storage.ts`:

```ts
import { Inject, Injectable, Optional } from "@nestjs/common"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import COS from "cos-nodejs-sdk-v5"
import { isContentStoreCosConfigured, loadEnv } from "../config/env"
import { contentStoreLocalRootEnvKey } from "./content-store.constants"

export interface ContentStoreStorageObject {
  readonly key: string
  readonly size: bigint
  readonly contentType?: string | null
}

export interface ContentStoreStoragePort {
  putObject(input: { readonly key: string; readonly body: Buffer | NodeJS.ReadableStream; readonly contentType?: string | null }): Promise<void>
  getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }>
  headObject(key: string): Promise<ContentStoreStorageObject | null>
  deleteObject(key: string): Promise<void>
}

export const LOCAL_CONTENT_STORE_STORAGE_OPTIONS = Symbol("LOCAL_CONTENT_STORE_STORAGE_OPTIONS")

export type LocalContentStoreStorageOptions = {
  readonly root?: string
}

@Injectable()
export class LocalContentStoreStorage implements ContentStoreStoragePort {
  private readonly contentTypes = new Map<string, string | null>()
  private readonly root: string

  constructor(@Optional() @Inject(LOCAL_CONTENT_STORE_STORAGE_OPTIONS) options?: LocalContentStoreStorageOptions) {
    this.root = options?.root ?? process.env[contentStoreLocalRootEnvKey] ?? path.join(os.tmpdir(), "synapse-content-store-storage")
  }

  async putObject(input: { readonly key: string; readonly body: Buffer | NodeJS.ReadableStream; readonly contentType?: string | null }): Promise<void> {
    const objectPath = this.pathForKey(input.key)
    await mkdir(path.dirname(objectPath), { recursive: true })
    if (Buffer.isBuffer(input.body)) {
      await import("node:fs/promises").then(({ writeFile }) => writeFile(objectPath, input.body))
    } else {
      await pipeline(input.body, createWriteStream(objectPath))
    }
    this.contentTypes.set(input.key, input.contentType ?? null)
  }

  async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
    const objectPath = this.pathForKey(input.key)
    const info = await stat(objectPath)
    return { stream: createReadStream(objectPath), size: BigInt(info.size), contentType: this.contentTypes.get(input.key) ?? null }
  }

  async headObject(key: string): Promise<ContentStoreStorageObject | null> {
    try {
      const info = await stat(this.pathForKey(key))
      return { key, size: BigInt(info.size), contentType: this.contentTypes.get(key) ?? null }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { readonly code?: string }).code === "ENOENT") return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathForKey(key), { force: true })
    this.contentTypes.delete(key)
  }

  private pathForKey(key: string): string {
    const objectPath = path.resolve(this.root, key)
    const rootPath = path.resolve(this.root)
    if (objectPath !== rootPath && !objectPath.startsWith(`${rootPath}${path.sep}`)) throw new Error("Invalid Content Store storage key.")
    return objectPath
  }
}

@Injectable()
export class CosContentStoreStorage implements ContentStoreStoragePort {
  private client: { readonly cos: COS; readonly bucket: string; readonly region: string } | null = null

  async putObject(input: { readonly key: string; readonly body: Buffer | NodeJS.ReadableStream; readonly contentType?: string | null }): Promise<void> {
    const client = this.getClient()
    await new Promise<void>((resolve, reject) => {
      client.cos.putObject({
        Bucket: client.bucket,
        Region: client.region,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType ?? undefined,
      }, (error) => error ? reject(error) : resolve())
    })
  }

  async getObjectStream(input: { readonly key: string }): Promise<{ readonly stream: NodeJS.ReadableStream; readonly size?: bigint; readonly contentType?: string | null }> {
    const client = this.getClient()
    const info = await this.headObjectRaw(input.key)
    const stream = client.cos.getObjectStream({ Bucket: client.bucket, Region: client.region, Key: input.key }) as unknown as NodeJS.ReadableStream
    return { stream, size: parseContentLength(info.headers?.["content-length"]), contentType: info.headers?.["content-type"] ?? null }
  }

  async headObject(key: string): Promise<ContentStoreStorageObject | null> {
    try {
      const result = await this.headObjectRaw(key)
      return { key, size: parseContentLength(result.headers?.["content-length"]) ?? 0n, contentType: result.headers?.["content-type"] ?? null }
    } catch (error) {
      if (isCosNotFound(error)) return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    const client = this.getClient()
    await new Promise<void>((resolve, reject) => {
      client.cos.deleteObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error) => error ? reject(error) : resolve())
    })
  }

  private headObjectRaw(key: string): Promise<{ readonly headers?: Record<string, string> }> {
    const client = this.getClient()
    return new Promise((resolve, reject) => {
      client.cos.headObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error, data) => error ? reject(error) : resolve(data))
    })
  }

  private getClient(): { readonly cos: COS; readonly bucket: string; readonly region: string } {
    if (this.client) return this.client
    const env = loadEnv(process.env)
    this.client = {
      cos: new COS({
        SecretId: requireConfig(env.contentStoreCosSecretId, "CONTENT_STORE_COS_SECRET_ID"),
        SecretKey: requireConfig(env.contentStoreCosSecretKey, "CONTENT_STORE_COS_SECRET_KEY"),
      }),
      bucket: requireConfig(env.contentStoreCosBucket, "CONTENT_STORE_COS_BUCKET"),
      region: requireConfig(env.contentStoreCosRegion, "CONTENT_STORE_COS_REGION"),
    }
    return this.client
  }
}

export function shouldUseCosContentStoreStorage(source: NodeJS.ProcessEnv = process.env): boolean {
  return isContentStoreCosConfigured(loadEnv(source))
}

function requireConfig(value: string | undefined, key: string): string {
  if (!value) throw new Error(`${key} is required for Content Store storage.`)
  return value
}

function parseContentLength(value: string | undefined): bigint | undefined {
  return value && /^\d+$/u.test(value) ? BigInt(value) : undefined
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && (error as { readonly statusCode?: number }).statusCode === 404
}
```

- [ ] **Step 6: Add local storage tests**

Create `server/src/content-store/content-store-storage.spec.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, afterEach } from "vitest"
import { LocalContentStoreStorage } from "./content-store-storage"

let roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

describe("LocalContentStoreStorage", () => {
  it("writes and reads objects under the configured root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-store-"))
    roots.push(root)
    const storage = new LocalContentStoreStorage({ root })

    await storage.putObject({ key: "content-store/drafts/user/draft/file.txt", body: Buffer.from("hello"), contentType: "text/plain" })
    const head = await storage.headObject("content-store/drafts/user/draft/file.txt")
    const object = await storage.getObjectStream({ key: "content-store/drafts/user/draft/file.txt" })

    expect(head).toMatchObject({ size: 5n, contentType: "text/plain" })
    expect(object.size).toBe(5n)
  })

  it("rejects storage keys that escape the root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-store-"))
    roots.push(root)
    const storage = new LocalContentStoreStorage({ root })

    await expect(storage.putObject({ key: "../escape.txt", body: Buffer.from("x") })).rejects.toThrow("Invalid Content Store storage key.")
  })
})
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- server/src/config/env.spec.ts server/src/content-store/content-store-storage.spec.ts
```

Expected: tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/config/env.ts server/.env.example server/src/config/env.spec.ts server/src/content-store/content-store.constants.ts server/src/content-store/content-store-storage.ts server/src/content-store/content-store-storage.spec.ts
git commit -m "feat(server): add content store storage"
```

---

### Task 4: File Rules and Package Builder

**Files:**
- Create: `server/src/content-store/content-store.types.ts`
- Create: `server/src/content-store/content-store-file-rules.ts`
- Create: `server/src/content-store/content-store-package.ts`
- Create: `server/src/content-store/content-store-file-rules.spec.ts`
- Create: `server/src/content-store/content-store-package.spec.ts`

- [ ] **Step 1: Add internal types**

Create `server/src/content-store/content-store.types.ts`:

```ts
import type { ContentStoreFileKind, ContentStoreType } from "@synapse/shared"

export type ContentStoreFileInput = {
  readonly path: string
  readonly bytes: Buffer
  readonly mimeType?: string | null
}

export type NormalizedContentStoreFile = {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: ContentStoreFileKind
  readonly mimeType: string | null
  readonly text: string | null
  readonly bytes: Buffer
}

export type ContentStorePackageInput = {
  readonly contentId: string
  readonly versionId: string
  readonly type: Extract<ContentStoreType, "skill" | "rule">
  readonly title: string
  readonly files: readonly NormalizedContentStoreFile[]
}
```

- [ ] **Step 2: Implement file validation**

Create `server/src/content-store/content-store-file-rules.ts`:

```ts
import { createHash } from "node:crypto"
import path from "node:path"
import { BadRequestException } from "@nestjs/common"
import {
  contentStoreSkillMaxFileBytes,
  contentStoreSkillMaxFileCount,
  contentStoreSkillMaxTotalBytes,
  contentStoreTextMaxBytes,
} from "./content-store.constants"
import type { ContentStoreFileInput, NormalizedContentStoreFile } from "./content-store.types"

const obviousBinaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".gz", ".tar", ".pdf", ".exe", ".dll", ".dylib", ".so"])
const textExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".css", ".html", ".xml", ".toml", ".ini"])

export function normalizeSkillFiles(files: readonly ContentStoreFileInput[]): NormalizedContentStoreFile[] {
  if (files.length === 0) throw new BadRequestException("Skill 文件不能为空。")
  if (files.length > contentStoreSkillMaxFileCount) throw new BadRequestException("Skill 文件数量超过 200 个。")
  const seen = new Set<string>()
  let total = 0
  const normalized = files.map((file) => {
    const relativePath = normalizeContentStorePath(file.path)
    const key = relativePath.toLowerCase()
    if (seen.has(key)) throw new BadRequestException("Skill 文件路径重复。")
    seen.add(key)
    if (file.bytes.length > contentStoreSkillMaxFileBytes) throw new BadRequestException("Skill 单文件超过 20MB。")
    total += file.bytes.length
    if (total > contentStoreSkillMaxTotalBytes) throw new BadRequestException("Skill 文件总大小超过 50MB。")
    return normalizeFile(relativePath, file.bytes, file.mimeType ?? null)
  })
  const skillFile = normalized.find((file) => file.path === "SKILL.md")
  if (!skillFile || skillFile.kind !== "text" || !skillFile.text?.trim()) throw new BadRequestException("Skill 必须包含非空 SKILL.md。")
  return normalized
}

export function normalizeRuleBody(body: string): NormalizedContentStoreFile {
  return normalizeTextBody("RULE.md", body, "Rule 正文不能为空。")
}

export function normalizePromptBody(body: string): string {
  const buffer = Buffer.from(body, "utf8")
  if (!body.trim()) throw new BadRequestException("Prompt 正文不能为空。")
  if (buffer.length > contentStoreTextMaxBytes) throw new BadRequestException("Prompt 正文超过 1MB。")
  return body
}

export function normalizeContentStorePath(input: string): string {
  const trimmed = input.trim().replace(/\\/gu, "/")
  if (!trimmed) throw new BadRequestException("文件路径不能为空。")
  if (trimmed.startsWith("/") || /^[a-zA-Z]:\//u.test(trimmed)) throw new BadRequestException("文件路径必须是相对路径。")
  const normalized = path.posix.normalize(trimmed)
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) throw new BadRequestException("文件路径不能包含上级目录。")
  return normalized
}

export function detectContentStoreFileKind(relativePath: string, bytes: Buffer): { readonly kind: "text" | "binary"; readonly text: string | null } {
  const extension = path.posix.extname(relativePath).toLowerCase()
  if (obviousBinaryExtensions.has(extension)) return { kind: "binary", text: null }
  if (textExtensions.has(extension)) return decodeUtf8(bytes) ?? { kind: "binary", text: null }
  return decodeUtf8(bytes) ?? { kind: "binary", text: null }
}

function normalizeTextBody(pathName: string, body: string, emptyMessage: string): NormalizedContentStoreFile {
  const bytes = Buffer.from(body, "utf8")
  if (!body.trim()) throw new BadRequestException(emptyMessage)
  if (bytes.length > contentStoreTextMaxBytes) throw new BadRequestException("正文超过 1MB。")
  return normalizeFile(pathName, bytes, "text/markdown")
}

function normalizeFile(relativePath: string, bytes: Buffer, mimeType: string | null): NormalizedContentStoreFile {
  const detected = detectContentStoreFileKind(relativePath, bytes)
  return {
    path: relativePath,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: detected.kind,
    mimeType,
    text: detected.text,
    bytes,
  }
}

function decodeUtf8(bytes: Buffer): { readonly kind: "text"; readonly text: string } | null {
  const text = bytes.toString("utf8")
  if (text.includes("\u0000")) return null
  let controls = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls += 1
  }
  if (controls > Math.max(4, text.length * 0.02)) return null
  return { kind: "text", text }
}
```

- [ ] **Step 3: Implement package builder**

Create `server/src/content-store/content-store-package.ts`:

```ts
import archiver from "archiver"
import { createHash } from "node:crypto"
import { PassThrough } from "node:stream"
import type { ContentStoreInstallManifest } from "@synapse/shared"
import type { ContentStorePackageInput } from "./content-store.types"

export async function buildContentStorePackage(input: ContentStorePackageInput): Promise<{ readonly bytes: Buffer; readonly sha256: string; readonly manifest: ContentStoreInstallManifest }> {
  const mainFile = input.type === "skill" ? "content/SKILL.md" : "content/RULE.md"
  const manifest: ContentStoreInstallManifest = {
    schemaVersion: 1,
    contentId: input.contentId,
    versionId: input.versionId,
    type: input.type,
    title: input.title,
    mainFile,
    files: input.files.map((file) => ({
      path: `content/${file.path}`,
      size: file.size,
      sha256: file.sha256,
      kind: file.kind,
    })),
  }
  const archive = archiver("zip", { zlib: { level: 9 } })
  const output = new PassThrough()
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    output.on("end", () => resolve(Buffer.concat(chunks)))
    output.on("error", reject)
    archive.on("error", reject)
  })
  archive.pipe(output)
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" })
  for (const file of input.files) archive.append(file.bytes, { name: `content/${file.path}` })
  await archive.finalize()
  const bytes = await done
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), manifest }
}
```

- [ ] **Step 4: Add file rules tests**

Create `server/src/content-store/content-store-file-rules.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import { detectContentStoreFileKind, normalizeContentStorePath, normalizePromptBody, normalizeRuleBody, normalizeSkillFiles } from "./content-store-file-rules"

describe("content store file rules", () => {
  it("requires a non-empty SKILL.md", () => {
    expect(() => normalizeSkillFiles([{ path: "references/a.md", bytes: Buffer.from("x") }])).toThrow(BadRequestException)
    expect(normalizeSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("# Skill") }])[0]).toMatchObject({ path: "SKILL.md", kind: "text" })
  })

  it("rejects paths that escape the content root", () => {
    expect(() => normalizeContentStorePath("../secret")).toThrow("文件路径不能包含上级目录。")
    expect(() => normalizeContentStorePath("/tmp/secret")).toThrow("文件路径必须是相对路径。")
    expect(normalizeContentStorePath("references\\guide.md")).toBe("references/guide.md")
  })

  it("detects text and binary content", () => {
    expect(detectContentStoreFileKind("script.sh", Buffer.from("#!/bin/sh\necho hi")).kind).toBe("text")
    expect(detectContentStoreFileKind("image.png", Buffer.from([0, 1, 2, 3])).kind).toBe("binary")
  })

  it("normalizes rule and prompt text limits", () => {
    expect(normalizeRuleBody("Use terse responses.")).toMatchObject({ path: "RULE.md", kind: "text" })
    expect(normalizePromptBody("Write a release note.")).toBe("Write a release note.")
  })
})
```

- [ ] **Step 5: Add package tests**

Create `server/src/content-store/content-store-package.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { normalizeRuleBody, normalizeSkillFiles } from "./content-store-file-rules"
import { buildContentStorePackage } from "./content-store-package"

describe("buildContentStorePackage", () => {
  it("creates a skill package manifest with stable content paths", async () => {
    const files = normalizeSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("# Skill") }])
    const result = await buildContentStorePackage({ contentId: "content-1", versionId: "version-1", type: "skill", title: "Skill", files })

    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.manifest).toMatchObject({
      contentId: "content-1",
      versionId: "version-1",
      type: "skill",
      mainFile: "content/SKILL.md",
    })
    expect(result.manifest.files[0]?.path).toBe("content/SKILL.md")
  })

  it("creates a rule package with RULE.md as the main file", async () => {
    const file = normalizeRuleBody("Use concise language.")
    const result = await buildContentStorePackage({ contentId: "content-2", versionId: "version-2", type: "rule", title: "Rule", files: [file] })

    expect(result.manifest.mainFile).toBe("content/RULE.md")
    expect(result.manifest.files[0]?.path).toBe("content/RULE.md")
  })
})
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- server/src/content-store/content-store-file-rules.spec.ts server/src/content-store/content-store-package.spec.ts
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/content-store/content-store.types.ts server/src/content-store/content-store-file-rules.ts server/src/content-store/content-store-package.ts server/src/content-store/content-store-file-rules.spec.ts server/src/content-store/content-store-package.spec.ts
git commit -m "feat(server): add content store package utilities"
```

---

### Task 5: Content Store Service

**Files:**
- Create: `server/src/content-store/content-store.service.ts`
- Create: `server/src/content-store/content-store.service.spec.ts`

- [ ] **Step 1: Write service behavior tests**

Create `server/src/content-store/content-store.service.spec.ts` with mocked Prisma and storage. Include these tests:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContentStoreService } from "./content-store.service"

describe("ContentStoreService", () => {
  const prisma = createPrismaMock()
  const storage = { putObject: vi.fn(), getObjectStream: vi.fn(), headObject: vi.fn(), deleteObject: vi.fn() }
  let service: ContentStoreService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ContentStoreService(prisma as never, storage)
  })

  it("creates a private skill draft with SKILL.md", async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma))
    prisma.contentStoreItem.create.mockResolvedValue(item({ id: "item-1", type: "skill" }))
    prisma.contentStoreDraft.create.mockResolvedValue(draft({ id: "draft-1", itemId: "item-1" }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })

    const result = await service.createDraft("user-1", {
      type: "skill",
      title: "My Skill",
      description: null,
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") }],
    })

    expect(result.itemId).toBe("item-1")
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ key: expect.stringContaining("content-store/drafts/user-1/draft-1/") }))
  })

  it("rejects public visibility without description", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({ id: "item-1", ownerUserId: "user-1", description: null }))

    await expect(service.setVisibility("user-1", "item-1", "public")).rejects.toThrow(BadRequestException)
  })

  it("publishes skill drafts by creating an immutable package", async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma))
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draftWithSkillFile())
    prisma.contentStoreVersion.create.mockResolvedValue(version({ id: "version-1", versionNumber: 1 }))
    prisma.contentStoreItem.update.mockResolvedValue(item({ id: "item-1", latestVersionId: "version-1" }))

    const result = await service.publishDraft("user-1", "item-1", 1)

    expect(result.versionNumber).toBe(1)
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ key: "content-store/packages/item-1/version-1.zip", contentType: "application/zip" }))
  })

  it("creates install sessions only for installable skill and rule versions", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({ id: "item-1", type: "prompt", visibility: "public", latestVersionId: "version-1" }))

    await expect(service.createInstallSession("user-1", "item-1", "synapse://content-install")).rejects.toThrow(BadRequestException)
  })

  it("requires the install session user to match the desktop user", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000),
      status: "pending",
      item: item({ id: "item-1", type: "skill" }),
      version: version({ id: "version-1", packageKey: "content-store/packages/item-1/version-1.zip", packageSha256: "a".repeat(64) }),
    })

    await expect(service.resolveInstallSession("user-2", "session-1")).rejects.toThrow(ForbiddenException)
  })
})
```

Use helper factories in the same file:

```ts
function createPrismaMock() {
  return {
    $transaction: vi.fn(),
    contentStoreItem: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    contentStoreDraft: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    contentStoreVersion: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    contentStoreFile: { createMany: vi.fn(), deleteMany: vi.fn() },
    contentStoreInstallSession: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    contentStoreInstallEvent: { upsert: vi.fn(), count: vi.fn() },
  }
}
```

- [ ] **Step 2: Implement service methods**

Create `server/src/content-store/content-store.service.ts` with public methods:

```ts
createDraft(userId: string, input: CreateContentStoreDraftInput): Promise<ContentStoreDraftDto>
saveDraft(userId: string, itemId: string, baseRevision: number, input: SaveContentStoreDraftInput): Promise<ContentStoreDraftDto>
publishDraft(userId: string, itemId: string, baseRevision: number): Promise<ContentStoreVersionDto>
listStore(userId: string, options: ListContentStoreOptions): Promise<PaginatedResponse<ContentStoreItemDto>>
listMine(userId: string, options: ListContentStoreOptions): Promise<PaginatedResponse<ContentStoreItemDto>>
getDetail(userId: string, itemId: string): Promise<ContentStoreDetailDto>
copyToMine(userId: string, itemId: string): Promise<ContentStoreItemDto>
setVisibility(userId: string, itemId: string, visibility: "private" | "public"): Promise<ContentStoreItemDto>
deletePrivateItem(userId: string, itemId: string): Promise<{ ok: true }>
createInstallSession(userId: string, itemId: string, deepLinkBase: string): Promise<ContentStoreInstallSessionDto>
resolveInstallSession(userId: string, sessionId: string): Promise<ResolvedContentStoreInstallSession>
recordInstall(userId: string, sessionId: string, clientInstanceId: string): Promise<{ ok: true }>
listAdmin(options: AdminListContentStoreOptions): Promise<PaginatedResponse<ContentStoreItemDto>>
getAdminDetail(itemId: string): Promise<ContentStoreDetailDto>
setFeaturedAsAdmin(adminEmail: string, ipAddress: string, itemId: string, featured: boolean): Promise<ContentStoreItemDto>
setRemovedAsAdmin(adminEmail: string, ipAddress: string, itemId: string, removed: boolean): Promise<ContentStoreItemDto>
```

Implement these exact rules:

- `createDraft` creates a private item and one draft.
- Skill draft files use `normalizeSkillFiles`; Rule uses `normalizeRuleBody`; Prompt uses `normalizePromptBody`.
- Draft files are written to storage under `content-store/drafts/<userId>/<draftId>/<sha256>`.
- `saveDraft` rejects mismatched `baseRevision` with `BadRequestException("草稿已在其它页面更新，请刷新后继续。")`.
- `publishDraft` creates the next version number from current version count + 1.
- `publishDraft` creates Skill / Rule package before marking latest version.
- Prompt publish stores body snapshot and no package.
- `setVisibility(public)` requires `description` with non-empty trimmed text.
- Store listing only returns public + normal items.
- Mine listing returns owner items regardless of visibility and moderation.
- Deleted private item is hard-deleted only when `visibility === "private"`.
- `copyToMine` copies latest version into a new private item and draftless published version.
- Install sessions require Skill or Rule, latest version, package key, package hash, and normal moderation.
- Private install session is allowed only for owner.
- `resolveInstallSession` requires matching user and non-expired pending session.
- `recordInstall` uses upsert on unique `(userId, itemId, versionId, clientInstanceId)`.
- Admin feature/remove methods write `AuditLog` action strings `content_store.feature`, `content_store.unfeature`, `content_store.remove`, `content_store.restore`.

- [ ] **Step 3: Run service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- server/src/content-store/content-store.service.spec.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/content-store/content-store.service.ts server/src/content-store/content-store.service.spec.ts
git commit -m "feat(server): add content store service"
```

---

### Task 6: User and Admin Controllers

**Files:**
- Create: `server/src/content-store/content-store.controller.ts`
- Create: `server/src/content-store/content-store.controller.spec.ts`

- [ ] **Step 1: Implement controller schemas and routes**

Create `server/src/content-store/content-store.controller.ts` with:

```ts
@UseGuards(UserAuthGuard)
@Controller("/api/content-store")
export class ContentStoreUserController {
  constructor(private readonly service: ContentStoreService) {}

  @Get("/items")
  listStore(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {}

  @Get("/mine")
  listMine(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {}

  @Post("/drafts")
  createDraft(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {}

  @Put("/items/:id/draft")
  saveDraft(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {}

  @Post("/items/:id/publish")
  publishDraft(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {}

  @Get("/items/:id")
  getDetail(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {}

  @Post("/items/:id/copy")
  copyToMine(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {}

  @Post("/items/:id/visibility")
  setVisibility(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {}

  @Delete("/items/:id")
  deletePrivateItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {}

  @Post("/items/:id/install-sessions")
  createInstallSession(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {}

  @Get("/install-sessions/:id")
  resolveInstallSession(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {}

  @Post("/install-sessions/:id/complete")
  recordInstall(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {}
}

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/content-store")
export class ContentStoreAdminController {
  constructor(private readonly service: ContentStoreService) {}

  @Get("/items")
  listAdmin(@Query() query: Record<string, unknown>) {}

  @Get("/items/:id")
  getAdminDetail(@Param("id") id: string) {}

  @Post("/items/:id/featured")
  setFeatured(@Param("id") id: string, @Body() body: unknown, @Req() request: AdminRequest) {}

  @Post("/items/:id/removed")
  setRemoved(@Param("id") id: string, @Body() body: unknown, @Req() request: AdminRequest) {}
}
```

Use Zod schemas:

```ts
const contentTypeSchema = z.enum(["skill", "rule", "prompt"])
const fileSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  contentBase64: z.string().min(1),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()
const createDraftSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("skill"), title: z.string().trim().min(1).max(160), description: z.string().nullable().optional(), localSourceFingerprint: z.string().trim().max(128).nullable().optional(), files: z.array(fileSchema).min(1).max(200) }).strict(),
  z.object({ type: z.literal("rule"), title: z.string().trim().min(1).max(160), description: z.string().nullable().optional(), body: z.string().min(1) }).strict(),
  z.object({ type: z.literal("prompt"), title: z.string().trim().min(1).max(160), description: z.string().nullable().optional(), body: z.string().min(1) }).strict(),
])
const saveDraftSchema = createDraftSchema.and(z.object({ baseRevision: z.number().int().positive() }).strict())
const publishDraftSchema = z.object({ baseRevision: z.number().int().positive() }).strict()
const visibilitySchema = z.object({ visibility: z.enum(["private", "public"]) }).strict()
const installCompleteSchema = z.object({ clientInstanceId: z.string().trim().min(1).max(120) }).strict()
const booleanValueSchema = z.object({ value: z.boolean() }).strict()
```

Use `parsePagination(query, { allowedSortFields: ["createdAt", "updatedAt", "installCount"] })` for list routes.

- [ ] **Step 2: Add controller tests**

Create `server/src/content-store/content-store.controller.spec.ts` with tests that instantiate controllers directly and mock service methods:

```ts
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { ContentStoreAdminController, ContentStoreUserController } from "./content-store.controller"

describe("ContentStoreUserController", () => {
  it("parses skill draft payloads and passes the authenticated user", async () => {
    const service = { createDraft: vi.fn().mockResolvedValue({ id: "draft-1" }) }
    const controller = new ContentStoreUserController(service as never)

    await controller.createDraft({
      type: "skill",
      title: "Skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") }],
    }, { user: { id: "user-1" } } as never)

    expect(service.createDraft).toHaveBeenCalledWith("user-1", expect.objectContaining({ type: "skill", title: "Skill" }))
  })

  it("rejects invalid visibility payloads", async () => {
    const controller = new ContentStoreUserController({ setVisibility: vi.fn() } as never)

    await expect(controller.setVisibility("item-1", { visibility: "team" }, { user: { id: "user-1" } } as never)).rejects.toThrow(BadRequestException)
  })
})

describe("ContentStoreAdminController", () => {
  it("passes admin identity into moderation actions", async () => {
    const service = { setRemovedAsAdmin: vi.fn().mockResolvedValue({ id: "item-1" }) }
    const controller = new ContentStoreAdminController(service as never)

    await controller.setRemoved("item-1", { value: true }, { admin: { email: "admin@example.com" }, ip: "127.0.0.1" } as never)

    expect(service.setRemovedAsAdmin).toHaveBeenCalledWith("admin@example.com", "127.0.0.1", "item-1", true)
  })
})
```

- [ ] **Step 3: Run controller tests**

Run:

```bash
pnpm --filter @synapse/server run test -- server/src/content-store/content-store.controller.spec.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/content-store/content-store.controller.ts server/src/content-store/content-store.controller.spec.ts
git commit -m "feat(server): add content store controllers"
```

---

### Task 7: Module Registration

**Files:**
- Create: `server/src/content-store/content-store.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Create module**

Create `server/src/content-store/content-store.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { CONTENT_STORE_STORAGE_PORT } from "./content-store.constants"
import { ContentStoreAdminController, ContentStoreUserController } from "./content-store.controller"
import { ContentStoreService } from "./content-store.service"
import { CosContentStoreStorage, LocalContentStoreStorage, shouldUseCosContentStoreStorage } from "./content-store-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [ContentStoreUserController, ContentStoreAdminController],
  providers: [
    ContentStoreService,
    AuditLogService,
    CosContentStoreStorage,
    LocalContentStoreStorage,
    {
      provide: CONTENT_STORE_STORAGE_PORT,
      useFactory: (cos: CosContentStoreStorage, local: LocalContentStoreStorage) => shouldUseCosContentStoreStorage() ? cos : local,
      inject: [CosContentStoreStorage, LocalContentStoreStorage],
    },
  ],
  exports: [ContentStoreService],
})
export class ContentStoreModule {}
```

- [ ] **Step 2: Register in app module**

Modify `server/src/app.module.ts`:

```ts
import { ContentStoreModule } from "./content-store/content-store.module"
```

Add `ContentStoreModule` to `imports` before `DriveModule`.

- [ ] **Step 3: Run server typecheck**

Run:

```bash
pnpm --filter @synapse/server run typecheck
```

Expected: command exits 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/content-store/content-store.module.ts server/src/app.module.ts
git commit -m "feat(server): register content store module"
```

---

### Task 8: API Integration Tests

**Files:**
- Create or extend: `server/src/content-store/content-store.controller.spec.ts`

- [ ] **Step 1: Add request-level tests**

Extend `server/src/content-store/content-store.controller.spec.ts` with a Nest testing module using `supertest`. Cover:

```ts
it("requires user auth for store list", async () => {
  await request(app.getHttpServer()).get("/api/content-store/items").expect(401)
})

it("requires admin auth for admin content list", async () => {
  await request(app.getHttpServer()).get("/api/admin/content-store/items").expect(401)
})

it("returns validation errors for invalid draft payloads", async () => {
  await request(app.getHttpServer())
    .post("/api/content-store/drafts")
    .set("Authorization", "Bearer user-token")
    .send({ type: "skill", title: "" })
    .expect(400)
})
```

Mock `UserAuthGuard` and `AdminAuthGuard` in the test module for authenticated cases:

```ts
class AllowUserGuard {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest().user = { id: "user-1" }
    return true
  }
}

class AllowAdminGuard {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest().admin = { email: "admin@example.com" }
    return true
  }
}
```

- [ ] **Step 2: Run request tests**

Run:

```bash
pnpm --filter @synapse/server run test -- server/src/content-store/content-store.controller.spec.ts
```

Expected: tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/content-store/content-store.controller.spec.ts
git commit -m "test(server): cover content store API guards"
```

---

### Task 9: Release Notes and Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add a user-facing entry:

```md
- 新增在线内容商店的服务端基础能力，为后续 Skill / Rule / Prompt 云端发布、私有草稿、公开商店、精选治理和客户端安装打下基础。
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/server run test -- server/src/content-store server/src/config/env.spec.ts
pnpm --filter @synapse/server run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 3: Run Prisma validation**

Run:

```bash
pnpm --filter @synapse/server exec prisma validate --schema server/prisma/schema.prisma
```

Expected: schema is valid.

- [ ] **Step 4: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note content store server foundation"
```

---

## Self-Review Checklist

- The plan implements server foundation only and leaves Dashboard/Desktop to separate plans.
- The plan covers the spec requirements for server-side source of truth, independent object storage, drafts, versions, package generation, install sessions, admin governance, and install counting.
- The plan does not implement UI, Monaco, Dashboard fallback, Desktop protocol window, or local Skill upload UI.
- The plan uses explicit paths and commands for each task.
- The plan includes tests before implementation tasks.
- The plan preserves old local repository behavior.
