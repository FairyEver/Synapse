# Skill Repository Phase 4 Migration And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate legacy Content Store Skills into Skill Repository, preserve old Skill links with clear redirects, and retire old cloud Prompt/Rule store surfaces from the user-facing Dashboard without breaking existing install compatibility.

**Architecture:** Keep old Content Store server APIs alive for compatibility, especially `synapse://content-install`, but move all Skill creation/management traffic to Skill Repository. Migration is idempotent: each legacy `ContentStoreItem(type="skill")` maps to at most one `SkillRepository` through `legacyContentStoreItemId`. Dashboard hides legacy Content Store creation/listing from normal users and shows compatibility messages or redirects for old routes.

**Tech Stack:** NestJS, Prisma, Zod, `@synapse/shared`, Content Store storage port, Skill Repository service, React 19, TanStack Router, existing Dashboard API client, Electron IPC, Vitest, TypeScript.

---

## Scope Check

### In Scope

- Add idempotent legacy Content Store Skill migration into Skill Repository.
- Migrate published Skill versions and draft-only Skill items.
- Preserve old Content Store Skill links by resolving them to the migrated Skill Repository page.
- Keep old `synapse://content-install` install sessions compatible.
- Hide old user-facing cloud Content Store and My Content navigation for normal users.
- Replace old Dashboard create/edit pages for Prompt/Rule/Skill cloud store with a retirement message or redirect.
- Change Desktop scan-detail “publish Skill” path to create/update Skill Repository instead of Content Store draft.
- Keep admin legacy Content Store visibility available as a compatibility/admin surface, but label it as legacy.
- Update built-in `synapse-skill` Skill Repository docs and release notes.

### Out Of Scope

- Hard-deleting legacy Content Store database rows.
- Migrating Prompt or Rule into Skill Repository.
- Removing server-side Content Store install endpoints.
- Removing Desktop `content-store-install` protocol handling.
- Building a full migration dashboard with progress bars.
- Adding history, releases, rollback, stars, comments, ratings, review, or moderation.
- Renaming the `CONTENT_STORE_COS_*` storage domain in this phase.

---

## File Structure

### Shared Contracts

- Modify `shared/src/skill-repository.ts`: add migration DTOs and legacy route DTOs.
- Modify `shared/src/skill-repository.test.ts`: cover URL/DTO helper behavior.

### Prisma And Server

- Modify `server/prisma/schema.prisma`: add unique idempotency constraint for `SkillRepository.legacyContentStoreItemId`.
- Create `server/prisma/migrations/20260702000001_skill_repository_legacy_content_store_unique/migration.sql`.
- Create `server/src/skill-repository/skill-repository-legacy-migration.service.ts`: migration core.
- Create `server/src/skill-repository/skill-repository-legacy-migration.service.spec.ts`: migration service tests.
- Modify `server/src/skill-repository/skill-repository.module.ts`: register migration service.
- Modify `server/src/skill-repository/skill-repository.controller.ts`: expose migration and legacy route resolution APIs.
- Modify `server/src/skill-repository/skill-repository.controller.spec.ts`: controller validation tests.
- Modify `server/src/skill-repository/skill-repository.service.ts`: add small helper for migrated repository detail if needed.
- Modify `server/src/content-store/content-store.controller.ts`: add legacy route helper endpoint or keep old controller using Skill Repository resolver.
- Modify `server/src/content-store/content-store.service.ts`: add read-only legacy route resolver if controller-local routing is not enough.

### Dashboard

- Modify `dashboard/src/lib/api.ts`: add migration and legacy route resolution API calls.
- Modify `dashboard/src/components/layout/data/sidebar-data.ts`: remove normal-user Content Store/My Content links, keep Skill Repository links.
- Modify `dashboard/src/features/content-store/content-store-list.tsx`: replace normal user store list with retired message and Skill Explore link.
- Modify `dashboard/src/features/content-store/my-content-list.tsx`: replace normal user list with retired message, migration action, and My Skill Repositories link.
- Modify `dashboard/src/features/content-store/content-store-detail.tsx`: redirect migrated legacy Skill items to Skill Repository public/detail URL; show retired Prompt/Rule message.
- Modify `dashboard/src/features/content-store/editor/content-store-create-page.tsx`: block new cloud Prompt/Rule/Skill Content Store creation with retired message.
- Modify `dashboard/src/features/content-store/editor/content-store-editor-page.tsx`: redirect migrated Skill draft/editor links or show retired editing message.
- Modify `dashboard/src/features/content-store/content-store-admin.tsx`: label admin page as legacy Content Store.
- Modify `dashboard/src/features/content-store/index.ts`: keep exports stable.
- Modify route files under `dashboard/src/routes/_authenticated/content-store/` and `dashboard/src/routes/_authenticated/my-content/` only if props or redirects require route-level changes.
- Modify `dashboard/src/routeTree.gen.ts` only if route files are added or removed.

### Desktop

- Modify `desktop/electron/services/content-store-upload-service.ts`: route scan-detail Skill upload through Skill Repository import/update.
- Modify `desktop/electron/services/__tests__/content-store-upload-service.test.ts`: update behavior expectations.
- Modify `desktop/electron/modules/editor-scan/ipc.ts`: keep the existing IPC channel but clarify schema/result still returns a URL.
- Modify `desktop/electron/modules/editor-scan/__tests__/ipc.test.ts`: assert the compatibility channel delegates to the updated upload service.
- Modify `desktop/src/modules/editor-scan/lib/content-store-upload.ts`: change UI copy from “商店草稿” to “Skill 仓库”.
- Modify `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`: change button copy and success handling to open Skill Repository management URL.
- Modify `desktop/src/types/editor-scan.ts`: keep backward-compatible type names unless tests require a clearer alias.

### MCP And Built-In Skill Docs

- Modify `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`: add migration guidance.
- Modify `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`: add old Content Store compatibility notes.

### Release Notes

- Modify `RELEASE_NOTES_PENDING.md`: describe migration, hidden legacy store entry points, and compatibility behavior.

