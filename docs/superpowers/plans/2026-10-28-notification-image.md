# 通知携带图片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 通过一条账号通知把一张图片推到用户手机；手机点通知进入 Synapse 图片查看器，底部按钮保存到相册；桌面消息中心能查看同一张图。

**Architecture:** 通知契约增加可选 `imagePath`（本机绝对路径），桌面读取并上传到服务端平台媒体存储，拿到 `imageId` 后再创建通知；APNs payload 不变，手机按通知 id 回查后多一个 `.image` 去向，鉴权下载后用通用查看器展示并保存原图。

**Tech Stack:** NestJS + Prisma + PostgreSQL + COS/本地平台媒体存储；Electron 主进程 + React renderer；SwiftUI + Photos/ImageIO（iOS 17+）。

**Spec:** `docs/superpowers/specs/2026-10-28-notification-image-design.md`

## Global Constraints

- 只接受绝对路径的 PNG / JPEG / GIF / WebP，单张 ≤ 10 MiB（10 × 1024 × 1024 字节）。
- 不收 URL、base64、`file://`；归一化由调用方完成，命令写在 Skill。
- 私有图片必须走鉴权下载，禁止使用无鉴权的 `/object/<id>` 直链或预签名下载地址。
- APNs payload、`open-api-contract.ts`、Workflow 节点字段、通知分级都不得改动。
- MCP 工具仍 1 个，Workflow 节点仍 1 个，能力版本保持 `app.system_notifier.notification.trigger@1.0.0`。
- 上线顺序固定：服务端 → 桌面端 → iOS。
- 不新增依赖；不引入 multipart、图片转码库或 Notification Service Extension。
- 生产代码禁止 `console.log`；错误必须显式处理或带上下文上抛。
- 用户可见变化同步更新 `RELEASE_NOTES_PENDING.md`。
- 提交前只暂存本任务文件，不用 `git add -A`；提交信息用中文说明行为变化。
- 桌面端首次跑测试前若未生成配置，先运行 `pnpm --filter @synapse/desktop run generate:deployment-config`。
- iOS 模拟器名称以 `xcrun simctl list devices available` 为准；本文命令以 `iPhone 15 (18.6)` 为例。

## Review Focus

- 用户给的是损坏文件、改扩展名的文本或空文件：必须明确拒绝，不能发出一条打不开图的“成功”通知。
- 同一个 `imageId` 被重复使用或来自另一个账号：必须 400，绝不能让两台设备串图。
- 新桌面配旧服务端：必须当场报 `service_outdated`，不能出现“AI 说发了、手机什么都没有”。
- 用户在手机上拒绝相册权限：查看器仍可看，保存给出可恢复提示，不崩溃、不空白。
- 超大或异常尺寸图片：查看器用 ImageIO 降采样显示，保存写原始字节，不整图解码。

---

### Task 1: 服务端数据模型与迁移

**Files:**
- Modify: `server/prisma/schema.prisma`（`User`、`UserNotification`、新增 `NotificationImage`）
- Create: `server/prisma/migrations/20261028200000_notification_images/migration.sql`

**Interfaces:**
- Produces: `NotificationImage` 表；`UserNotification.imageId: String?`。

- [ ] **Step 1: 修改 Prisma schema**

在 `User` 模型里加反向关系：

```prisma
  notificationImages NotificationImage[]
```

在 `UserNotification`（`server/prisma/schema.prisma:94`）里加：

```prisma
  imageId     String?   @unique @db.VarChar(64)
  image       NotificationImage? @relation(fields: [imageId], references: [id], onDelete: SetNull)
```

在文件末尾附近新增：

```prisma
model NotificationImage {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  objectKey    String   @unique @db.VarChar(200)
  mimeType     String   @db.VarChar(64)
  byteSize     Int
  state        String   @db.VarChar(20)
  createdAt    DateTime @default(now())
  expiresAt    DateTime?
  notification UserNotification?

  @@index([userId])
  @@index([state, expiresAt])
}
```

- [ ] **Step 2: 写迁移 SQL**

`server/prisma/migrations/20261028200000_notification_images/migration.sql`：

```sql
CREATE TABLE "NotificationImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "NotificationImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationImage_objectKey_key" ON "NotificationImage"("objectKey");
CREATE INDEX "NotificationImage_userId_idx" ON "NotificationImage"("userId");
CREATE INDEX "NotificationImage_state_expiresAt_idx" ON "NotificationImage"("state", "expiresAt");

ALTER TABLE "UserNotification" ADD COLUMN "imageId" VARCHAR(64);
CREATE UNIQUE INDEX "UserNotification_imageId_key" ON "UserNotification"("imageId");

ALTER TABLE "NotificationImage" ADD CONSTRAINT "NotificationImage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "NotificationImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: 校验并生成客户端**

Run:

```bash
cd server
pnpm exec prisma validate
pnpm exec prisma generate
```

Expected: `The schema at prisma/schema.prisma is valid`，且 `@prisma/client` 生成成功。

- [ ] **Step 4: 应用迁移**

Run（需要本地数据库可用）：

```bash
pnpm --filter @synapse/server run prisma:migrate
```

Expected: 迁移 `20261028200000_notification_images` 被应用；重复执行显示 no pending migrations。

- [ ] **Step 5: 提交**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261028200000_notification_images/migration.sql
git commit -m "feat: 增加通知图片数据模型与迁移" -- server/prisma/schema.prisma server/prisma/migrations/20261028200000_notification_images/migration.sql
```

---

### Task 2: 抽出平台媒体模块并支持服务端写入

**Files:**
- Create: `server/src/platform-media/platform-media.module.ts`
- Modify: `server/src/drive/drive.module.ts:28,47`（改为导入模块、移除 provider）
- Modify: `server/src/notifications/notification.module.ts`
- Modify: `server/src/drive/platform-media-storage.ts`（新增 `putObject`）
- Test: `server/src/drive/platform-media-storage.spec.ts`

**Interfaces:**
- Produces: `PlatformMediaStorage.putObject(key: string, bytes: Buffer, contentType: string): Promise<void>`；`PlatformMediaModule` 导出 `PlatformMediaStorage`。

- [ ] **Step 1: 写失败测试**

`server/src/drive/platform-media-storage.spec.ts`：

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const root = await mkdtemp(path.join(os.tmpdir(), "platform-media-"))
vi.mock("../config/env", () => ({
  isPlatformMediaCosConfigured: () => false,
  loadEnv: () => ({ driveLocalRoot: root }),
}))

import { PlatformMediaStorage } from "./platform-media-storage"

