# Drive Markdown Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public plain-text comments to cloud drive `.md` files in the Markdown Render view, with selected rendered text as the only first-version comment target.

**Architecture:** Store annotations in generic drive annotation tables keyed to real `DriveItem` IDs, with `textRange` targets held as JSON for first-version Markdown usage and future renderer expansion. Resolve annotation access through existing owner/share drive browser permissions, then let Markdown Render load annotations, mark attached ranges in sanitized preview HTML, and show a lightweight internal sticky header plus comment rail without touching the system floating menu.

**Tech Stack:** Prisma, NestJS, Vitest, shared TypeScript DTOs, TanStack Query, React 19, dashboard shadcn/Radix components, existing drive browser API patterns.

---

## Scope And File Map

Implement in focused slices. Do not implement non-`.md` comments, insert-point comment UI, comment statuses, realtime refresh, or renderer switching inside Markdown Render.

Files to create:

- `server/prisma/migrations/20260621090000_drive_annotations/migration.sql`: annotation thread/comment tables and indexes.
- `server/src/drive/drive-annotation-target.ts`: target schema, `.md` support check, and anchor resolution helpers shared by service tests.
- `server/src/drive/drive-annotation.service.ts`: annotation persistence, permissions, and DTO shaping.
- `server/src/drive/drive-annotation.service.spec.ts`: service-level behavior and permissions.
- `dashboard/src/features/drive-browser/use-drive-annotations.ts`: dashboard hook and mutations.
- `dashboard/src/features/drive-browser/use-drive-annotations.test.ts`: hook-free API utility tests if helpers are exported.
- `dashboard/src/features/drive-browser/renderers/markdown-annotation-target.ts`: selection/range helpers and rendered text model.
- `dashboard/src/features/drive-browser/renderers/markdown-annotation-target.test.ts`: DOM offset helper tests.
- `dashboard/src/features/drive-browser/renderers/markdown-annotation-render.ts`: marker insertion into sanitized Markdown HTML.
- `dashboard/src/features/drive-browser/renderers/markdown-annotation-render.test.ts`: marker insertion tests.
- `dashboard/src/features/drive-browser/renderers/markdown-comments-rail.tsx`: comment rail UI.
- `dashboard/src/features/drive-browser/renderers/markdown-comments-rail.test.tsx`: plain text, replies, edit/delete controls.

Files to modify:

- `shared/src/drive.ts`: annotation DTO and input types.
- `shared/src/drive.test.ts`: type/export smoke tests.
- `server/prisma/schema.prisma`: `DriveAnnotationThread`, `DriveAnnotationComment`, and relation fields.
- `server/src/drive/drive.module.ts`: provide `DriveAnnotationService` if the module has explicit providers.
- `server/src/drive/drive.controller.ts`: owner/share annotation routes.
- `server/src/drive/drive.controller.spec.ts`: controller routing/auth coverage.
- `dashboard/src/lib/api.ts`: `driveAnnotationApi` and protected-share auth handling for annotation writes.
- `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`: internal header, outline/comment toggles, selection action, markers, rail.
- `dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx`: UI behavior coverage.
- `RELEASE_NOTES_PENDING.md`: user-facing release note after implementation.

Verification commands:

- `pnpm --filter @synapse/shared run build`
- `pnpm --filter @synapse/shared run test -- src/drive.test.ts`
- `pnpm --filter @synapse/server run test -- src/drive/drive-annotation.service.spec.ts src/drive/drive.controller.spec.ts src/drive/drive-markdown-renderer.spec.ts`
- `pnpm --dir dashboard exec vitest run src/features/drive-browser/renderers/markdown-annotation-target.test.ts src/features/drive-browser/renderers/markdown-annotation-render.test.ts src/features/drive-browser/renderers/markdown-comments-rail.test.tsx src/features/drive-browser/renderers/markdown-renderer.test.tsx`
- `pnpm --filter @synapse/server run typecheck`
- `pnpm --filter @synapse/dashboard run tsc`

---

### Task 1: Shared Annotation Types

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Add failing shared type/export tests**

Append these tests to `shared/src/drive.test.ts`:

```ts
import type {
  DriveAnnotationAnchorStatus,
  DriveAnnotationCommentDto,
  DriveAnnotationCreateInput,
  DriveAnnotationTargetKind,
  DriveAnnotationThreadDto,
} from "./drive"

it("defines drive annotation DTOs for text range comments", () => {
  const targetKind: DriveAnnotationTargetKind = "textRange"
  const anchorStatus: DriveAnnotationAnchorStatus = "attached"
  const comment: DriveAnnotationCommentDto = {
    id: "comment-1",
    threadId: "thread-1",
    parentCommentId: null,
    body: "Use the shorter term.",
    author: {
      id: "user-1",
      email: "reader@example.com",
      displayName: "Reader",
    },
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    deleted: false,
    permissions: { canEdit: true, canDelete: true },
  }
  const thread: DriveAnnotationThreadDto = {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: "version-1",
    targetKind,
    target: {
      schemaVersion: 1,
      kind: "textRange",
      surface: "markdownRenderedText",
      range: { start: 3, end: 9 },
      quote: { exact: "重点", prefix: "这是 ", suffix: " 内容" },
    },
    anchorStatus,
    author: comment.author,
    comments: [comment],
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    permissions: { canDelete: true },
  }
  const input: DriveAnnotationCreateInput = {
    targetKind,
    target: thread.target,
    body: "Comment body",
  }

  expect(thread.comments[0]?.body).toBe("Use the shorter term.")
  expect(input.target.kind).toBe("textRange")
})
```

- [ ] **Step 2: Run shared test and verify it fails**

Run:

```bash
pnpm --filter @synapse/shared run test -- src/drive.test.ts
```

Expected: TypeScript/Vitest fails because annotation types are not exported.

- [ ] **Step 3: Add shared annotation types**

Append these exports after `DriveBrowserPasswordRequiredDto` in `shared/src/drive.ts`:

```ts
export type DriveAnnotationTargetKind = "textRange"
export type DriveAnnotationAnchorStatus = "attached" | "shifted" | "orphaned"

export interface DriveAnnotationAuthorDto {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
}

export interface DriveAnnotationTextRangeTargetV1 {
  readonly schemaVersion: 1
  readonly kind: "textRange"
  readonly surface: "markdownRenderedText"
  readonly range: {
    readonly start: number
    readonly end: number
  }
  readonly quote: {
    readonly exact: string
    readonly prefix: string
    readonly suffix: string
  }
  readonly source?: {
    readonly startOffset: number
    readonly endOffset: number
    readonly lineStart: number
    readonly lineEnd: number
  }
  readonly blockHint?: {
    readonly path: readonly number[]
    readonly type: string
    readonly textHash: string
  }
}

export type DriveAnnotationTargetDto = DriveAnnotationTextRangeTargetV1

export interface DriveAnnotationCommentDto {
  readonly id: string
  readonly threadId: string
  readonly parentCommentId: string | null
  readonly body: string
  readonly author: DriveAnnotationAuthorDto
  readonly createdAt: string
  readonly updatedAt: string
  readonly editedAt: string | null
  readonly deletedAt: string | null
  readonly deleted: boolean
  readonly permissions: {
    readonly canEdit: boolean
    readonly canDelete: boolean
  }
}

export interface DriveAnnotationThreadDto {
  readonly id: string
  readonly itemId: string
  readonly baseVersionId: string | null
  readonly targetKind: DriveAnnotationTargetKind
  readonly target: DriveAnnotationTargetDto
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly author: DriveAnnotationAuthorDto
  readonly comments: readonly DriveAnnotationCommentDto[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly permissions: {
    readonly canDelete: boolean
  }
}

export interface DriveAnnotationCreateInput {
  readonly targetKind: DriveAnnotationTargetKind
  readonly target: DriveAnnotationTargetDto
  readonly body: string
}

export interface DriveAnnotationReplyInput {
  readonly parentCommentId?: string | null
  readonly body: string
}

export interface DriveAnnotationCommentUpdateInput {
  readonly body: string
}
```

- [ ] **Step 4: Run shared tests**

Run:

```bash
pnpm --filter @synapse/shared run test -- src/drive.test.ts
pnpm --filter @synapse/shared run build
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(shared): add drive annotation types"
```

---

### Task 2: Prisma Schema And Migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260621090000_drive_annotations/migration.sql`

- [ ] **Step 1: Add Prisma models and relations**

Modify `server/prisma/schema.prisma`.

Add relation fields to `User`:

```prisma
  driveAnnotationThreads        DriveAnnotationThread[]
  driveAnnotationComments       DriveAnnotationComment[]
```

Add relation field to `DriveItem`:

```prisma
  annotationThreads  DriveAnnotationThread[]
```

Add models after `DriveFileVersion`:

```prisma
model DriveAnnotationThread {
  id              String                   @id @default(cuid())
  itemId          String
  item            DriveItem                @relation(fields: [itemId], references: [id], onDelete: Restrict)
  baseVersionId   String?
  targetKind      String                   @db.VarChar(64)
  target          Json
  anchorStatus    String                   @default("attached") @db.VarChar(32)
  createdByUserId String
  createdByUser   User                     @relation(fields: [createdByUserId], references: [id], onDelete: Restrict)
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  deletedAt       DateTime?
  comments        DriveAnnotationComment[]

  @@index([itemId, deletedAt, createdAt])
  @@index([createdByUserId, createdAt])
  @@index([anchorStatus])
}

model DriveAnnotationComment {
  id              String                   @id @default(cuid())
  threadId        String
  thread          DriveAnnotationThread    @relation(fields: [threadId], references: [id], onDelete: Cascade)
  parentCommentId String?
  parentComment   DriveAnnotationComment?  @relation("DriveAnnotationCommentReplies", fields: [parentCommentId], references: [id], onDelete: Restrict)
  replies         DriveAnnotationComment[] @relation("DriveAnnotationCommentReplies")
  body            String
  createdByUserId String
  createdByUser   User                     @relation(fields: [createdByUserId], references: [id], onDelete: Restrict)
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  editedAt        DateTime?
  deletedAt       DateTime?

  @@index([threadId, createdAt])
  @@index([parentCommentId])
  @@index([createdByUserId, createdAt])
}
```