---

## Data Decisions

- `SkillRepository.legacyContentStoreItemId` is the idempotency key.
- A legacy Skill item with `latestVersionId` migrates from its latest version.
- A legacy Skill item without `latestVersionId` but with a draft migrates from that draft.
- Migration skips non-Skill Content Store items and returns them as `skipped`.
- Migration copies file bytes into new Skill Repository objects using the existing Content Store storage port.
- Migrated repository visibility follows the legacy item visibility:
  - `public` legacy Skill becomes public only when the owner has a handle.
  - `public` legacy Skill with no owner handle becomes private and returns a `USER_HANDLE_REQUIRED` warning.
  - `private` legacy Skill stays private.
- `legacyInstallCount` copies the old `ContentStoreInstallEvent` count.
- No legacy objects are deleted.
- Prompt and Rule cloud store rows remain readable by old admin/server paths but are no longer a normal user creation or sharing surface.

---

## Task 1: Add Shared Migration Contracts

**Files:**

- Modify: `shared/src/skill-repository.ts`
- Modify: `shared/src/skill-repository.test.ts`

- [ ] **Step 1: Add failing shared tests**

Add these tests to `shared/src/skill-repository.test.ts`:

```ts
import {
  buildSkillRepositoryManagementUrl,
  buildSkillRepositoryPublicUrl,
  type SkillRepositoryLegacyContentRouteDto,
  type SkillRepositoryLegacyMigrationResultDto,
} from "./skill-repository"

describe("legacy Content Store migration contracts", () => {
  it("allows migrated routes to describe either a repository redirect or retired content", () => {
    const skillRoute: SkillRepositoryLegacyContentRouteDto = {
      status: "migrated",
      repositoryId: "repo-1",
      managementUrl: buildSkillRepositoryManagementUrl("https://synapse.example", "repo-1"),
      publicUrl: buildSkillRepositoryPublicUrl("https://synapse.example", "liyang", "demo-skill"),
    }
    const retiredRoute: SkillRepositoryLegacyContentRouteDto = {
      status: "retired",
      contentType: "prompt",
      message: "云端 Prompt 商店已停止维护。",
    }

    expect(skillRoute.status).toBe("migrated")
    expect(retiredRoute.status).toBe("retired")
  })

  it("summarizes idempotent migration results", () => {
    const result: SkillRepositoryLegacyMigrationResultDto = {
      scanned: 3,
      migrated: 1,
      alreadyMigrated: 1,
      skipped: [
        {
          contentStoreItemId: "content-rule-1",
          reason: "not_skill",
        },
      ],
      warnings: [
        {
          contentStoreItemId: "content-skill-2",
          code: "USER_HANDLE_REQUIRED",
          message: "公开 Skill 需要先设置用户名。",
        },
      ],
    }

    expect(result.scanned).toBe(3)
    expect(result.skipped[0]?.reason).toBe("not_skill")
    expect(result.warnings[0]?.code).toBe("USER_HANDLE_REQUIRED")
  })
})
```

- [ ] **Step 2: Run shared tests and verify failure**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/shared test -- skill-repository
```

Expected: TypeScript compile failure for missing `SkillRepositoryLegacyContentRouteDto` and `SkillRepositoryLegacyMigrationResultDto`.

- [ ] **Step 3: Add shared DTOs**

Add this block to `shared/src/skill-repository.ts` after the install manifest interfaces:

```ts
export type SkillRepositoryLegacyMigrationSkippedReason =
  | "not_skill"
  | "removed"
  | "missing_source"
  | "invalid_skill"

export interface SkillRepositoryLegacyMigrationSkippedDto {
  readonly contentStoreItemId: string
  readonly reason: SkillRepositoryLegacyMigrationSkippedReason
  readonly message?: string
}

export interface SkillRepositoryLegacyMigrationWarningDto {
  readonly contentStoreItemId: string
  readonly code: SkillRepositoryErrorCode
  readonly message: string
}

export interface SkillRepositoryLegacyMigrationResultDto {
  readonly scanned: number
  readonly migrated: number
  readonly alreadyMigrated: number
  readonly skipped: readonly SkillRepositoryLegacyMigrationSkippedDto[]
  readonly warnings: readonly SkillRepositoryLegacyMigrationWarningDto[]
}

export type SkillRepositoryLegacyContentRouteDto =
  | {
      readonly status: "migrated"
      readonly repositoryId: string
      readonly managementUrl: string
      readonly publicUrl: string | null
    }
  | {
      readonly status: "retired"
      readonly contentType: "rule" | "prompt"
      readonly message: string
    }
  | {
      readonly status: "not_found"
      readonly message: string
    }
```

- [ ] **Step 4: Run shared tests and verify pass**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/shared test -- skill-repository
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/skill-repository.ts shared/src/skill-repository.test.ts
git commit -m "feat: add skill repository legacy migration contracts"
```

---

## Task 2: Add Prisma Idempotency Constraint

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260702000001_skill_repository_legacy_content_store_unique/migration.sql`

- [ ] **Step 1: Add schema constraint**

In `server/prisma/schema.prisma`, change the `SkillRepository` model field:

```prisma
  legacyContentStoreItemId String?                       @unique
```

Keep existing `legacyInstallCount Int @default(0)`.

- [ ] **Step 2: Add migration SQL**

Create `server/prisma/migrations/20260702000001_skill_repository_legacy_content_store_unique/migration.sql`:

```sql
CREATE UNIQUE INDEX "SkillRepository_legacyContentStoreItemId_key"
  ON "SkillRepository"("legacyContentStoreItemId")
  WHERE "legacyContentStoreItemId" IS NOT NULL;
```

- [ ] **Step 3: Run Prisma generation**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server prisma:generate
```