describe("PlatformMediaStorage.putObject", () => {
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it("writes raw bytes to the local platform-media root", async () => {
    const storage = new PlatformMediaStorage()
    await storage.putObject("notification-images/abc", Buffer.from([1, 2, 3]), "image/png")
    const written = await readFile(path.join(root, "platform-media", "notification-images", "abc"))
    expect([...written]).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd server && pnpm exec vitest run src/drive/platform-media-storage.spec.ts`

Expected: FAIL，`storage.putObject is not a function`。

- [ ] **Step 3: 实现模块与 putObject**

`server/src/platform-media/platform-media.module.ts`：

```ts
import { Module } from "@nestjs/common"
import { PlatformMediaStorage } from "../drive/platform-media-storage"

@Module({ providers: [PlatformMediaStorage], exports: [PlatformMediaStorage] })
export class PlatformMediaModule {}
```

`drive.module.ts`：`imports` 增加 `PlatformMediaModule`，`providers` 删除 `PlatformMediaStorage`。

`notification.module.ts`：`imports` 增加 `PlatformMediaModule`。

`platform-media-storage.ts` 顶部的 `node:fs/promises` 导入改为 `{ mkdir, rm, stat, writeFile }`，然后增加方法：

```ts
  async putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const env = loadEnv(process.env)
    if (!isPlatformMediaCosConfigured(env)) {
      const target = this.localPath(key)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, bytes, { mode: 0o600 })
      return
    }
    const client = this.getCosClient()
    await new Promise<void>((resolve, reject) => {
      client.cos.putObject({
        Bucket: client.bucket,
        Region: client.region,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }, (error) => (error ? reject(error) : resolve()))
    })
  }
```

- [ ] **Step 4: 运行测试**

Run: `cd server && pnpm exec vitest run src/drive/platform-media-storage.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/platform-media/platform-media.module.ts server/src/drive/drive.module.ts server/src/notifications/notification.module.ts server/src/drive/platform-media-storage.ts server/src/drive/platform-media-storage.spec.ts
git commit -m "feat: 平台媒体存储支持服务端写入并抽出共享模块" -- server/src/platform-media/platform-media.module.ts server/src/drive/drive.module.ts server/src/notifications/notification.module.ts server/src/drive/platform-media-storage.ts server/src/drive/platform-media-storage.spec.ts
```

---

### Task 3: NotificationImageService

**Files:**
- Create: `server/src/notifications/notification-image.service.ts`
- Test: `server/src/notifications/notification-image.service.spec.ts`
- Modify: `server/src/notifications/notification.module.ts`

**Interfaces:**
- Consumes: `PlatformMediaStorage.putObject`、`PrismaService`。
- Produces:
  - `stage(userId: string, bytes: Buffer): Promise<{ id: string; mimeType: string; byteSize: number }>`
  - `claimInTransaction(tx, userId: string, imageId: string): Promise<void>`
  - `open(imageId: string): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; byteSize: number } | null>`
  - `deleteByIds(ids: readonly string[]): Promise<void>`
  - `prunePending(): Promise<void>`
  - 错误类 `NotificationImageInvalidTypeError`、`NotificationImageUnavailableError`

- [ ] **Step 1: 写失败测试**

`server/src/notifications/notification-image.service.spec.ts`：

```ts
import { describe, expect, it, vi } from "vitest"
import { NotificationImageInvalidTypeError, NotificationImageService } from "./notification-image.service"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function setup() {
  const created = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "img-1", mimeType: data.mimeType, byteSize: data.byteSize }))
  const prisma = {
    notificationImage: {
      create: created,
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  const storage = { putObject: vi.fn(async () => undefined), getObjectStream: vi.fn(), deleteObject: vi.fn(async () => undefined) }
  return { service: new NotificationImageService(prisma as never, storage as never), created, storage }
}

describe("NotificationImageService", () => {
  it("stages a PNG under notification-images and records pending state", async () => {
    const { service, created, storage } = setup()
    await expect(service.stage("user-1", png)).resolves.toMatchObject({ id: "img-1", mimeType: "image/png", byteSize: png.length })
    expect(storage.putObject).toHaveBeenCalledWith(expect.stringMatching(/^notification-images\//u), png, "image/png")
    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-1", state: "pending", mimeType: "image/png" }),
    }))
  })

  it("rejects bytes whose magic is not an allowed image", async () => {
    const { service, storage } = setup()
    await expect(service.stage("user-1", Buffer.from("not an image"))).rejects.toBeInstanceOf(NotificationImageInvalidTypeError)
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("claims only a pending image owned by the caller", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const service = new NotificationImageService({ notificationImage: { updateMany } } as never, {} as never)
    await service.claimInTransaction({ notificationImage: { updateMany } } as never, "user-1", "img-1")
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "img-1", userId: "user-1", state: "pending" }),
    }))
  })

  it("throws when the image is already attached or belongs to someone else", async () => {
    const service = new NotificationImageService({ notificationImage: { updateMany: vi.fn(async () => ({ count: 0 })) } } as never, {} as never)
    await expect(service.claimInTransaction({ notificationImage: { updateMany: vi.fn(async () => ({ count: 0 })) } } as never, "user-1", "img-1"))
      .rejects.toMatchObject({ name: "NotificationImageUnavailableError" })
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd server && pnpm exec vitest run src/notifications/notification-image.service.spec.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现服务**

`server/src/notifications/notification-image.service.ts`：

```ts
import { Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { randomBytes } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { detectPublicAssetImageType } from "../drive/drive-public-asset-policy"
import { PlatformMediaStorage } from "../drive/platform-media-storage"
import { PrismaService } from "../prisma/prisma.service"

export const NOTIFICATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const pendingTtlMs = 24 * 60 * 60 * 1000

export class NotificationImageInvalidTypeError extends Error {
  constructor() { super("Notification image type is not supported."); this.name = "NotificationImageInvalidTypeError" }
}
export class NotificationImageUnavailableError extends Error {
  constructor() { super("Notification image is unavailable."); this.name = "NotificationImageUnavailableError" }
}

@Injectable()
export class NotificationImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PlatformMediaStorage,
  ) {}

  async stage(userId: string, bytes: Buffer): Promise<{ id: string; mimeType: string; byteSize: number }> {
    const mimeType = detectPublicAssetImageType(bytes)
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) throw new NotificationImageInvalidTypeError()
    const objectKey = `notification-images/${randomBytes(24).toString("base64url")}`
    await this.storage.putObject(objectKey, bytes, mimeType)
    return this.prisma.notificationImage.create({
      data: { userId, objectKey, mimeType, byteSize: bytes.length, state: "pending", expiresAt: new Date(Date.now() + pendingTtlMs) },
      select: { id: true, mimeType: true, byteSize: true },
    })
  }

  async claimInTransaction(tx: Prisma.TransactionClient, userId: string, imageId: string): Promise<void> {
    const claimed = await tx.notificationImage.updateMany({
      where: { id: imageId, userId, state: "pending", expiresAt: { gt: new Date() } },
      data: { state: "attached", expiresAt: null },
    })
    if (claimed.count === 0) throw new NotificationImageUnavailableError()
  }

  async open(imageId: string) {
    const image = await this.prisma.notificationImage.findUnique({
      where: { id: imageId },
      select: { objectKey: true, mimeType: true, byteSize: true },
    })
    if (!image) return null
    const object = await this.storage.getObjectStream(image.objectKey)
    return { stream: object.stream, mimeType: image.mimeType, byteSize: image.byteSize }
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const rows = await this.prisma.notificationImage.findMany({ where: { id: { in: [...ids] } }, select: { id: true, objectKey: true } })
    for (const row of rows) await this.storage.deleteObject(row.objectKey)
    if (rows.length > 0) await this.prisma.notificationImage.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
  }

  @Cron("0 */10 * * * *")
  async prunePending(): Promise<void> {
    const rows = await this.prisma.notificationImage.findMany({
      where: { state: "pending", expiresAt: { lt: new Date() } },
      select: { id: true, objectKey: true },
    })
    for (const row of rows) await this.storage.deleteObject(row.objectKey)
    if (rows.length > 0) await this.prisma.notificationImage.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
  }
}
```

`notification.module.ts` 的 `providers` 增加 `NotificationImageService`，`exports` 增加它。

- [ ] **Step 4: 运行测试**

Run: `cd server && pnpm exec vitest run src/notifications/notification-image.service.spec.ts`

Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add server/src/notifications/notification-image.service.ts server/src/notifications/notification-image.service.spec.ts server/src/notifications/notification.module.ts
git commit -m "feat: 通知图片暂存、认领与过期清理" -- server/src/notifications/notification-image.service.ts server/src/notifications/notification-image.service.spec.ts server/src/notifications/notification.module.ts
```

---

### Task 4: 上传端点

**Files:**
- Modify: `server/src/notifications/notification.controller.ts`（构造器、`@Put("desktop/image")`）
- Test: `server/src/notifications/notification.controller.spec.ts`

**Interfaces:**
- Consumes: `NotificationImageService.stage`。
- Produces: `PUT /api/notifications/desktop/image` → `{ imageId, mimeType, byteSize }`。

- [ ] **Step 1: 写失败测试**

在 `notification.controller.spec.ts` 末尾加：

```ts
import { PassThrough, Readable } from "node:stream"

it("uploads raw image bytes and rejects an unsupported payload", async () => {
  const stage = vi.fn(async (_userId: string, bytes: Buffer) => ({ id: "img-1", mimeType: "image/png", byteSize: bytes.length }))
  const endpoint = new NotificationController({} as never, { stage } as never)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await expect(endpoint.uploadImage(
    Object.assign(Readable.from([png]), { user: { id: "u1" } }) as never,
  )).resolves.toMatchObject({ imageId: "img-1", mimeType: "image/png" })
  expect(stage).toHaveBeenLastCalledWith("u1", png)
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd server && pnpm exec vitest run src/notifications/notification.controller.spec.ts`

Expected: FAIL，`endpoint.uploadImage is not a function`。

- [ ] **Step 3: 实现端点**

`notification.controller.ts`：

- 导入 `BadRequestException`、`PayloadTooLargeException`（`@nestjs/common`）与 `NotificationImageService`、`NOTIFICATION_IMAGE_MAX_BYTES`。
- 构造器改为：

```ts
  constructor(
    private readonly notifications: NotificationService,
    private readonly images: NotificationImageService,
  ) {}
```

- 新增方法：

```ts
  @Put("desktop/image")
  async uploadImage(@Req() request: AuthedRequest & Request) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > NOTIFICATION_IMAGE_MAX_BYTES) throw new PayloadTooLargeException("图片不能超过 10 MB。")
      chunks.push(part)
    }
    if (size === 0) throw new BadRequestException("图片为空。")
    const staged = await this.images.stage(request.user.id, Buffer.concat(chunks))
    return { imageId: staged.id, mimeType: staged.mimeType, byteSize: staged.byteSize }
  }
```

- 现有测试里的 `new NotificationController(service as never)` 全部补第二个参数 `{} as never`。

- [ ] **Step 4: 运行测试**

Run: `cd server && pnpm exec vitest run src/notifications/notification.controller.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/notifications/notification.controller.ts server/src/notifications/notification.controller.spec.ts
git commit -m "feat: 新增通知图片原始字节上传端点" -- server/src/notifications/notification.controller.ts server/src/notifications/notification.controller.spec.ts
```

---

### Task 5: 创建通知时认领图片并在 DTO 中带出

**Files:**
- Modify: `server/src/notifications/notification.controller.ts:51-62`
- Modify: `server/src/notifications/notification.service.ts`（`create`、`list`、`get`、`toNotificationProjection`）
- Test: `server/src/notifications/notification.service.spec.ts`、`notification.controller.spec.ts`

**Interfaces:**
- Consumes: `NotificationImageService.claimInTransaction`。
- Produces: `CreateNotificationInput.imageId?: string`；`GET /api/notifications` 与 `/:id` 返回 `image: { id, mimeType, byteSize } | null`。

- [ ] **Step 1: 写失败测试**

`notification.controller.spec.ts` 增加：

```ts
it("accepts an imageId on the desktop write path and rejects non-string values", async () => {
  const create = vi.fn(async (input: Record<string, unknown>) => ({ id: "n1", createdAt: new Date("2026-10-28T08:00:00Z"), ...input }))
  const endpoint = new NotificationController({ create } as never, {} as never)
  const request = { user: { id: "writer" } }
  await endpoint.createFromDesktop(request as never, { source: "system-notifier", title: "图", body: "看图", imageId: "img-1" })
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ imageId: "img-1" }))
  await expect(endpoint.createFromDesktop(request as never, { source: "system-notifier", title: "图", body: "看图", imageId: 1 }))
    .rejects.toMatchObject({ status: 400 })
})
```

`notification.service.spec.ts` 增加（按该文件现有 fake prisma 形状调整变量名）：

```ts
it("claims the image inside the same transaction that creates the notification", async () => {
  const claim = vi.fn(async () => undefined)
  const created = vi.fn(async () => ({ id: "n1", imageId: "img-1" }))
  const tx = { userNotification: { create: created } }
  const service = new NotificationService(
    { $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx) } as never,
    { broadcastToUser: vi.fn() } as never,
    { sendToMobileClients: vi.fn() } as never,
    { sendNotification: vi.fn(async () => ({ failed: 0, skipped: false })) } as never,
    {} as never,
    { claimInTransaction: claim } as never,
  )
  await service.create({ userId: "u1", source: "system-notifier", title: "图", body: "看图", imageId: "img-1" })
  expect(claim).toHaveBeenCalledWith(tx, "u1", "img-1")
  expect(created).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageId: "img-1" }) }))
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd server && pnpm exec vitest run src/notifications/notification.service.spec.ts src/notifications/notification.controller.spec.ts`

Expected: FAIL，schema 拒绝 `imageId`，构造器参数数量不符。

- [ ] **Step 3: 实现**

`notification.controller.ts` 的 `desktopWriteSchema` 增加：

```ts
  imageId: z.string().min(1).max(64).optional(),
