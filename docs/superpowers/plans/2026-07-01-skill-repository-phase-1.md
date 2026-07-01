# Skill Repository Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of cloud Skill Repository: stable shared contracts, user handle, server-side private Skill repositories, local Skill import through Desktop/MCP, and updated MCP documentation.

**Architecture:** Add a new `skill-repository` cloud domain beside the existing Content Store instead of extending old draft/publish tables. The server owns repository metadata, file metadata, storage writes, validation, and authenticated APIs; Desktop reads local Skill folders, calls the server API through the existing account service, and writes `.synapse.json` through the existing permission/audit path. Phase 1 keeps all Skill repositories private and does not implement public browsing, fork, install deep links, or the web file browser.

**Tech Stack:** Prisma/PostgreSQL, NestJS, zod, shared TypeScript DTOs in `@synapse/shared`, Electron main process services, Synapse MCP capability registry, Vitest, React/TanStack Query for the profile settings handle field.

---

## Scope Check

The accepted spec covers server, Dashboard, Desktop, MCP, UI, install flow, public consumption, fork, and migration. This plan implements only the first independently testable slice:

- user handle storage and profile editing;
- private Skill Repository database tables;
- import/list/get/update-by-id APIs;
- local Skill directory import through Desktop account service;
- MCP tools for list/get/import/update/open metadata;
- `.synapse.json` write after successful local import;
- built-in Synapse MCP skill documentation for the new cloud domain.

Separate plans are required for:

- Phase 2 web management UI and shared Finder extraction;
- Phase 3 public visibility, Explore, fork, and install deep link;
- Phase 4 old Content Store migration and route cleanup.

## File Structure

### Shared Contract

- Create `shared/src/skill-repository.ts`: DTOs, constants, error codes, name/handle normalization, URL helpers.
- Modify `shared/src/index.ts`: export the new contract.
- Create `shared/src/skill-repository.test.ts`: validation and helper tests.

### Server

- Modify `server/prisma/schema.prisma`: add `User.handle`, handle redirects, Skill Repository tables, file table, install event table.
- Create `server/prisma/migrations/20260701000000_skill_repository_phase1/migration.sql`: schema migration.
- Create `server/src/skill-repository/skill-repository.types.ts`: service input types and row helpers.
- Create `server/src/skill-repository/skill-repository-file-rules.ts`: Skill file validation, path validation, text/binary detection.
- Create `server/src/skill-repository/skill-repository.service.ts`: import, update, list mine, get, storage cleanup.
- Create `server/src/skill-repository/skill-repository.controller.ts`: authenticated API endpoints.
- Create `server/src/skill-repository/skill-repository.module.ts`: Nest module and storage injection.
- Create `server/src/skill-repository/skill-repository.service.spec.ts`: service behavior tests.
- Create `server/src/skill-repository/skill-repository.controller.spec.ts`: API validation/auth tests.
- Modify `server/src/app.module.ts`: register the new module.
- Modify `server/src/content-store/content-store.module.ts`: export `CONTENT_STORE_STORAGE_PORT` so the new module can reuse the existing storage domain.
- Modify `server/src/auth/user-auth.service.ts`: return and update `handle`.
- Modify `server/src/auth/user-auth.service.spec.ts`: handle update tests.
- Modify `server/src/dashboard/dashboard.controller.ts`: accept handle in `/api/console/me` patch.
- Modify `server/src/dashboard/dashboard.controller.spec.ts`: profile API handle tests.

### Dashboard

- Modify `dashboard/src/lib/api.ts`: include `handle` in `DashboardMe` and `updateMe`.
- Modify `dashboard/src/features/settings/profile-settings.tsx`: add the username field using existing form layout.
- Create `dashboard/src/features/settings/profile-settings.test.tsx`: profile form tests for handle save and invalid handle.

### Desktop And MCP

- Create `desktop/electron/services/skill-repository-upload-service.ts`: read local Skill directory, call account API, write `.synapse.json`, optionally open browser.
- Create `desktop/electron/services/skill-repository-local-identity.ts`: atomic `.synapse.json` read/write helpers with `fs.write` permission/audit.
- Create `desktop/electron/services/__tests__/skill-repository-upload-service.test.ts`: upload service tests.
- Create `desktop/electron/services/__tests__/skill-repository-local-identity.test.ts`: identity file permission/audit tests.
- Modify `desktop/electron/services/account-service.ts`: add authenticated Skill Repository API methods.
- Create `desktop/electron/capabilities/skill-repository-dispatcher.ts`: MCP dispatcher.
- Create `desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts`: dispatcher tests.
- Modify `desktop/electron/capabilities/action-router.ts`: route the new domain.
- Modify `desktop/electron/capabilities/__tests__/action-router.test.ts`: route test.
- Modify `desktop/electron/bootstrap/descriptors.ts`: construct the dispatcher and pass it into the action router.
- Create `desktop/synapse-capabilities/shared/skill-repository-domain.ts`: capability definitions and MCP tool schemas.
- Create `desktop/synapse-capabilities/shared/skill-repository-domain.test.ts`: registry and tool-name tests.
- Modify `desktop/synapse-capabilities/shared/registry.ts`: register domain, tool actions, and tools.

### Documentation And Release Notes

- Create `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`.
- Create `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`.
- Modify `desktop/resources/templates/skills/synapse-skill/content.md`: include the new domain.
- Modify `RELEASE_NOTES_PENDING.md`: note private cloud Skill Repository import and username support.

## Task 1: Shared Skill Repository Contract

**Files:**
- Create: `shared/src/skill-repository.ts`
- Create: `shared/src/skill-repository.test.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write the failing shared tests**

```ts
// shared/src/skill-repository.test.ts
import { describe, expect, it } from "vitest"
import {
  buildSkillRepositoryManagementUrl,
  normalizeSkillRepositoryName,
  normalizeUserHandle,
  skillRepositoryErrorCodes,
} from "./skill-repository.js"

describe("skill repository shared helpers", () => {
  it("normalizes repository names with the existing Skill machine-name shape", () => {
    expect(normalizeSkillRepositoryName(" Demo-Skill ")).toBe("demo-skill")
    expect(() => normalizeSkillRepositoryName("demo.skill")).toThrow("仓库名不能包含点。")
    expect(() => normalizeSkillRepositoryName("con")).toThrow("仓库名不能使用 Windows 保留名称。")
  })

  it("normalizes user handles for URL identity", () => {
    expect(normalizeUserHandle(" Li-Yang ")).toBe("li-yang")
    expect(() => normalizeUserHandle("li.yang")).toThrow("用户名不能包含点。")
    expect(() => normalizeUserHandle("-liyang")).toThrow("用户名必须以字母或数字开头和结尾。")
  })

  it("exports stable structured error codes", () => {
    expect(skillRepositoryErrorCodes).toContain("USER_HANDLE_REQUIRED")
    expect(skillRepositoryErrorCodes).toContain("SKILL_REPOSITORY_NAME_CONFLICT")
    expect(skillRepositoryErrorCodes).toContain("SKILL_REPOSITORY_INVALID_SKILL")
  })

  it("builds dashboard management urls by stable repository id", () => {
    expect(buildSkillRepositoryManagementUrl("https://synapse.example/", "repo_1"))
      .toBe("https://synapse.example/console/skill-repositories/repo_1")
  })
})
```

- [ ] **Step 2: Run the shared test and verify it fails**

Run:

```bash
pnpm --filter @synapse/shared exec vitest run src/skill-repository.test.ts
```

Expected: FAIL because `shared/src/skill-repository.ts` does not exist.

- [ ] **Step 3: Add the shared contract**

```ts
// shared/src/skill-repository.ts
export type SkillRepositoryVisibility = "private" | "public"
export type SkillRepositoryStatus = "active" | "removed"
export type SkillRepositoryFileKind = "text" | "binary"

export const skillRepositoryMaxTotalBytes = 50 * 1024 * 1024
export const skillRepositoryMaxFileBytes = 20 * 1024 * 1024
export const skillRepositoryMaxFileCount = 200
export const skillRepositoryNameMaxLength = 64
export const userHandleMaxLength = 64

export const skillRepositoryErrorCodes = [
  "USER_HANDLE_REQUIRED",
  "SKILL_REPOSITORY_NAME_CONFLICT",
  "SKILL_REPOSITORY_FORBIDDEN",
  "SKILL_REPOSITORY_NOT_FOUND",
  "SKILL_REPOSITORY_INVALID_SKILL",
] as const

export type SkillRepositoryErrorCode = (typeof skillRepositoryErrorCodes)[number]

export interface SkillRepositoryOwnerDto {
  readonly id: string
  readonly handle: string | null
  readonly displayName: string | null
}