Expected: command exits 0 and generated Prisma client accepts the schema.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260702000001_skill_repository_legacy_content_store_unique/migration.sql
git commit -m "feat: make legacy content skill migration idempotent"
```

---

## Task 3: Implement Legacy Skill Migration Service

**Files:**

- Create: `server/src/skill-repository/skill-repository-legacy-migration.service.ts`
- Create: `server/src/skill-repository/skill-repository-legacy-migration.service.spec.ts`
- Modify: `server/src/skill-repository/skill-repository.module.ts`

- [ ] **Step 1: Write failing migration tests**

Create `server/src/skill-repository/skill-repository-legacy-migration.service.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { SkillRepositoryLegacyMigrationService } from "./skill-repository-legacy-migration.service"

const now = new Date("2026-07-02T00:00:00.000Z")

function createStorage() {
  const objects = new Map<string, Buffer>([
    ["content-store/files/skill-md", Buffer.from("# Demo\n")],
    ["content-store/files/readme", Buffer.from("Read me\n")],
  ])
  return {
    getObjectStream: vi.fn(async (key: string) => {
      const bytes = objects.get(key)
      if (!bytes) throw new Error(`missing object ${key}`)
      return { stream: ReadableFromBuffer(bytes), size: BigInt(bytes.length), contentType: "application/octet-stream" }
    }),
    putObject: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => undefined),
  }
}

function ReadableFromBuffer(bytes: Buffer) {
  const { Readable } = require("node:stream") as typeof import("node:stream")
  return Readable.from(bytes)
}

function createPrisma() {
  const repositories: Array<Record<string, unknown>> = []
  const files: Array<Record<string, unknown>> = []
  const contentStoreItems = [
    {
      id: "content-skill-1",
      type: "skill",
      title: "Demo Skill",
      description: "Legacy skill",
      ownerUserId: "user-1",
      visibility: "public",
      moderationStatus: "normal",
      latestVersionId: "version-1",
      createdAt: now,
      updatedAt: now,
      owner: { id: "user-1", handle: "liyang", displayName: "Liyang" },
      _count: { installEvents: 2 },
    },
  ]
  const versions = [{
    id: "version-1",
    itemId: "content-skill-1",
    title: "Demo Skill",
    description: "Legacy skill",
    files: [
      { path: "SKILL.md", storageKey: "content-store/files/skill-md", text: null, mimeType: "text/markdown" },
      { path: "README.md", storageKey: "content-store/files/readme", text: null, mimeType: "text/markdown" },
    ],
  }]

  return {
    contentStoreItem: {
      findMany: vi.fn(async () => contentStoreItems),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        contentStoreItems.find((item) => item.id === where.id) ?? null),
    },
    contentStoreVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        versions.find((version) => version.id === where.id) ?? null),
    },
    contentStoreDraft: {
      findUnique: vi.fn(async () => null),
    },
    skillRepository: {
      findUnique: vi.fn(async ({ where }: { where: { legacyContentStoreItemId?: string } }) =>
        repositories.find((repo) => repo.legacyContentStoreItemId === where.legacyContentStoreItemId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const repo = { id: "repo-1", ...data }
        repositories.push(repo)
        return repo
      }),
    },
    skillRepositoryFile: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        files.push(...data)
        return { count: data.length }
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      skillRepository: {
        findUnique: vi.fn(async ({ where }: { where: { legacyContentStoreItemId?: string } }) =>
          repositories.find((repo) => repo.legacyContentStoreItemId === where.legacyContentStoreItemId) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const repo = { id: "repo-1", ...data }
          repositories.push(repo)
          return repo
        }),
      },
      skillRepositoryFile: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          files.push(...data)
          return { count: data.length }
        }),
      },
    })),
    __repositories: repositories,
    __files: files,
  }
}

describe("SkillRepositoryLegacyMigrationService", () => {
  it("migrates a published legacy Content Store Skill once", async () => {
    const prisma = createPrisma()
    const storage = createStorage()
    const service = new SkillRepositoryLegacyMigrationService(prisma as never, storage as never)

    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 1,
      migrated: 1,
      alreadyMigrated: 0,
      skipped: [],
    })
    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 1,
      migrated: 0,
      alreadyMigrated: 1,
      skipped: [],
    })
    expect(prisma.__repositories[0]).toMatchObject({
      legacyContentStoreItemId: "content-skill-1",
      name: "demo-skill",
      title: "Demo Skill",
      visibility: "public",
      legacyInstallCount: 2,
    })
    expect(prisma.__files).toHaveLength(2)
    expect(storage.putObject).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository/skill-repository-legacy-migration.service.spec.ts