```

`notification.service.ts`：

- `CreateNotificationInput` 增加 `imageId?: string`。
- 构造器注入 `private readonly images: NotificationImageService`（放在最后）。
- `create()` 把写库改成事务：

```ts
    const record = await this.prisma.$transaction(async (tx) => {
      if (input.imageId) await this.images.claimInTransaction(tx, input.userId, input.imageId)
      return tx.userNotification.create({
        data: {
          userId: input.userId,
          source: input.source,
          sourceKey: input.sourceKey,
          title: input.title.slice(0, 64),
          body: input.body.slice(0, 512),
          group: input.group,
          url: input.url,
          copyOnTap: input.copyOnTap,
          imageId: input.imageId,
          level: input.level ?? "active",
          targetId: input.targetId,
          deviceId: input.deviceId,
        },
      })
    })
```

`createInTransaction()` 的 `create` 数据同样加入 `imageId: input.imageId`；它由调用方持有事务与认领，因此这里不重复 claim。

P2002 分支保持原样（`sourceKey` 重复时返回既有记录）。

同文件与 `notification-http.spec.ts` 里所有 `new NotificationService(...)` 调用补第六个参数 `{ claimInTransaction: vi.fn(async () => undefined) } as never`，否则新增依赖会让旧用例编译失败。

- `list()` 的 `findMany` 与 `get()` 的 `findFirst` 的 `include` 各加：

```ts
        image: { select: { id: true, mimeType: true, byteSize: true } },
```

- `toNotificationProjection` 的参数类型增加 `image?: { id: string; mimeType: string; byteSize: number } | null`；投影本身原样展开，不额外映射。

- [ ] **Step 4: 运行测试**

Run: `cd server && pnpm exec vitest run src/notifications/notification.service.spec.ts src/notifications/notification.controller.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/notifications/notification.controller.ts server/src/notifications/notification.service.ts server/src/notifications/notification.service.spec.ts server/src/notifications/notification.controller.spec.ts
git commit -m "feat: 创建通知时认领图片并在列表详情中带出" -- server/src/notifications/notification.controller.ts server/src/notifications/notification.service.ts server/src/notifications/notification.service.spec.ts server/src/notifications/notification.controller.spec.ts
```

---

### Task 6: 图片下载端点与删除清理

**Files:**
- Modify: `server/src/notifications/notification.controller.ts`
- Modify: `server/src/notifications/notification.service.ts`（`imageFor`、`delete`、`deleteAll`、`pruneExpired`）
- Test: `notification.controller.spec.ts`、`notification.service.spec.ts`

**Interfaces:**
- Produces: `GET /api/notifications/:id/image` 流式返回；删除通知时同步清理对象。

- [ ] **Step 1: 写失败测试**

Controller 测试：

```ts
it("streams the notification image only when the record belongs to the caller", async () => {
  const imageFor = vi.fn(async () => ({ stream: Readable.from([Buffer.from([1])]), mimeType: "image/png", byteSize: 1 }))
  const endpoint = new NotificationController({ imageFor } as never, {} as never)
  const headers: Record<string, string> = {}
  const response = new PassThrough()
  response.setHeader = (name: string, value: string) => { headers[name] = value; return response }
  await endpoint.notificationImage({ user: { id: "u1" } } as never, response as never, "n1")
  expect(headers["Content-Type"]).toBe("image/png")
  expect(headers["Cache-Control"]).toBe("private, no-store")
  expect(imageFor).toHaveBeenCalledWith("u1", "n1")
})

it("returns 404 when the notification has no image", async () => {
  const endpoint = new NotificationController({ imageFor: vi.fn(async () => null) } as never, {} as never)
  await expect(endpoint.notificationImage({ user: { id: "u1" } } as never, {} as never, "n1"))
    .rejects.toMatchObject({ status: 404 })
})
```

Service 测试：

```ts
it("deletes the stored object when a notification is deleted", async () => {
  const deleteByIds = vi.fn(async () => undefined)
  const service = new NotificationService(
    {
      userNotification: {
        findFirst: async () => ({ imageId: "img-1" }),
        updateMany: async () => ({ count: 1 }),
      },
    } as never,
    { broadcastToUser: vi.fn() } as never,
    { sendToMobileClients: vi.fn() } as never,
    {} as never, {} as never,
    { deleteByIds } as never,
  )
  await service.delete("u1", "n1")
  expect(deleteByIds).toHaveBeenCalledWith(["img-1"])
})