export interface SkillRepositoryFileDto {
  readonly id: string
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: SkillRepositoryFileKind
  readonly mimeType: string | null
  readonly text?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SkillRepositoryItemDto {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly description: string | null
  readonly visibility: SkillRepositoryVisibility
  readonly status: SkillRepositoryStatus
  readonly owner: SkillRepositoryOwnerDto
  readonly forkedFromRepositoryId: string | null
  readonly legacyContentStoreItemId: string | null
  readonly legacyInstallCount: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastSyncedAt: string | null
}

export interface SkillRepositoryDetailDto extends SkillRepositoryItemDto {
  readonly files: readonly SkillRepositoryFileDto[]
}

export interface SkillRepositoryImportFileInput {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
}

export interface SkillRepositoryImportInput {
  readonly repositoryId?: string | null
  readonly name?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly files: readonly SkillRepositoryImportFileInput[]
}

const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const windowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu

export function normalizeSkillRepositoryName(value: string): string {
  return normalizeDashedIdentifier(value, "仓库名")
}

export function normalizeUserHandle(value: string): string {
  return normalizeDashedIdentifier(value, "用户名")
}

export function buildSkillRepositoryManagementUrl(publicAppUrl: string, repositoryId: string): string {
  const base = publicAppUrl.trim().endsWith("/") ? publicAppUrl.trim() : `${publicAppUrl.trim()}/`
  return new URL(`/console/skill-repositories/${encodeURIComponent(repositoryId)}`, base).toString()
}

function normalizeDashedIdentifier(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > 64) throw new Error(`${label}不能超过 64 个字符。`)
  if (normalized.includes(".")) throw new Error(`${label}不能包含点。`)
  if (!namePattern.test(normalized)) throw new Error(`${label}必须以字母或数字开头和结尾，只能包含小写字母、数字和连字符。`)
  if (windowsReservedNames.test(normalized)) throw new Error(`${label}不能使用 Windows 保留名称。`)
  return normalized
}
```

Update the barrel export:

```ts
// shared/src/index.ts
export * from "./skill-repository.js"
```

- [ ] **Step 4: Run the shared test and verify it passes**

Run:

```bash
pnpm --filter @synapse/shared exec vitest run src/skill-repository.test.ts
pnpm --filter @synapse/shared run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add shared/src/skill-repository.ts shared/src/skill-repository.test.ts shared/src/index.ts
git commit -m "feat: add skill repository shared contract"
```

## Task 2: Database Schema And Migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260701000000_skill_repository_phase1/migration.sql`

- [ ] **Step 1: Update the Prisma schema**

In the existing `User` model, add the URL-safe handle field next to the current identity/profile fields:

```prisma
handle String? @unique @db.VarChar(64)
```

In the same `User` model, add these relation fields next to the existing user-owned content relations:

```prisma
userHandleRedirects          UserHandleRedirect[]
skillRepositories            SkillRepository[]
skillRepositoryInstallEvents SkillRepositoryInstallEvent[]
```

Add these models near the existing Content Store models:

```prisma
model UserHandleRedirect {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  oldHandle String   @unique @db.VarChar(64)
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}

model SkillRepository {
  id                       String                        @id @default(cuid())
  ownerUserId              String
  owner                    User                          @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  name                     String                        @db.VarChar(64)
  title                    String                        @db.VarChar(160)
  description              String?
  visibility               String                        @default("private") @db.VarChar(16)
  status                   String                        @default("active") @db.VarChar(16)
  forkedFromRepositoryId   String?
  forkedFromRepository     SkillRepository?              @relation("SkillRepositoryForks", fields: [forkedFromRepositoryId], references: [id], onDelete: SetNull)
  forks                    SkillRepository[]             @relation("SkillRepositoryForks")
  lastSyncedAt             DateTime?
  legacyContentStoreItemId String?
  legacyInstallCount       Int                           @default(0)
  createdAt                DateTime                      @default(now())
  updatedAt                DateTime                      @updatedAt
  files                    SkillRepositoryFile[]
  nameRedirects            SkillRepositoryNameRedirect[]
  installEvents            SkillRepositoryInstallEvent[]

  @@unique([ownerUserId, name])
  @@index([visibility, status, updatedAt])
  @@index([ownerUserId, updatedAt])
  @@index([forkedFromRepositoryId])
  @@index([legacyContentStoreItemId])
}

model SkillRepositoryNameRedirect {
  id           String          @id @default(cuid())
  ownerUserId  String
  oldName      String          @db.VarChar(64)
  repositoryId String
  repository   SkillRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  createdAt    DateTime        @default(now())

  @@unique([ownerUserId, oldName])
  @@index([repositoryId])
}

model SkillRepositoryFile {
  id           String          @id @default(cuid())
  repositoryId String
  repository   SkillRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  path         String          @db.VarChar(1024)
  pathKey      String          @db.VarChar(1024)
  kind         String          @db.VarChar(16)
  mimeType     String?         @db.VarChar(255)
  size         BigInt
  sha256       String          @db.VarChar(64)
  storageKey   String?
  text         String?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@unique([repositoryId, pathKey])
  @@index([repositoryId, path])
  @@index([sha256])
}

model SkillRepositoryInstallEvent {
  id               String          @id @default(cuid())
  userId           String
  user             User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  repositoryId     String
  repository       SkillRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  clientInstanceId String          @db.VarChar(120)
  createdAt        DateTime        @default(now())

  @@unique([userId, repositoryId, clientInstanceId])
  @@index([repositoryId])
}
```

- [ ] **Step 2: Create the SQL migration**

```sql
-- server/prisma/migrations/20260701000000_skill_repository_phase1/migration.sql
ALTER TABLE "User" ADD COLUMN "handle" VARCHAR(64);
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

CREATE TABLE "UserHandleRedirect" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldHandle" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserHandleRedirect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserHandleRedirect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserHandleRedirect_oldHandle_key" ON "UserHandleRedirect"("oldHandle");
CREATE INDEX "UserHandleRedirect_userId_createdAt_idx" ON "UserHandleRedirect"("userId", "createdAt");

CREATE TABLE "SkillRepository" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "visibility" VARCHAR(16) NOT NULL DEFAULT 'private',
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "forkedFromRepositoryId" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "legacyContentStoreItemId" TEXT,
  "legacyInstallCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepository_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepository_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SkillRepository_forkedFromRepositoryId_fkey" FOREIGN KEY ("forkedFromRepositoryId") REFERENCES "SkillRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepository_ownerUserId_name_key" ON "SkillRepository"("ownerUserId", "name");
CREATE INDEX "SkillRepository_visibility_status_updatedAt_idx" ON "SkillRepository"("visibility", "status", "updatedAt");
CREATE INDEX "SkillRepository_ownerUserId_updatedAt_idx" ON "SkillRepository"("ownerUserId", "updatedAt");
CREATE INDEX "SkillRepository_forkedFromRepositoryId_idx" ON "SkillRepository"("forkedFromRepositoryId");
CREATE INDEX "SkillRepository_legacyContentStoreItemId_idx" ON "SkillRepository"("legacyContentStoreItemId");

CREATE TABLE "SkillRepositoryNameRedirect" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "oldName" VARCHAR(64) NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillRepositoryNameRedirect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryNameRedirect_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryNameRedirect_ownerUserId_oldName_key" ON "SkillRepositoryNameRedirect"("ownerUserId", "oldName");
CREATE INDEX "SkillRepositoryNameRedirect_repositoryId_idx" ON "SkillRepositoryNameRedirect"("repositoryId");

CREATE TABLE "SkillRepositoryFile" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "path" VARCHAR(1024) NOT NULL,
  "pathKey" VARCHAR(1024) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "mimeType" VARCHAR(255),
  "size" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "storageKey" TEXT,
  "text" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepositoryFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryFile_repositoryId_pathKey_key" ON "SkillRepositoryFile"("repositoryId", "pathKey");
CREATE INDEX "SkillRepositoryFile_repositoryId_path_idx" ON "SkillRepositoryFile"("repositoryId", "path");
CREATE INDEX "SkillRepositoryFile_sha256_idx" ON "SkillRepositoryFile"("sha256");

CREATE TABLE "SkillRepositoryInstallEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "clientInstanceId" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillRepositoryInstallEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryInstallEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SkillRepositoryInstallEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryInstallEvent_userId_repositoryId_clientInstanceId_key" ON "SkillRepositoryInstallEvent"("userId", "repositoryId", "clientInstanceId");
CREATE INDEX "SkillRepositoryInstallEvent_repositoryId_idx" ON "SkillRepositoryInstallEvent"("repositoryId");
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
```