```

Expected: FAIL because `skill-repository-legacy-migration.service.ts` does not exist.

- [ ] **Step 3: Implement service skeleton and migration logic**

Create `server/src/skill-repository/skill-repository-legacy-migration.service.ts`:

```ts
import { createHash, randomUUID } from "node:crypto"
import { Inject, Injectable, Logger } from "@nestjs/common"
import type {
  SkillRepositoryLegacyMigrationResultDto,
  SkillRepositoryLegacyMigrationSkippedDto,
  SkillRepositoryLegacyMigrationWarningDto,
} from "@synapse/shared"
import {
  normalizeSkillRepositoryName,
  skillRepositoryRootFilePath,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { CONTENT_STORE_STORAGE_PORT } from "../content-store/content-store.constants"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"
import { normalizeSkillRepositoryFiles } from "./skill-repository-file-rules"

type LegacyFileRow = {
  readonly path: string
  readonly storageKey: string | null
  readonly text: string | null
  readonly mimeType: string | null
}

type LegacySource = {
  readonly title: string
  readonly description: string | null
  readonly files: readonly LegacyFileRow[]
}

type LegacyItemRow = {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly description: string | null
  readonly ownerUserId: string
  readonly visibility: string
  readonly moderationStatus: string
  readonly latestVersionId: string | null
  readonly owner: { readonly handle: string | null } | null
  readonly _count: { readonly installEvents: number }
}

@Injectable()
export class SkillRepositoryLegacyMigrationService {
  private readonly logger = new Logger(SkillRepositoryLegacyMigrationService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_STORE_STORAGE_PORT) private readonly storage: ContentStoreStoragePort,
  ) {}

  async migrateOwnerSkills(ownerUserId: string): Promise<SkillRepositoryLegacyMigrationResultDto> {
    const items = await this.prisma.contentStoreItem.findMany({
      where: { ownerUserId },
      include: {
        owner: { select: { handle: true } },
        _count: { select: { installEvents: true } },
      },
      orderBy: { createdAt: "asc" },
    }) as LegacyItemRow[]

    const skipped: SkillRepositoryLegacyMigrationSkippedDto[] = []
    const warnings: SkillRepositoryLegacyMigrationWarningDto[] = []
    let migrated = 0
    let alreadyMigrated = 0

    for (const item of items) {
      if (item.type !== "skill") {
        skipped.push({ contentStoreItemId: item.id, reason: "not_skill" })
        continue
      }
      if (item.moderationStatus === "removed") {
        skipped.push({ contentStoreItemId: item.id, reason: "removed" })
        continue
      }
      const existing = await this.prisma.skillRepository.findUnique({
        where: { legacyContentStoreItemId: item.id },
      })
      if (existing) {
        alreadyMigrated += 1
        continue
      }

      const source = await this.resolveSource(item)
      if (!source) {
        skipped.push({ contentStoreItemId: item.id, reason: "missing_source" })
        continue
      }

      const files = await this.readLegacyFiles(source.files)
      let normalized
      try {
        normalized = normalizeSkillRepositoryFiles(files)
      } catch (error) {
        skipped.push({
          contentStoreItemId: item.id,
          reason: "invalid_skill",
          message: error instanceof Error ? error.message : "Skill 文件无效。",
        })
        continue
      }

      const wantsPublic = item.visibility === "public"
      const hasHandle = Boolean(item.owner?.handle)
      if (wantsPublic && !hasHandle) {
        warnings.push({
          contentStoreItemId: item.id,
          code: "USER_HANDLE_REQUIRED",
          message: "公开 Skill 需要先设置用户名，已按私有仓库迁移。",
        })
      }

      const repositoryName = await this.findAvailableName(ownerUserId, source.title || item.title)
      const repositoryId = randomUUID()
      const storedFiles = []
      for (const file of normalized) {
        const storageKey = `skill-repositories/${repositoryId}/files/${randomUUID()}/${file.sha256}`
        await this.storage.putObject(storageKey, file.bytes, file.mimeType ?? "application/octet-stream")
        storedFiles.push({
          repositoryId,
          path: file.path,
          pathKey: file.pathKey,
          kind: file.kind,
          mimeType: file.mimeType,
          size: BigInt(file.size),
          sha256: file.sha256,
          storageKey,
        })
      }

      await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.skillRepository.findUnique({
          where: { legacyContentStoreItemId: item.id },
        })
        if (duplicate) return
        await tx.skillRepository.create({
          data: {
            id: repositoryId,
            ownerUserId,
            name: repositoryName,
            title: source.title || item.title,
            description: source.description,
            visibility: wantsPublic && hasHandle ? "public" : "private",
            status: "active",
            legacyContentStoreItemId: item.id,
            legacyInstallCount: item._count.installEvents,
          },
        })
        await tx.skillRepositoryFile.createMany({ data: storedFiles })
      })
      migrated += 1
    }

    return {
      scanned: items.length,
      migrated,
      alreadyMigrated,
      skipped,
      warnings,
    }
  }

  private async resolveSource(item: LegacyItemRow): Promise<LegacySource | null> {
    if (item.latestVersionId) {
      const version = await this.prisma.contentStoreVersion.findUnique({
        where: { id: item.latestVersionId },
        include: { files: true },
      }) as LegacySource | null
      return version
    }
    const draft = await this.prisma.contentStoreDraft.findUnique({
      where: { itemId: item.id },
      include: { files: true },
    }) as LegacySource | null
    return draft
  }

  private async readLegacyFiles(files: readonly LegacyFileRow[]) {
    const output = []
    for (const file of files) {
      const bytes = file.storageKey
        ? await this.readObject(file.storageKey)
        : Buffer.from(file.text ?? "", "utf8")
      output.push({
        path: file.path,
        contentBase64: bytes.toString("base64"),
        mimeType: file.mimeType,
      })
    }
    return output
  }

  private async readObject(storageKey: string): Promise<Buffer> {
    const object = await this.storage.getObjectStream(storageKey)
    const chunks: Buffer[] = []
    for await (const chunk of object.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  private async findAvailableName(ownerUserId: string, title: string): Promise<string> {
    const fallback = title || skillRepositoryRootFilePath
    const base = normalizeSkillRepositoryName(
      fallback
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        || "skill",
    )
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}-${index + 1}`
      const existing = await this.prisma.skillRepository.findFirst({
        where: { ownerUserId, name: candidate },
        select: { id: true },
      })
      if (!existing) return candidate
    }
    return `${base}-${createHash("sha256").update(`${ownerUserId}:${title}`).digest("hex").slice(0, 8)}`
  }
}
```

- [ ] **Step 4: Register the service**

Modify `server/src/skill-repository/skill-repository.module.ts` so providers include the new service:

```ts
providers: [
  SkillRepositoryService,
  SkillRepositoryLegacyMigrationService,
  // keep existing providers unchanged
]
```

Add import:

```ts
import { SkillRepositoryLegacyMigrationService } from "./skill-repository-legacy-migration.service"
```

- [ ] **Step 5: Run focused migration tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository/skill-repository-legacy-migration.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/skill-repository/skill-repository-legacy-migration.service.ts server/src/skill-repository/skill-repository-legacy-migration.service.spec.ts server/src/skill-repository/skill-repository.module.ts
git commit -m "feat: migrate legacy content store skills"
```

---

## Task 4: Add Server Migration And Legacy Route APIs

**Files:**

- Modify: `server/src/skill-repository/skill-repository.controller.ts`
- Modify: `server/src/skill-repository/skill-repository.controller.spec.ts`
- Modify: `server/src/content-store/content-store.controller.ts`
- Modify: `server/src/content-store/content-store.service.ts`

- [ ] **Step 1: Add controller tests**

Add tests to `server/src/skill-repository/skill-repository.controller.spec.ts`:

```ts
it("starts legacy Content Store Skill migration for the signed-in user", async () => {
  const service = createService()
  const migration = {
    migrateOwnerSkills: vi.fn().mockResolvedValue({
      scanned: 1,
      migrated: 1,
      alreadyMigrated: 0,
      skipped: [],
      warnings: [],
    }),
  }
  const controller = new SkillRepositoryController(service as never, migration as never)

  await expect(controller.migrateLegacyContentStoreSkills(request("user-1"))).resolves.toMatchObject({
    scanned: 1,
    migrated: 1,
  })
  expect(migration.migrateOwnerSkills).toHaveBeenCalledWith("user-1")
})

it("resolves a legacy content id to its migrated repository route", async () => {
  const service = createService()
  service.resolveLegacyContentRoute = vi.fn().mockResolvedValue({
    status: "migrated",
    repositoryId: "repo-1",
    managementUrl: "https://synapse.example/console/skill-repositories/repo-1",
    publicUrl: "https://synapse.example/console/skills/liyang/demo",
  })
  const migration = { migrateOwnerSkills: vi.fn() }
  const controller = new SkillRepositoryController(service as never, migration as never)

  await expect(controller.resolveLegacyContentRoute("content-1", request("user-1"))).resolves.toMatchObject({
    status: "migrated",
    repositoryId: "repo-1",
  })
  expect(service.resolveLegacyContentRoute).toHaveBeenCalledWith("user-1", "content-1")
})
```

- [ ] **Step 2: Add controller routes**

In `server/src/skill-repository/skill-repository.controller.ts`, inject `SkillRepositoryLegacyMigrationService`:

```ts
constructor(
  private readonly service: SkillRepositoryService,
  private readonly legacyMigration: SkillRepositoryLegacyMigrationService,
) {}
```

Add routes:

```ts
@Post("/legacy/content-store/migrate-skills")
migrateLegacyContentStoreSkills(@Req() request: AuthenticatedUserRequest) {
  return this.legacyMigration.migrateOwnerSkills(request.user!.id)
}

@Get("/legacy/content-store/:contentId/route")
resolveLegacyContentRoute(@Param("contentId") contentId: string, @Req() request: AuthenticatedUserRequest) {
  return this.service.resolveLegacyContentRoute(request.user!.id, contentId)
}
```

- [ ] **Step 3: Add service route resolver**

Add this method to `server/src/skill-repository/skill-repository.service.ts`:

```ts
async resolveLegacyContentRoute(userId: string, contentId: string): Promise<SkillRepositoryLegacyContentRouteDto> {
  const item = await this.prisma.contentStoreItem.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      type: true,
      ownerUserId: true,
    },
  }) as { id: string; type: string; ownerUserId: string } | null
  if (!item) {
    return { status: "not_found", message: "旧内容不存在。" }
  }
  if (item.type === "rule" || item.type === "prompt") {
    return {
      status: "retired",
      contentType: item.type,
      message: item.type === "rule" ? "云端 Rule 商店已停止维护。" : "云端 Prompt 商店已停止维护。",
    }
  }
  const repository = await this.prisma.skillRepository.findUnique({
    where: { legacyContentStoreItemId: contentId },
    include: { owner: { select: { handle: true } } },
  }) as ({ id: string; name: string; ownerUserId: string; visibility: string; owner: { handle: string | null } }) | null
  if (!repository) {
    return { status: "not_found", message: "旧 Skill 尚未迁移。" }
  }
  const { buildSkillRepositoryManagementUrl, buildSkillRepositoryPublicUrl } = await import("@synapse/shared")
  return {
    status: "migrated",
    repositoryId: repository.id,
    managementUrl: buildSkillRepositoryManagementUrl(this.publicAppUrl, repository.id),
    publicUrl: repository.visibility === "public" && repository.owner.handle
      ? buildSkillRepositoryPublicUrl(this.publicAppUrl, repository.owner.handle, repository.name)
      : null,
  }
}
```

If `SkillRepositoryService` does not already have `publicAppUrl`, add it through the same deployment config source used by existing Skill Repository upload management URL code.

- [ ] **Step 4: Add Content Store compatibility endpoint**

In `server/src/content-store/content-store.controller.ts`, add a user route that forwards old route resolution without changing old install routes:

```ts
@Get("/items/:id/legacy-route")
resolveLegacyRoute(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
  return this.service.resolveLegacySkillRepositoryRoute(request.user!.id, id)
}
```

In `server/src/content-store/content-store.service.ts`, add:

```ts
async resolveLegacySkillRepositoryRoute(userId: string, contentId: string): Promise<SkillRepositoryLegacyContentRouteDto> {
  const item = await this.prisma.contentStoreItem.findUnique({
    where: { id: contentId },
    select: { id: true, type: true },
  }) as { id: string; type: string } | null
  if (!item) return { status: "not_found", message: "旧内容不存在。" }
  if (item.type === "rule" || item.type === "prompt") {
    return {
      status: "retired",
      contentType: item.type,
      message: item.type === "rule" ? "云端 Rule 商店已停止维护。" : "云端 Prompt 商店已停止维护。",
    }
  }
  const repository = await this.prisma.skillRepository.findUnique({
    where: { legacyContentStoreItemId: contentId },
    include: { owner: { select: { handle: true } } },
  }) as ({ id: string; name: string; visibility: string; owner: { handle: string | null } }) | null
  if (!repository) return { status: "not_found", message: "旧 Skill 尚未迁移。" }
  const { buildSkillRepositoryManagementUrl, buildSkillRepositoryPublicUrl } = await import("@synapse/shared")
  return {
    status: "migrated",
    repositoryId: repository.id,
    managementUrl: buildSkillRepositoryManagementUrl(this.publicAppUrl, repository.id),
    publicUrl: repository.visibility === "public" && repository.owner.handle
      ? buildSkillRepositoryPublicUrl(this.publicAppUrl, repository.owner.handle, repository.name)
      : null,
  }
}
```

- [ ] **Step 5: Run focused server tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository src/content-store
```