it("removes stored objects before pruning expired notification rows", async () => {
  const order: string[] = []
  const deleteByIds = vi.fn(async () => { order.push("objects") })
  const service = new NotificationService(
    {
      userNotification: {
        findMany: async () => [{ imageId: "img-1" }],
        deleteMany: async () => { order.push("rows"); return { count: 1 } },
      },
    } as never,
    { broadcastToUser: vi.fn() } as never,
    { sendToMobileClients: vi.fn() } as never,
    {} as never, {} as never,
    { deleteByIds } as never,
  )
  await service.pruneExpired()
  expect(order).toEqual(["objects", "rows"])
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd server && pnpm exec vitest run src/notifications/notification.controller.spec.ts src/notifications/notification.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 实现**

Controller 增加（`pipeline` 从 `node:stream/promises` 导入，`Res`、`Response` 已可用）：

```ts
  @Get(":id/image")
  async notificationImage(@Req() request: AuthedRequest, @Res() response: Response, @Param("id") id: string) {
    const image = await this.notifications.imageFor(request.user.id, id)
    if (!image) throw new NotFoundException("图片不存在。")
    response.setHeader("Content-Type", image.mimeType)
    response.setHeader("Content-Length", String(image.byteSize))
    response.setHeader("Cache-Control", "private, no-store")
    response.setHeader("Content-Disposition", "inline")
    await pipeline(image.stream, response)
  }
```

Service 增加：

```ts
  async imageFor(userId: string, id: string) {
    const record = await this.prisma.userNotification.findFirst({
      where: { id, userId, deletedAt: null },
      select: { imageId: true },
    })
    if (!record?.imageId) return null
    return this.images.open(record.imageId)
  }
```

`delete()`：

```ts
  async delete(userId: string, id: string): Promise<void> {
    const record = await this.prisma.userNotification.findFirst({ where: { id, userId, deletedAt: null }, select: { imageId: true } })
    await this.prisma.userNotification.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } })
    if (record?.imageId) await this.images.deleteByIds([record.imageId])
    this.publish(userId, id)
  }
```

`deleteAll()`：先 `findMany` 取同条件记录的 `imageId`（非空），执行 `updateMany`，再 `deleteByIds`。

`pruneExpired()`：先 `findMany` 取 90 天前记录的非空 `imageId`，`deleteByIds` 后再 `deleteMany`（顺序不能反，否则找不到对象键）。

- [ ] **Step 4: 运行测试**

Run: `cd server && pnpm exec vitest run src/notifications/notification.controller.spec.ts src/notifications/notification.service.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/notifications/notification.controller.ts server/src/notifications/notification.service.ts server/src/notifications/notification.controller.spec.ts server/src/notifications/notification.service.spec.ts
git commit -m "feat: 通知图片鉴权下载并随通知删除清理" -- server/src/notifications/notification.controller.ts server/src/notifications/notification.service.ts server/src/notifications/notification.controller.spec.ts server/src/notifications/notification.service.spec.ts
```

---

### Task 7: 桌面输入校验、MCP schema 与 Skill 归一化说明

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/shared/schema.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.ts:474-501`
- Modify: `desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.test.ts`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/index.md`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/notifications/index.md`

**Interfaces:**
- Produces: `SystemNotificationInput.imagePath?: string`、`imageId?: string`；校验原因新增 `not_absolute`、`not_found`、`not_regular_file`、`unreadable`、`permission_denied`、`unsupported_type`、`too_large`、`service_outdated`。

- [ ] **Step 1: 写失败测试**

在 `service.test.ts` 的校验用例旁加：

```ts
  it("accepts an optional absolute imagePath and rejects relative paths", () => {
    expect(validateSystemNotificationInput({ title: "图", body: "看图", imagePath: "/tmp/a.png" })).toMatchObject({
      ok: true, data: { imagePath: "/tmp/a.png" },
    })
    expect(validateSystemNotificationInput({ title: "图", body: "看图", imagePath: "tmp/a.png" })).toEqual({
      ok: false, code: "INVALID_INPUT", error: "Invalid system notification input.",
      data: { field: "imagePath", reason: "not_absolute" },
    })
    expect(validateSystemNotificationInput({ title: "图", body: "看图", imagePath: 1 })).toMatchObject({
      data: { field: "imagePath", reason: "type" },
    })
  })
```

在 `app-domain.test.ts` 的 System Notifier 断言里加：

```ts
          imagePath: expect.objectContaining({ type: "string", maxLength: 1024 }),
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/service.test.ts synapse-capabilities/shared/app-domain.test.ts
```

Expected: FAIL，`unknown_field` / `imagePath` 不存在。

- [ ] **Step 3: 实现 schema**

`shared/schema.ts`：

- `SYSTEM_NOTIFICATION_INVALID_FIELDS` 增加 `"imagePath"`。
- `SYSTEM_NOTIFICATION_INVALID_REASONS` 追加上面 8 个原因。
- `SystemNotificationInput` 增加：

```ts
  /** 本机图片绝对路径；只由 MCP 直接调用传入。 */
  readonly imagePath?: string
  /** 暂存后的服务端图片 id；内部字段，不对外开放。 */
  readonly imageId?: string
```

- `ACCEPTED_KEYS` 增加 `"imagePath"`。
- 在 `copyOnTap` 校验之后加：

```ts
  const imageError = validateImagePath(request)
  if (imageError) return imageError
```

- 返回对象带上 `imagePath`：

```ts
      ...(request.imagePath !== undefined ? { imagePath: request.imagePath as string } : {}),
```

- 新增函数：

```ts
function validateImagePath(request: Record<string, unknown>): SystemNotificationInvalidInput | null {
  if (!("imagePath" in request) || request.imagePath === undefined) return null
  const value = request.imagePath
  if (typeof value !== "string") return invalid("imagePath", "type")
  if (value === "") return invalid("imagePath", "required")
  const shapeError = validateSingleLineShape(value, "imagePath")
  if (shapeError) return shapeError
  if (value.length > 1024) return invalid("imagePath", "too_long")
  if (!isAbsolute(value)) return invalid("imagePath", "not_absolute")
  return null
}
```

文件顶部加 `import { isAbsolute } from "node:path"`。

- [ ] **Step 4: 更新 MCP schema 与描述**

`app-domain.ts` 的 trigger 工具：

- `description` 增加一句：

```text
Use it also when the user wants an image on their phone: first save or normalize whatever they gave you (clipboard, screenshot, URL, HEIC) into a local PNG/JPEG/GIF/WebP file of at most 10 MB, then pass its absolute path as imagePath; the phone opens the image and can save it to Photos. Chinese intent: 把这张图发我手机上, 发图片通知, 把截图推给我.
```

- `properties` 增加：

```ts
          imagePath: stringField("Optional absolute path to a local image file on the desktop that runs Synapse: PNG, JPEG, GIF or WebP, at most 10 MB. Convert other sources (clipboard, screenshot, URL, HEIC) to such a file before calling. The phone opens the image when the notification is tapped.", {
            maxLength: 1024,
          }),
```

- [ ] **Step 5: 更新 Skill 文案**

`app/index.md` 的 System Notifier 段补：

```markdown
图片：用户想要的是一张图（截图、剪贴板图、生成图、网络图片）并且希望在手机上看到或保存时，先把任意来源归一化成绝对路径的本地文件，再传 `imagePath`。只支持 PNG / JPEG / GIF / WebP、≤10 MB；HEIC 用 `sips -s format png` 转换。归一化命令（macOS，已实测）：

- 剪贴板：`osascript -e 'set pngData to the clipboard as «class PNGf»' -e 'set f to open for access POSIX file "/tmp/notify.png" with write permission' -e 'write pngData to f' -e 'close access f'`
- 区域截图：`screencapture -i /tmp/notify.png`；或 `screencapture -x -R x,y,w,h /tmp/notify.png`
- 网络图片：`curl -L --fail -o /tmp/notify.png "<url>"`，再用 `file` 确认是图片
- 本地文件 / `file://`：取绝对路径、去掉 scheme
- HEIC：`sips -s format png in.heic --out /tmp/notify.png`

路径必须真实存在且可读；不要伪造路径，也不要把图片内容转成 base64 传进来。
```

`api-reference.md` 的 trigger 参数表增加一行 `imagePath | string | 可选 | 本机图片绝对路径，PNG/JPEG/GIF/WebP，≤10 MB`。

`SKILL.md` 与 `notifications/index.md` 各补一句：带图通知点开后进入图片查看器，可保存到相册。

- [ ] **Step 6: 运行测试**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/service.test.ts synapse-capabilities/shared/app-domain.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add desktop/app-capabilities/system-notifier/shared/schema.ts desktop/synapse-capabilities/shared/app-domain.ts desktop/synapse-capabilities/shared/app-domain.test.ts desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts desktop/app-capabilities/synapse-skill/skill-package/app/index.md desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md desktop/app-capabilities/synapse-skill/skill-package/SKILL.md desktop/app-capabilities/synapse-skill/skill-package/notifications/index.md
git commit -m "feat: 通知触发支持 imagePath 并补充图片归一化指南" -- desktop/app-capabilities/system-notifier/shared/schema.ts desktop/synapse-capabilities/shared/app-domain.ts desktop/synapse-capabilities/shared/app-domain.test.ts desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts desktop/app-capabilities/synapse-skill/skill-package/app/index.md desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md desktop/app-capabilities/synapse-skill/skill-package/SKILL.md desktop/app-capabilities/synapse-skill/skill-package/notifications/index.md
```

---

### Task 8: 桌面对本地图片做权限、审计与格式校验

**Files:**
- Create: `desktop/app-capabilities/system-notifier/main/image.ts`
- Create: `desktop/app-capabilities/system-notifier/main/__tests__/image.test.ts`

**Interfaces:**
- Produces:

```ts
export type NotificationImageReadFailure =
  | "not_absolute" | "not_found" | "not_regular_file" | "unreadable"
  | "permission_denied" | "unsupported_type" | "too_large"

export async function readNotificationImageFile(input: {
  filePath: string
  actor: ActorIdentity
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  metadata: Record<string, unknown>
}): Promise<{ ok: true; bytes: Buffer; mimeType: string } | { ok: false; reason: NotificationImageReadFailure }>
```

- [ ] **Step 1: 写失败测试**

`__tests__/image.test.ts`：

```ts
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { readNotificationImageFile } from "../image"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe("readNotificationImageFile", () => {
  it("reads an absolute PNG after the permission check and audits without the path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const file = path.join(dir, "a.png")
    await writeFile(file, png)
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const result = await readNotificationImageFile({
      filePath: file, actor: { kind: "agent", id: "a1" }, permissionGuard: permissionGuard as never,
      auditSink: auditSink as never, metadata: { source: "mcp-http" },
    })
    expect(result).toMatchObject({ ok: true, mimeType: "image/png" })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "fs.read.outside-userdata", resource: file }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain(file)
  })

  it("rejects relative, missing, unsupported and denied inputs", async () => {
    expect(await readNotificationImageFile({ filePath: "a.png", actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "not_absolute" })
    expect(await readNotificationImageFile({ filePath: "/definitely/missing.png", actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "not_found" })
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const text = path.join(dir, "a.png")
    await writeFile(text, "hello")
    expect(await readNotificationImageFile({ filePath: text, actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "unsupported_type" })
    expect(await readNotificationImageFile({
      filePath: text, actor: { kind: "system" },
      permissionGuard: { check: async () => ({ allowed: false, reason: "policy" }) } as never,
      metadata: {},
    })).toEqual({ ok: false, reason: "permission_denied" })
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/image.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`main/image.ts`：

```ts
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"

export const NOTIFICATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export type NotificationImageReadFailure =
  | "not_absolute" | "not_found" | "not_regular_file" | "unreadable"
  | "permission_denied" | "unsupported_type" | "too_large"

export function detectNotificationImageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif"
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  return null
}

export async function readNotificationImageFile(input: {
  filePath: string
  actor: ActorIdentity
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  metadata: Record<string, unknown>
}): Promise<{ ok: true; bytes: Buffer; mimeType: string } | { ok: false; reason: NotificationImageReadFailure }> {
  if (!path.isAbsolute(input.filePath)) return { ok: false, reason: "not_absolute" }

  if (input.permissionGuard) {
    const permission = await input.permissionGuard.check({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: input.filePath,
      context: input.metadata,
    })
    input.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor: input.actor,
      resource: path.basename(input.filePath),
      outcome: permission.allowed ? "allowed" : "denied",
      metadata: permission.allowed ? input.metadata : { ...input.metadata, reason: "permission_denied" },
    })
    if (!permission.allowed) return { ok: false, reason: "permission_denied" }
  }

  let info
  try {
    info = await lstat(input.filePath)
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "not_found" : "unreadable" }
  }
  if (!info.isFile()) return { ok: false, reason: "not_regular_file" }
  if (info.size > NOTIFICATION_IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" }

  let bytes: Buffer
  try {
    bytes = await readFile(input.filePath)
  } catch {
    return { ok: false, reason: "unreadable" }
  }
  const mimeType = detectNotificationImageMime(bytes)
  if (!mimeType) return { ok: false, reason: "unsupported_type" }
  return { ok: true, bytes, mimeType }
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/image.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/app-capabilities/system-notifier/main/image.ts desktop/app-capabilities/system-notifier/main/__tests__/image.test.ts
git commit -m "feat: 通知图片读取加入权限、审计与格式校验" -- desktop/app-capabilities/system-notifier/main/image.ts desktop/app-capabilities/system-notifier/main/__tests__/image.test.ts
```

---

### Task 9: 账号服务上传图片并装配到 System Notifier

**Files:**
- Create: `desktop/app-capabilities/system-notifier/main/upload-outcome.ts`
- Create: `desktop/app-capabilities/system-notifier/main/__tests__/upload-outcome.test.ts`
- Modify: `desktop/app-capabilities/system-notifier/shared/schema.ts`（导出 `NotificationImageUploadOutcome`）
- Modify: `desktop/electron/services/account-service.ts`（`uploadNotificationImage`）
- Modify: `desktop/app-capabilities/system-notifier/main/service.ts`（ports 类型）
- Modify: `desktop/electron/bootstrap/descriptors.ts`（`coreSystemNotifierIntegrationDescriptor`）

**Interfaces:**
- Produces:

```ts
export type NotificationImageUploadOutcome =
  | { status: "uploaded"; imageId: string }
  | { status: "not_signed_in" } | { status: "offline" }
  | { status: "service_outdated" } | { status: "failed" }

export function mapNotificationImageUploadResponse(status: number, body: unknown): NotificationImageUploadOutcome
```

- [ ] **Step 1: 写失败测试**

`__tests__/upload-outcome.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { mapNotificationImageUploadResponse } from "../upload-outcome"

describe("mapNotificationImageUploadResponse", () => {
  it("reads the image id from a successful response", () => {
    expect(mapNotificationImageUploadResponse(201, { imageId: "img-1" })).toEqual({ status: "uploaded", imageId: "img-1" })
    expect(mapNotificationImageUploadResponse(200, {})).toEqual({ status: "failed" })
  })

  it("treats missing endpoints and contract 4xx as an outdated server", () => {
    expect(mapNotificationImageUploadResponse(404, undefined)).toEqual({ status: "service_outdated" })
    expect(mapNotificationImageUploadResponse(405, undefined)).toEqual({ status: "service_outdated" })
    expect(mapNotificationImageUploadResponse(400, { message: "bad" })).toEqual({ status: "service_outdated" })
  })

  it("separates credential failures and transient failures", () => {
    expect(mapNotificationImageUploadResponse(401, undefined)).toEqual({ status: "not_signed_in" })
    expect(mapNotificationImageUploadResponse(403, undefined)).toEqual({ status: "not_signed_in" })
    expect(mapNotificationImageUploadResponse(500, undefined)).toEqual({ status: "failed" })
    expect(mapNotificationImageUploadResponse(0, undefined)).toEqual({ status: "failed" })
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/upload-outcome.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯映射与账号服务**

`main/upload-outcome.ts`：

```ts
import type { NotificationImageUploadOutcome } from "../shared/schema"

export function mapNotificationImageUploadResponse(status: number, body: unknown): NotificationImageUploadOutcome {
  if (status >= 200 && status < 300) {
    const imageId = typeof body === "object" && body !== null ? (body as { imageId?: unknown }).imageId : undefined
    return typeof imageId === "string" ? { status: "uploaded", imageId } : { status: "failed" }
  }
  if (status === 401 || status === 403) return { status: "not_signed_in" }
  if (status === 404 || status === 405 || (status >= 400 && status < 500)) return { status: "service_outdated" }
  return { status: "failed" }
}
```

`shared/schema.ts` 导出：

```ts
export type NotificationImageUploadOutcome =
  | { readonly status: "uploaded"; readonly imageId: string }
  | { readonly status: "not_signed_in" } | { readonly status: "offline" }
  | { readonly status: "service_outdated" } | { readonly status: "failed" }
```

`account-service.ts` 顶部增加：

```ts
import { mapNotificationImageUploadResponse } from "../../app-capabilities/system-notifier/main/upload-outcome"
import type { NotificationImageUploadOutcome } from "../../app-capabilities/system-notifier/shared/schema"
```

然后增加方法（成功的 401/403 已被 `fetchAuthenticated` 刷新重试过，因此这里只来自失败）：

```ts
  async uploadNotificationImage(input: { bytes: Buffer; mimeType: string }): Promise<NotificationImageUploadOutcome> {
    if (this.state.status !== "authenticated") return { status: "not_signed_in" }
    if (this.state.connectivity !== "online") return { status: "offline" }
    try {
      const response = await this.fetchAuthenticated(`${apiBaseUrl()}/notifications/desktop/image`, {
        method: "PUT",
        headers: { "Content-Type": input.mimeType },
        body: new Uint8Array(input.bytes),
      }, "图片上传失败。")
      return mapNotificationImageUploadResponse(response.status, await response.json())
    } catch (error) {
      return mapNotificationImageUploadResponse((error as { status?: number }).status ?? 0, undefined)
    }
  }
```

`SystemNotifierServicePorts` 增加：

```ts
  readonly uploadImage?: (input: { bytes: Buffer; mimeType: string }) => Promise<NotificationImageUploadOutcome>
  readonly permissionGuard?: PermissionGuard
```

`descriptors.ts` 的 `initialize({...})` 增加：

```ts
      uploadImage: (input) => accountService.uploadNotificationImage(input),
      permissionGuard: optionalSystemNotifierPort(() => ctx.registry.get<PermissionGuard>("core.permission-guard")),
```

- [ ] **Step 4: 运行测试与类型检查**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/upload-outcome.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: 测试通过；typecheck 通过（若尚未生成配置，先运行 `pnpm --filter @synapse/desktop run generate:deployment-config`）。

- [ ] **Step 5: 提交**

```bash
git add desktop/app-capabilities/system-notifier/main/upload-outcome.ts desktop/app-capabilities/system-notifier/main/__tests__/upload-outcome.test.ts desktop/app-capabilities/system-notifier/shared/schema.ts desktop/electron/services/account-service.ts desktop/app-capabilities/system-notifier/main/service.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "feat: 账号服务支持上传通知图片并接入通知能力" -- desktop/app-capabilities/system-notifier/main/upload-outcome.ts desktop/app-capabilities/system-notifier/main/__tests__/upload-outcome.test.ts desktop/app-capabilities/system-notifier/shared/schema.ts desktop/electron/services/account-service.ts desktop/app-capabilities/system-notifier/main/service.ts desktop/electron/bootstrap/descriptors.ts
```

---

### Task 10: 触发前暂存图片并映射失败

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/main/service.ts`（`prepare`、`systemNotificationAccountWrite`）
- Modify: `desktop/app-capabilities/system-notifier/main/dispatcher.ts`
- Modify: `desktop/electron/services/account-service.ts`（`createInternalNotification` 加 `imageId`）
- Test: `main/__tests__/service.test.ts`、`main/__tests__/dispatcher.test.ts`

**Interfaces:**
- Produces: `SystemNotifierService.prepare(input, context): Promise<SystemNotificationInputValidation>`；`createInternalNotification` 入参加 `imageId?: string`。

- [ ] **Step 1: 写失败测试**

`service.test.ts`：

```ts
  it("stages an image and passes only imageId to the account write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-prepare-"))
    const file = path.join(dir, "a.png")
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const uploadImage = vi.fn(async () => ({ status: "uploaded" as const, imageId: "img-1" }))
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settingsNamespace({ ...activeSettings }).port,
      permissionGuard: { check: vi.fn(async () => ({ allowed: true })) } as never,
      uploadImage,
      sync: vi.fn(async () => "sent" as const),
    })
    const result = await service.prepare(
      { title: "图", body: "看图", imagePath: file },
      { source: "mcp-http", actor: { kind: "agent", id: "a1" }, identityKey: "k" },
    )
    expect(result).toMatchObject({ ok: true, data: { imageId: "img-1" } })
    const write = systemNotificationAccountWrite(result.ok ? result.data : { title: "", body: "" })
    expect(write).toMatchObject({ imageId: "img-1" })
    expect(write).not.toHaveProperty("imagePath")
    expect(JSON.stringify(uploadImage.mock.calls)).not.toContain(file)
  })

  it("maps an outdated server and a denied local read to INVALID_INPUT", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-prepare-"))
    const file = path.join(dir, "a.png")
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const denied = new SystemNotifierService(logger())
    await denied.initialize({
      settings: settingsNamespace({ ...activeSettings }).port,
      permissionGuard: { check: vi.fn(async () => ({ allowed: false, reason: "policy" })) } as never,
      uploadImage: async () => ({ status: "service_outdated" }),
    })
    await expect(denied.prepare(
      { title: "图", body: "看图", imagePath: file },
      { source: "mcp-http", actor: { kind: "agent", id: "a1" }, identityKey: "k" },
    )).resolves.toMatchObject({ ok: false, data: { field: "imagePath", reason: "permission_denied" } })

    const outdated = new SystemNotifierService(logger())
    await outdated.initialize({
      settings: settingsNamespace({ ...activeSettings }).port,
      permissionGuard: { check: vi.fn(async () => ({ allowed: true })) } as never,
      uploadImage: async () => ({ status: "service_outdated" }),
    })
    await expect(outdated.prepare(
      { title: "图", body: "看图", imagePath: file },
      { source: "mcp-http", actor: { kind: "agent", id: "a1" }, identityKey: "k" },
    )).resolves.toMatchObject({ ok: false, data: { field: "imagePath", reason: "service_outdated" } })
  })