Expected: exit 0 and generated client includes `skillRepository`, `skillRepositoryFile`, `userHandleRedirect`, and `skillRepositoryNameRedirect`.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260701000000_skill_repository_phase1/migration.sql
git commit -m "feat: add skill repository database schema"
```

## Task 3: User Handle Profile API

**Files:**
- Modify: `server/src/auth/user-auth.service.ts`
- Modify: `server/src/auth/user-auth.service.spec.ts`
- Modify: `server/src/dashboard/dashboard.controller.ts`
- Modify: `server/src/dashboard/dashboard.controller.spec.ts`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/features/settings/profile-settings.tsx`
- Create: `dashboard/src/features/settings/profile-settings.test.tsx`

- [ ] **Step 1: Write server tests for handle set and rename reservation**

Add these cases to `server/src/auth/user-auth.service.spec.ts`:

```ts
it("updates a user handle and returns it from getMe", async () => {
  prisma.user.findUniqueOrThrow.mockResolvedValueOnce(user({
    id: "user-1",
    email: "u@example.test",
    handle: "liyang",
    displayName: "Liyang",
    memberships: [],
  }))

  const result = await service.getMe("user-1")

  expect(result.user.handle).toBe("liyang")
})

it("renames a handle and reserves the old handle", async () => {
  prisma.$transaction.mockImplementation(async (task: (tx: typeof prisma) => Promise<unknown>) => task(prisma))
  prisma.user.findUniqueOrThrow.mockResolvedValueOnce(user({
    id: "user-1",
    email: "u@example.test",
    handle: "old-name",
    displayName: "Liyang",
    memberships: [],
  }))
  prisma.userHandleRedirect.findUnique.mockResolvedValueOnce(null)
  prisma.user.update.mockResolvedValueOnce(user({
    id: "user-1",
    email: "u@example.test",
    handle: "new-name",
    displayName: "Liyang",
    memberships: [],
  }))

  const result = await service.updateMyProfile("user-1", {
    displayName: "Liyang",
    handle: " New-Name ",
  })

  expect(result.user.handle).toBe("new-name")
  expect(prisma.userHandleRedirect.upsert).toHaveBeenCalledWith({
    where: { oldHandle: "old-name" },
    create: { userId: "user-1", oldHandle: "old-name" },
    update: { userId: "user-1" },
  })
})
```

Add a controller test in `server/src/dashboard/dashboard.controller.spec.ts`:

```ts
it("passes handle updates to the profile service", async () => {
  auth.updateMyProfile.mockResolvedValue({
    user: { id: "user-1", email: "u@example.test", status: "active", displayName: "Liyang", handle: "liyang" },
    teams: [],
  })

  await controller.updateMe({ displayName: "Liyang", handle: "liyang" }, request("user-1"))

  expect(auth.updateMyProfile).toHaveBeenCalledWith("user-1", { displayName: "Liyang", handle: "liyang" }, expect.any(String))
})
```

- [ ] **Step 2: Run the server tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/auth/user-auth.service.spec.ts src/dashboard/dashboard.controller.spec.ts
```

Expected: FAIL because `handle` is not selected, returned, or accepted by the update schema.

- [ ] **Step 3: Implement handle normalization in auth service**

Apply these concrete changes in `server/src/auth/user-auth.service.ts`:

```ts
import { normalizeUserHandle } from "@synapse/shared"
```

Change `UserMeResponse`:

```ts
export interface UserMeResponse {
  readonly user: Pick<User, "id" | "email" | "status" | "displayName" | "handle">
  readonly teams: readonly UserMeTeam[]
}
```

Change `toUserMeResponse` to include `handle`:

```ts
function toUserMeResponse(user: {
  readonly id: string
  readonly email: string
  readonly status: User["status"]
  readonly displayName: string | null
  readonly handle: string | null
  readonly memberships: ReadonlyArray<{
    readonly id: string
    readonly role: TeamRole
    readonly team: { readonly id: string; readonly name: string }
  }>
}): UserMeResponse {
  return {
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
      displayName: user.displayName,
      handle: user.handle,
    },
    teams: user.memberships.map((membership) => ({
      id: membership.team.id,
      name: membership.team.name,
      membershipId: membership.id,
      membershipRole: membership.role,
    })),
  }
}
```

In every `user` select used by `getMe` and `updateMyProfile`, add:

```ts
handle: true,
```

Replace the `updateMyProfile` signature and logic:

```ts
async updateMyProfile(
  userId: string,
  input: { readonly displayName?: string; readonly handle?: string },
  ipAddress = "system",
): Promise<UserMeResponse> {
  if (input.displayName === undefined && input.handle === undefined) {
    throw new BadRequestException("profile update is empty.")
  }

  const result = await this.prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        displayName: true,
        handle: true,
      },
    })

    const data: Prisma.UserUpdateInput = {}
    if (input.displayName !== undefined) data.displayName = normalizeDisplayName(input.displayName)
    if (input.handle !== undefined) {
      const nextHandle = normalizeUserHandle(input.handle)
      if (current.handle !== nextHandle) {
        const reserved = await tx.userHandleRedirect.findUnique({
          where: { oldHandle: nextHandle },
          select: { userId: true },
        })
        if (reserved && reserved.userId !== userId) {
          throw new BadRequestException("用户名已被保留。")
        }
        if (current.handle) {
          await tx.userHandleRedirect.upsert({
            where: { oldHandle: current.handle },
            create: { userId, oldHandle: current.handle },
            update: { userId },
          })
        }
        data.handle = nextHandle
      }
    }

    return tx.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        status: true,
        displayName: true,
        handle: true,
        memberships: {
          select: {
            id: true,
            role: true,
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })
  })

  await this.recordUserProfileUpdateAuditSafely({
    adminEmail: result.email,
    targetId: result.id,
    ipAddress,
  })

  return toUserMeResponse(result)
}
```

- [ ] **Step 4: Update the dashboard controller schema**

Replace `updateMeSchema` in `server/src/dashboard/dashboard.controller.ts`:

```ts
const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  handle: z.string().trim().min(1).max(64).optional(),
}).strict().refine(
  (value) => value.displayName !== undefined || value.handle !== undefined,
  "Profile update request is empty.",
)
```

- [ ] **Step 5: Update Dashboard API types**

In `dashboard/src/lib/api.ts`, add `handle` to `DashboardMe.user` and update `updateMe`:

```ts
export type DashboardMe = {
  user: {
    id: string
    email: string
    status: 'active' | 'disabled'
    displayName: string | null
    handle: string | null
  }
  teams: Array<{
    id: string
    name: string
    membershipId: string
    membershipRole: 'owner' | 'member'
  }>
}
```

```ts
updateMe: (input: { displayName?: string; handle?: string }) =>
  request<DashboardMe>(`${consoleApiBasePath}/me`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }),
```

- [ ] **Step 6: Update `ProfileSettings` UI**

In `dashboard/src/features/settings/profile-settings.tsx`, add state and validation:

```tsx
const maxHandleLength = 64
const handlePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const [handle, setHandle] = useState('')
```

Update the data effect:

```tsx
useEffect(() => {
  if (!data) return
  setDisplayName(data.user.displayName ?? '')
  setHandle(data.user.handle ?? '')
}, [data])
```

Update change detection and submit payload:

```tsx
const trimmedHandle = handle.trim().toLowerCase()
const handleInvalid = trimmedHandle.length > 0 && !handlePattern.test(trimmedHandle)
const isInvalid =
  trimmedDisplayName.length === 0 ||
  trimmedDisplayName.length > maxDisplayNameLength ||
  handleInvalid
const hasChanged =
  trimmedDisplayName !== (data.user.displayName ?? '') ||
  trimmedHandle !== (data.user.handle ?? '')

function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (isInvalid || !hasChanged) return
  updateProfile.mutate({
    displayName: trimmedDisplayName,
    ...(trimmedHandle ? { handle: trimmedHandle } : {}),
  })
}
```

Add the field directly after nickname:

```tsx
<div className='space-y-2'>
  <Label htmlFor='user-handle'>用户名</Label>
  <Input
    id='user-handle'
    value={handle}
    maxLength={maxHandleLength}
    onChange={(event) => setHandle(event.target.value)}
  />
  {handleInvalid ? (
    <p className='text-sm text-destructive'>只能使用小写字母、数字和连字符，并以字母或数字开头和结尾。</p>
  ) : null}
</div>
```

- [ ] **Step 7: Write Dashboard profile tests**

```tsx
// dashboard/src/features/settings/profile-settings.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { ProfileSettings } from './profile-settings'

vi.mock('@/lib/api', () => ({
  dashboardApi: {
    getMe: vi.fn(),
    updateMe: vi.fn(),
  },
}))

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileSettings />
    </QueryClientProvider>,
  )
}