- [ ] **Step 2: Create SQL migration**

Create `server/prisma/migrations/20260621090000_drive_annotations/migration.sql`:

```sql
CREATE TABLE "DriveAnnotationThread" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "baseVersionId" TEXT,
  "targetKind" VARCHAR(64) NOT NULL,
  "target" JSONB NOT NULL,
  "anchorStatus" VARCHAR(32) NOT NULL DEFAULT 'attached',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveAnnotationThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveAnnotationComment" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "parentCommentId" TEXT,
  "body" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveAnnotationComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriveAnnotationThread_itemId_deletedAt_createdAt_idx"
  ON "DriveAnnotationThread"("itemId", "deletedAt", "createdAt");
CREATE INDEX "DriveAnnotationThread_createdByUserId_createdAt_idx"
  ON "DriveAnnotationThread"("createdByUserId", "createdAt");
CREATE INDEX "DriveAnnotationThread_anchorStatus_idx"
  ON "DriveAnnotationThread"("anchorStatus");
CREATE INDEX "DriveAnnotationComment_threadId_createdAt_idx"
  ON "DriveAnnotationComment"("threadId", "createdAt");
CREATE INDEX "DriveAnnotationComment_parentCommentId_idx"
  ON "DriveAnnotationComment"("parentCommentId");
CREATE INDEX "DriveAnnotationComment_createdByUserId_createdAt_idx"
  ON "DriveAnnotationComment"("createdByUserId", "createdAt");

ALTER TABLE "DriveAnnotationThread"
  ADD CONSTRAINT "DriveAnnotationThread_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationThread"
  ADD CONSTRAINT "DriveAnnotationThread_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationComment"
  ADD CONSTRAINT "DriveAnnotationComment_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "DriveAnnotationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationComment"
  ADD CONSTRAINT "DriveAnnotationComment_parentCommentId_fkey"
  FOREIGN KEY ("parentCommentId") REFERENCES "DriveAnnotationComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveAnnotationComment"
  ADD CONSTRAINT "DriveAnnotationComment_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
```

Expected: Prisma client generation succeeds with the new models.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260621090000_drive_annotations/migration.sql
git commit -m "feat(server): add drive annotation tables"
```

---

### Task 3: Server Target Validation And Anchor Resolution Helpers

**Files:**
- Create: `server/src/drive/drive-annotation-target.ts`
- Create: `server/src/drive/drive-annotation-target.spec.ts`

- [ ] **Step 1: Write failing target helper tests**

Create `server/src/drive/drive-annotation-target.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  isCommentableMarkdownItem,
  parseDriveAnnotationCreateBody,
  resolveDriveAnnotationTarget,
} from "./drive-annotation-target"

describe("drive annotation target helpers", () => {
  it("allows only .md files for first-version comment creation", () => {
    expect(isCommentableMarkdownItem({ name: "notes.md", type: "file", mimeType: "text/markdown" })).toBe(true)
    expect(isCommentableMarkdownItem({ name: "notes.markdown", type: "file", mimeType: "text/markdown" })).toBe(false)
    expect(isCommentableMarkdownItem({ name: "notes.mdx", type: "file", mimeType: "text/markdown" })).toBe(false)
    expect(isCommentableMarkdownItem({ name: "folder.md", type: "folder", mimeType: null })).toBe(false)
  })

  it("validates text range create bodies", () => {
    const parsed = parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 2, end: 5 },
        quote: { exact: "abc", prefix: "x", suffix: "y" },
      },
      body: "Looks good",
    })

    expect(parsed.body).toBe("Looks good")
    expect(parsed.target.range).toEqual({ start: 2, end: 5 })
  })

  it("rejects empty comments and collapsed ranges in first-version UI input", () => {
    expect(() => parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 4, end: 4 },
        quote: { exact: "", prefix: "abc", suffix: "def" },
      },
      body: "ok",
    })).toThrow("评论位置无效。")

    expect(() => parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 1, end: 2 },
        quote: { exact: "a", prefix: "", suffix: "" },
      },
      body: "   ",
    })).toThrow("评论内容不能为空。")
  })

  it("reattaches exact quotes after inserted text", () => {
    const result = resolveDriveAnnotationTarget({
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 6, end: 10 },
        quote: { exact: "重点文本", prefix: "这是", suffix: "内容" },
      },
      renderedText: "新增段落。这是重点文本内容。",
    })

    expect(result.anchorStatus).toBe("shifted")
    expect(result.range).toEqual({ start: 8, end: 12 })
  })

  it("marks ambiguous repeated quotes orphaned", () => {
    const result = resolveDriveAnnotationTarget({
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 0, end: 2 },
        quote: { exact: "重复", prefix: "", suffix: "" },
      },
      renderedText: "重复。重复。",
    })

    expect(result.anchorStatus).toBe("orphaned")
    expect(result.range).toBeNull()
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server run test -- src/drive/drive-annotation-target.spec.ts
```

Expected: fails because helper module does not exist.

- [ ] **Step 3: Implement target helper**

Create `server/src/drive/drive-annotation-target.ts`:

```ts
import { BadRequestException } from "@nestjs/common"
import { z } from "zod"
import type {
  DriveAnnotationAnchorStatus,
  DriveAnnotationCreateInput,
  DriveAnnotationTextRangeTargetV1,
} from "@synapse/shared"

const COMMENT_MAX_LENGTH = 4000

const textRangeTargetSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("textRange"),
  surface: z.literal("markdownRenderedText"),
  range: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).strict(),
  quote: z.object({
    exact: z.string().min(1).max(1000),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  }).strict(),
  source: z.object({
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  }).strict().optional(),
  blockHint: z.object({
    path: z.array(z.number().int().nonnegative()).max(32),
    type: z.string().min(1).max(64),
    textHash: z.string().min(1).max(128),
  }).strict().optional(),
}).strict()

const createBodySchema = z.object({
  targetKind: z.literal("textRange"),
  target: textRangeTargetSchema,
  body: z.string().max(COMMENT_MAX_LENGTH),
}).strict()

export type DriveAnnotationResolvedTarget = {
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly range: { readonly start: number; readonly end: number } | null
}

export function isCommentableMarkdownItem(item: {
  readonly name: string
  readonly type: string
  readonly mimeType: string | null
}): boolean {
  return item.type === "file" && item.name.toLowerCase().endsWith(".md")
}

export function parseDriveAnnotationCreateBody(value: unknown): DriveAnnotationCreateInput {
  const parsed = createBodySchema.safeParse(value)
  if (!parsed.success) throw new BadRequestException("评论请求无效。")
  const body = parsed.data.body.trim()
  if (!body) throw new BadRequestException("评论内容不能为空。")
  if (parsed.data.target.range.end <= parsed.data.target.range.start) {
    throw new BadRequestException("评论位置无效。")
  }
  return { ...parsed.data, body }
}

export function parseDriveAnnotationReplyBody(value: unknown): { readonly parentCommentId: string | null; readonly body: string } {
  const parsed = z.object({
    parentCommentId: z.string().min(1).nullable().optional(),
    body: z.string().max(COMMENT_MAX_LENGTH),
  }).strict().safeParse(value)
  if (!parsed.success) throw new BadRequestException("回复请求无效。")
  const body = parsed.data.body.trim()
  if (!body) throw new BadRequestException("回复内容不能为空。")
  return { parentCommentId: parsed.data.parentCommentId ?? null, body }
}

export function parseDriveAnnotationCommentUpdateBody(value: unknown): { readonly body: string } {
  const parsed = z.object({ body: z.string().max(COMMENT_MAX_LENGTH) }).strict().safeParse(value)
  if (!parsed.success) throw new BadRequestException("评论更新请求无效。")
  const body = parsed.data.body.trim()
  if (!body) throw new BadRequestException("评论内容不能为空。")
  return { body }
}

