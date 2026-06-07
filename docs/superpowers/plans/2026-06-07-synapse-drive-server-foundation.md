# Synapse Drive Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side foundation for Synapse Drive: data model, quota reservation, direct-to-COS upload sessions, public file/folder sharing, admin deletion, and tests.

**Architecture:** Add a focused `DriveModule` under `server/src/drive/` with separate token, DTO, storage, service, and controller files. User-facing APIs live under `/api/drive/*`, admin APIs under `/api/admin/drive/*`, and public share routes under `/files/*`. The server creates all item ids and COS keys, issues short-lived upload/download URLs through a storage adapter, and verifies upload completion before activating files.

**Tech Stack:** NestJS, Prisma/PostgreSQL, `cos-nodejs-sdk-v5`, zod, Vitest, supertest, existing `@synapse/shared` URL helpers.

---

## Scope Boundary

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-07-synapse-drive-design.md`: server foundation only.

Follow-up plans should cover:

- Desktop client `云盘` UI and direct upload integration.
- Dashboard admin table UI.
- MCP `drive` domain and built-in `synapse-drive-mcp` skill.

## File Structure

- Create `shared/src/drive.ts`: shared constants, DTOs, and public URL builder.
- Modify `shared/src/index.ts`: export drive helpers.
- Create `shared/src/drive.test.ts`: URL and DTO helper tests.
- Modify `server/prisma/schema.prisma`: add `DriveItem`, `DriveShare`, `DriveUsage`, `DriveUploadSession`, and `User.driveItems` relation.
- Create `server/prisma/migrations/20260607110000_synapse_drive/migration.sql`: SQL migration matching the Prisma schema.
- Create `server/src/drive/drive.constants.ts`: quota, size, status, and URL expiry constants.
- Create `server/src/drive/drive-token.ts`: share id generation and storage key helpers.
- Create `server/src/drive/drive-storage.ts`: COS storage adapter interface and implementation.
- Create `server/src/drive/drive.types.ts`: internal service types and DTO mapping helpers.
- Create `server/src/drive/drive.service.ts`: ownership, tree, quota, upload session, share, public access, and admin operations.
- Create `server/src/drive/drive.controller.ts`: user, admin, and public controllers.
- Create `server/src/drive/drive.module.ts`: Nest module wiring.
- Modify `server/src/app.module.ts`: import `DriveModule`.
- Create `server/src/drive/drive-token.spec.ts`: id/key helper tests.
- Create `server/src/drive/drive.service.spec.ts`: focused service tests with mocked storage.
- Create `server/src/drive/drive.controller.spec.ts`: authenticated API and public route tests.

## Shared DTO Shape

Use these shared types consistently across controller responses:

```ts
export const DRIVE_PUBLIC_PATH_PREFIX = "/files"

export type DriveItemType = "file" | "folder"
export type DriveStorageStatus = "pending" | "active" | "delete_pending" | "deleted" | "failed"
export type DriveUploadSessionStatus = "pending" | "completed" | "cancelled" | "expired" | "failed"

export interface DriveItemDto {
  readonly id: string
  readonly parentId: string | null
  readonly type: DriveItemType
  readonly name: string
  readonly size: string
  readonly mimeType: string | null
  readonly storageStatus: DriveStorageStatus
  readonly shared: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DriveUploadPrepareResult {
  readonly sessionId: string
  readonly item: DriveItemDto
  readonly upload: {
    readonly method: "PUT"
    readonly url: string
    readonly expiresAt: string
    readonly headers: Record<string, string>
  }
}

export interface DriveShareDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly enabled: boolean
  readonly url: string
  readonly createdAt: string
}

export interface DriveUsageDto {
  readonly usedBytes: string
  readonly reservedBytes: string
  readonly quotaBytes: string
}
```

## Task 1: Shared Drive Helpers

**Files:**
- Create: `shared/src/drive.ts`
- Create: `shared/src/drive.test.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write shared helper tests**

Create `shared/src/drive.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DRIVE_PUBLIC_PATH_PREFIX, buildDriveShareUrl, maskDriveShareUrl } from "./drive"

describe("drive URL helpers", () => {
  it("builds public drive share URLs", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub/", shareId: "shr_abc" }))
      .toBe("https://synapse.d2.pub/files/shr_abc")
  })

  it("encodes share ids", () => {
    expect(buildDriveShareUrl({ publicAppUrl: "https://synapse.d2.pub", shareId: "shr_a/b" }))
      .toBe("https://synapse.d2.pub/files/shr_a%2Fb")
  })

  it("masks share URL ids for logs", () => {
    expect(maskDriveShareUrl("https://synapse.d2.pub/files/shr_secret"))
      .toBe("https://synapse.d2.pub/files/***")
  })

  it("uses the files public prefix", () => {
    expect(DRIVE_PUBLIC_PATH_PREFIX).toBe("/files")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/shared exec vitest run src/drive.test.ts`

Expected: FAIL because `shared/src/drive.ts` does not exist.