describe('ProfileSettings', () => {
  beforeEach(() => {
    useAuthStore.setState({
      auth: {
        user: { email: 'u@example.test', displayName: 'Liyang', role: 'user', sessionId: 's1' },
        setUser: vi.fn(),
        clearUser: vi.fn(),
      },
    })
    vi.mocked(dashboardApi.getMe).mockResolvedValue({
      user: { id: 'user-1', email: 'u@example.test', status: 'active', displayName: 'Liyang', handle: 'liyang' },
      teams: [],
    })
    vi.mocked(dashboardApi.updateMe).mockResolvedValue({
      user: { id: 'user-1', email: 'u@example.test', status: 'active', displayName: 'Liyang', handle: 'new-name' },
      teams: [],
    })
  })

  it('saves a normalized handle', async () => {
    renderProfile()
    fireEvent.change(await screen.findByLabelText('用户名'), { target: { value: ' New-Name ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(dashboardApi.updateMe).toHaveBeenCalledWith({ displayName: 'Liyang', handle: 'new-name' })
    })
  })

  it('blocks invalid handles in the form', async () => {
    renderProfile()
    fireEvent.change(await screen.findByLabelText('用户名'), { target: { value: 'bad.name' } })
    expect(screen.getByText('只能使用小写字母、数字和连字符，并以字母或数字开头和结尾。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
})
```

- [ ] **Step 8: Run tests and commit**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/auth/user-auth.service.spec.ts src/dashboard/dashboard.controller.spec.ts
pnpm --filter @synapse/dashboard exec vitest run src/features/settings/profile-settings.test.tsx
```

Expected: both commands exit 0.

Commit:

```bash
git add server/src/auth/user-auth.service.ts server/src/auth/user-auth.service.spec.ts server/src/dashboard/dashboard.controller.ts server/src/dashboard/dashboard.controller.spec.ts dashboard/src/lib/api.ts dashboard/src/features/settings/profile-settings.tsx dashboard/src/features/settings/profile-settings.test.tsx
git commit -m "feat: add user handles to profile settings"
```

## Task 4: Server Skill Repository Service

**Files:**
- Create: `server/src/skill-repository/skill-repository.types.ts`
- Create: `server/src/skill-repository/skill-repository-file-rules.ts`
- Create: `server/src/skill-repository/skill-repository.service.ts`
- Create: `server/src/skill-repository/skill-repository.service.spec.ts`
- Modify: `server/src/content-store/content-store.module.ts`

- [ ] **Step 1: Write service tests**

Create `server/src/skill-repository/skill-repository.service.spec.ts` with these cases:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { SkillRepositoryService } from "./skill-repository.service"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"

describe("SkillRepositoryService", () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let storage: ReturnType<typeof createStorageMock>
  let service: SkillRepositoryService

  beforeEach(() => {
    prisma = createPrismaMock()
    storage = createStorageMock()
    prisma.$transaction.mockImplementation(async (input: (tx: typeof prisma) => Promise<unknown>) => input(prisma))
    service = new SkillRepositoryService(prisma as unknown as PrismaService, storage as unknown as ContentStoreStoragePort)
  })

  it("imports a private repository from a packaged Skill file tree", async () => {
    prisma.skillRepository.findUnique.mockResolvedValueOnce(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValueOnce(null)
    prisma.skillRepository.create.mockResolvedValueOnce(repository({ id: "repo-1", ownerUserId: "user-1", name: "demo-skill" }))
    prisma.skillRepositoryFile.createMany.mockResolvedValueOnce({ count: 1 })
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryWithFiles({ id: "repo-1", name: "demo-skill" }))

    const result = await service.importRepository("user-1", {
      name: "demo-skill",
      title: "Demo Skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })

    expect(result).toMatchObject({ id: "repo-1", name: "demo-skill", visibility: "private" })
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^skill-repositories\/repo-1\/files\/[a-z0-9-]+\/[a-f0-9]{64}$/u),
    }))
  })

  it("rejects same-name import without repository id", async () => {
    prisma.skillRepository.findUnique.mockResolvedValueOnce(repository({ id: "repo-1", ownerUserId: "user-1", name: "demo-skill" }))

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SKILL_REPOSITORY_NAME_CONFLICT" }),
    })
  })

  it("updates an owned repository only when repository id is explicit", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repository({ id: "repo-1", ownerUserId: "user-1", name: "demo-skill" }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([{ storageKey: "skill-repositories/repo-1/files/old/sha" }])
    prisma.skillRepository.update.mockResolvedValueOnce(repository({ id: "repo-1", ownerUserId: "user-1", name: "demo-skill" }))
    prisma.skillRepositoryFile.deleteMany.mockResolvedValueOnce({ count: 1 })
    prisma.skillRepositoryFile.createMany.mockResolvedValueOnce({ count: 1 })
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryWithFiles({ id: "repo-1", name: "demo-skill" }))

    const result = await service.importRepository("user-1", {
      repositoryId: "repo-1",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Updated").toString("base64") }],
    })

    expect(result.id).toBe("repo-1")
    expect(storage.deleteObject).toHaveBeenCalledWith("skill-repositories/repo-1/files/old/sha")
  })

  it("rejects updates to repositories owned by another user", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(null)

    await expect(service.importRepository("user-2", {
      repositoryId: "repo-1",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Updated").toString("base64") }],
    })).rejects.toThrow(NotFoundException)
  })

  it("rejects repositories without a non-empty SKILL.md", async () => {
    await expect(service.importRepository("user-1", {
      name: "bad-skill",
      files: [{ path: "README.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toThrow(BadRequestException)
  })
})
```

Test helper functions in the same file:

```ts
function createStorageMock() {
  return {
    putObject: vi.fn(async () => undefined),
    getObjectStream: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
  }
}

function createPrismaMock() {
  return {
    $transaction: vi.fn(),
    skillRepository: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    skillRepositoryFile: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    skillRepositoryNameRedirect: {
      findUnique: vi.fn(),
    },
  }
}
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/skill-repository/skill-repository.service.spec.ts
```

Expected: FAIL because the service files do not exist.

- [ ] **Step 3: Add file normalization**

Create `server/src/skill-repository/skill-repository-file-rules.ts` by copying the behavior from `content-store-file-rules.ts` and renaming messages to Skill Repository where needed. Keep these exported functions:

```ts
export type NormalizedSkillRepositoryFile = {
  readonly path: string
  readonly pathKey: string
  readonly size: number
  readonly sha256: string
  readonly kind: "text" | "binary"
  readonly mimeType: string | null
  readonly text: string | null
  readonly bytes: Buffer
}

export type SkillRepositoryFileInput = {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
}

export function normalizeSkillRepositoryFiles(files: readonly SkillRepositoryFileInput[]): NormalizedSkillRepositoryFile[]
export function normalizeSkillRepositoryPath(input: string): string
```

Concrete rules:

- decode only strict base64 strings;
- reject empty file list;
- max 200 files;
- max 20 MB per file;
- max 50 MB total;
- require root `SKILL.md`;
- require `SKILL.md` to be text and non-empty;
- normalize `\` to `/`;
- reject absolute paths, drive-letter paths, `..`, Windows-hostile path characters, Windows reserved segment names, trailing dot, and trailing space;
- set `pathKey = normalizedPath.toLowerCase()`.

- [ ] **Step 4: Implement the service**

Create `server/src/skill-repository/skill-repository.types.ts`:

```ts
import type { SkillRepositoryImportFileInput } from "@synapse/shared"

export type SkillRepositoryImportRequest = {
  readonly repositoryId?: string | null
  readonly name?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly files: readonly SkillRepositoryImportFileInput[]
}
```

Create `server/src/skill-repository/skill-repository.service.ts` with these public methods:

```ts
@Injectable()
export class SkillRepositoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_STORE_STORAGE_PORT) private readonly storage: ContentStoreStoragePort,
  ) {}

  async importRepository(userId: string, input: SkillRepositoryImportRequest): Promise<SkillRepositoryDetailDto>
  async listMine(userId: string): Promise<SkillRepositoryItemDto[]>
  async getMine(userId: string, repositoryId: string): Promise<SkillRepositoryDetailDto>
}
```

Use this conflict helper in the service:

```ts
function skillRepositoryConflict(message: string): BadRequestException {
  return new BadRequestException({
    code: "SKILL_REPOSITORY_NAME_CONFLICT",
    message,
  })
}
```

Use this invalid helper for file validation failures that are caught inside the service:

```ts
function invalidSkill(message: string): BadRequestException {
  return new BadRequestException({
    code: "SKILL_REPOSITORY_INVALID_SKILL",
    message,
  })
}
```

The import algorithm must be:

1. normalize files with `normalizeSkillRepositoryFiles`;
2. if `repositoryId` is present, find `SkillRepository` by `{ id: repositoryId, ownerUserId: userId, status: "active" }`;
3. if not found for explicit id, throw `NotFoundException`;
4. if no `repositoryId`, require `name`, normalize it, check active repository conflict, check name redirect conflict, create private repository;
5. upload each file to `skill-repositories/{repositoryId}/files/{fileId}/{sha256}`;
6. replace file rows inside the same transaction;
7. update `title`, `description`, and `lastSyncedAt`;
8. after transaction, delete stale storage keys and log but do not fail metadata if deletion fails;
9. return `getMine(userId, repositoryId)`.

Use `randomUUID()` for file ids before storage keys:

```ts
const fileId = randomUUID()
const storageKey = `skill-repositories/${repositoryId}/files/${fileId}/${file.sha256}`
```

DTO mapping must include owner handle:

```ts
function toRepositoryItemDto(row: RepositoryRow): SkillRepositoryItemDto {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    visibility: row.visibility as SkillRepositoryVisibility,
    status: row.status as SkillRepositoryStatus,
    owner: {
      id: row.owner.id,
      handle: row.owner.handle,
      displayName: row.owner.displayName,
    },
    forkedFromRepositoryId: row.forkedFromRepositoryId,
    legacyContentStoreItemId: row.legacyContentStoreItemId,
    legacyInstallCount: row.legacyInstallCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  }
}
```

- [ ] **Step 5: Export the storage provider from Content Store module**

Modify `server/src/content-store/content-store.module.ts`:

```ts
exports: [ContentStoreService, CONTENT_STORE_STORAGE_PORT],
```

- [ ] **Step 6: Run service tests and commit**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/skill-repository/skill-repository.service.spec.ts
```