```

测试文件顶部补 `import { mkdtemp, writeFile } from "node:fs/promises"`、`import os from "node:os"`、`import path from "node:path"`；`settingsNamespace`、`activeSettings`、`logger` 都用该文件已有的 helper。

`dispatcher.test.ts`：

```ts
  it("awaits image preparation before entering the service", async () => {
    const order: string[] = []
    const prepare = vi.fn(async () => { order.push("prepare"); return { ok: true as const, data: { title: "图", body: "看图", imageId: "img-1" } } })
    const trigger = vi.fn(() => { order.push("trigger"); return { success: true as const } })
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { prepare, trigger } })
    await dispatcher.dispatch(
      SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      { title: "图", body: "看图", imagePath: "/tmp/a.png" },
      { source: "mcp-http" },
    )
    expect(order).toEqual(["prepare", "trigger"])
  })
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/service.test.ts app-capabilities/system-notifier/main/__tests__/dispatcher.test.ts
```

Expected: FAIL，`prepare` 不存在。

- [ ] **Step 3: 实现 prepare**

`service.ts` 增加：

```ts
  async prepare(input: SystemNotificationInput, context: SystemNotifierTriggerContext): Promise<SystemNotificationInputValidation> {
    if (input.imagePath === undefined) return { ok: true, data: input }
    const settings = this.snapshot
    if (settings?.sendEnabled !== true) {
      this.diagnostics.record("notification_sync", "disabled")
      const { imagePath: _ignored, ...rest } = input
      return { ok: true, data: rest }
    }
    const read = await readNotificationImageFile({
      filePath: input.imagePath,
      actor: context.actor,
      permissionGuard: this.permissionGuard,
      auditSink: this.auditSink,
      metadata: { source: context.source, capabilityAction: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID },
    })
    if (!read.ok) return invalidImage(read.reason)
    const uploaded = await this.uploadImage?.({ bytes: read.bytes, mimeType: read.mimeType })
    if (!uploaded || uploaded.status === "failed" || uploaded.status === "not_signed_in" || uploaded.status === "offline") {
      this.diagnostics.record("notification_sync", uploaded?.status ?? "sync_failed")
      const { imagePath: _ignored, ...rest } = input
      return { ok: true, data: rest }
    }
    if (uploaded.status === "service_outdated") return invalidImage("service_outdated")
    const { imagePath: _ignored, ...rest } = input
    return { ok: true, data: { ...rest, imageId: uploaded.imageId } }
  }