Expected: PASS for Skill Repository and Content Store focused tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/skill-repository/skill-repository.controller.ts server/src/skill-repository/skill-repository.controller.spec.ts server/src/skill-repository/skill-repository.service.ts server/src/content-store/content-store.controller.ts server/src/content-store/content-store.service.ts
git commit -m "feat: expose legacy skill migration routes"
```

---

## Task 5: Add Dashboard API And Legacy Compatibility Screens

**Files:**

- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/features/content-store/content-store-detail.tsx`
- Modify: `dashboard/src/features/content-store/content-store-list.tsx`
- Modify: `dashboard/src/features/content-store/my-content-list.tsx`
- Modify: `dashboard/src/features/content-store/editor/content-store-create-page.tsx`
- Modify: `dashboard/src/features/content-store/editor/content-store-editor-page.tsx`

- [ ] **Step 1: Add Dashboard API methods**

In `dashboard/src/lib/api.ts`, import:

```ts
import type {
  SkillRepositoryLegacyContentRouteDto,
  SkillRepositoryLegacyMigrationResultDto,
} from '@synapse/shared'
```

Add methods to `dashboardApi`:

```ts
async migrateLegacyContentStoreSkills(): Promise<SkillRepositoryLegacyMigrationResultDto> {
  return apiRequest('/skill-repositories/legacy/content-store/migrate-skills', {
    method: 'POST',
  })
},

async resolveLegacyContentStoreRoute(contentId: string): Promise<SkillRepositoryLegacyContentRouteDto> {
  return apiRequest(`/content-store/items/${encodeURIComponent(contentId)}/legacy-route`)
},
```