export function resolveDriveAnnotationTarget(input: {
  readonly target: DriveAnnotationTextRangeTargetV1
  readonly renderedText: string
}): DriveAnnotationResolvedTarget {
  const { target, renderedText } = input
  const direct = renderedText.slice(target.range.start, target.range.end)
  if (direct === target.quote.exact) return { anchorStatus: "attached", range: target.range }

  const matches = findAllMatches(renderedText, target.quote.exact)
  if (matches.length === 0) return { anchorStatus: "orphaned", range: null }

  const scored = matches
    .map((range) => ({ range, score: scoreMatch(renderedText, target, range) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (!best || best.score <= 0) return { anchorStatus: "orphaned", range: null }
  if (second && second.score === best.score) return { anchorStatus: "orphaned", range: null }
  return { anchorStatus: "shifted", range: best.range }
}

function findAllMatches(text: string, exact: string): Array<{ readonly start: number; readonly end: number }> {
  const matches: Array<{ readonly start: number; readonly end: number }> = []
  let cursor = 0
  while (cursor <= text.length) {
    const index = text.indexOf(exact, cursor)
    if (index === -1) break
    matches.push({ start: index, end: index + exact.length })
    cursor = index + Math.max(1, exact.length)
  }
  return matches
}

function scoreMatch(
  renderedText: string,
  target: DriveAnnotationTextRangeTargetV1,
  range: { readonly start: number; readonly end: number },
): number {
  let score = 1
  if (target.quote.prefix) {
    const before = renderedText.slice(Math.max(0, range.start - target.quote.prefix.length), range.start)
    if (before === target.quote.prefix) score += 4
  }
  if (target.quote.suffix) {
    const after = renderedText.slice(range.end, range.end + target.quote.suffix.length)
    if (after === target.quote.suffix) score += 4
  }
  const distance = Math.abs(range.start - target.range.start)
  return score - Math.min(1, distance / Math.max(1, renderedText.length))
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/drive/drive-annotation-target.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/drive/drive-annotation-target.ts server/src/drive/drive-annotation-target.spec.ts
git commit -m "feat(server): add drive annotation target helpers"
```

---

### Task 4: Server Annotation Service

**Files:**
- Create: `server/src/drive/drive-annotation.service.ts`
- Create: `server/src/drive/drive-annotation.service.spec.ts`
- Modify: `server/src/drive/drive.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/drive/drive-annotation.service.spec.ts` with a mocked Prisma client:

```ts
import { ForbiddenException, NotFoundException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DriveAnnotationService } from "./drive-annotation.service"

describe("DriveAnnotationService", () => {
  const prisma = createPrismaMock()
  const drive = createDriveServiceMock()
  const service = new DriveAnnotationService(prisma as never, drive as never)

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.driveItem.findFirst.mockResolvedValue(markdownItem())
    prisma.driveAnnotationThread.findMany.mockResolvedValue([threadRecord()])
    prisma.driveAnnotationThread.create.mockResolvedValue(threadRecord())
    prisma.driveAnnotationComment.create.mockResolvedValue(commentRecord())
    prisma.driveAnnotationComment.findFirst.mockResolvedValue(commentRecord())
    prisma.driveAnnotationComment.update.mockResolvedValue({ ...commentRecord(), body: "updated" })
    prisma.driveAnnotationThread.update.mockResolvedValue({ ...threadRecord(), deletedAt: new Date("2026-06-21T00:00:00.000Z") })
    prisma.driveFileVersion.findFirst.mockResolvedValue({ id: "version-1" })
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot())
  })

  it("lists visible owner annotations with author metadata", async () => {
    const result = await service.listOwnerAnnotations("owner-1", "item-1")

    expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "item-1", userId: "owner-1" }),
    }))
    expect(result[0]?.comments[0]?.author.email).toBe("reader@example.com")
  })

  it("creates a thread plus first comment for .md files", async () => {
    const result = await service.createOwnerAnnotation("owner-1", "item-1", createInput())

    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        itemId: "item-1",
        createdByUserId: "owner-1",
        comments: { create: expect.objectContaining({ body: "Comment body" }) },
      }),
    }))
    expect(result.id).toBe("thread-1")
  })

  it("rejects comment creation for unsupported file names", async () => {
    prisma.driveItem.findFirst.mockResolvedValueOnce({ ...markdownItem(), name: "notes.mdx" })

    await expect(service.createOwnerAnnotation("owner-1", "item-1", createInput()))
      .rejects.toThrow("该文件暂不支持评论。")
  })

  it("allows authors to edit their own comments", async () => {
    const ownComment = {
      ...commentRecord(),
      createdByUserId: "owner-1",
      createdByUser: { id: "owner-1", email: "owner@example.com", displayName: "Owner" },
    }
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(ownComment)
    prisma.driveAnnotationComment.update.mockResolvedValueOnce({ ...ownComment, body: "updated" })

    const result = await service.updateOwnerComment("owner-1", "item-1", "comment-1", { body: "updated" })

    expect(result.body).toBe("updated")
    expect(prisma.driveAnnotationComment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "comment-1" },
      data: expect.objectContaining({ body: "updated", editedAt: expect.any(Date) }),
    }))
  })

  it("rejects editing another user's comment", async () => {
    await expect(service.updateOwnerComment("owner-1", "item-1", "comment-1", { body: "updated" }))
      .rejects.toBeInstanceOf(ForbiddenException)
  })

  it("lets the file owner delete any thread", async () => {
    await service.deleteOwnerThread("owner-1", "item-1", "thread-1")

    expect(prisma.driveAnnotationThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })
})

function createInput() {
  return {
    targetKind: "textRange" as const,
    target: {
      schemaVersion: 1 as const,
      kind: "textRange" as const,
      surface: "markdownRenderedText" as const,
      range: { start: 0, end: 4 },
      quote: { exact: "Note", prefix: "", suffix: "" },
    },
    body: "Comment body",
  }
}

function markdownItem() {
  return {
    id: "item-1",
    userId: "owner-1",
    name: "notes.md",
    type: "file",
    mimeType: "text/markdown",
    storageKey: "drive/user-1/item-1/current.md",
  }
}

function shareSnapshot() {
  return {
    context: "share",
    surface: "standalone",
    current: {
      id: "item-1",
      name: "notes.md",
      type: "file",
      mimeType: "text/markdown",
    },
  }
}

function threadRecord() {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  return {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: "version-1",
    targetKind: "textRange",
    target: createInput().target,
    anchorStatus: "attached",
    createdByUserId: "reader-1",
    createdByUser: { id: "reader-1", email: "reader@example.com", displayName: "Reader" },
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    comments: [commentRecord()],
  }
}

function commentRecord() {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  return {
    id: "comment-1",
    threadId: "thread-1",
    parentCommentId: null,
    body: "Comment body",
    createdByUserId: "reader-1",
    createdByUser: { id: "reader-1", email: "reader@example.com", displayName: "Reader" },
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    deletedAt: null,
  }
}

function createPrismaMock() {
  return {
    driveItem: { findFirst: vi.fn() },
    driveFileVersion: { findFirst: vi.fn() },
    driveAnnotationThread: {
      findMany: vi.fn(),
      findFirst: vi.fn(async () => threadRecord()),
      create: vi.fn(),
      update: vi.fn(),
    },
    driveAnnotationComment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  }
}