```

在 `SystemNotifierService` 上增加字段 `private uploadImage?: SystemNotifierServicePorts["uploadImage"]`、`private permissionGuard?: PermissionGuard`；`initialize()` 里显式赋值：

```ts
    this.uploadImage = ports.uploadImage
    this.permissionGuard = ports.permissionGuard
```

`invalidImage` 复用 `shared/schema.ts` 导出的构造函数：把现有私有 `invalid` 改名为导出的 `systemNotificationInvalid`，所有内部调用同步改名；`service.ts` 里定义：

```ts
function invalidImage(reason: SystemNotificationInvalidReason): SystemNotificationInvalidInput {
  return systemNotificationInvalid("imagePath", reason)
}
```

Dispatcher 的依赖类型从 `Pick<SystemNotifierService, "trigger">` 改为 `Pick<SystemNotifierService, "trigger" | "prepare">`。

`systemNotificationAccountWrite` 返回类型与对象增加：

```ts
  readonly imageId?: string
  ...
    ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
```

Dispatcher：

```ts
      const prepared = await deps.service.prepare(validation.data, context)
      if (!prepared.ok) return prepared
      const result = deps.service.trigger(prepared.data, context)
```

`account-service.createInternalNotification` 入参增加 `imageId?: string` 并随请求体发送。

- [ ] **Step 4: 运行测试**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/main/__tests__/service.test.ts app-capabilities/system-notifier/main/__tests__/dispatcher.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/app-capabilities/system-notifier/main/service.ts desktop/app-capabilities/system-notifier/main/dispatcher.ts desktop/app-capabilities/system-notifier/shared/schema.ts desktop/electron/services/account-service.ts desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts desktop/app-capabilities/system-notifier/main/__tests__/dispatcher.test.ts
git commit -m "feat: 触发前暂存通知图片并明确失败语义" -- desktop/app-capabilities/system-notifier/main/service.ts desktop/app-capabilities/system-notifier/main/dispatcher.ts desktop/app-capabilities/system-notifier/shared/schema.ts desktop/electron/services/account-service.ts desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts desktop/app-capabilities/system-notifier/main/__tests__/dispatcher.test.ts
```

---

### Task 11: 桌面消息中心查看图片

**Files:**
- Modify: `desktop/electron/services/account-service.ts`（`downloadNotificationImage`）
- Modify: `desktop/electron/modules/account/ipc.ts`（`notificationImage` invoke）
- Modify: `desktop/electron/preload.ts:770-778`
- Modify: `desktop/src/types/bridge.ts:1408-1417`
- Modify: `desktop/src/types/notification-center.ts`
- Modify: `desktop/src/app-shell/components/message-center.tsx`
- Modify: `desktop/src/app-shell/hooks/use-message-center.ts`
- Test: `desktop/src/app-shell/components/__tests__/message-center.test.tsx`

**Interfaces:**
- Produces: `account.notifications.image({ id }) → { mimeType: string; bytes: Uint8Array }`。

- [ ] **Step 1: 写失败测试**

在 `message-center.test.tsx` 的 `mockCenter` 里补 `openNotificationImage: vi.fn()`，并在 `afterEach` 重置 `mockCenter.selected` 与该方法；然后加：

```tsx
  it("shows the image entry in the detail and opens it on demand", async () => {
    mockCenter.selected = {
      ...mockCenter.selected,
      source: "system-notifier",
      title: "图片通知",
      body: "看图",
      targetId: null,
      image: { id: "img-1", mimeType: "image/png", byteSize: 8 },
    } as SynapseNotification
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<MessageCenter />) })
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "查看图片")
      expect(button).toBeTruthy()
      act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })))
      expect(mockCenter.openNotificationImage).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }))
    } finally {
      await act(async () => { root.unmount() })
    }
  })
```

`SynapseNotification` 类型在 `desktop/src/types/notification-center.ts` 增加：

```ts
  image?: { id: string; mimeType: string; byteSize: number } | null
```

- [ ] **Step 2: 实现账号服务与 IPC**

`account-service.ts`：

```ts
  async downloadNotificationImage(id: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    const response = await this.fetchAuthenticated(
      `${apiBaseUrl()}/notifications/${encodeURIComponent(id)}/image`,
      {},
      "图片加载失败。",
    )
    return {
      mimeType: response.headers.get("Content-Type") ?? "application/octet-stream",
      bytes: new Uint8Array(await response.arrayBuffer()),
    }
  }
```

`modules/account/ipc.ts` 增加：

```ts
    notificationImage: {
      kind: "invoke",
      operationId: "app.account.notification.image",
      request: notificationIdSchema,
      response: z.object({ mimeType: z.string(), bytes: z.instanceof(Uint8Array) }),
      handler: async (_ctx, input) => accountService.downloadNotificationImage(notificationIdSchema.parse(input).id),
    },
```

Run: `pnpm --filter @synapse/desktop run generate:ipc`（生成 channel）。

`preload.ts` 的 `notifications` 增加：

```ts
      image: invoke(IPC_CHANNELS.account.notificationImage),
```

`bridge.ts` 的 `notifications` 类型增加：

```ts
      image: (input: { id: string }) => Promise<{ mimeType: string; bytes: Uint8Array }>
```

- [ ] **Step 3: 实现详情入口**

`use-message-center.ts` 增加 state 与回调：

```ts
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const openNotificationImage = useCallback(async (item: SynapseNotification) => {
    if (!item.image) return
    const { mimeType, bytes } = await requireBridgeDomain("account").notifications.image({ id: item.id })
    const url = URL.createObjectURL(new Blob([bytes.buffer], { type: mimeType }))
    setImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return url
    })
  }, [])

  const closeImagePreview = useCallback(() => {
    setImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
  }, [])
```

并在 `userId` 变化的 effect 与卸载时调用 `closeImagePreview()`；返回值带 `imagePreview`、`closeImagePreview`、`openNotificationImage`。

`message-center.tsx`：在 `notificationActions` 里最前面加：

```tsx
  if (item.image) actions.push({ id: "open-image", label: "查看图片", run: () => { void center.openNotificationImage(item) } })
```

详情区在有 image 时显示按钮（`imageTrigger` 是该按钮的 `ref`）：

```tsx
<Button ref={imageTrigger} variant="outline" size="sm" onClick={() => { void center.openNotificationImage(item) }}>查看图片</Button>
```

并用现有 `ImageLightbox` 渲染预览：

```tsx
{center.imagePreview && (
  <ImageLightbox
    preview={{ images: [{ alt: item.title, src: center.imagePreview }], initialIndex: 0, trigger: imageTrigger.current ?? document.body }}
    onClose={center.closeImagePreview}
  />
)}
```

`ImageLightbox` 从 `@/components/image-lightbox` 导入；`imageTrigger` 用 `useRef<HTMLButtonElement | null>(null)` 声明。

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @synapse/desktop exec vitest run src/app-shell/components/__tests__/message-center.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/modules/account/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts desktop/src/app-shell/components/message-center.tsx desktop/src/app-shell/hooks/use-message-center.ts desktop/src/app-shell/components/__tests__/message-center.test.tsx
git commit -m "feat: 桌面消息中心可查看通知图片" -- desktop/electron/services/account-service.ts desktop/electron/modules/account/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts desktop/src/app-shell/components/message-center.tsx desktop/src/app-shell/hooks/use-message-center.ts desktop/src/app-shell/components/__tests__/message-center.test.tsx
```

---

### Task 12: iOS 通知模型与图片去向

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift:50-79`
- Modify: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift`
- Modify: `SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift:17-34`
- Modify: `SynapseMobile/SynapseMobile/Features/Root/RootView.swift`（`handleRoute`、`openNotification`）
- Modify: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationView.swift`（`open`）
- Test: `SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift`

**Interfaces:**
- Produces: `SynapseNotification.image: NotificationImage?`；`NotificationDestination.Outcome.image(notificationId:)`；`NotificationRouter.Destination.image(notificationId:)`。

- [ ] **Step 1: 写失败测试**