- [ ] **Step 2: Add retired Content Store page component**

Create this local helper inside `dashboard/src/features/content-store/content-store-list.tsx`:

```tsx
function ContentStoreRetiredPage() {
  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 py-8'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-xl font-semibold tracking-tight'>Skill Repository</h1>
        <p className='text-sm text-muted-foreground'>
          云端 Skill 已迁移到 Skill Repository。
        </p>
      </div>
      <div className='flex gap-2'>
        <Button asChild>
          <Link to='/skill-repositories/explore'>Explore Skills</Link>
        </Button>
        <Button variant='outline' asChild>
          <Link to='/skill-repositories'>My Skills</Link>
        </Button>
      </div>
    </div>
  )
}
```

Export `ContentStoreRetiredPage` as the default for normal user Content Store list route.

- [ ] **Step 3: Add My Content migration action**

In `dashboard/src/features/content-store/my-content-list.tsx`, replace the normal list body with:

```tsx
export default function MyContentListPage() {
  const migrate = useMutation({
    mutationFn: () => dashboardApi.migrateLegacyContentStoreSkills(),
  })

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 py-8'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-xl font-semibold tracking-tight'>My Skills</h1>
        <p className='text-sm text-muted-foreground'>
          旧内容商店里的 Skill 可以迁移到 Skill Repository。
        </p>
      </div>
      {migrate.data ? (
        <div className='rounded-lg border border-border p-4 text-sm text-muted-foreground'>
          已扫描 {migrate.data.scanned} 项，迁移 {migrate.data.migrated} 项，已迁移 {migrate.data.alreadyMigrated} 项。
        </div>
      ) : null}
      {migrate.error ? <p className='text-sm text-destructive'>{getErrorMessage(migrate.error)}</p> : null}
      <div className='flex gap-2'>
        <Button onClick={() => migrate.mutate()} disabled={migrate.isPending}>
          {migrate.isPending ? '迁移中' : '迁移旧 Skill'}
        </Button>
        <Button variant='outline' asChild>
          <Link to='/skill-repositories'>打开 My Skills</Link>
        </Button>
      </div>
    </div>
  )
}
```

Use the project’s existing error helper if `getErrorMessage` already exists in this file or nearby API utilities. If not, add:

```ts
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。'
}
```

- [ ] **Step 4: Redirect legacy Skill detail route**

In `dashboard/src/features/content-store/content-store-detail.tsx`, before loading old detail, call `dashboardApi.resolveLegacyContentStoreRoute(contentId)`. If `status === "migrated"`, navigate:

```tsx
useEffect(() => {
  if (legacyRoute.data?.status !== 'migrated') return
  navigate({
    to: '/skill-repositories/$repositoryId',
    params: { repositoryId: legacyRoute.data.repositoryId },
    replace: true,
  })
}, [legacyRoute.data, navigate])
```

If `status === "retired"`, render:

```tsx
<div className='mx-auto flex w-full max-w-2xl flex-col gap-3 py-8'>
  <h1 className='text-xl font-semibold tracking-tight'>内容已停止维护</h1>
  <p className='text-sm text-muted-foreground'>{legacyRoute.data.message}</p>
  <Button variant='outline' asChild>
    <Link to='/skill-repositories/explore'>Explore Skills</Link>
  </Button>
</div>
```

- [ ] **Step 5: Block legacy create/edit pages**

In `content-store-create-page.tsx` and `content-store-editor-page.tsx`, render this replacement for normal users:

```tsx
<div className='mx-auto flex w-full max-w-2xl flex-col gap-3 py-8'>
  <h1 className='text-xl font-semibold tracking-tight'>Skill Repository</h1>
  <p className='text-sm text-muted-foreground'>
    云端 Prompt 和 Rule 商店已停止维护。Skill 请通过本地上传到 Skill Repository。
  </p>
  <Button asChild>
    <Link to='/skill-repositories'>打开 My Skills</Link>
  </Button>
</div>
```

Do not remove admin-only legacy pages in this task.