- [ ] **Step 3: Implement shared helpers**

Create `shared/src/drive.ts`:

```ts
export const DRIVE_PUBLIC_PATH_PREFIX = "/files"

export type DriveItemType = "file" | "folder"
export type DriveStorageStatus = "pending" | "active" | "delete_pending" | "deleted" | "failed"
export type DriveUploadSessionStatus = "pending" | "completed" | "cancelled" | "expired" | "failed"

export interface DriveItemDto {
  readonly id: string
  readonly parentId: string | null
  readonly type: DriveItemType
  readonly name: string
  readonly size: string
  readonly mimeType: string | null
  readonly storageStatus: DriveStorageStatus
  readonly shared: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DriveUploadPrepareResult {
  readonly sessionId: string
  readonly item: DriveItemDto
  readonly upload: {
    readonly method: "PUT"
    readonly url: string
    readonly expiresAt: string
    readonly headers: Record<string, string>
  }
}

export interface DriveShareDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly enabled: boolean
  readonly url: string
  readonly createdAt: string
}

export interface DriveUsageDto {
  readonly usedBytes: string
  readonly reservedBytes: string
  readonly quotaBytes: string
}

export function buildDriveShareUrl(input: {
  readonly publicAppUrl: string
  readonly shareId: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${DRIVE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(input.shareId)}`
}