Expected: exit 0.

Commit:

```bash
git add server/src/skill-repository/skill-repository.types.ts server/src/skill-repository/skill-repository-file-rules.ts server/src/skill-repository/skill-repository.service.ts server/src/skill-repository/skill-repository.service.spec.ts server/src/content-store/content-store.module.ts
git commit -m "feat: add private skill repository service"
```

## Task 5: Server API Module

**Files:**
- Create: `server/src/skill-repository/skill-repository.controller.ts`
- Create: `server/src/skill-repository/skill-repository.controller.spec.ts`
- Create: `server/src/skill-repository/skill-repository.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write controller tests**

Create `server/src/skill-repository/skill-repository.controller.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { SkillRepositoryController } from "./skill-repository.controller"

describe("SkillRepositoryController", () => {
  it("imports a packaged Skill repository for the authenticated user", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service)

    await controller.importRepository({
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    }, request("user-1"))

    expect(service.importRepository).toHaveBeenCalledWith("user-1", {
      name: "demo-skill",
      title: undefined,
      description: undefined,
      repositoryId: undefined,
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })
  })

  it("rejects invalid import body before service call", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service)

    await expect(controller.importRepository({ name: "bad" }, request("user-1"))).rejects.toThrow(BadRequestException)
    expect(service.importRepository).not.toHaveBeenCalled()
  })
})

function createService() {
  return {
    importRepository: vi.fn(async () => ({ id: "repo-1" })),
    listMine: vi.fn(async () => []),
    getMine: vi.fn(async () => ({ id: "repo-1" })),
  } as any
}

function request(userId: string) {
  return { user: { id: userId }, ip: "127.0.0.1" } as any
}
```

- [ ] **Step 2: Run controller tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/skill-repository/skill-repository.controller.spec.ts
```

Expected: FAIL because controller/module files do not exist.

- [ ] **Step 3: Add the controller**

```ts
// server/src/skill-repository/skill-repository.controller.ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { SkillRepositoryService } from "./skill-repository.service"

const fileSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  contentBase64: z.string().min(1),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const importSchema = z.object({
  repositoryId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  files: z.array(fileSchema).min(1).max(200),
}).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/skill-repositories")
export class SkillRepositoryController {
  constructor(private readonly service: SkillRepositoryService) {}

  @Get("/mine")
  listMine(@Req() request: AuthenticatedUserRequest) {
    return this.service.listMine(request.user!.id)
  }

  @Get("/:id")
  getMine(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.getMine(request.user!.id, id)
  }

  @Post("/import")
  importRepository(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(importSchema, body, "Skill 仓库导入请求无效。")
    return this.service.importRepository(request.user!.id, {
      repositoryId: parsed.repositoryId ?? undefined,
      name: parsed.name ?? undefined,
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      files: parsed.files,
    })
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}
```

- [ ] **Step 4: Add the module and register it**

```ts
// server/src/skill-repository/skill-repository.module.ts
import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { ContentStoreModule } from "../content-store/content-store.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillRepositoryController } from "./skill-repository.controller"
import { SkillRepositoryService } from "./skill-repository.service"

@Module({
  imports: [UserAuthModule, PrismaModule, ContentStoreModule],
  controllers: [SkillRepositoryController],
  providers: [SkillRepositoryService],
  exports: [SkillRepositoryService],
})
export class SkillRepositoryModule {}
```

In `server/src/app.module.ts`:

```ts
import { SkillRepositoryModule } from "./skill-repository/skill-repository.module"
```

Add `SkillRepositoryModule` after `ContentStoreModule` in imports.