- [ ] **Step 6: Run Dashboard build**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard build
```

Expected: PASS. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/features/content-store/content-store-detail.tsx dashboard/src/features/content-store/content-store-list.tsx dashboard/src/features/content-store/my-content-list.tsx dashboard/src/features/content-store/editor/content-store-create-page.tsx dashboard/src/features/content-store/editor/content-store-editor-page.tsx
git commit -m "feat: add legacy content store compatibility screens"
```

---

## Task 6: Hide Legacy User Navigation And Label Admin Surface

**Files:**

- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/features/content-store/content-store-admin.tsx`
- Modify: `dashboard/src/features/content-store/content-store-actions.test.ts`

- [ ] **Step 1: Remove normal-user legacy nav items**

In `dashboard/src/components/layout/data/sidebar-data.ts`, remove these two items from `userAccountNavGroup.items`:

```ts
{
  title: '内容商店',
  url: '/content-store',
  icon: Store,
},
{
  title: '我的内容',
  url: '/my-content',
  icon: FolderKanban,
},
```

Keep:

```ts
{
  title: 'Skill Repositories',
  url: '/skill-repositories',
  icon: FolderKanban,
},
{
  title: 'Explore Skills',
  url: '/skill-repositories/explore',
  icon: Store,
},
```

- [ ] **Step 2: Rename admin legacy page heading**

In `dashboard/src/features/content-store/content-store-admin.tsx`, change the page title text from `内容商店` to:

```tsx
Legacy Content Store
```

Add a short status line only if the page already has a header description slot:

```tsx
保留用于旧内容和安装链接兼容。
```

- [ ] **Step 3: Update tests that expect old user nav**

Search:

```bash
rg "内容商店|我的内容|/content-store|/my-content" dashboard/src -g "*.test.*" -n
```

For sidebar tests, assert `Skill Repositories` and `Explore Skills` exist and `/content-store` is absent for normal users.

- [ ] **Step 4: Run Dashboard tests/build**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard exec vitest run src/features/content-store src/components/layout
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard build
```

Expected: tests pass; build passes.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/layout/data/sidebar-data.ts dashboard/src/features/content-store/content-store-admin.tsx dashboard/src/features/content-store/content-store-actions.test.ts
git commit -m "feat: hide legacy content store user navigation"
```

---

## Task 7: Route Desktop Scan Upload To Skill Repository

**Files:**

- Modify: `desktop/electron/services/content-store-upload-service.ts`
- Modify: `desktop/electron/services/__tests__/content-store-upload-service.test.ts`
- Modify: `desktop/electron/modules/editor-scan/ipc.ts`
- Modify: `desktop/electron/modules/editor-scan/__tests__/ipc.test.ts`
- Modify: `desktop/src/modules/editor-scan/lib/content-store-upload.ts`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Modify: `desktop/src/types/editor-scan.ts`

- [ ] **Step 1: Write failing service test for Skill Repository upload**

In `desktop/electron/services/__tests__/content-store-upload-service.test.ts`, add:

```ts
it("uploads scan detail Skills into Skill Repository through the compatibility method", async () => {
  const accountService = {
    getState: vi.fn(() => ({ status: "authenticated", user: { id: "user-1" } })),
    importSkillRepository: vi.fn(async () => ({
      id: "repo-1",
      name: "demo-skill",
      title: "Demo Skill",
      description: null,
      visibility: "private",
      status: "active",
      owner: { id: "user-1", handle: "liyang", displayName: "Liyang" },
      forkedFromRepositoryId: null,
      legacyContentStoreItemId: null,
      legacyInstallCount: 0,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      lastSyncedAt: null,
      files: [],
    })),
  }
  const service = new ContentStoreUploadService({
    accountService: accountService as never,
    publicAppUrl: "https://synapse.example",
  })

  await expect(service.uploadSkillDraftToContentStore({
    itemType: "skill",
    itemPath: fixtureSkillPath,
    itemName: "Demo Skill",
    editorId: "codex",
    scope: "global",
    projectPath: null,
  })).resolves.toMatchObject({
    itemId: "repo-1",
    consoleEditUrl: "https://synapse.example/console/skill-repositories/repo-1",
    dashboardEditUrl: "https://synapse.example/console/skill-repositories/repo-1",
  })
  expect(accountService.importSkillRepository).toHaveBeenCalledWith(expect.objectContaining({
    title: "Demo Skill",
    files: expect.arrayContaining([
      expect.objectContaining({ path: "SKILL.md" }),
    ]),
  }))
})
```

- [ ] **Step 2: Replace account port and upload implementation**

In `desktop/electron/services/content-store-upload-service.ts`, change `ContentStoreUploadAccountPort`:

```ts
type ContentStoreUploadAccountPort = {
  readonly getState: () => SynapseAccountState
  readonly importSkillRepository: (input: SkillRepositoryImportInput) => Promise<SkillRepositoryDetailDto>
}
```

Import shared types:

```ts
import type {
  SkillRepositoryDetailDto,
  SkillRepositoryImportInput,
} from "@synapse/shared" with { "resolution-mode": "import" }
```

Inside `uploadSkillDraftToContentStore`, replace `createContentStoreSkillDraft` with:

```ts
const repository = await this.account.importSkillRepository({
  title: skillDraftTitle(sourceDraft.metadata, sourceDraft.content, request.itemName),
  description: skillDraftDescription(sourceDraft.metadata),
  files: [
    {
      path: "SKILL.md",
      contentBase64: Buffer.from(sourceDraft.content, "utf8").toString("base64"),
      mimeType: "text/markdown",
    },
    ...sourceDraft.files.map((file) => ({
      path: file.originalName,
      contentBase64: Buffer.from(assertSkillFileBytes(file.originalName, file.bytes)).toString("base64"),
      mimeType: null,
    })),
  ],
})