```swift
    @Test func anImageNotificationOpensTheImageViewerBeforeItsLink() throws {
        let raw = #"{"id":"n1","source":"system-notifier","title":"图","body":"看图","level":"active","createdAt":"2026-10-28T00:00:00Z","url":"https://example.com/x","image":{"id":"img-1","mimeType":"image/png","byteSize":8}}"#
        let item = try JSONDecoder().decode(SynapseNotification.self, from: Data(raw.utf8))
        #expect(item.image == NotificationImage(id: "img-1", mimeType: "image/png", byteSize: 8))
        #expect(NotificationDestination.resolve(item) == .route(.image(notificationId: "n1")))
        #expect(NotificationDestination.actionLabel(for: item) == "查看图片")
    }

    @Test func aNotificationWithoutAnImageKeepsItsExistingRoute() {
        let item = notification(source: "system-notifier", targetId: nil, deviceId: nil, url: "https://example.com/x")
        #expect(NotificationDestination.resolve(item) == .externalURL(URL(string: "https://example.com/x")!))
    }
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15 (18.6)' \
  -only-testing:SynapseMobileTests
```

Expected: 编译失败，`NotificationImage` / `.image` 不存在。

- [ ] **Step 3: 实现模型**

`NotificationStore.swift` 增加：

```swift
struct NotificationImage: Decodable, Equatable {
    let id: String
    let mimeType: String
    let byteSize: Int
}
```

`SynapseNotification` 增加 `let image: NotificationImage?`，并在两个 init 中赋值；init 参数默认 `nil`，现有测试调用不改。

- [ ] **Step 4: 实现去向**

`NotificationDestination.swift`：

```swift
    enum Outcome: Equatable {
        case route(NotificationRouter.Destination)
        case externalURL(URL)
        case none
    }
```

`resolve` 在 `url` 判断之前加：

```swift
        if item.image != nil {
            return .route(.image(notificationId: item.id))
        }
```

`actionLabel` 的 `switch` 前加：

```swift
        if item.image != nil { return "查看图片" }
```

`NotificationRouter.Destination` 增加：

```swift
        case image(notificationId: String)
```

`RootView.handleRoute` 增加：

```swift
        case .image(let notificationId):
            notificationImageTarget = NotificationImageTarget(id: notificationId)
```

新增 `struct NotificationImageTarget: Identifiable { let id: String }` 与 `@State private var notificationImageTarget: NotificationImageTarget?`，并用 `.fullScreenCover(item: $notificationImageTarget)` 呈现 Task 13 的查看器。

`NotificationView.open` 的 `.route` 分支已统一走 `NotificationRouter.shared.route(to:)`，无需额外改动。

- [ ] **Step 5: 运行测试**

Run:

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15 (18.6)' \
  -only-testing:SynapseMobileTests
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift SynapseMobile/SynapseMobile/Features/Root/RootView.swift SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift
git commit -m "feat: 手机端识别图片通知并新增图片去向" -- SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift SynapseMobile/SynapseMobile/Features/Root/RootView.swift SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift
```

---

### Task 13: iOS 图片下载与全屏查看器

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift`
- Modify: `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`
- Create: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationImageViewer.swift`
- Create: `SynapseMobile/SynapseMobile/DesignSystem/PhotoLibrarySave.swift`
- Modify: `SynapseMobile/SynapseMobile/Features/Root/RootView.swift`（fullScreenCover 内容）
- Test: `SynapseMobile/SynapseMobileTests/NotificationImageViewerTests.swift`

**Interfaces:**
- Produces:

```swift
func downloadNotificationImage(id: String) async throws -> URL   // APIClient
func downloadNotificationImage(id: String) async throws -> URL   // SynapseAppModel

@MainActor final class NotificationImageViewerModel: ObservableObject {
  init(notificationId: String, loader: @escaping () async throws -> URL, saver: any PhotoLibrarySaving)
  @Published private(set) var state: State
  func load() async
  func save() async
}
```

- [ ] **Step 1: 写失败测试**

`NotificationImageViewerTests.swift`：

```swift
import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct NotificationImageViewerTests {
    @Test func aFailedLoadCanBeRetried() async {
        var attempts = 0
        let model = NotificationImageViewerModel(notificationId: "n1", loader: {
            attempts += 1
            if attempts == 1 { throw APIError(status: 0, code: "network", message: "网络不可用") }
            return URL(fileURLWithPath: "/tmp/does-not-matter.png")
        }, saver: StubSaver(result: .success(())))
        await model.load()
        #expect(model.state == .failed)
        await model.load()
        #expect(model.state == .loaded(URL(fileURLWithPath: "/tmp/does-not-matter.png")))
        #expect(attempts == 2)
    }

    @Test func aDeniedSaveKeepsTheImageVisibleAndExplains() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let model = NotificationImageViewerModel(notificationId: "n1", loader: { url }, saver: StubSaver(result: .failure(.denied)))
        await model.load()
        await model.save()
        #expect(model.state == .loaded(url))
        #expect(model.notice == "没有相册写入权限")
    }

    @Test func savingUsesTheDownloadedOriginalFile() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let saver = CapturingSaver()
        let model = NotificationImageViewerModel(notificationId: "n1", loader: { url }, saver: saver)
        await model.load()
        await model.save()
        #expect(saver.savedURLs == [url])
    }
}

private final class CapturingSaver: PhotoLibrarySaving {
    private(set) var savedURLs: [URL] = []
    func save(originalFile: URL) async throws { savedURLs.append(originalFile) }
}

private struct StubSaver: PhotoLibrarySaving {
    let result: Result<Void, PhotoLibrarySaveError>
    func save(originalFile: URL) async throws { try result.get() }
}
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15 (18.6)' \
  -only-testing:SynapseMobileTests
```

Expected: 编译失败，类型不存在。

- [ ] **Step 3: 实现下载**

`APIClient.swift`（沿用站内信附件的令牌与 `downloadSession` 写法）：

```swift
    func downloadNotificationImage(id: String) async throws -> URL {
        synchronizeStoredCredential()
        let generation = credentialGeneration
        let account = tokens.credentialVersion
        if accessToken == nil || accessTokenIsStale {
            _ = await refreshAccessTokenOutcome()
        }
        guard generation == credentialGeneration, account == tokens.credentialVersion,
              accessToken == nil || accessTokenCredentialVersion == account else {
            throw APIError(status: 0, code: "credential_changed", message: "账号已改变，请重新操作。")
        }
        guard let token = accessToken else { throw APIError(status: 401, code: "unauthenticated", message: "登录已过期，请重新登录。") }
        guard let url = URL(string: AppConfiguration.apiBaseURL.absoluteString + "/notifications/\(escaped(id))/image") else {
            throw APIError(status: 0, code: "bad_url", message: "图片地址无效。")
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (temporary, response) = try await downloadSession.download(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, code: "download", message: "图片没能下载下来。")
        }
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("notification-\(UUID().uuidString).img")
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }
```

`SynapseAppModel` 增加：

```swift
    func downloadNotificationImage(id: String) async throws -> URL {
        try await apiClient.downloadNotificationImage(id: id)
    }
```

- [ ] **Step 4: 实现查看器**

`NotificationImageViewer.swift`：

```swift
import SwiftUI

@MainActor
final class NotificationImageViewerModel: ObservableObject {
    enum State: Equatable { case loading, loaded(URL), failed }
    @Published private(set) var state: State = .loading
    @Published private(set) var notice: String?

    private let loader: () async throws -> URL
    private let saver: any PhotoLibrarySaving

    init(notificationId: String, loader: @escaping () async throws -> URL, saver: any PhotoLibrarySaving) {
        self.loader = loader
        self.saver = saver
    }

    func load() async {
        state = .loading
        do { state = .loaded(try await loader()) }
        catch { state = .failed }
    }

    func save() async {
        guard case .loaded(let url) = state else { return }
        do {
            try await saver.save(originalFile: url)
            notice = "已保存到相册"
        } catch PhotoLibrarySaveError.denied {
            notice = "没有相册写入权限"
        } catch {
            notice = "保存失败"
        }
    }

    func clearNotice() { notice = nil }
}

struct NotificationImageViewer: View {
    @StateObject private var model: NotificationImageViewerModel
    @Environment(\.dismiss) private var dismiss

    init(notificationId: String, loader: @escaping () async throws -> URL, saver: any PhotoLibrarySaving = PhotoLibrarySaver()) {
        _model = StateObject(wrappedValue: NotificationImageViewerModel(notificationId: notificationId, loader: loader, saver: saver))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                switch model.state {
                case .loading: ProgressView().tint(.white)
                case .failed:
                    VStack(spacing: 12) {
                        Text("图片没能加载").foregroundStyle(.white)
                        Button("重试") { Task { await model.load() } }
                    }
                case .loaded(let url):
                    ZoomableImage(url: url)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button("保存到相册") { Task { await model.save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled({ if case .loaded = model.state { return false } else { return true } }())
                    .padding()
            }
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("关闭") { dismiss() } } }
            .task { await model.load() }
            .alert(model.notice ?? "", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.clearNotice() } })) {
                Button("好", role: .cancel) {}
            }
        }
    }
}
```

`ZoomableImage` 用 `UIScrollView` 包装 `UIImage`，并在加载时用 ImageIO 降采样：

```swift
private struct ZoomableImage: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.delegate = context.coordinator
        let image = downsampledImage(at: url, maxPixelSize: 2048)
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.frame = scroll.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(view)
        context.coordinator.imageView = view
        return scroll
    }
    func updateUIView(_ uiView: UIScrollView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    }
}

private func downsampledImage(at url: URL, maxPixelSize: CGFloat) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: maxPixelSize]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: cg)
}
```

同批创建 `DesignSystem/PhotoLibrarySave.swift`（协议与真实实现都在这里，Task 14 只补权限文案与真机验收）：

```swift
import Photos
import UIKit

enum PhotoLibrarySaveError: Error, Equatable { case denied, failed }