function createDriveServiceMock() {
  return {
    getShareBrowserSnapshot: vi.fn(),
  }
}
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server run test -- src/drive/drive-annotation.service.spec.ts
```

Expected: fails because the service module does not exist.

- [ ] **Step 3: Implement service**

Create `server/src/drive/drive-annotation.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import type {
  DriveAnnotationCommentDto,
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationTargetDto,
  DriveAnnotationThreadDto,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { isCommentableMarkdownItem } from "./drive-annotation-target"
import { DriveService } from "./drive.service"

type AnnotationThreadRecord = {
  readonly id: string
  readonly itemId: string
  readonly baseVersionId: string | null
  readonly targetKind: string
  readonly target: unknown
  readonly anchorStatus: string
  readonly createdByUserId: string
  readonly createdByUser: { readonly id: string; readonly email: string; readonly displayName: string | null }
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly comments: readonly AnnotationCommentRecord[]
}

type AnnotationCommentRecord = {
  readonly id: string
  readonly threadId: string
  readonly parentCommentId: string | null
  readonly body: string
  readonly createdByUserId: string
  readonly createdByUser: { readonly id: string; readonly email: string; readonly displayName: string | null }
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly editedAt: Date | null
  readonly deletedAt: Date | null
}

const annotationInclude = {
  createdByUser: { select: { id: true, email: true, displayName: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
  },
}

@Injectable()
export class DriveAnnotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
  ) {}

  async listOwnerAnnotations(userId: string, itemId: string): Promise<DriveAnnotationThreadDto[]> {
    const item = await this.requireOwnerItem(userId, itemId)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return threads.map((thread) => toThreadDto(thread, userId, item.userId))
  }

  async createOwnerAnnotation(userId: string, itemId: string, input: DriveAnnotationCreateInput): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    assertCommentableItem(item)
    const thread = await this.prisma.driveAnnotationThread.create({
      data: {
        itemId,
        baseVersionId: await this.findCurrentVersionId(item),
        targetKind: input.targetKind,
        target: input.target,
        anchorStatus: "attached",
        createdByUserId: userId,
        comments: { create: { body: input.body, createdByUserId: userId } },
      },
      include: annotationInclude,
    })
    return toThreadDto(thread, userId, item.userId)
  }

  async replyOwnerAnnotation(userId: string, itemId: string, threadId: string, input: DriveAnnotationReplyInput): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    await this.requireThread(itemId, threadId)
    const comment = await this.prisma.driveAnnotationComment.create({
      data: {
        threadId,
        parentCommentId: input.parentCommentId ?? null,
        body: input.body,
        createdByUserId: userId,
      },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    return toCommentDto(comment, userId, item.userId)
  }

  async updateOwnerComment(userId: string, itemId: string, commentId: string, input: DriveAnnotationCommentUpdateInput): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    const comment = await this.requireComment(itemId, commentId)
    if (comment.createdByUserId !== userId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: commentId },
      data: { body: input.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    return toCommentDto(updated, userId, item.userId)
  }

  async deleteOwnerComment(userId: string, itemId: string, commentId: string): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    const comment = await this.requireComment(itemId, commentId)
    if (comment.createdByUserId !== userId && item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    await this.prisma.driveAnnotationComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  async deleteOwnerThread(userId: string, itemId: string, threadId: string): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    if (item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    await this.requireThread(itemId, threadId)
    await this.prisma.driveAnnotationThread.update({ where: { id: threadId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  private async requireOwnerItem(userId: string, itemId: string) {
    const item = await this.prisma.driveItem.findFirst({
      where: { id: itemId, userId, deletedAt: null },
      select: { id: true, userId: true, name: true, type: true, mimeType: true, storageKey: true },
    })
    if (!item) throw new NotFoundException("文件未找到")
    return item
  }

  private async requireThread(itemId: string, threadId: string) {
    const thread = await this.prisma.driveAnnotationThread.findFirst({ where: { id: threadId, itemId, deletedAt: null } })
    if (!thread) throw new NotFoundException("评论不存在。")
    return thread
  }

  private async requireComment(itemId: string, commentId: string) {
    const comment = await this.prisma.driveAnnotationComment.findFirst({
      where: { id: commentId, thread: { itemId, deletedAt: null }, deletedAt: null },
    })
    if (!comment) throw new NotFoundException("评论不存在。")
    return comment
  }

  private async findCurrentVersionId(item: {
    readonly id: string
    readonly type: string
    readonly storageKey: string | null
  }): Promise<string | null> {
    if (item.type !== "file" || !item.storageKey) return null
    const version = await this.prisma.driveFileVersion.findFirst({
      where: { itemId: item.id, storageKey: item.storageKey, deletedAt: null },
      select: { id: true },
    })
    return version?.id ?? null
  }
}

function assertCommentableItem(item: { readonly name: string; readonly type: string; readonly mimeType: string | null }) {
  if (!isCommentableMarkdownItem(item)) throw new BadRequestException("该文件暂不支持评论。")
}

function toThreadDto(record: AnnotationThreadRecord, actorUserId: string | null, fileOwnerUserId: string): DriveAnnotationThreadDto {
  return {
    id: record.id,
    itemId: record.itemId,
    baseVersionId: record.baseVersionId,
    targetKind: "textRange",
    target: record.target as DriveAnnotationTargetDto,
    anchorStatus: record.anchorStatus === "shifted" || record.anchorStatus === "orphaned" ? record.anchorStatus : "attached",
    author: record.createdByUser,
    comments: visibleComments(record.comments).map((comment) => toCommentDto(comment, actorUserId, fileOwnerUserId)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: { canDelete: Boolean(actorUserId && actorUserId === fileOwnerUserId) },
  }
}

function visibleComments(comments: readonly AnnotationCommentRecord[]): readonly AnnotationCommentRecord[] {
  const parentIds = new Set(comments.map((comment) => comment.parentCommentId).filter((id): id is string => Boolean(id)))
  return comments.filter((comment) => !comment.deletedAt || parentIds.has(comment.id))
}

function toCommentDto(record: AnnotationCommentRecord, actorUserId: string | null, fileOwnerUserId: string): DriveAnnotationCommentDto {
  const deleted = Boolean(record.deletedAt)
  const isAuthor = actorUserId === record.createdByUserId
  const isFileOwner = actorUserId === fileOwnerUserId
  return {
    id: record.id,
    threadId: record.threadId,
    parentCommentId: record.parentCommentId,
    body: deleted ? "" : record.body,
    author: record.createdByUser,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    editedAt: record.editedAt?.toISOString() ?? null,
    deletedAt: record.deletedAt?.toISOString() ?? null,
    deleted,
    permissions: {
      canEdit: !deleted && Boolean(isAuthor),
      canDelete: !deleted && Boolean(isAuthor || isFileOwner),
    },
  }
}
```

- [ ] **Step 4: Register the service**

Modify `server/src/drive/drive.module.ts` to register the service with the existing explicit provider list:

```ts
import { DriveAnnotationService } from "./drive-annotation.service"
```

and include `DriveAnnotationService` in `providers`.

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/drive/drive-annotation.service.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-annotation.service.ts server/src/drive/drive-annotation.service.spec.ts server/src/drive/drive.module.ts
git commit -m "feat(server): add drive annotation service"
```

---

### Task 5: Owner And Share Annotation Routes

**Files:**
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Add failing controller route tests**

In `server/src/drive/drive.controller.spec.ts`, add `annotationService` to the top-level mocks:

```ts
const annotations = {
  listOwnerAnnotations: vi.fn(),
  createOwnerAnnotation: vi.fn(),
  replyOwnerAnnotation: vi.fn(),
  updateOwnerComment: vi.fn(),
  deleteOwnerComment: vi.fn(),
  deleteOwnerThread: vi.fn(),
}
```

Reset it in `beforeEach`:

```ts
annotations.listOwnerAnnotations.mockReset()
annotations.createOwnerAnnotation.mockReset()
annotations.replyOwnerAnnotation.mockReset()
annotations.updateOwnerComment.mockReset()
annotations.deleteOwnerComment.mockReset()
annotations.deleteOwnerThread.mockReset()
```

Add this test near owner browser tests:

```ts
it("routes owner annotation requests through the annotation service", async () => {
  annotations.listOwnerAnnotations.mockResolvedValue([])
  annotations.createOwnerAnnotation.mockResolvedValue(createAnnotationThread())
  const moduleRef = await Test.createTestingModule({
    controllers: [DriveUserController],
    providers: [
      { provide: DriveService, useValue: drive },
      { provide: DriveAnnotationService, useValue: annotations },
    ],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: vi.fn((context) => {
      context.switchToHttp().getRequest().user = { id: "user-1" }
      return true
    }) })
    .compile()
  const userApp = moduleRef.createNestApplication()
  await userApp.init()

  await request(userApp.getHttpServer()).get("/api/drive/browser/owner/items/item-1/annotations").expect(200)
  await request(userApp.getHttpServer())
    .post("/api/drive/browser/owner/items/item-1/annotations")
    .send(createAnnotationInput())
    .expect(201)

  expect(annotations.listOwnerAnnotations).toHaveBeenCalledWith("user-1", "item-1")
  expect(annotations.createOwnerAnnotation).toHaveBeenCalledWith("user-1", "item-1", expect.objectContaining({ body: "Comment body" }))
  await userApp.close()
})

function createAnnotationInput() {
  return {
    targetKind: "textRange",
    target: {
      schemaVersion: 1,
      kind: "textRange",
      surface: "markdownRenderedText",
      range: { start: 0, end: 4 },
      quote: { exact: "Note", prefix: "", suffix: "" },
    },
    body: "Comment body",
  }
}

function createAnnotationThread() {
  return {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: "version-1",
    targetKind: "textRange",
    target: createAnnotationInput().target,
    anchorStatus: "attached",
    author: { id: "user-1", email: "user@example.com", displayName: null },
    comments: [],
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  }
}
```

Add `DriveAnnotationService` import.

- [ ] **Step 2: Run controller test and verify it fails**

Run:

```bash
pnpm --filter @synapse/server run test -- src/drive/drive.controller.spec.ts
```

Expected: fails because annotation routes and injected service are missing.

- [ ] **Step 3: Add controller constructor dependency**

Modify `DriveUserController` constructor in `server/src/drive/drive.controller.ts`:

```ts
constructor(
  private readonly drive: DriveService,
  private readonly annotations: DriveAnnotationService,
  @Optional() private readonly publicAssets?: DrivePublicAssetService,
) {}
```

Add import:

```ts
import { DriveAnnotationService } from "./drive-annotation.service"
import {
  parseDriveAnnotationCommentUpdateBody,
  parseDriveAnnotationCreateBody,
  parseDriveAnnotationReplyBody,
} from "./drive-annotation-target"
```

- [ ] **Step 4: Add owner routes**

Add these methods before the end of `DriveUserController`:

```ts
@Get("/browser/owner/items/:itemId/annotations")
listOwnerAnnotations(@Param("itemId") itemId: string, @Req() request: AuthenticatedUserRequest) {
  return this.annotations.listOwnerAnnotations(request.user!.id, itemId)
}

@Post("/browser/owner/items/:itemId/annotations")
createOwnerAnnotation(
  @Param("itemId") itemId: string,
  @Body() body: unknown,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.annotations.createOwnerAnnotation(request.user!.id, itemId, parseDriveAnnotationCreateBody(body))
}

@Post("/browser/owner/items/:itemId/annotations/:threadId/comments")
replyOwnerAnnotation(
  @Param("itemId") itemId: string,
  @Param("threadId") threadId: string,
  @Body() body: unknown,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.annotations.replyOwnerAnnotation(request.user!.id, itemId, threadId, parseDriveAnnotationReplyBody(body))
}

@Patch("/browser/owner/items/:itemId/annotations/comments/:commentId")
updateOwnerAnnotationComment(
  @Param("itemId") itemId: string,
  @Param("commentId") commentId: string,
  @Body() body: unknown,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.annotations.updateOwnerComment(request.user!.id, itemId, commentId, parseDriveAnnotationCommentUpdateBody(body))
}

@Delete("/browser/owner/items/:itemId/annotations/comments/:commentId")
deleteOwnerAnnotationComment(
  @Param("itemId") itemId: string,
  @Param("commentId") commentId: string,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.annotations.deleteOwnerComment(request.user!.id, itemId, commentId)
}

@Delete("/browser/owner/items/:itemId/annotations/:threadId")
deleteOwnerAnnotationThread(
  @Param("itemId") itemId: string,
  @Param("threadId") threadId: string,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.annotations.deleteOwnerThread(request.user!.id, itemId, threadId)
}
```

- [ ] **Step 5: Add share service methods and routes**

Add matching service methods in `DriveAnnotationService`:

```ts
async listShareAnnotations(input: { readonly shareId: string; readonly itemId?: string; readonly cookie?: string | null }): Promise<DriveAnnotationThreadDto[]> {
  const item = await this.requireShareVisibleItem(input)
  const threads = await this.prisma.driveAnnotationThread.findMany({
    where: { itemId: item.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: annotationInclude,
  })
  return threads.map((thread) => toThreadDto(thread, null, item.userId))
}

async createShareAnnotation(input: {
  readonly actorUserId: string
  readonly shareId: string
  readonly itemId?: string
  readonly cookie?: string | null
  readonly body: DriveAnnotationCreateInput
}): Promise<DriveAnnotationThreadDto> {
  const item = await this.requireShareVisibleItem(input)
  assertCommentableItem(item)
  const thread = await this.prisma.driveAnnotationThread.create({
    data: {
      itemId: item.id,
      baseVersionId: await this.findCurrentVersionId(item),
      targetKind: input.body.targetKind,
      target: input.body.target,
      anchorStatus: "attached",
      createdByUserId: input.actorUserId,
      comments: { create: { body: input.body.body, createdByUserId: input.actorUserId } },
    },
    include: annotationInclude,
  })
  return toThreadDto(thread, input.actorUserId, item.userId)
}

async replyShareAnnotation(input: {
  readonly actorUserId: string
  readonly shareId: string
  readonly itemId?: string
  readonly cookie?: string | null
  readonly threadId: string
  readonly body: DriveAnnotationReplyInput
}): Promise<DriveAnnotationCommentDto> {
  const item = await this.requireShareVisibleItem(input)
  await this.requireThread(item.id, input.threadId)
  const comment = await this.prisma.driveAnnotationComment.create({
    data: {
      threadId: input.threadId,
      parentCommentId: input.body.parentCommentId ?? null,
      body: input.body.body,
      createdByUserId: input.actorUserId,
    },
    include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
  })
  return toCommentDto(comment, input.actorUserId, item.userId)
}

async updateShareComment(input: {
  readonly actorUserId: string
  readonly shareId: string
  readonly itemId?: string
  readonly cookie?: string | null
  readonly commentId: string
  readonly body: DriveAnnotationCommentUpdateInput
}): Promise<DriveAnnotationCommentDto> {
  const item = await this.requireShareVisibleItem(input)
  const comment = await this.requireComment(item.id, input.commentId)
  if (comment.createdByUserId !== input.actorUserId) throw new ForbiddenException("不能编辑他人的评论。")
  const updated = await this.prisma.driveAnnotationComment.update({
    where: { id: input.commentId },
    data: { body: input.body.body, editedAt: new Date() },
    include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
  })
  return toCommentDto(updated, input.actorUserId, item.userId)
}

async deleteShareComment(input: {
  readonly actorUserId: string
  readonly shareId: string
  readonly itemId?: string
  readonly cookie?: string | null
  readonly commentId: string
}): Promise<{ readonly ok: true }> {
  const item = await this.requireShareVisibleItem(input)
  const comment = await this.requireComment(item.id, input.commentId)
  if (comment.createdByUserId !== input.actorUserId && item.userId !== input.actorUserId) {
    throw new ForbiddenException("不能删除该评论。")
  }
  await this.prisma.driveAnnotationComment.update({ where: { id: input.commentId }, data: { deletedAt: new Date() } })
  return { ok: true }
}

async deleteShareThread(input: {
  readonly actorUserId: string
  readonly shareId: string
  readonly itemId?: string
  readonly cookie?: string | null
  readonly threadId: string
}): Promise<{ readonly ok: true }> {
  const item = await this.requireShareVisibleItem(input)
  if (item.userId !== input.actorUserId) throw new ForbiddenException("不能删除该评论。")
  await this.requireThread(item.id, input.threadId)
  await this.prisma.driveAnnotationThread.update({ where: { id: input.threadId }, data: { deletedAt: new Date() } })
  return { ok: true }
}

private async requireShareVisibleItem(input: {
  readonly shareId: string
  readonly itemId?: string
  readonly cookie?: string | null
  readonly actorUserId?: string | null
}) {
  const snapshot = await this.drive.getShareBrowserSnapshot({
    shareId: input.shareId,
    itemId: input.itemId,
    cookie: input.cookie ?? undefined,
    actorUserId: input.actorUserId ?? null,
  })
  const item = await this.prisma.driveItem.findFirst({
    where: { id: snapshot.current.id, deletedAt: null },
    select: { id: true, userId: true, name: true, type: true, mimeType: true, storageKey: true },
  })
  if (!item) throw new NotFoundException("文件未找到")
  return item
}
```

Add public share routes beside existing share browser routes:

- `GET /api/drive/browser/shares/:shareId/annotations`
- `GET /api/drive/browser/shares/:shareId/items/:itemId/annotations`
- `POST /api/drive/browser/shares/:shareId/annotations`
- `POST /api/drive/browser/shares/:shareId/items/:itemId/annotations`
- `POST /api/drive/browser/shares/:shareId/annotations/:threadId/comments`
- `POST /api/drive/browser/shares/:shareId/items/:itemId/annotations/:threadId/comments`
- `PATCH /api/drive/browser/shares/:shareId/annotations/comments/:commentId`
- `PATCH /api/drive/browser/shares/:shareId/items/:itemId/annotations/comments/:commentId`
- `DELETE /api/drive/browser/shares/:shareId/annotations/comments/:commentId`
- `DELETE /api/drive/browser/shares/:shareId/items/:itemId/annotations/comments/:commentId`
- `DELETE /api/drive/browser/shares/:shareId/annotations/:threadId`
- `DELETE /api/drive/browser/shares/:shareId/items/:itemId/annotations/:threadId`

Read routes do not use `UserAuthGuard`. Create/reply/update/delete routes use `UserAuthGuard` and pass `readDriveAccessCookie(request, { kind: "share", publicId: shareId })` into the service input.

- [ ] **Step 6: Run controller tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/drive/drive.controller.spec.ts src/drive/drive-annotation.service.spec.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.controller.spec.ts server/src/drive/drive-annotation.service.ts server/src/drive/drive-annotation.service.spec.ts
git commit -m "feat(server): expose drive annotation APIs"
```

---

### Task 6: Dashboard Annotation API And Hook

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/features/drive-browser/use-drive-annotations.ts`

- [ ] **Step 1: Add API methods**

Modify `dashboard/src/lib/api.ts`.

Add imports from `@synapse/shared`:

```ts
  DriveAnnotationCommentDto,
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationThreadDto,
```

Add a protected drive share annotation matcher near `isProtectedDriveShareBrowserPath`:

```ts
function isProtectedDriveShareAnnotationPath(path: string) {
  return new RegExp(`^${driveBrowserApiBasePath}/shares/[^/?#]+(?:/items/[^/?#]+)?/annotations(?:/[^/?#]+/comments|/comments/[^/?#]+|/[^/?#]+)?(?:[?#].*)?$`, 'u').test(path)
}
```

Update `isProtectedDriveShareBrowserPath`:

```ts
function isProtectedDriveShareBrowserPath(path: string) {
  return new RegExp(`^${driveBrowserApiBasePath}/shares/[^/?#]+(?:/items/[^/?#]+)?/content(?:[?#].*)?$`, 'u').test(path)
    || isProtectedDriveShareAnnotationPath(path)
}
```

Add helpers near `driveBrowserApi`:

```ts
function ownerAnnotationPath(itemId: string, suffix = '') {
  return `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}/annotations${suffix}`
}

function shareAnnotationPath(shareId: string, itemId?: string | null, suffix = '') {
  const base = itemId
    ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/annotations`
    : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/annotations`
  return `${base}${suffix}`
}
```

Add API object after `driveBrowserApi`:

```ts
export const driveAnnotationApi = {
  listOwner: (itemId: string) =>
    request<DriveAnnotationThreadDto[]>(ownerAnnotationPath(itemId)),
  createOwner: (itemId: string, input: DriveAnnotationCreateInput) =>
    request<DriveAnnotationThreadDto>(ownerAnnotationPath(itemId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  replyOwner: (itemId: string, threadId: string, input: DriveAnnotationReplyInput) =>
    request<DriveAnnotationCommentDto>(ownerAnnotationPath(itemId, `/${encodeURIComponent(threadId)}/comments`), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateOwnerComment: (itemId: string, commentId: string, input: DriveAnnotationCommentUpdateInput) =>
    request<DriveAnnotationCommentDto>(ownerAnnotationPath(itemId, `/comments/${encodeURIComponent(commentId)}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteOwnerComment: (itemId: string, commentId: string) =>
    request<{ ok: true }>(ownerAnnotationPath(itemId, `/comments/${encodeURIComponent(commentId)}`), { method: 'DELETE' }),
  deleteOwnerThread: (itemId: string, threadId: string) =>
    request<{ ok: true }>(ownerAnnotationPath(itemId, `/${encodeURIComponent(threadId)}`), { method: 'DELETE' }),
  listShare: (shareId: string, itemId?: string | null) =>
    request<DriveAnnotationThreadDto[]>(shareAnnotationPath(shareId, itemId)),
  createShare: (shareId: string, itemId: string | null | undefined, input: DriveAnnotationCreateInput) =>
    request<DriveAnnotationThreadDto>(shareAnnotationPath(shareId, itemId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  replyShare: (shareId: string, itemId: string | null | undefined, threadId: string, input: DriveAnnotationReplyInput) =>
    request<DriveAnnotationCommentDto>(shareAnnotationPath(shareId, itemId, `/${encodeURIComponent(threadId)}/comments`), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateShareComment: (shareId: string, itemId: string | null | undefined, commentId: string, input: DriveAnnotationCommentUpdateInput) =>
    request<DriveAnnotationCommentDto>(shareAnnotationPath(shareId, itemId, `/comments/${encodeURIComponent(commentId)}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteShareComment: (shareId: string, itemId: string | null | undefined, commentId: string) =>
    request<{ ok: true }>(shareAnnotationPath(shareId, itemId, `/comments/${encodeURIComponent(commentId)}`), { method: 'DELETE' }),
  deleteShareThread: (shareId: string, itemId: string | null | undefined, threadId: string) =>
    request<{ ok: true }>(shareAnnotationPath(shareId, itemId, `/${encodeURIComponent(threadId)}`), { method: 'DELETE' }),
}
```

- [ ] **Step 2: Create hook**

Create `dashboard/src/features/drive-browser/use-drive-annotations.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationThreadDto,
} from '@synapse/shared'
import { driveAnnotationApi } from '@/lib/api'

export type DriveAnnotationContext =
  | { readonly context: 'owner'; readonly itemId: string }
  | { readonly context: 'share'; readonly shareId: string; readonly itemId?: string | null }

export function driveAnnotationsQueryKey(input: DriveAnnotationContext) {
  return input.context === 'owner'
    ? ['drive-annotations', 'owner', input.itemId] as const
    : ['drive-annotations', 'share', input.shareId, input.itemId ?? null] as const
}

export function useDriveAnnotations(input: DriveAnnotationContext) {
  const queryClient = useQueryClient()
  const queryKey = driveAnnotationsQueryKey(input)
  const query = useQuery({
    queryKey,
    queryFn: () => input.context === 'owner'
      ? driveAnnotationApi.listOwner(input.itemId)
      : driveAnnotationApi.listShare(input.shareId, input.itemId),
  })
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }
  const createMutation = useMutation({
    mutationFn: (body: DriveAnnotationCreateInput) => input.context === 'owner'
      ? driveAnnotationApi.createOwner(input.itemId, body)
      : driveAnnotationApi.createShare(input.shareId, input.itemId, body),
    onSuccess: invalidate,
  })
  const replyMutation = useMutation({
    mutationFn: (variables: { readonly threadId: string } & DriveAnnotationReplyInput) => input.context === 'owner'
      ? driveAnnotationApi.replyOwner(input.itemId, variables.threadId, variables)
      : driveAnnotationApi.replyShare(input.shareId, input.itemId, variables.threadId, variables),
    onSuccess: invalidate,
  })
  const updateMutation = useMutation({
    mutationFn: (variables: { readonly commentId: string } & DriveAnnotationCommentUpdateInput) => input.context === 'owner'
      ? driveAnnotationApi.updateOwnerComment(input.itemId, variables.commentId, variables)
      : driveAnnotationApi.updateShareComment(input.shareId, input.itemId, variables.commentId, variables),
    onSuccess: invalidate,
  })
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => input.context === 'owner'
      ? driveAnnotationApi.deleteOwnerComment(input.itemId, commentId)
      : driveAnnotationApi.deleteShareComment(input.shareId, input.itemId, commentId),
    onSuccess: invalidate,
  })
  const deleteThreadMutation = useMutation({
    mutationFn: (threadId: string) => input.context === 'owner'
      ? driveAnnotationApi.deleteOwnerThread(input.itemId, threadId)
      : driveAnnotationApi.deleteShareThread(input.shareId, input.itemId, threadId),
    onSuccess: invalidate,
  })

  return {
    threads: query.data ?? [] satisfies readonly DriveAnnotationThreadDto[],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    createThread: createMutation.mutateAsync,
    creatingThread: createMutation.isPending,
    reply: replyMutation.mutateAsync,
    replying: replyMutation.isPending,
    updateComment: updateMutation.mutateAsync,
    updatingComment: updateMutation.isPending,
    deleteComment: deleteCommentMutation.mutateAsync,
    deletingComment: deleteCommentMutation.isPending,
    deleteThread: deleteThreadMutation.mutateAsync,
    deletingThread: deleteThreadMutation.isPending,
  }
}
```

- [ ] **Step 3: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/features/drive-browser/use-drive-annotations.ts
git commit -m "feat(dashboard): add drive annotation API hook"
```

---

### Task 7: Markdown Selection And Marker Helpers

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/markdown-annotation-target.ts`
- Create: `dashboard/src/features/drive-browser/renderers/markdown-annotation-target.test.ts`
- Create: `dashboard/src/features/drive-browser/renderers/markdown-annotation-render.ts`
- Create: `dashboard/src/features/drive-browser/renderers/markdown-annotation-render.test.ts`

- [ ] **Step 1: Write failing target helper tests**

Create `dashboard/src/features/drive-browser/renderers/markdown-annotation-target.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { buildMarkdownRenderedTextModel, createTextRangeTargetFromSelection } from './markdown-annotation-target'

describe('markdown annotation target helpers', () => {
  it('builds rendered text offsets from HTML text nodes', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>这是 <strong>重点</strong> 内容</p>'
    const model = buildMarkdownRenderedTextModel(host)

    expect(model.text).toBe('这是 重点 内容')
    expect(model.nodes.length).toBeGreaterThan(1)
  })

  it('creates a text range target from selected rendered text', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>这是 <strong>重点</strong> 内容</p>'
    const strongText = host.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.setStart(strongText, 0)
    range.setEnd(strongText, 2)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const target = createTextRangeTargetFromSelection(host, selection)

    expect(target?.range).toEqual({ start: 3, end: 5 })
    expect(target?.quote.exact).toBe('重点')
  })

  it('returns null for empty selections outside the host', () => {
    const host = document.createElement('div')
    host.textContent = '正文'
    const outside = document.createElement('div')
    outside.textContent = '外部'
    document.body.append(host, outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(createTextRangeTargetFromSelection(host, selection)).toBeNull()
  })
})
```

- [ ] **Step 2: Implement target helper**

Create `dashboard/src/features/drive-browser/renderers/markdown-annotation-target.ts`:

```ts
import type { DriveAnnotationTextRangeTargetV1 } from '@synapse/shared'

export type MarkdownRenderedTextNode = {
  readonly node: Text
  readonly start: number
  readonly end: number
}

export type MarkdownRenderedTextModel = {
  readonly text: string
  readonly nodes: readonly MarkdownRenderedTextNode[]
}

export function buildMarkdownRenderedTextModel(root: HTMLElement): MarkdownRenderedTextModel {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: MarkdownRenderedTextNode[] = []
  let text = ''
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (!(current instanceof Text)) continue
    const value = current.nodeValue ?? ''
    const start = text.length
    text += value
    nodes.push({ node: current, start, end: text.length })
  }
  return { text, nodes }
}

export function createTextRangeTargetFromSelection(
  root: HTMLElement,
  selection: Selection | null,
): DriveAnnotationTextRangeTargetV1 | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const selectedText = selection.toString()
  if (!selectedText.trim()) return null
  const model = buildMarkdownRenderedTextModel(root)
  const start = offsetForBoundary(model, range.startContainer, range.startOffset)
  const end = offsetForBoundary(model, range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return null
  return {
    schemaVersion: 1,
    kind: 'textRange',
    surface: 'markdownRenderedText',
    range: { start, end },
    quote: {
      exact: model.text.slice(start, end),
      prefix: model.text.slice(Math.max(0, start - 80), start),
      suffix: model.text.slice(end, Math.min(model.text.length, end + 80)),
    },
  }
}

function offsetForBoundary(model: MarkdownRenderedTextModel, container: Node, offset: number): number | null {
  if (container instanceof Text) {
    const found = model.nodes.find((entry) => entry.node === container)
    return found ? found.start + offset : null
  }
  const child = container.childNodes[offset] ?? container.childNodes[offset - 1]
  if (!child) return null
  const entry = model.nodes.find((node) => node.node === child || child.contains(node.node))
  return entry?.start ?? null
}
```

- [ ] **Step 3: Write failing marker render tests**

Create `dashboard/src/features/drive-browser/renderers/markdown-annotation-render.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { DriveAnnotationThreadDto } from '@synapse/shared'
import { renderMarkdownAnnotationHtml } from './markdown-annotation-render'

describe('markdown annotation render helper', () => {
  it('wraps attached target ranges with annotation markers', () => {
    const html = '<p>这是重点内容</p>'
    const result = renderMarkdownAnnotationHtml(html, [thread({ start: 2, end: 4 })])

    expect(result.html).toContain('data-annotation-thread-id="thread-1"')
    expect(result.html).toContain('重点')
  })

  it('does not render orphaned markers', () => {
    const html = '<p>这是重点内容</p>'
    const result = renderMarkdownAnnotationHtml(html, [thread({ start: 2, end: 4, anchorStatus: 'orphaned' })])

    expect(result.html).not.toContain('data-annotation-thread-id')
  })
})

function thread(input: { readonly start: number; readonly end: number; readonly anchorStatus?: 'attached' | 'shifted' | 'orphaned' }): DriveAnnotationThreadDto {
  return {
    id: 'thread-1',
    itemId: 'item-1',
    baseVersionId: 'version-1',
    targetKind: 'textRange',
    target: {
      schemaVersion: 1,
      kind: 'textRange',
      surface: 'markdownRenderedText',
      range: { start: input.start, end: input.end },
      quote: { exact: '重点', prefix: '这是', suffix: '内容' },
    },
    anchorStatus: input.anchorStatus ?? 'attached',
    author: { id: 'user-1', email: 'user@example.com', displayName: null },
    comments: [],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
  }
}
```

- [ ] **Step 4: Implement marker renderer**

Create `dashboard/src/features/drive-browser/renderers/markdown-annotation-render.ts`:

```ts
import type { DriveAnnotationThreadDto } from '@synapse/shared'
import { buildMarkdownRenderedTextModel } from './markdown-annotation-target'

export function renderMarkdownAnnotationHtml(
  html: string,
  threads: readonly DriveAnnotationThreadDto[],
): { readonly html: string } {
  const document = new DOMParser().parseFromString(`<div data-root>${html}</div>`, 'text/html')
  const root = document.querySelector('[data-root]') as HTMLElement | null
  if (!root) return { html }
  const attached = threads.filter((thread) => thread.anchorStatus !== 'orphaned')
  if (attached.length === 0) return { html }
  const model = buildMarkdownRenderedTextModel(root)
  for (const thread of attached) {
    const range = thread.target.range
    for (const entry of [...model.nodes]) {
      if (entry.end <= range.start || entry.start >= range.end) continue
      wrapTextNodeRange(document, entry.node, {
        start: Math.max(0, range.start - entry.start),
        end: Math.min(entry.end - entry.start, range.end - entry.start),
        threadId: thread.id,
      })
    }
  }
  return { html: root.innerHTML }
}

function wrapTextNodeRange(
  document: Document,
  node: Text,
  input: { readonly start: number; readonly end: number; readonly threadId: string },
) {
  const value = node.nodeValue ?? ''
  if (input.end <= input.start) return
  const before = value.slice(0, input.start)
  const selected = value.slice(input.start, input.end)
  const after = value.slice(input.end)
  const fragment = document.createDocumentFragment()
  if (before) fragment.append(document.createTextNode(before))
  const marker = document.createElement('mark')
  marker.setAttribute('data-annotation-thread-id', input.threadId)
  marker.className = 'rounded-sm bg-muted px-0.5'
  marker.textContent = selected
  fragment.append(marker)
  if (after) fragment.append(document.createTextNode(after))
  node.replaceWith(fragment)
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
pnpm --dir dashboard exec vitest run src/features/drive-browser/renderers/markdown-annotation-target.test.ts src/features/drive-browser/renderers/markdown-annotation-render.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/markdown-annotation-target.ts dashboard/src/features/drive-browser/renderers/markdown-annotation-target.test.ts dashboard/src/features/drive-browser/renderers/markdown-annotation-render.ts dashboard/src/features/drive-browser/renderers/markdown-annotation-render.test.ts
git commit -m "feat(dashboard): add markdown annotation helpers"
```

---

### Task 8: Comment Rail UI

**Files:**
- Create: `dashboard/src/features/drive-browser/renderers/markdown-comments-rail.tsx`
- Create: `dashboard/src/features/drive-browser/renderers/markdown-comments-rail.test.tsx`

- [ ] **Step 1: Write failing rail tests**

Create `dashboard/src/features/drive-browser/renderers/markdown-comments-rail.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownCommentsRail } from './markdown-comments-rail'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('MarkdownCommentsRail', () => {
  it('renders plain text comments and orphaned position messages', () => {
    renderRail()

    expect(document.body.textContent).toContain('评论')
    expect(document.body.textContent).toContain('First line')
    expect(document.body.textContent).toContain('Second line')
    expect(document.body.textContent).toContain('位置已变化')
    expect(document.body.innerHTML).not.toContain('<strong>unsafe</strong>')
  })

  it('submits replies without nesting the visual layout indefinitely', async () => {
    const onReply = vi.fn(async () => undefined)
    renderRail({ onReply })

    await click(buttonWithText('回复'))
    await inputValue(textarea(), 'Reply body')
    await click(buttonWithText('发送'))

    expect(onReply).toHaveBeenCalledWith({ threadId: 'thread-1', parentCommentId: 'comment-1', body: 'Reply body' })
  })
})

function renderRail(overrides: Partial<Parameters<typeof MarkdownCommentsRail>[0]> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <MarkdownCommentsRail
        threads={[thread()]}
        activeThreadId={null}
        onFocusThread={vi.fn()}
        onReply={vi.fn(async () => undefined)}
        onUpdateComment={vi.fn(async () => undefined)}
        onDeleteComment={vi.fn(async () => undefined)}
        onDeleteThread={vi.fn(async () => undefined)}
        {...overrides}
      />
    )
  })
}

function thread() {
  return {
    id: 'thread-1',
    itemId: 'item-1',
    baseVersionId: 'version-1',
    targetKind: 'textRange' as const,
    target: {
      schemaVersion: 1 as const,
      kind: 'textRange' as const,
      surface: 'markdownRenderedText' as const,
      range: { start: 0, end: 4 },
      quote: { exact: 'Note', prefix: '', suffix: '' },
    },
    anchorStatus: 'orphaned' as const,
    author: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
    comments: [{
      id: 'comment-1',
      threadId: 'thread-1',
      parentCommentId: null,
      body: 'First line\nSecond line\n<strong>unsafe</strong>',
      author: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
      permissions: { canEdit: true, canDelete: true },
    }],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Missing button ${text}`)
  return button as HTMLButtonElement
}

function textarea() {
  const element = document.querySelector('textarea')
  if (!element) throw new Error('Missing textarea')
  return element as HTMLTextAreaElement
}

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
```

- [ ] **Step 2: Implement rail UI**

Create `dashboard/src/features/drive-browser/renderers/markdown-comments-rail.tsx`:

```tsx
import { useState } from 'react'
import type { DriveAnnotationCommentDto, DriveAnnotationThreadDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export function MarkdownCommentsRail({
  threads,
  activeThreadId,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly threads: readonly DriveAnnotationThreadDto[]
  readonly activeThreadId: string | null
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onDeleteThread: (threadId: string) => Promise<void>
}) {
  return (
    <aside className='w-72 shrink-0 border-l bg-background'>
      <div className='sticky top-0 border-b bg-background px-3 py-2 text-sm font-medium'>评论 {threads.length}</div>
      <div className='space-y-3 p-3'>
        {threads.map((thread) => (
          <ThreadView
            key={thread.id}
            thread={thread}
            active={thread.id === activeThreadId}
            onFocusThread={onFocusThread}
            onReply={onReply}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
            onDeleteThread={onDeleteThread}
          />
        ))}
      </div>
    </aside>
  )
}

function ThreadView({
  thread,
  active,
  onFocusThread,
  onReply,
  onUpdateComment,
  onDeleteComment,
  onDeleteThread,
}: {
  readonly thread: DriveAnnotationThreadDto
  readonly active: boolean
  readonly onFocusThread: (threadId: string) => void
  readonly onReply: (input: { readonly threadId: string; readonly parentCommentId: string | null; readonly body: string }) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
  readonly onDeleteThread: (threadId: string) => Promise<void>
}) {
  return (
    <section
      className={cn('rounded-lg border bg-background p-2 text-sm', active && 'border-foreground')}
      onClick={() => onFocusThread(thread.id)}
    >
      {thread.anchorStatus === 'orphaned' ? (
        <div className='mb-2 text-xs text-muted-foreground'>位置已变化</div>
      ) : null}
      <div className='space-y-2'>
        {thread.comments.map((comment) => (
          <CommentView
            key={comment.id}
            comment={comment}
            onReply={(body) => onReply({ threadId: thread.id, parentCommentId: comment.id, body })}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
          />
        ))}
      </div>
      {thread.permissions.canDelete ? (
        <Button type='button' variant='ghost' size='sm' onClick={() => { void onDeleteThread(thread.id) }}>删除讨论</Button>
      ) : null}
    </section>
  )
}

function CommentView({
  comment,
  onReply,
  onUpdateComment,
  onDeleteComment,
}: {
  readonly comment: DriveAnnotationCommentDto
  readonly onReply: (body: string) => Promise<void>
  readonly onUpdateComment: (input: { readonly commentId: string; readonly body: string }) => Promise<void>
  readonly onDeleteComment: (commentId: string) => Promise<void>
}) {
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(comment.body)
  if (comment.deleted) {
    return <div className='text-xs text-muted-foreground'>评论已删除</div>
  }
  return (
    <article className='space-y-1'>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-xs font-medium'>{comment.author.displayName || comment.author.email}</span>
        <span className='text-xs text-muted-foreground'>{comment.editedAt ? '已编辑' : null}</span>
      </div>
      {editing ? (
        <CommentComposer
          value={value}
          onChange={setValue}
          submitLabel='保存'
          onCancel={() => setEditing(false)}
          onSubmit={async () => {
            await onUpdateComment({ commentId: comment.id, body: value })
            setEditing(false)
          }}
        />
      ) : (
        <p className='whitespace-pre-wrap break-words text-sm'>{comment.body}</p>
      )}
      <div className='flex items-center gap-1'>
        <Button type='button' variant='ghost' size='sm' onClick={() => setReplying(true)}>回复</Button>
        {comment.permissions.canEdit ? (
          <Button type='button' variant='ghost' size='sm' onClick={() => setEditing(true)}>编辑</Button>
        ) : null}
        {comment.permissions.canDelete ? (
          <Button type='button' variant='ghost' size='sm' onClick={() => { void onDeleteComment(comment.id) }}>删除</Button>
        ) : null}
      </div>
      {replying ? (
        <CommentComposer
          value={value === comment.body ? '' : value}
          onChange={setValue}
          submitLabel='发送'
          onCancel={() => setReplying(false)}
          onSubmit={async () => {
            await onReply(value)
            setValue(comment.body)
            setReplying(false)
          }}
        />
      ) : null}
    </article>
  )
}

function CommentComposer({
  value,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly value: string
  readonly submitLabel: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onCancel: () => void
}) {
  return (
    <div className='space-y-2'>
      <Textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      <div className='flex justify-end gap-1'>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>取消</Button>
        <Button type='button' size='sm' disabled={!value.trim()} onClick={() => { void onSubmit() }}>{submitLabel}</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run rail tests**

Run:

```bash
pnpm --dir dashboard exec vitest run src/features/drive-browser/renderers/markdown-comments-rail.test.tsx
```

Expected: pass. If button labels collide, query by surrounding text or add accessible labels.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/markdown-comments-rail.tsx dashboard/src/features/drive-browser/renderers/markdown-comments-rail.test.tsx
git commit -m "feat(dashboard): add markdown comments rail"
```

---

### Task 9: Markdown Render Integration

**Files:**
- Modify: `dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx`
- Modify: `dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx`

- [ ] **Step 1: Add failing Markdown renderer tests**

If `markdown-renderer.test.tsx` does not exist, create it using the same React root pattern from `code-renderer.test.tsx`.

Core tests:

```tsx
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveMarkdownRenderer } from './markdown-renderer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../use-drive-annotations', () => ({
  useDriveAnnotations: () => ({
    threads: [annotationThread()],
    loading: false,
    error: null,
    createThread: vi.fn(async () => annotationThread()),
    creatingThread: false,
    reply: vi.fn(),
    replying: false,
    updateComment: vi.fn(),
    updatingComment: false,
    deleteComment: vi.fn(),
    deletingComment: false,
    deleteThread: vi.fn(),
    deletingThread: false,
  }),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('DriveMarkdownRenderer annotations', () => {
  it('renders an internal sticky header with outline and comment toggles', () => {
    renderMarkdown()

    expect(document.body.textContent).toContain('notes.md')
    expect(buttonWithText('目录')).toBeTruthy()
    expect(buttonWithText('评论 1')).toBeTruthy()
  })

  it('does not render renderer switching controls inside Markdown Render', () => {
    renderMarkdown()

    expect(document.body.textContent).not.toContain('MDXeditor')
    expect(document.body.textContent).not.toContain('代码')
  })

  it('marks attached annotations in the rendered body and opens comments when comments exist', () => {
    renderMarkdown()

    expect(document.querySelector('[data-annotation-thread-id="thread-1"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Comment body')
  })
})

function renderMarkdown() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const queryClient = new QueryClient()
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <DriveMarkdownRenderer current={current()} preview={preview()} annotationContext={{ context: 'owner', itemId: 'item-1' }} />
      </QueryClientProvider>
    )
  })
}

function current() {
  return {
    id: 'item-1',
    name: 'notes.md',
    type: 'file' as const,
    size: '20',
    mimeType: 'text/markdown',
    updatedAt: '2026-06-21T00:00:00.000Z',
    previewKind: 'markdown' as const,
    browserUrl: '/drive/items/item-1',
    downloadUrl: '/drive/items/item-1/download',
  }
}

function preview() {
  return {
    kind: 'markdown' as const,
    text: '这是重点内容',
    html: '<p>这是重点内容</p>',
    outline: [{ id: 'title', text: 'Title', depth: 1, children: [] }],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
  }
}

function annotationThread() {
  return {
    id: 'thread-1',
    itemId: 'item-1',
    baseVersionId: 'version-1',
    targetKind: 'textRange' as const,
    target: {
      schemaVersion: 1 as const,
      kind: 'textRange' as const,
      surface: 'markdownRenderedText' as const,
      range: { start: 2, end: 4 },
      quote: { exact: '重点', prefix: '这是', suffix: '内容' },
    },
    anchorStatus: 'attached' as const,
    author: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
    comments: [{
      id: 'comment-1',
      threadId: 'thread-1',
      parentCommentId: null,
      body: 'Comment body',
      author: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      deleted: false,
    }],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
  }
}

function buttonWithText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Missing button ${text}`)
  return button as HTMLButtonElement
}
```

- [ ] **Step 2: Extend renderer props**

Modify `DriveMarkdownRenderer` props:

```ts
import type { DriveAnnotationContext } from '../use-drive-annotations'

export function DriveMarkdownRenderer({
  current,
  preview,
  annotationContext,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly annotationContext?: DriveAnnotationContext
}) {
```

- [ ] **Step 3: Integrate hook and header**

Inside `DriveMarkdownRenderer`, add state and hook:

```ts
const annotations = useDriveAnnotations(annotationContext ?? { context: 'owner', itemId: current.id })
const [outlineOpen, setOutlineOpen] = useState(true)
const [commentsOpen, setCommentsOpen] = useState(false)
useEffect(() => {
  setCommentsOpen(annotations.threads.length > 0)
}, [annotations.threads.length, current.id])
```

Add internal header above the existing layout:

```tsx
<div className='sticky top-0 z-10 flex h-9 items-center justify-between border-b bg-background px-3'>
  <div className='min-w-0 truncate text-sm font-medium'>{current.name}</div>
  <div className='flex items-center gap-1'>
    <Button type='button' variant={outlineOpen ? 'secondary' : 'ghost'} size='sm' onClick={() => setOutlineOpen((value) => !value)}>
      目录
    </Button>
    <Button type='button' variant={commentsOpen ? 'secondary' : 'ghost'} size='sm' onClick={() => setCommentsOpen((value) => !value)}>
      评论 {annotations.threads.length}
    </Button>
  </div>
</div>
```

Keep header inside Markdown Render only.

- [ ] **Step 4: Render annotated HTML and rail**

Use:

```ts
const annotated = useMemo(
  () => renderMarkdownAnnotationHtml(renderedHtml, annotations.threads),
  [annotations.threads, renderedHtml],
)
```

Replace `dangerouslySetInnerHTML={{ __html: renderedHtml }}` with:

```tsx
dangerouslySetInnerHTML={{ __html: annotated.html }}
```

Condition outline rail on `outlineOpen`.

Condition comment rail on `commentsOpen`:

```tsx
{commentsOpen ? (
  <MarkdownCommentsRail
    threads={annotations.threads}
    activeThreadId={activeThreadId}
    onFocusThread={setActiveThreadId}
    onReply={annotations.reply}
    onUpdateComment={annotations.updateComment}
    onDeleteComment={annotations.deleteComment}
    onDeleteThread={annotations.deleteThread}
  />
) : null}
```

- [ ] **Step 5: Wire annotation context from page to shell**

Extend `DriveRendererShell` and `DriveRendererContent` props in `drive-renderer-shell.tsx`:

```tsx
readonly annotationContext?: DriveAnnotationContext

return renderContent(<DriveMarkdownRenderer current={snapshot.current} preview={preview} annotationContext={annotationContext} />)
```

Add the import:

```ts
import type { DriveAnnotationContext } from '../use-drive-annotations'
```

Modify `DriveSingleFileReaderView` in `drive-browser-page.tsx` to accept and forward the context:

```tsx
export function DriveSingleFileReaderView({
  snapshot,
  embedded = false,
  initialRendererId = null,
  editContext,
  annotationContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly embedded?: boolean
  readonly initialRendererId?: DriveRendererId | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
}) {
  void embedded
  return (
    <div className='h-svh min-h-0 overflow-hidden bg-background'>
      <DriveRendererShell
        snapshot={snapshot}
        body
        initialRendererId={initialRendererId}
        editContext={editContext}
        annotationContext={annotationContext}
      />
    </div>
  )
}
```

When `DriveBrowserPage` renders the single-file body view, compute the context from route props rather than breadcrumbs:

```tsx
const annotationContext = props.context === 'owner'
  ? { context: 'owner' as const, itemId: state.snapshot.current.id }
  : { context: 'share' as const, shareId: props.shareId, itemId: state.snapshot.current.id }

return <DriveSingleFileReaderView snapshot={state.snapshot} editContext={state} annotationContext={annotationContext} />
```

Do not derive `shareId` from `snapshot.breadcrumbs`, and do not encode `shareId` into comment target data.

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --dir dashboard exec vitest run src/features/drive-browser/renderers/markdown-renderer.test.tsx src/features/drive-browser/renderers/markdown-annotation-target.test.ts src/features/drive-browser/renderers/markdown-annotation-render.test.ts src/features/drive-browser/renderers/markdown-comments-rail.test.tsx
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx dashboard/src/features/drive-browser/renderers/markdown-renderer.test.tsx dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx
git commit -m "feat(dashboard): show markdown annotations in render view"
```

---

### Task 10: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a user-facing bullet under the pending release section:

```md
- 云盘 `.md` 文件的预览视图支持选中文字评论。能查看文档的用户都能看到评论，登录用户可以参与讨论；评论不写入原 Markdown 文件。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/shared run test -- src/drive.test.ts
pnpm --filter @synapse/server run test -- src/drive/drive-annotation-target.spec.ts src/drive/drive-annotation.service.spec.ts src/drive/drive.controller.spec.ts src/drive/drive-markdown-renderer.spec.ts
pnpm --dir dashboard exec vitest run src/features/drive-browser/renderers/markdown-annotation-target.test.ts src/features/drive-browser/renderers/markdown-annotation-render.test.ts src/features/drive-browser/renderers/markdown-comments-rail.test.tsx src/features/drive-browser/renderers/markdown-renderer.test.tsx
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run tsc
```

Expected: all commands pass.

- [ ] **Step 3: Inspect for UI rule violations**

Run:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|bg-\\[|text-\\[|from-|to-|gradient|shadow-lg|shadow-xl" dashboard/src/features/drive-browser/renderers
```

Expected: no new violations in annotation files. Existing allowed arbitrary values in unrelated renderer code should be evaluated before changing anything.

- [ ] **Step 4: Final git status**

Run:

```bash
git status --short
```

Expected: only intended files changed before commit.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note markdown annotation support"
```