- [ ] **Step 5: Run API tests and commit**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/skill-repository/skill-repository.controller.spec.ts src/app.module.spec.ts
```

Expected: exit 0.

Commit:

```bash
git add server/src/skill-repository/skill-repository.controller.ts server/src/skill-repository/skill-repository.controller.spec.ts server/src/skill-repository/skill-repository.module.ts server/src/app.module.ts
git commit -m "feat: expose skill repository api"
```

## Task 6: Desktop Account API And Local Upload Service

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Create: `desktop/electron/services/skill-repository-local-identity.ts`
- Create: `desktop/electron/services/skill-repository-upload-service.ts`
- Create: `desktop/electron/services/__tests__/skill-repository-local-identity.test.ts`
- Create: `desktop/electron/services/__tests__/skill-repository-upload-service.test.ts`

- [ ] **Step 1: Add account service types and methods**

In `desktop/electron/services/account-service.ts`, import shared DTOs:

```ts
import type {
  SkillRepositoryDetailDto,
  SkillRepositoryImportInput,
  SkillRepositoryItemDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
```

Add methods to `AccountService`:

```ts
async listSkillRepositories(): Promise<SkillRepositoryItemDto[]> {
  return this.getAuthenticatedJson<SkillRepositoryItemDto[]>(
    `${apiBaseUrl()}/skill-repositories/mine`,
    "Skill 仓库列表加载失败。",
  )
}

async getSkillRepository(repositoryId: string): Promise<SkillRepositoryDetailDto> {
  return this.getAuthenticatedJson<SkillRepositoryDetailDto>(
    `${apiBaseUrl()}/skill-repositories/${encodeURIComponent(repositoryId)}`,
    "Skill 仓库加载失败。",
  )
}

async importSkillRepository(input: SkillRepositoryImportInput): Promise<SkillRepositoryDetailDto> {
  return this.requestAuthenticatedJson<SkillRepositoryDetailDto>(
    "POST",
    `${apiBaseUrl()}/skill-repositories/import`,
    input,
    "Skill 仓库上传失败。",
  )
}
```

- [ ] **Step 2: Write local identity tests**

Create `desktop/electron/services/__tests__/skill-repository-local-identity.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { writeSkillRepositoryIdentity } from "../skill-repository-local-identity"

describe("writeSkillRepositoryIdentity", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "skill-repo-identity-"))
  })

  it("writes cloud repository identity through fs.write permission", async () => {
    const auditSink = { record: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }

    await writeSkillRepositoryIdentity(dir, {
      id: "repo-1",
      owner: "liyang",
      name: "demo-skill",
    }, {
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      auditSink,
      permissionGuard,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: path.join(dir, ".synapse.json"),
    }))
    expect(JSON.parse(await readFile(path.join(dir, ".synapse.json"), "utf8"))).toEqual({
      id: "repo-1",
      kind: "cloud-skill-repository",
      owner: "liyang",
      name: "demo-skill",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed" }))
  })

  it("does not write when permission is denied", async () => {
    const auditSink = { record: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: false as const, reason: "denied", policyId: "test" })) }

    await expect(writeSkillRepositoryIdentity(dir, {
      id: "repo-1",
      owner: "liyang",
      name: "demo-skill",
    }, {
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      auditSink,
      permissionGuard,
    })).rejects.toThrow("denied")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })
})
```

- [ ] **Step 3: Implement local identity writer**

```ts
// desktop/electron/services/skill-repository-local-identity.ts
import { randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { SYNAPSE_SKILL_ID_FILE_NAME } from "./editor-adapters/skill-identity"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"

export type SkillRepositoryIdentity = {
  readonly id: string
  readonly owner: string | null
  readonly name: string
}

export type SkillRepositoryIdentityWriteSecurity = {
  readonly actor: ActorIdentity
  readonly auditSink: Pick<AuditSink, "record">
  readonly permissionGuard: Pick<PermissionGuard, "check">
}

export async function writeSkillRepositoryIdentity(
  skillDirectoryPath: string,
  identity: SkillRepositoryIdentity,
  security?: SkillRepositoryIdentityWriteSecurity,
): Promise<void> {
  const targetPath = path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME)
  await checkWritePermission(targetPath, identity, security)
  try {
    await mkdir(path.dirname(targetPath), { recursive: true })
    const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`)
    await writeFile(tempPath, `${JSON.stringify({
      id: identity.id,
      kind: "cloud-skill-repository",
      owner: identity.owner,
      name: identity.name,
    }, null, 2)}\n`, "utf8")
    await rename(tempPath, targetPath)
    recordAudit(targetPath, identity, "allowed", security)
  } catch (error) {
    recordAudit(targetPath, identity, "failed", security)
    throw error
  }
}

async function checkWritePermission(
  targetPath: string,
  identity: SkillRepositoryIdentity,
  security?: SkillRepositoryIdentityWriteSecurity,
): Promise<void> {
  if (!security) return
  const permission = await security.permissionGuard.check({
    action: "fs.write",
    actor: security.actor,
    resource: targetPath,
    context: {
      operation: "skill-repository.identity.write",
      repositoryId: identity.id,
      repositoryName: identity.name,
    },
  })
  if (permission.allowed) return
  security.auditSink.record({
    action: "fs.write",
    actor: security.actor,
    resource: targetPath,
    outcome: "denied",
    metadata: {
      operation: "skill-repository.identity.write",
      repositoryId: identity.id,
      repositoryName: identity.name,
      reason: permission.reason,
      policyId: permission.policyId,
    },
  })
  throw new Error(permission.reason)
}

function recordAudit(
  targetPath: string,
  identity: SkillRepositoryIdentity,
  outcome: "allowed" | "failed",
  security?: SkillRepositoryIdentityWriteSecurity,
): void {
  security?.auditSink.record({
    action: "fs.write",
    actor: security.actor,
    resource: targetPath,
    outcome,
    metadata: {
      operation: "skill-repository.identity.write",
      repositoryId: identity.id,
      repositoryName: identity.name,
    },
  })
}
```

- [ ] **Step 4: Write upload service tests**

Create `desktop/electron/services/__tests__/skill-repository-upload-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { SkillRepositoryUploadService } from "../skill-repository-upload-service"

describe("SkillRepositoryUploadService", () => {
  it("imports a local Skill directory and writes cloud identity", async () => {
    const account = {
      getState: vi.fn(() => ({ status: "authenticated" })),
      importSkillRepository: vi.fn(async () => repositoryDetail()),
    }
    const writeIdentity = vi.fn(async () => undefined)
    const readSkillDraftFromDirectory = vi.fn(async () => ({
      sourceDirectoryPath: "/tmp/demo-skill",
      mainFilePath: "/tmp/demo-skill/SKILL.md",
      content: "# Demo",
      metadata: { name: "demo-skill", title: "Demo Skill" },
      files: [],
    }))
    const service = new SkillRepositoryUploadService({
      accountService: account,
      readSkillDraftFromDirectory,
      writeIdentity,
      publicAppUrl: "https://synapse.example",
    })

    const result = await service.importLocal({
      sourceDirectoryPath: "/tmp/demo-skill",
      openInBrowser: false,
    })

    expect(result.repositoryId).toBe("repo-1")
    expect(account.importSkillRepository).toHaveBeenCalledWith(expect.objectContaining({
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64"), mimeType: "text/markdown" }],
    }))
    expect(writeIdentity).toHaveBeenCalledWith("/tmp/demo-skill", {
      id: "repo-1",
      owner: "liyang",
      name: "demo-skill",
    }, undefined)
  })

  it("passes explicit repository id for updates", async () => {
    const account = {
      getState: vi.fn(() => ({ status: "authenticated" })),
      importSkillRepository: vi.fn(async () => repositoryDetail()),
    }
    const service = new SkillRepositoryUploadService({
      accountService: account,
      readSkillDraftFromDirectory: vi.fn(async () => ({
        sourceDirectoryPath: "/tmp/demo-skill",
        mainFilePath: "/tmp/demo-skill/SKILL.md",
        content: "# Demo",
        metadata: {},
        files: [],
      })),
      writeIdentity: vi.fn(async () => undefined),
      publicAppUrl: "https://synapse.example",
    })

    await service.importLocal({ sourceDirectoryPath: "/tmp/demo-skill", repositoryId: "repo-1" })

    expect(account.importSkillRepository).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo-1" }))
  })
})

function repositoryDetail() {
  return {
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
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    files: [],
  } as const
}
```

- [ ] **Step 5: Implement upload service**

Create `desktop/electron/services/skill-repository-upload-service.ts` with:

```ts
import path from "node:path"
import { buildSkillRepositoryManagementUrl, normalizeSkillRepositoryName, type SkillRepositoryDetailDto, type SkillRepositoryImportInput } from "@synapse/shared" with { "resolution-mode": "import" }
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import { AccountAuthenticationRequiredError, accountService } from "./account-service"
import { readSkillDraftFromDirectory, type ContentSkillSourceSecurityDeps } from "./content-skill-source-service"
import { writeSkillRepositoryIdentity, type SkillRepositoryIdentityWriteSecurity } from "./skill-repository-local-identity"

export type SkillRepositoryLocalImportInput = {
  readonly sourceDirectoryPath: string
  readonly repositoryId?: string | null
  readonly name?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly openInBrowser?: boolean
}

export type SkillRepositoryLocalImportResult = {
  readonly repositoryId: string
  readonly name: string
  readonly owner: string | null
  readonly managementUrl: string
}

export class SkillRepositoryUploadService {
  constructor(private readonly deps: {
    readonly accountService?: {
      readonly getState: () => { readonly status: string }
      readonly importSkillRepository: (input: SkillRepositoryImportInput) => Promise<SkillRepositoryDetailDto>
    }
    readonly publicAppUrl?: string
    readonly openExternal?: (url: string) => Promise<void>
    readonly readSkillDraftFromDirectory?: typeof readSkillDraftFromDirectory
    readonly writeIdentity?: typeof writeSkillRepositoryIdentity
  } = {}) {}

  async importLocal(
    input: SkillRepositoryLocalImportInput,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ): Promise<SkillRepositoryLocalImportResult> {
    const account = this.deps.accountService ?? accountService
    if (account.getState().status !== "authenticated") throw new AccountAuthenticationRequiredError()
    const readSource = this.deps.readSkillDraftFromDirectory ?? readSkillDraftFromDirectory
    const source = await readSource(input.sourceDirectoryPath, security)
    if (path.basename(source.mainFilePath) !== "SKILL.md") {
      throw new Error("Skill 必须包含根目录 SKILL.md。")
    }
    const name = normalizeSkillRepositoryName(input.name ?? source.metadata.name ?? path.basename(source.sourceDirectoryPath))
    const repository = await account.importSkillRepository({
      repositoryId: input.repositoryId ?? undefined,
      name,
      title: input.title ?? source.metadata.title ?? name,
      description: input.description ?? source.metadata.description ?? null,
      files: [
        { path: "SKILL.md", contentBase64: Buffer.from(source.content, "utf8").toString("base64"), mimeType: "text/markdown" },
        ...source.files.map((file) => ({
          path: file.originalName,
          contentBase64: Buffer.from(file.bytes ?? new Uint8Array()).toString("base64"),
          mimeType: null,
        })),
      ],
    })
    const managementUrl = buildSkillRepositoryManagementUrl(this.deps.publicAppUrl ?? SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl, repository.id)
    await (this.deps.writeIdentity ?? writeSkillRepositoryIdentity)(source.sourceDirectoryPath, {
      id: repository.id,
      owner: repository.owner.handle,
      name: repository.name,
    }, security)
    if (input.openInBrowser && this.deps.openExternal) await this.deps.openExternal(managementUrl)
    return {
      repositoryId: repository.id,
      name: repository.name,
      owner: repository.owner.handle,
      managementUrl,
    }
  }
}

export const skillRepositoryUploadService = new SkillRepositoryUploadService()
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/skill-repository-local-identity.test.ts electron/services/__tests__/skill-repository-upload-service.test.ts
```

Expected: exit 0.

Commit:

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/skill-repository-local-identity.ts desktop/electron/services/skill-repository-upload-service.ts desktop/electron/services/__tests__/skill-repository-local-identity.test.ts desktop/electron/services/__tests__/skill-repository-upload-service.test.ts
git commit -m "feat: upload local skills to cloud repositories"
```

## Task 7: MCP Skill Repository Domain

**Files:**
- Create: `desktop/synapse-capabilities/shared/skill-repository-domain.ts`
- Create: `desktop/synapse-capabilities/shared/skill-repository-domain.test.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Create: `desktop/electron/capabilities/skill-repository-dispatcher.ts`
- Create: `desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`

- [ ] **Step 1: Write domain registry tests**

```ts
// desktop/synapse-capabilities/shared/skill-repository-domain.test.ts
import { describe, expect, it } from "vitest"
import { MCP_TOOL_ACTIONS, buildAllMcpTools, getActionDomainId } from "./registry"

describe("skill repository MCP domain", () => {
  it("registers cloud skill repository tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("app_skill_repository_import_local")
    expect(toolNames).toContain("app_skill_repository_update_local")
    expect(toolNames).toContain("app_skill_repository_list")
    expect(MCP_TOOL_ACTIONS.app_skill_repository_import_local).toBe("app.skill_repository.item.import_local")
    expect(getActionDomainId("app.skill_repository.item.import_local")).toBe("skill_repository")
  })
})
```

- [ ] **Step 2: Implement the shared domain**

Create `desktop/synapse-capabilities/shared/skill-repository-domain.ts`:

```ts
import type { CapabilityId } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const capabilities: readonly CapabilityDefinition[] = [
  { id: "app.skill_repository.item.list" as CapabilityId, title: "List cloud Skill repositories", description: "List cloud Skill repositories owned by the signed-in user.", mutates: false },
  { id: "app.skill_repository.item.get" as CapabilityId, title: "Get cloud Skill repository", description: "Get one cloud Skill repository owned by the signed-in user.", mutates: false },
  { id: "app.skill_repository.item.import_local" as CapabilityId, title: "Import local Skill to cloud repository", description: "Create a private cloud Skill repository from a local Skill directory.", mutates: true },
  { id: "app.skill_repository.item.update_local" as CapabilityId, title: "Update cloud Skill repository from local Skill", description: "Update an existing owned cloud Skill repository from a local Skill directory.", mutates: true },
  { id: "app.skill_repository.item.open" as CapabilityId, title: "Open cloud Skill repository", description: "Return or open the web management URL for a cloud Skill repository.", mutates: false },
]

export const SKILL_REPOSITORY_DOMAIN: CapabilityDomainDefinition = {
  id: "skill_repository",
  capabilities,
}

export const SKILL_REPOSITORY_MCP_TOOL_ACTIONS: Record<string, string> = {
  app_skill_repository_list: "app.skill_repository.item.list",
  app_skill_repository_get: "app.skill_repository.item.get",
  app_skill_repository_import_local: "app.skill_repository.item.import_local",
  app_skill_repository_update_local: "app.skill_repository.item.update_local",
  app_skill_repository_open: "app.skill_repository.item.open",
}

export function buildSkillRepositoryTools(): McpToolDefinition[] {
  return [
    {
      name: "app_skill_repository_list",
      description: "List private cloud Skill repositories owned by the signed-in user.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "app_skill_repository_get",
      description: "Get one private cloud Skill repository by stable repository id.",
      inputSchema: {
        type: "object",
        properties: { repositoryId: { type: "string", description: "Stable cloud Skill repository id." } },
        required: ["repositoryId"],
      },
    },
    {
      name: "app_skill_repository_import_local",
      description: "Create a private cloud Skill repository from a local Skill directory. Same-name conflicts are not treated as updates.",
      inputSchema: {
        type: "object",
        properties: {
          sourceDirectoryPath: { type: "string", description: "Local Skill directory containing root SKILL.md." },
          name: { type: "string", description: "Optional repository name. Defaults to SKILL.md name metadata or folder name." },
          title: { type: "string", description: "Optional display title." },
          description: { type: "string", description: "Optional description." },
          openInBrowser: { type: "boolean", description: "Open the management URL after upload. Defaults to false." },
        },
        required: ["sourceDirectoryPath"],
      },
    },
    {
      name: "app_skill_repository_update_local",
      description: "Update an owned private cloud Skill repository from a local Skill directory. Requires stable repositoryId.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: { type: "string", description: "Stable cloud Skill repository id to update." },
          sourceDirectoryPath: { type: "string", description: "Local Skill directory containing root SKILL.md." },
          title: { type: "string", description: "Optional display title." },
          description: { type: "string", description: "Optional description." },
          openInBrowser: { type: "boolean", description: "Open the management URL after upload. Defaults to false." },
        },
        required: ["repositoryId", "sourceDirectoryPath"],
      },
    },
    {
      name: "app_skill_repository_open",
      description: "Return the management URL for a cloud Skill repository. When openInBrowser is true, open it in the system browser.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: { type: "string", description: "Stable cloud Skill repository id." },
          openInBrowser: { type: "boolean", description: "Open the URL in the system browser. Defaults to false." },
        },
        required: ["repositoryId"],
      },
    },
  ]
}
```

Update `desktop/synapse-capabilities/shared/registry.ts` by importing this domain, adding it to `CAPABILITY_DOMAINS`, `MCP_TOOL_ACTIONS`, and `buildAllMcpTools()`.

- [ ] **Step 3: Write dispatcher tests**

Create `desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createSkillRepositoryCapabilityDispatcher } from "../skill-repository-dispatcher"

describe("skill repository dispatcher", () => {
  it("imports a local Skill without opening browser by default", async () => {
    const uploadService = { importLocal: vi.fn(async () => ({ repositoryId: "repo-1", name: "demo-skill", owner: "liyang", managementUrl: "https://synapse.example/console/skill-repositories/repo-1" })) }
    const dispatcher = createSkillRepositoryCapabilityDispatcher({
      uploadService,
      accountService: accountService(),
      auditSink: { record: vi.fn() },
      permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) },
    })

    const result = await dispatcher.dispatch("app.skill_repository.item.import_local", { sourceDirectoryPath: "/tmp/demo" }, { source: "mcp-stdio" })

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ repositoryId: "repo-1" }) })
    expect(uploadService.importLocal).toHaveBeenCalledWith({ sourceDirectoryPath: "/tmp/demo", openInBrowser: false }, expect.any(Object))
  })

  it("requires repository id for update", async () => {
    const dispatcher = createSkillRepositoryCapabilityDispatcher({ uploadService: { importLocal: vi.fn() }, accountService: accountService() })

    await expect(dispatcher.dispatch("app.skill_repository.item.update_local", { sourceDirectoryPath: "/tmp/demo" }, { source: "mcp-stdio" }))
      .rejects.toThrow("repositoryId is required")
  })
})

function accountService() {
  return {
    listSkillRepositories: vi.fn(async () => []),
    getSkillRepository: vi.fn(async () => ({ id: "repo-1" })),
  }
}
```

- [ ] **Step 4: Implement dispatcher and router**

Create `desktop/electron/capabilities/skill-repository-dispatcher.ts`:

```ts
import { buildSkillRepositoryManagementUrl } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { accountService } from "../services/account-service"
import { skillRepositoryUploadService, type SkillRepositoryUploadService } from "../services/skill-repository-upload-service"

type Deps = {
  readonly accountService?: Pick<typeof accountService, "listSkillRepositories" | "getSkillRepository">
  readonly uploadService?: Pick<SkillRepositoryUploadService, "importLocal">
  readonly openExternal?: (url: string) => Promise<void>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}

export function createSkillRepositoryCapabilityDispatcher(deps: Deps = {}) {
  const account = deps.accountService ?? accountService
  const upload = deps.uploadService ?? skillRepositoryUploadService
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (action === "app.skill_repository.item.list") {
        return { ok: true, data: await account.listSkillRepositories() }
      }
      if (action === "app.skill_repository.item.get") {
        return { ok: true, data: await account.getSkillRepository(requiredString(params.repositoryId, "repositoryId")) }
      }
      if (action === "app.skill_repository.item.import_local") {
        const security = securityFromDeps(deps, context)
        return { ok: true, data: await upload.importLocal({
          sourceDirectoryPath: requiredString(params.sourceDirectoryPath, "sourceDirectoryPath"),
          name: optionalString(params.name),
          title: optionalString(params.title),
          description: optionalString(params.description),
          openInBrowser: params.openInBrowser === true,
        }, security) }
      }
      if (action === "app.skill_repository.item.update_local") {
        const security = securityFromDeps(deps, context)
        return { ok: true, data: await upload.importLocal({
          repositoryId: requiredString(params.repositoryId, "repositoryId"),
          sourceDirectoryPath: requiredString(params.sourceDirectoryPath, "sourceDirectoryPath"),
          title: optionalString(params.title),
          description: optionalString(params.description),
          openInBrowser: params.openInBrowser === true,
        }, security) }
      }
      if (action === "app.skill_repository.item.open") {
        const repositoryId = requiredString(params.repositoryId, "repositoryId")
        const url = buildSkillRepositoryManagementUrl(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl, repositoryId)
        if (params.openInBrowser === true && deps.openExternal) await deps.openExternal(url)
        return { ok: true, data: { repositoryId, managementUrl: url } }
      }
      throw new Error(`Unknown skill repository action: ${action}`)
    },
  }
}

function securityFromDeps(deps: Deps, context: DispatchContext) {
  if (!deps.auditSink || !deps.permissionGuard) return undefined
  return {
    actor: context.actor ?? { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" },
    auditSink: deps.auditSink,
    permissionGuard: deps.permissionGuard,
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
```

Then update `desktop/electron/capabilities/action-router.ts`.

Add this field to the existing `SynapseActionRouterDeps` type:

```ts
readonly skillRepositoryDispatch: DomainDispatch
```

```ts
if (domainId === "skill_repository") return deps.skillRepositoryDispatch(dispatchAction, params, context)
```

No legacy action mapping is needed for this new domain.

Update `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { createSkillRepositoryCapabilityDispatcher } from "../capabilities/skill-repository-dispatcher"
```

Create the dispatcher near the Drive dispatcher:

```ts
const skillRepositoryDispatcher = createSkillRepositoryCapabilityDispatcher({
  accountService,
  permissionGuard,
  auditSink,
})
```

Pass it into `createSynapseActionRouter`:

```ts
skillRepositoryDispatch: (action, params, context) => skillRepositoryDispatcher.dispatch(action, params, context),
```

- [ ] **Step 5: Run MCP tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run synapse-capabilities/shared/skill-repository-domain.test.ts electron/capabilities/__tests__/skill-repository-dispatcher.test.ts electron/capabilities/__tests__/action-router.test.ts
```

Expected: exit 0.

Commit:

```bash
git add desktop/synapse-capabilities/shared/skill-repository-domain.ts desktop/synapse-capabilities/shared/skill-repository-domain.test.ts desktop/synapse-capabilities/shared/registry.ts desktop/electron/capabilities/skill-repository-dispatcher.ts desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "feat: add skill repository mcp tools"
```

## Task 8: Built-In Skill Docs And Release Notes

**Files:**
- Create: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
- Create: `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/content.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add domain docs**

Create `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`:

```md
# Skill Repository

Use this domain for cloud Skill repositories.

Use `app_skill_repository_import_local` when the user already has a local Skill folder and wants to upload it as a private cloud Skill repository. Use `app_skill_repository_update_local` only when the target cloud `repositoryId` is known. Same-name uploads without a stable repository id must be treated as conflicts by the server.

Do not use the local Resource Repository tools for cloud Skill Repository work. `app_resource_repository_*` remains the local Rule, Skill, and Prompt repository domain.

The cloud repository system in this phase stores private Skill repositories only. Public browsing, fork, and install deep links use later Skill Repository tools.
```

Create `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`:

```md
# Skill Repository API Reference

## Tools

### app_skill_repository_list

Lists private cloud Skill repositories owned by the signed-in user.

### app_skill_repository_get

Inputs:

- `repositoryId`: stable cloud Skill repository id.

Returns repository metadata and current file metadata.

### app_skill_repository_import_local

Inputs:

- `sourceDirectoryPath`: local Skill directory containing root `SKILL.md`.
- `name`: optional repository name.
- `title`: optional display title.
- `description`: optional description.
- `openInBrowser`: optional boolean, default false.

Creates a private cloud Skill repository. Same-name conflicts are returned as `SKILL_REPOSITORY_NAME_CONFLICT`.

### app_skill_repository_update_local

Inputs:

- `repositoryId`: stable cloud Skill repository id.
- `sourceDirectoryPath`: local Skill directory containing root `SKILL.md`.
- `title`: optional display title.
- `description`: optional description.
- `openInBrowser`: optional boolean, default false.

Updates the owned target repository. Do not call this tool without a confirmed `repositoryId`.

### app_skill_repository_open

Inputs:

- `repositoryId`: stable cloud Skill repository id.
- `openInBrowser`: optional boolean, default false.

Returns the management URL. Opens the system browser only when `openInBrowser` is true.

## Structured Errors

- `USER_HANDLE_REQUIRED`
- `SKILL_REPOSITORY_NAME_CONFLICT`
- `SKILL_REPOSITORY_FORBIDDEN`
- `SKILL_REPOSITORY_NOT_FOUND`
- `SKILL_REPOSITORY_INVALID_SKILL`
```

- [ ] **Step 2: Link docs from `content.md`**

Add a short entry to `desktop/resources/templates/skills/synapse-skill/content.md` that points to `files/skill-repository/index.md` and names the new MCP tools.

- [ ] **Step 3: Add release notes**

Append to `RELEASE_NOTES_PENDING.md`:

```md
- Added the first private cloud Skill Repository foundation: users can set a username, and Agents can upload an existing local Skill folder into a private cloud Skill repository through the new MCP tools.
```

- [ ] **Step 4: Commit**

```bash
git add desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md desktop/resources/templates/skills/synapse-skill/content.md RELEASE_NOTES_PENDING.md
git commit -m "docs: document skill repository mcp tools"
```

## Task 9: Phase 1 Verification

**Files:**
- Verify all files touched in Tasks 1 through 8.

- [ ] **Step 1: Run focused test suites**

```bash
pnpm --filter @synapse/shared exec vitest run src/skill-repository.test.ts
pnpm --filter @synapse/server exec vitest run src/auth/user-auth.service.spec.ts src/dashboard/dashboard.controller.spec.ts src/skill-repository/skill-repository.service.spec.ts src/skill-repository/skill-repository.controller.spec.ts src/app.module.spec.ts
pnpm --filter @synapse/dashboard exec vitest run src/features/settings/profile-settings.test.tsx
pnpm --filter @synapse/desktop exec vitest run synapse-capabilities/shared/skill-repository-domain.test.ts electron/services/__tests__/skill-repository-local-identity.test.ts electron/services/__tests__/skill-repository-upload-service.test.ts electron/capabilities/__tests__/skill-repository-dispatcher.test.ts electron/capabilities/__tests__/action-router.test.ts
```

Expected: all focused suites exit 0.

- [ ] **Step 2: Run typechecks**

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/desktop run typecheck
```

Expected: all typecheck commands exit 0.

- [ ] **Step 3: Check generated MCP tool list**

```bash
pnpm --filter @synapse/desktop exec vitest run synapse-capabilities/shared/skill-repository-domain.test.ts
```

Expected: `app_skill_repository_import_local`, `app_skill_repository_update_local`, `app_skill_repository_list`, `app_skill_repository_get`, and `app_skill_repository_open` are in `buildAllMcpTools()`.

- [ ] **Step 4: Inspect git diff for scope**

```bash
git status --short
git diff --stat HEAD
```

Expected: only files listed in this plan changed after the most recent task commit.

- [ ] **Step 5: Leave the working tree clean**

Run:

```bash
git status --short
```

Expected: no output after the task commits above. If verification exposed a defect, return to the task that introduced it, make the exact fix there, rerun that task's tests, and commit those exact files with that task's commit message style.

## Requirement Coverage

- Cloud store supports only Skill: Tasks 1, 4, 5, 6, 7.
- No publish/review/release/version history in Phase 1: Tasks 4 and 5 expose import/list/get only.
- Stable repo id separate from owner/name/local directory: Tasks 1, 2, 4, 6.
- User handle added, changeable, old handle reserved: Tasks 2 and 3.
- Same-name upload does not auto-update without repo id: Task 4 service tests and Task 7 MCP docs.
- MCP import local is primary creation path: Tasks 6 and 7.
- Successful upload writes `.synapse.json`: Task 6.
- MCP upload does not open browser unless requested: Tasks 6 and 7.
- Desktop remains a bridge, not a manager: Tasks 6 and 7 expose upload/list/get/open metadata only.
- Existing local Resource Repository remains distinct: Task 7 uses `app.skill_repository.*`, not `app.resource_repository.*`.
- Built-in `synapse-skill` docs updated: Task 8.
- User-visible change recorded for release notes: Task 8.