protocol PhotoLibrarySaving {
    func save(originalFile: URL) async throws
}

struct PhotoLibrarySaver: PhotoLibrarySaving {
    func save(originalFile: URL) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw PhotoLibrarySaveError.denied }
        guard let data = try? Data(contentsOf: originalFile) else { throw PhotoLibrarySaveError.failed }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
        } catch {
            throw PhotoLibrarySaveError.failed
        }
    }
}
```

- [ ] **Step 5: 接入 RootView**

`fullScreenCover(item: $notificationImageTarget)` 的内容：

```swift
NotificationImageViewer(notificationId: target.id) { try await model.downloadNotificationImage(id: target.id) }
```

- [ ] **Step 6: 运行测试**

Run:

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15 (18.6)' \
  -only-testing:SynapseMobileTests
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift SynapseMobile/SynapseMobile/App/SynapseAppModel.swift SynapseMobile/SynapseMobile/Features/Inbox/NotificationImageViewer.swift SynapseMobile/SynapseMobile/Features/Root/RootView.swift SynapseMobile/SynapseMobileTests/NotificationImageViewerTests.swift
git commit -m "feat: 手机端通知图片下载与全屏查看器" -- SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift SynapseMobile/SynapseMobile/App/SynapseAppModel.swift SynapseMobile/SynapseMobile/Features/Inbox/NotificationImageViewer.swift SynapseMobile/SynapseMobile/Features/Root/RootView.swift SynapseMobile/SynapseMobileTests/NotificationImageViewerTests.swift
```

---

### Task 14: 相册权限被拒路径与权限文案

**Files:**
- Modify: `SynapseMobile/SynapseMobile/DesignSystem/PhotoLibrarySave.swift`（授权与写入可注入）
- Modify: `SynapseMobile/SynapseMobile/Info.plist`
- Test: `SynapseMobile/SynapseMobileTests/NotificationImageViewerTests.swift`

**Interfaces:**
- Produces:

```swift
struct PhotoLibrarySaver: PhotoLibrarySaving {
    init(
        requestAuthorization: @escaping () async -> PHAuthorizationStatus = { await PHPhotoLibrary.requestAuthorization(for: .addOnly) },
        performSave: @escaping (Data) async throws -> Void = { data in
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
        }
    )
}
```

- [ ] **Step 1: 写失败测试**

在已有测试里补：

```swift
    @Test func aDeniedAuthorizationNeverWritesToPhotos() async {
        let saver = PhotoLibrarySaver(
            requestAuthorization: { .denied },
            performSave: { _ in Issue.record("must not attempt to write") }
        )
        await #expect(throws: PhotoLibrarySaveError.denied) {
            try await saver.save(originalFile: URL(fileURLWithPath: "/tmp/x.png"))
        }
    }

    @Test func aFailedSaveReportsFailureWithoutDroppingTheImage() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let model = NotificationImageViewerModel(notificationId: "n1", loader: { url }, saver: StubSaver(result: .failure(.failed)))
        await model.load()
        await model.save()
        #expect(model.notice == "保存失败")
        #expect(model.state == .loaded(url))
    }
```

- [ ] **Step 2: 运行并确认失败**

Run: 同 Task 13 的 xcodebuild 命令。

Expected: 编译失败，`PhotoLibrarySaver` 没有注入式 `init`。

- [ ] **Step 3: 改为可注入实现**

把 Task 13 的 `PhotoLibrarySaver` 改成：

```swift
struct PhotoLibrarySaver: PhotoLibrarySaving {
    var requestAuthorization: () async -> PHAuthorizationStatus = {
        await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    }
    var performSave: (Data) async throws -> Void = { data in
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
        }
    }

    func save(originalFile: URL) async throws {
        let status = await requestAuthorization()
        guard status == .authorized || status == .limited else { throw PhotoLibrarySaveError.denied }
        guard let data = try? Data(contentsOf: originalFile) else { throw PhotoLibrarySaveError.failed }
        do {
            try await performSave(data)
        } catch {
            throw PhotoLibrarySaveError.failed
        }
    }
}
```

默认值保持生产行为，测试通过构造参数替换授权与写入。

- [ ] **Step 4: 加权限文案**

`SynapseMobile/SynapseMobile/Info.plist` 在 `NSPhotoLibraryUsageDescription` 旁加：

```xml
	<key>NSPhotoLibraryAddUsageDescription</key>
	<string>用于把你查看的图片保存到相册。</string>
```

- [ ] **Step 5: 运行测试**

Run: 同 Task 13 的 xcodebuild 命令。

Expected: PASS（含授权拒绝与保存失败两条）。

- [ ] **Step 6: 真机验收**

```bash
pnpm mobile:install
```

装到手机后：让 AI 发一条带图通知 → 点通知 → 查看图片 → 点「保存到相册」→ 在系统相册确认出现原图；再在设置里关掉相册权限重试，确认提示为「没有相册写入权限」且图片仍可看。

- [ ] **Step 7: 提交**

```bash
git add SynapseMobile/SynapseMobile/DesignSystem/PhotoLibrarySave.swift SynapseMobile/SynapseMobile/Info.plist SynapseMobile/SynapseMobileTests/NotificationImageViewerTests.swift
git commit -m "feat: 通知图片保存补充相册权限拒绝处理" -- SynapseMobile/SynapseMobile/DesignSystem/PhotoLibrarySave.swift SynapseMobile/SynapseMobile/Info.plist SynapseMobile/SynapseMobileTests/NotificationImageViewerTests.swift
```

---

### Task 15: 规则文档、发布说明与全量验证

**Files:**
- Modify: `docs/agents/capability-registry.md`（System Notifier 例外说明）
- Modify: `docs/agents/module-boundaries.md`（通知段）
- Modify: `docs/superpowers/specs/2026-09-23-account-notification-center-design.md`（第 35 行边界补充）
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- 无代码接口；只同步规则与用户可见说明。

- [ ] **Step 1: 更新能力清单**

`docs/agents/capability-registry.md` 的 System Notifier 例外说明末尾追加：

```markdown
2026-10-28：触发工具增加可选 `imagePath`（本机绝对路径，PNG/JPEG/GIF/WebP，≤10 MB）。图片不进入 APNs payload，桌面读取并上传到平台媒体存储，手机按通知 id 鉴权下载后展示并可保存到相册。**MCP 工具数仍为 1，Workflow 节点仍为 1，三张表数字不变**；开放 API 仍不支持图片。
```

- [ ] **Step 2: 更新通知边界**

`docs/agents/module-boundaries.md` 的 System Notifier 段补一句：

```markdown
可选单图只对桌面 MCP 触发开放：`imagePath` 由桌面读取并上传，服务端保存单张私有图片并随通知 90 天保留期清理；开放 API 三个发送形状继续拒绝图片字段。
```

`2026-09-23-account-notification-center-design.md` 第 35 行「不支持图片」后补：

```markdown
2026-10-28 修订：该限制只描述开放 API。MCP / 桌面路径可通过 System Notifier 的 `imagePath` 携带一张图片；开放 API 仍不接受图片。
```

- [ ] **Step 3: 更新发布说明**

`RELEASE_NOTES_PENDING.md` 增加：

```markdown
- 通知现在可以带一张图片：AI 把截图、剪贴板图片或本地图片发到手机上，点通知即可查看，并可保存到相册。
```

- [ ] **Step 4: 全量验证**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test
```

Expected: 全部通过。若出现与本改动无关的既有红，单独记录并在提交信息里说明，不要放宽断言。

iOS 再跑一次：

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15 (18.6)' \
  -only-testing:SynapseMobileTests
```

- [ ] **Step 5: 检查版本错配**

按 spec 的矩阵手验一次「新桌面 + 旧服务端」：把服务端指到没有上传端点的实例，触发带图通知，确认工具返回 `INVALID_INPUT / imagePath / service_outdated`，而不是 `success:true`。

- [ ] **Step 6: 提交**

```bash
git add docs/agents/capability-registry.md docs/agents/module-boundaries.md docs/superpowers/specs/2026-09-23-account-notification-center-design.md RELEASE_NOTES_PENDING.md
git commit -m "docs: 同步通知图片能力边界与发布说明" -- docs/agents/capability-registry.md docs/agents/module-boundaries.md docs/superpowers/specs/2026-09-23-account-notification-center-design.md RELEASE_NOTES_PENDING.md
```

---

## 交付顺序与验证清单

1. Task 1–6 服务端先行并部署，确认 `/api/notifications/desktop/image` 可用。
2. Task 7–11 桌面端发布，确认带图触发在旧服务端上明确失败。
3. Task 12–14 iOS 发布，真机验收保存到相册与拒绝权限两条路径。
4. Task 15 文档与发布说明，跑完全量验证后再进入发版流程。

## Spec 覆盖检查

| Spec 章节 | 对应任务 |
|---|---|
| 规范输入 `imagePath` / 校验 / 归一化 | Task 7 |
| 数据流（上传 → 认领 → 通知） | Task 3、4、5、9、10 |
| 服务端数据、上传、读取、清理 | Task 1、2、3、4、5、6 |
| 桌面暂存、权限、审计、失败语义 | Task 8、9、10 |
| 桌面消息中心查看 | Task 11 |
| iOS 路由、查看器、下载 | Task 12、13 |
| 保存到相册与权限文案 | Task 14 |
| Skill / 规则 / 发布说明 | Task 7、15 |
| 上线顺序与版本错配 | Task 15 |

## 明确不在本计划内

- 推送横幅缩略图（需要 Notification Service Extension）。
- 开放 API 图片支持。
- Workflow 节点图片参数。
- 多图、相册、图片编辑、桌面保存导出。
- Windows 归一化命令（实现阶段补测后写入 Skill）。