export function maskDriveShareUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 3 && parts[1] === "files") {
      parts[2] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return value.replace(/\/files\/[^/?#]+/u, "/files/***")
  }
  return value.replace(/\/files\/[^/?#]+/u, "/files/***")
}

function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}
```

Modify `shared/src/index.ts`:

```ts
export * from "./drive.js"
export * from "./live.js"
export * from "./urls.js"
export * from "./webhook.js"
```

- [ ] **Step 4: Run shared tests**

Run: `pnpm --filter @synapse/shared exec vitest run src/drive.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts shared/src/index.ts
git commit -m "feat(shared): add drive URL helpers"
```

## Task 2: Prisma Drive Schema

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260607110000_synapse_drive/migration.sql`

- [ ] **Step 1: Add schema models**

Modify `server/prisma/schema.prisma`:

```prisma
model User {
  id                  String                 @id @default(cuid())
  email               String                 @unique
  displayName         String?                @db.VarChar(40)
  passwordHash        String
  passwordChangedAt   DateTime?
  status              UserStatus             @default(active)
  memberships         TeamMembership[]
  createdTeams        Team[]                 @relation("TeamCreator")
  sessions            UserSession[]
  desktopLoginCodes   DesktopLoginCode[]
  passwordResetTokens UserPasswordResetToken[]
  acceptedInvitations Invitation[]           @relation("AcceptedInvitations")
  createdInvitations  Invitation[]           @relation("UserCreatedInvitations")
  modulePermissions   UserModulePermission[]
  webhooks            UserWebhook[]
  devices             UserDevice[]
  driveItems          DriveItem[]
  driveUploadSessions DriveUploadSession[]
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt
}
```

Append these models after `WebhookDeliveryReceipt`:

```prisma
model DriveItem {
  id                   String              @id @default(cuid())
  userId               String
  user                 User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  parentId             String?
  parent               DriveItem?          @relation("DriveTree", fields: [parentId], references: [id], onDelete: Restrict)
  children             DriveItem[]         @relation("DriveTree")
  type                 String              @db.VarChar(16)
  name                 String              @db.VarChar(255)
  size                 BigInt              @default(0)
  mimeType             String?             @db.VarChar(255)
  storageKey           String?             @unique
  storageStatus        String              @db.VarChar(32)
  uploadStatus         String              @db.VarChar(32)
  storageDeletePending Boolean             @default(false)
  deletedAt            DateTime?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt
  shares               DriveShare[]
  uploadSessions       DriveUploadSession[]

  @@index([userId, parentId, deletedAt, createdAt])
  @@index([userId, deletedAt, updatedAt])
  @@index([storageStatus])
}

model DriveShare {
  id              String    @id @default(cuid())
  shareId         String    @unique
  itemId          String
  item            DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  userId          String
  type            String    @db.VarChar(16)
  enabled         Boolean   @default(true)
  passwordEnabled Boolean   @default(false)
  passwordHash    String?
  expiresAt       DateTime?
  createdAt       DateTime  @default(now())
  disabledAt      DateTime?

  @@index([itemId, enabled])
  @@index([userId, createdAt])
}

model DriveUsage {
  userId        String   @id
  usedBytes     BigInt   @default(0)
  reservedBytes BigInt   @default(0)
  quotaBytes    BigInt
  updatedAt     DateTime @updatedAt
}

model DriveUploadSession {
  id             String    @id @default(cuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  itemId         String
  item           DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  storageKey     String
  expectedName   String    @db.VarChar(255)
  expectedSize   BigInt
  expectedMime   String?   @db.VarChar(255)
  status         String    @db.VarChar(32)
  credentialKind String    @db.VarChar(32)
  expiresAt      DateTime
  createdAt      DateTime  @default(now())
  completedAt    DateTime?
  failedAt       DateTime?

  @@index([userId, status, createdAt])
  @@index([expiresAt, status])
  @@index([itemId])
}
```

- [ ] **Step 2: Add SQL migration**

Create `server/prisma/migrations/20260607110000_synapse_drive/migration.sql`:

```sql
CREATE TABLE "DriveItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentId" TEXT,
  "type" VARCHAR(16) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "size" BIGINT NOT NULL DEFAULT 0,
  "mimeType" VARCHAR(255),
  "storageKey" TEXT,
  "storageStatus" VARCHAR(32) NOT NULL,
  "uploadStatus" VARCHAR(32) NOT NULL,
  "storageDeletePending" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriveItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveShare" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "passwordEnabled" BOOLEAN NOT NULL DEFAULT false,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "DriveShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveUsage" (
  "userId" TEXT NOT NULL,
  "usedBytes" BIGINT NOT NULL DEFAULT 0,
  "reservedBytes" BIGINT NOT NULL DEFAULT 0,
  "quotaBytes" BIGINT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriveUsage_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "DriveUploadSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "expectedName" VARCHAR(255) NOT NULL,
  "expectedSize" BIGINT NOT NULL,
  "expectedMime" VARCHAR(255),
  "status" VARCHAR(32) NOT NULL,
  "credentialKind" VARCHAR(32) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  CONSTRAINT "DriveUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveItem_storageKey_key" ON "DriveItem"("storageKey");
CREATE INDEX "DriveItem_userId_parentId_deletedAt_createdAt_idx" ON "DriveItem"("userId", "parentId", "deletedAt", "createdAt");
CREATE INDEX "DriveItem_userId_deletedAt_updatedAt_idx" ON "DriveItem"("userId", "deletedAt", "updatedAt");
CREATE INDEX "DriveItem_storageStatus_idx" ON "DriveItem"("storageStatus");
CREATE UNIQUE INDEX "DriveShare_shareId_key" ON "DriveShare"("shareId");
CREATE INDEX "DriveShare_itemId_enabled_idx" ON "DriveShare"("itemId", "enabled");
CREATE INDEX "DriveShare_userId_createdAt_idx" ON "DriveShare"("userId", "createdAt");
CREATE INDEX "DriveUploadSession_userId_status_createdAt_idx" ON "DriveUploadSession"("userId", "status", "createdAt");
CREATE INDEX "DriveUploadSession_expiresAt_status_idx" ON "DriveUploadSession"("expiresAt", "status");
CREATE INDEX "DriveUploadSession_itemId_idx" ON "DriveUploadSession"("itemId");

ALTER TABLE "DriveItem" ADD CONSTRAINT "DriveItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveItem" ADD CONSTRAINT "DriveItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveShare" ADD CONSTRAINT "DriveShare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveUploadSession" ADD CONSTRAINT "DriveUploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveUploadSession" ADD CONSTRAINT "DriveUploadSession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run: `pnpm --filter @synapse/server run prisma:generate`

Expected: command exits 0 and generated Prisma client includes `driveItem`, `driveShare`, `driveUsage`, and `driveUploadSession`.

- [ ] **Step 4: Run typecheck for schema consumers**

Run: `pnpm --filter @synapse/server run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260607110000_synapse_drive/migration.sql
git commit -m "feat(server): add drive prisma schema"
```

## Task 3: Drive Tokens And Storage Adapter

**Files:**
- Create: `server/src/drive/drive.constants.ts`
- Create: `server/src/drive/drive-token.ts`
- Create: `server/src/drive/drive-token.spec.ts`
- Create: `server/src/drive/drive-storage.ts`

- [ ] **Step 1: Write token tests**

Create `server/src/drive/drive-token.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createDriveShareId, driveStorageKeyForItem, isValidDriveItemName } from "./drive-token"

describe("drive token helpers", () => {
  it("creates URL-safe share ids", () => {
    expect(createDriveShareId()).toMatch(/^shr_[A-Za-z0-9_-]{32,}$/u)
  })

  it("builds storage keys from server item ids", () => {
    expect(driveStorageKeyForItem("item_123")).toBe("drive/item_123")
  })

  it("accepts normal file names", () => {
    expect(isValidDriveItemName("handoff.docx")).toBe(true)
  })

  it("rejects empty names and path separators", () => {
    expect(isValidDriveItemName("")).toBe(false)
    expect(isValidDriveItemName("../secret")).toBe(false)
    expect(isValidDriveItemName("a/b.txt")).toBe(false)
  })
})
```

- [ ] **Step 2: Run token test to verify it fails**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive-token.spec.ts`

Expected: FAIL because `drive-token.ts` does not exist.

- [ ] **Step 3: Implement constants and token helpers**

Create `server/src/drive/drive.constants.ts`:

```ts
export const driveDefaultQuotaBytes = 10n * 1024n * 1024n * 1024n
export const driveMaxFileBytes = 1n * 1024n * 1024n * 1024n
export const driveUploadUrlTtlSeconds = 15 * 60
export const driveDownloadUrlTtlSeconds = 5 * 60

export const DRIVE_ITEM_TYPE = {
  file: "file",
  folder: "folder",
} as const

export const DRIVE_STORAGE_STATUS = {
  pending: "pending",
  active: "active",
  deletePending: "delete_pending",
  deleted: "deleted",
  failed: "failed",
} as const

export const DRIVE_UPLOAD_STATUS = {
  pending: "pending",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
  failed: "failed",
} as const
```

Create `server/src/drive/drive-token.ts`:

```ts
import { randomBytes } from "node:crypto"

export function createDriveShareId(): string {
  return `shr_${randomBytes(24).toString("base64url")}`
}

export function driveStorageKeyForItem(itemId: string): string {
  return `drive/${itemId}`
}

export function isValidDriveItemName(value: string): boolean {
  const name = value.trim()
  if (!name) return false
  if (name.length > 255) return false
  if (name === "." || name === "..") return false
  return !/[\\/]/u.test(name)
}
```

- [ ] **Step 4: Implement storage adapter**

Create `server/src/drive/drive-storage.ts`:

```ts
import { Injectable } from "@nestjs/common"
import COS from "cos-nodejs-sdk-v5"
import { loadEnv } from "../config/env"
import { driveDownloadUrlTtlSeconds, driveUploadUrlTtlSeconds } from "./drive.constants"

export interface DriveStorageObjectInfo {
  readonly key: string
  readonly size: bigint
  readonly etag?: string
}

export interface DriveUploadInstruction {
  readonly method: "PUT"
  readonly url: string
  readonly expiresAt: Date
  readonly headers: Record<string, string>
}

export interface DriveStoragePort {
  createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction>
  createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }>
  headObject(key: string): Promise<DriveStorageObjectInfo | null>
  deleteObject(key: string): Promise<void>
}

@Injectable()
export class CosDriveStorage implements DriveStoragePort {
  private readonly env = loadEnv(process.env)
  private readonly cos = new COS({
    SecretId: this.requireConfig(this.env.cosSecretId, "COS_SECRET_ID"),
    SecretKey: this.requireConfig(this.env.cosSecretKey, "COS_SECRET_KEY"),
  })
  private readonly bucket = this.requireConfig(this.env.cosBucket, "COS_BUCKET")
  private readonly region = this.requireConfig(this.env.cosRegion, "COS_REGION")

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction> {
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    const url = await this.getSignedUrl({ key: input.key, method: "put", expires: driveUploadUrlTtlSeconds })
    return {
      method: "PUT",
      url,
      expiresAt,
      headers: input.contentType ? { "Content-Type": input.contentType } : {},
    }
  }

  async createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + driveDownloadUrlTtlSeconds * 1000)
    const url = await this.getSignedUrl({ key: input.key, method: "get", expires: driveDownloadUrlTtlSeconds })
    return { url, expiresAt }
  }

  async headObject(key: string): Promise<DriveStorageObjectInfo | null> {
    try {
      const result = await this.headObjectRaw(key)
      const sizeValue = result.headers?.["content-length"]
      return {
        key,
        size: BigInt(typeof sizeValue === "string" ? sizeValue : "0"),
        etag: typeof result.headers?.etag === "string" ? result.headers.etag : undefined,
      }
    } catch (error) {
      if (isCosNotFound(error)) return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.cos.deleteObject({ Bucket: this.bucket, Region: this.region, Key: key }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private getSignedUrl(input: { readonly key: string; readonly method: "put" | "get"; readonly expires: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      this.cos.getObjectUrl({
        Bucket: this.bucket,
        Region: this.region,
        Key: input.key,
        Sign: true,
        Method: input.method,
        Expires: input.expires,
      }, (error, data) => {
        if (error) reject(error)
        else resolve(data.Url)
      })
    })
  }

  private headObjectRaw(key: string): Promise<{ readonly headers?: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      this.cos.headObject({ Bucket: this.bucket, Region: this.region, Key: key }, (error, data) => {
        if (error) reject(error)
        else resolve(data)
      })
    })
  }

  private requireConfig(value: string | undefined, key: string): string {
    if (!value) throw new Error(`${key} is required for Synapse Drive storage.`)
    return value
  }
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && ("statusCode" in error)
    && (error as { readonly statusCode?: unknown }).statusCode === 404
}
```

- [ ] **Step 5: Run token tests**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive-token.spec.ts`

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @synapse/server run typecheck`

Expected: PASS after Prisma client has been generated.

- [ ] **Step 7: Commit**

```bash
git add server/src/drive/drive.constants.ts server/src/drive/drive-token.ts server/src/drive/drive-token.spec.ts server/src/drive/drive-storage.ts
git commit -m "feat(server): add drive storage helpers"
```

## Task 4: Drive Service Core

**Files:**
- Create: `server/src/drive/drive.types.ts`
- Create: `server/src/drive/drive.service.ts`
- Create: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Write service tests for quota, upload completion, and shares**

Create `server/src/drive/drive.service.spec.ts` with mocked storage:

```ts
import { BadRequestException, NotFoundException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PrismaService } from "../prisma/prisma.service"
import { DriveService } from "./drive.service"
import type { DriveStoragePort } from "./drive-storage"

const storageMock: DriveStoragePort = {
  createUploadInstruction: vi.fn(async () => ({
    method: "PUT",
    url: "https://cos.example/upload",
    expiresAt: new Date("2026-06-07T12:15:00.000Z"),
    headers: { "Content-Type": "text/plain" },
  })),
  createDownloadUrl: vi.fn(async () => ({
    url: "https://cos.example/download",
    expiresAt: new Date("2026-06-07T12:05:00.000Z"),
  })),
  headObject: vi.fn(async () => ({ key: "drive/item-file", size: 11n, etag: "etag" })),
  deleteObject: vi.fn(async () => undefined),
}

describe("DriveService", () => {
  let prisma: PrismaService
  let service: DriveService

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DriveService,
        PrismaService,
        { provide: "DriveStoragePort", useValue: storageMock },
      ],
    }).compile()

    prisma = moduleRef.get(PrismaService)
    service = moduleRef.get(DriveService)
    await prisma.driveUploadSession.deleteMany()
    await prisma.driveShare.deleteMany()
    await prisma.driveItem.deleteMany()
    await prisma.driveUsage.deleteMany()
    await prisma.user.deleteMany()
    await prisma.user.create({
      data: {
        id: "user-1",
        email: "user@example.com",
        passwordHash: "hash",
      },
    })
  })

  it("prepares upload sessions with reserved quota and server-generated storage keys", async () => {
    const result = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    expect(result.item.name).toBe("handoff.txt")
    expect(result.upload.method).toBe("PUT")
    const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: result.item.id } })
    expect(item.storageKey).toBe(`drive/${result.item.id}`)
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.reservedBytes).toBe(11n)
    expect(usage.usedBytes).toBe(0n)
  })

  it("rejects uploads over the single file limit", async () => {
    await expect(service.prepareUpload("user-1", {
      parentId: null,
      name: "large.bin",
      size: "1073741825",
      mimeType: "application/octet-stream",
      publicAppUrl: "https://synapse.test",
    })).rejects.toBeInstanceOf(BadRequestException)
  })

  it("completes uploads only after storage verification", async () => {
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })

    const completed = await service.completeUpload("user-1", prepared.sessionId)
    expect(completed.storageStatus).toBe("active")
    const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
    expect(usage.usedBytes).toBe(11n)
    expect(usage.reservedBytes).toBe(0n)
  })

  it("creates revocable share links", async () => {
    const prepared = await service.prepareUpload("user-1", {
      parentId: null,
      name: "handoff.txt",
      size: "11",
      mimeType: "text/plain",
      publicAppUrl: "https://synapse.test",
    })
    await service.completeUpload("user-1", prepared.sessionId)

    const share = await service.createShare("user-1", prepared.item.id, "https://synapse.test")
    expect(share.url).toMatch(/^https:\/\/synapse\.test\/files\/shr_/u)
    await service.disableShare("user-1", share.id)
    await expect(service.resolvePublicShare(share.shareId)).rejects.toBeInstanceOf(NotFoundException)
  })
})
```

- [ ] **Step 2: Run service tests to verify failure**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts`

Expected: FAIL because `DriveService` does not exist.

- [ ] **Step 3: Implement DTO mapping types**

Create `server/src/drive/drive.types.ts`:

```ts
import type { DriveItemDto, DriveStorageStatus } from "@synapse/shared"

export type DrivePrepareUploadInput = {
  readonly parentId: string | null
  readonly name: string
  readonly size: string
  readonly mimeType?: string | null
  readonly publicAppUrl: string
}

export type DriveItemRecord = {
  readonly id: string
  readonly parentId: string | null
  readonly type: string
  readonly name: string
  readonly size: bigint
  readonly mimeType: string | null
  readonly storageStatus: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly shares?: readonly { readonly enabled: boolean }[]
}

export function toDriveItemDto(item: DriveItemRecord): DriveItemDto {
  return {
    id: item.id,
    parentId: item.parentId,
    type: item.type === "folder" ? "folder" : "file",
    name: item.name,
    size: item.size.toString(),
    mimeType: item.mimeType,
    storageStatus: item.storageStatus as DriveStorageStatus,
    shared: item.shares?.some((share) => share.enabled) ?? false,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 4: Implement service**

Create `server/src/drive/drive.service.ts` with these public methods:

```ts
@Injectable()
export class DriveService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async listItems(userId: string, parentId: string | null): Promise<DriveItemDto[]>
  async getItem(userId: string, itemId: string): Promise<DriveItemDto>
  async prepareUpload(userId: string, input: DrivePrepareUploadInput): Promise<DriveUploadPrepareResult>
  async completeUpload(userId: string, sessionId: string): Promise<DriveItemDto>
  async cancelUpload(userId: string, sessionId: string): Promise<{ readonly ok: true }>
  async createFolder(userId: string, input: { parentId: string | null; name: string }): Promise<DriveItemDto>
  async renameItem(userId: string, itemId: string, name: string): Promise<DriveItemDto>
  async moveItem(userId: string, itemId: string, parentId: string | null): Promise<DriveItemDto>
  async deleteItem(userId: string, itemId: string, actorEmail?: string, ipAddress?: string): Promise<{ readonly ok: true }>
  async createShare(userId: string, itemId: string, publicAppUrl: string): Promise<DriveShareDto>
  async disableShare(userId: string, shareId: string): Promise<{ readonly ok: true }>
  async getUsage(userId: string): Promise<DriveUsageDto>
  async resolvePublicShare(shareId: string): Promise<{ readonly item: DriveItemDto; readonly storageKey: string | null; readonly type: "file" | "folder" }>
  async createDownloadUrlForShare(shareId: string): Promise<{ readonly url: string }>
  async listAdminItems(options: { pagination: PaginationQuery; filters: DriveAdminFilters }): Promise<PaginatedResponse<DriveAdminItemDto>>
  async deleteItemAsAdmin(itemId: string, actorEmail: string, ipAddress: string): Promise<{ readonly ok: true }>
}
```

Within implementation, enforce these exact rules:

```ts
const requestedSize = BigInt(input.size)
if (requestedSize <= 0n) throw new BadRequestException("文件大小无效。")
if (requestedSize > driveMaxFileBytes) throw new BadRequestException("文件超过 1GB 限制。")
if (!isValidDriveItemName(input.name)) throw new BadRequestException("文件名无效。")
```

Use a transaction in `prepareUpload`:

```ts
const usage = await tx.driveUsage.upsert({
  where: { userId },
  create: { userId, usedBytes: 0n, reservedBytes: 0n, quotaBytes: driveDefaultQuotaBytes },
  update: {},
})
if (usage.usedBytes + usage.reservedBytes + requestedSize > usage.quotaBytes) {
  throw new BadRequestException("云盘空间不足。")
}
const item = await tx.driveItem.create({
  data: {
    userId,
    parentId: input.parentId,
    type: DRIVE_ITEM_TYPE.file,
    name: input.name.trim(),
    size: requestedSize,
    mimeType: input.mimeType ?? null,
    storageStatus: DRIVE_STORAGE_STATUS.pending,
    uploadStatus: DRIVE_UPLOAD_STATUS.pending,
  },
})
const storageKey = driveStorageKeyForItem(item.id)
const updatedItem = await tx.driveItem.update({
  where: { id: item.id },
  data: { storageKey },
  include: { shares: true },
})
const session = await tx.driveUploadSession.create({
  data: {
    userId,
    itemId: item.id,
    storageKey,
    expectedName: item.name,
    expectedSize: requestedSize,
    expectedMime: item.mimeType,
    status: DRIVE_UPLOAD_STATUS.pending,
    credentialKind: "presigned_put",
    expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
  },
})
await tx.driveUsage.update({
  where: { userId },
  data: { reservedBytes: { increment: requestedSize } },
})
```

Use storage verification in `completeUpload`:

```ts
const object = await this.storage.headObject(session.storageKey)
if (!object || object.size !== session.expectedSize) {
  await this.failUploadSession(userId, session.id, session.expectedSize)
  throw new BadRequestException("上传文件校验失败。")
}
```

- [ ] **Step 5: Run service tests**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive.types.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(server): add drive service core"
```

## Task 5: Drive Controllers And Module

**Files:**
- Create: `server/src/drive/drive.controller.ts`
- Create: `server/src/drive/drive.module.ts`
- Modify: `server/src/app.module.ts`
- Create: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write controller tests**

Create `server/src/drive/drive.controller.spec.ts` with tests for:

```ts
import { type INestApplication } from "@nestjs/common"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestApp } from "../test/test-app"

describe("DriveController", () => {
  let app: INestApplication

  beforeEach(async () => {
    app = await createTestApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it("requires user auth for /api/drive/items", async () => {
    await request(app.getHttpServer()).get("/api/drive/items").expect(401)
  })

  it("returns public not found for missing share ids", async () => {
    const response = await request(app.getHttpServer()).get("/files/shr_missing").expect(404)
    expect(response.text).toContain("文件未找到")
  })
})
```

- [ ] **Step 2: Run controller tests to verify failure**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive.controller.spec.ts`

Expected: FAIL because controller and module do not exist.

- [ ] **Step 3: Implement controllers**

Create `server/src/drive/drive.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import { DriveService } from "./drive.service"

const prepareUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  size: z.string().regex(/^\d+$/u),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const folderSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(255),
}).strict()

const renameSchema = z.object({ name: z.string().trim().min(1).max(255) }).strict()
const moveSchema = z.object({ parentId: z.string().nullable() }).strict()
const adminSortFields = ["createdAt", "updatedAt", "name", "size", "storageStatus"] as const

@UseGuards(UserAuthGuard)
@Controller("/api/drive")
export class DriveUserController {
  constructor(private readonly drive: DriveService) {}

  @Get("/items")
  listItems(@Query("parentId") parentId: string | undefined, @Req() request: AuthenticatedUserRequest) {
    return this.drive.listItems(request.user!.id, parentId ?? null)
  }

  @Get("/items/:id")
  getItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.getItem(request.user!.id, id)
  }

  @Post("/uploads/prepare")
  prepareUpload(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(prepareUploadSchema, body, "上传请求无效。")
    return this.drive.prepareUpload(request.user!.id, {
      parentId: parsed.parentId ?? null,
      name: parsed.name,
      size: parsed.size,
      mimeType: parsed.mimeType ?? null,
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/uploads/:sessionId/complete")
  completeUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.completeUpload(request.user!.id, sessionId)
  }

  @Post("/uploads/:sessionId/cancel")
  cancelUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.cancelUpload(request.user!.id, sessionId)
  }

  @Post("/folders")
  createFolder(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(folderSchema, body, "文件夹请求无效。")
    return this.drive.createFolder(request.user!.id, { parentId: parsed.parentId ?? null, name: parsed.name })
  }

  @Patch("/items/:id")
  updateItem(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    if (typeof body === "object" && body !== null && "name" in body) {
      const parsed = parseBody(renameSchema, body, "重命名请求无效。")
      return this.drive.renameItem(request.user!.id, id, parsed.name)
    }
    const parsed = parseBody(moveSchema, body, "移动请求无效。")
    return this.drive.moveItem(request.user!.id, id, parsed.parentId)
  }

  @Delete("/items/:id")
  deleteItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.deleteItem(request.user!.id, id, request.user!.id, request.ip)
  }

  @Post("/items/:id/share")
  createShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.createShare(request.user!.id, id, resolveRequestPublicAppUrl(request))
  }

  @Delete("/shares/:id")
  disableShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.disableShare(request.user!.id, id)
  }

  @Get("/usage")
  getUsage(@Req() request: AuthenticatedUserRequest) {
    return this.drive.getUsage(request.user!.id)
  }
}

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/drive")
export class DriveAdminController {
  constructor(private readonly drive: DriveService) {}

  @Get("/items")
  listItems(@Query() query: Record<string, unknown>) {
    return this.drive.listAdminItems({
      pagination: parsePagination(query, { allowedSortFields: adminSortFields }),
      filters: {
        userId: typeof query.userId === "string" ? query.userId : undefined,
        type: typeof query.type === "string" ? query.type : undefined,
        storageStatus: typeof query.storageStatus === "string" ? query.storageStatus : undefined,
        shared: typeof query.shared === "string" ? query.shared : undefined,
        search: typeof query.search === "string" ? query.search : undefined,
      },
    })
  }

  @Delete("/items/:id")
  deleteItem(@Param("id") id: string, @Req() request: AdminRequest) {
    return this.drive.deleteItemAsAdmin(id, request.admin!.email, request.ip)
  }
}

@Controller()
export class DrivePublicController {
  constructor(private readonly drive: DriveService) {}

  @Get("/files/:shareId")
  async openShare(@Param("shareId") shareId: string, @Res() response: Response) {
    const share = await this.drive.resolvePublicShare(shareId)
    if (share.type === "file") {
      const download = await this.drive.createDownloadUrlForShare(shareId)
      response.redirect(302, download.url)
      return
    }
    response.type("html").send(`<main><h1>${escapeHtml(share.item.name)}</h1></main>`)
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function resolveRequestPublicAppUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char))
}
```

- [ ] **Step 4: Implement module and app import**

Create `server/src/drive/drive.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { DriveAdminController, DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveService } from "./drive.service"
import { CosDriveStorage } from "./drive-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [DriveUserController, DriveAdminController, DrivePublicController],
  providers: [
    DriveService,
    AuditLogService,
    CosDriveStorage,
    { provide: "DriveStoragePort", useExisting: CosDriveStorage },
  ],
  exports: [DriveService],
})
export class DriveModule {}
```

Modify `server/src/app.module.ts`:

```ts
import { DriveModule } from "./drive/drive.module"
```

Add `DriveModule` in the imports list after `DashboardModule`.

- [ ] **Step 5: Run controller tests**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive.controller.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.module.ts server/src/drive/drive.controller.spec.ts server/src/app.module.ts
git commit -m "feat(server): add drive HTTP routes"
```

## Task 6: Expiry Cleanup And Admin Delete Semantics

**Files:**
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Add failing tests for expiry and admin deletion**

Add tests:

```ts
it("expires pending sessions and releases reserved quota", async () => {
  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "stale.txt",
    size: "11",
    mimeType: "text/plain",
    publicAppUrl: "https://synapse.test",
  })
  await prisma.driveUploadSession.update({
    where: { id: prepared.sessionId },
    data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
  })

  const result = await service.expirePendingUploadSessions(new Date("2026-06-07T00:00:00.000Z"))
  expect(result.expired).toBe(1)
  const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
  expect(usage.reservedBytes).toBe(0n)
})

it("admin delete disables shares and hides the file", async () => {
  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "handoff.txt",
    size: "11",
    mimeType: "text/plain",
    publicAppUrl: "https://synapse.test",
  })
  await service.completeUpload("user-1", prepared.sessionId)
  const share = await service.createShare("user-1", prepared.item.id, "https://synapse.test")

  await service.deleteItemAsAdmin(prepared.item.id, "admin@example.com", "127.0.0.1")

  await expect(service.getItem("user-1", prepared.item.id)).rejects.toBeInstanceOf(NotFoundException)
  await expect(service.resolvePublicShare(share.shareId)).rejects.toBeInstanceOf(NotFoundException)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts`

Expected: FAIL because `expirePendingUploadSessions` does not exist or admin delete does not disable shares.

- [ ] **Step 3: Implement expiry and admin delete**

Add method:

```ts
async expirePendingUploadSessions(now = new Date()): Promise<{ readonly expired: number }> {
  const sessions = await this.prisma.driveUploadSession.findMany({
    where: { status: DRIVE_UPLOAD_STATUS.pending, expiresAt: { lte: now } },
    select: { id: true, userId: true, expectedSize: true, itemId: true },
  })
  for (const session of sessions) {
    await this.prisma.$transaction([
      this.prisma.driveUploadSession.update({
        where: { id: session.id },
        data: { status: DRIVE_UPLOAD_STATUS.expired, failedAt: now },
      }),
      this.prisma.driveItem.update({
        where: { id: session.itemId },
        data: { storageStatus: DRIVE_STORAGE_STATUS.failed, uploadStatus: DRIVE_UPLOAD_STATUS.expired },
      }),
      this.prisma.driveUsage.update({
        where: { userId: session.userId },
        data: { reservedBytes: { decrement: session.expectedSize } },
      }),
    ])
  }
  return { expired: sessions.length }
}
```

Ensure `deleteItem` and `deleteItemAsAdmin`:

```ts
await tx.driveShare.updateMany({
  where: { itemId: { in: itemIds } },
  data: { enabled: false, disabledAt: deletedAt },
})
await tx.driveItem.updateMany({
  where: { id: { in: itemIds } },
  data: {
    deletedAt,
    storageStatus: DRIVE_STORAGE_STATUS.deleted,
    uploadStatus: DRIVE_UPLOAD_STATUS.completed,
  },
})
```

For each active file storage key after transaction, call `storage.deleteObject(key)`. If delete fails:

```ts
await this.prisma.driveItem.update({
  where: { id: file.id },
  data: { storageDeletePending: true, storageStatus: DRIVE_STORAGE_STATUS.deletePending },
})
```

- [ ] **Step 4: Run service tests**

Run: `pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(server): handle drive upload expiry"
```

## Task 7: Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Append a short note under the pending release notes:

```md
- 新增 Synapse 云盘服务端基础能力：支持个人云盘元数据、直传上传会话、分享链接和管理员删除，为客户端云盘入口与 Agent 上传能力做准备。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/shared exec vitest run src/drive.test.ts
pnpm --filter @synapse/server exec vitest run src/drive/drive-token.spec.ts src/drive/drive.service.spec.ts src/drive/drive.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run server typecheck**

Run: `pnpm --filter @synapse/server run typecheck`

Expected: PASS.

- [ ] **Step 4: Run server test suite**

Run: `pnpm --filter @synapse/server run test`

Expected: PASS.

- [ ] **Step 5: Commit release note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive server foundation"
```

## Plan Self-Review

Spec coverage:

- AK/SK storage: covered by Task 3 storage adapter and Task 4/5 output rules.
- Direct client upload: covered by Task 4 prepare/complete upload sessions.
- Server-generated object key: covered by Task 3 and Task 4.
- Quota reservation: covered by Task 2 schema and Task 4 service tests.
- Public `/files/<shareId>`: covered by Task 1 URL helper and Task 5 public controller.
- User file management not in dashboard: covered as a scope boundary; UI is reserved for later plans.
- Admin delete: covered by Task 5 admin route and Task 6 delete semantics.
- MCP/skill: intentionally deferred to a separate follow-up plan.

Placeholder scan:

- No incomplete-marker wording or intentionally undefined file paths.
- Follow-up plans are explicit scope boundaries, not missing steps inside this phase.

Type consistency:

- Shared DTOs use string byte counts to avoid JSON `bigint` serialization problems.
- Server service snippets use `DriveUploadPrepareResult`, `DriveItemDto`, and `DriveShareDto` from `@synapse/shared`.
- Upload status constants map to schema `String` columns and public DTO status strings.