const managementUrl = buildSkillRepositoryConsoleUrl(this.publicAppUrl, repository.id)
return {
  draftId: repository.id,
  itemId: repository.id,
  revision: 1,
  consoleEditUrl: managementUrl,
  dashboardEditUrl: managementUrl,
}
```

Replace `buildContentStoreConsoleEditUrl` with:

```ts
function buildSkillRepositoryConsoleUrl(publicAppUrl: string, repositoryId: string): string {
  const url = new URL(`/console/skill-repositories/${encodeURIComponent(repositoryId)}`, normalizedUrlBase(publicAppUrl))
  return url.toString()
}
```

Keep the old export name as an alias for compatibility:

```ts
export {
  buildSkillRepositoryConsoleUrl,
  buildSkillRepositoryConsoleUrl as buildContentStoreConsoleEditUrl,
  buildSkillRepositoryConsoleUrl as buildContentStoreDashboardEditUrl,
  createLocalSourceFingerprint,
  normalizeFingerprintPath,
}
```

- [ ] **Step 3: Update renderer copy**

In `desktop/src/modules/editor-scan/lib/content-store-upload.ts`, change:

```ts
if (item.type !== "skill") return "只有 Skill 可以上传到 Skill Repository"
```

Change success message:

```ts
function buildUploadSkillDraftSuccessMessage(): string {
  return "Skill 仓库已保存。"
}
```

In `scan-item-detail-dialog.tsx`, change the button label from old store wording to:

```tsx
上传到 Skill Repository
```

- [ ] **Step 4: Keep IPC schema compatible**

In `desktop/electron/modules/editor-scan/ipc.ts`, keep channel name `synapse:editor-scan:upload-skill-draft-to-content-store`, but update comments or logger text to say it is a compatibility channel that now creates/updates Skill Repository.

The response schema remains:

```ts
const uploadSkillDraftToContentStoreResultSchema = z.object({
  draftId: z.string().min(1),
  itemId: z.string().min(1),
  revision: z.number().int().positive(),
  consoleEditUrl: z.string().url(),
  dashboardEditUrl: z.string().url(),
}).strict()
```

- [ ] **Step 5: Run Desktop tests**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop exec vitest run electron/services/__tests__/content-store-upload-service.test.ts electron/modules/editor-scan/__tests__/ipc.test.ts
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop typecheck
```

Expected: tests pass; typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/content-store-upload-service.ts desktop/electron/services/__tests__/content-store-upload-service.test.ts desktop/electron/modules/editor-scan/ipc.ts desktop/electron/modules/editor-scan/__tests__/ipc.test.ts desktop/src/modules/editor-scan/lib/content-store-upload.ts desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx desktop/src/types/editor-scan.ts
git commit -m "feat: upload scanned skills to skill repository"
```

---

## Task 8: Update Docs, Release Notes, And Final Verification

**Files:**

- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update built-in Skill Repository guidance**

Add this section to `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`:

```md
## Legacy Content Store

Old cloud Content Store Skill links may redirect to Skill Repository after migration. Do not create new cloud Prompt or Rule store entries. For Skills, use `app_skill_repository_import_local` or `app_skill_repository_update_local`.

If a user asks about an old Content Store Skill, prefer opening the migrated Skill Repository page. If a server response says the old item is a retired Prompt or Rule, explain that cloud Prompt/Rule sharing has been retired and do not try to migrate it into Skill Repository.
```

Add this note to `api-reference.md`:

```md
## Legacy Content Store Compatibility

Legacy Content Store Skill data may be migrated by the web console. Skill Repository tools operate on the new repository ids. Old Prompt and Rule cloud-store items are not Skill Repository resources.
```

- [ ] **Step 2: Update release notes**

Add to `RELEASE_NOTES_PENDING.md` under `新增功能`:

```md
- 旧内容商店里的 Skill 可以迁移到 Skill Repository；旧 Skill 链接会尽量跳转到新的仓库页面。
```

Add under `功能优化`:

```md
- Dashboard 普通用户入口收起旧的云端 Prompt/Rule 内容商店，Skill 的云端管理统一进入 Skill Repository。
```

- [ ] **Step 3: Run full focused verification**

Run:

```bash
pnpm --config.verify-deps-before-run=false --filter @synapse/shared test -- skill-repository
pnpm --config.verify-deps-before-run=false --filter @synapse/server exec vitest run src/skill-repository src/content-store
pnpm --config.verify-deps-before-run=false --filter @synapse/dashboard build
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop typecheck
pnpm --config.verify-deps-before-run=false --filter @synapse/desktop exec vitest run electron/services/__tests__/content-store-upload-service.test.ts electron/modules/editor-scan/__tests__/ipc.test.ts
git diff --check
```

Expected:

- Shared tests pass.
- Focused server tests pass.
- Dashboard build passes; existing Vite chunk-size warnings are acceptable.
- Desktop typecheck passes.
- Focused Desktop tests pass.
- `git diff --check` has no output.

- [ ] **Step 4: Confirm AGENTS storage-domain note**

Do not update `AGENTS.md` if this phase keeps Skill Repository files in the existing Content Store storage domain and does not rename `CONTENT_STORE_COS_*`.

If implementation renames the storage domain or changes COS bucket responsibility, update `AGENTS.md` in the same commit with the exact new domain responsibility. The expected Phase 4 path is to avoid this change.

- [ ] **Step 5: Commit**

```bash
git add desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "docs: document skill repository migration cleanup"
```

---

## Review Checklist

- [ ] Legacy Skill migration is idempotent through `legacyContentStoreItemId`.
- [ ] Public legacy Skills without owner handles become private and return a username warning.
- [ ] Prompt and Rule are not migrated into Skill Repository.
- [ ] Old `synapse://content-install` remains registered and tested.
- [ ] Normal Dashboard user nav no longer exposes old Content Store/My Content as primary destinations.
- [ ] Desktop scan-detail Skill upload creates or updates Skill Repository, not Content Store draft.
- [ ] Built-in `synapse-skill` docs describe the new Skill Repository path and legacy Content Store boundary.
- [ ] Release notes describe user-visible migration and hidden legacy surfaces.
