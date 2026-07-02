# Skill Repository Phase 3 Public Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the public consumption loop for cloud Skill repositories: public visibility, Explore, canonical `ownerHandle/repoName` pages, fork, install sessions, and Desktop `synapse://skill-install` installation.

**Architecture:** Extend the Phase 2 private repository model with public read paths and explicit owner mutations. Public users can read, fork, and install active public repositories. Fork creates an independent private repository copy. Install sessions snapshot the current file tree into an export zip under Content Store storage and are consumed by a new Desktop skill install protocol/service that reuses the existing installer flow. Existing `synapse://content-install` behavior remains compatible and unchanged.

**Tech Stack:** NestJS, Prisma, Zod, Content Store storage port, `@synapse/shared`, React, TanStack Router/Query, shadcn/ui, Electron protocol router/IPC, existing shared installer flow, Vitest, TypeScript.

---

## Scope Check

### In Scope

- Add public visibility as a real supported state for Skill repositories.
- Require a user handle before a repository can become public; return `USER_HANDLE_REQUIRED` with settings URL metadata when missing.
- Add public Explore list and public repository lookup by `ownerHandle/repoName`.
- Preserve stable id-based management routes for owner editing.
- Support canonical path redirects after owner handle or repository name changes.
- Add public file browsing and file content read for active public repositories.
- Add fork for signed-in users to copy a public repository into their own private repository.
- Add install sessions for active public repositories and owner-owned repositories.
- Add export zip generation for the current repository file tree.
- Add Desktop `synapse://skill-install?session=...` protocol handling.
- Add Desktop skill repository install service, IPC, window/page hook, and installer source conversion.
- Add dashboard Install and Fork actions on public repository pages.
- Update Skill Repository MCP capability docs and dispatcher actions for public open/fork/install entry points.
- Update release notes for user-visible behavior.

### Out Of Scope

- Migrating legacy Content Store skill data into Skill repositories.
- Removing or hiding old Prompt/Rule Content Store surfaces.
- Rewriting old `synapse://content-install` endpoints.
- Version history, releases, rollback, pinned versions, or install specified version.
- Pull requests, comments, ratings, stars, tags, or team collaboration.
- Admin moderation UI beyond respecting existing `status: "removed"` visibility.
- Cloud-side creation of empty Skill repositories.

---

## File Structure

### Shared Contracts

- `shared/src/skill-repository.ts`
- `shared/src/skill-repository.test.ts`

### Server

- `server/prisma/schema.prisma`
- `server/prisma/migrations/20260702000000_skill_repository_install_sessions/migration.sql`
- `server/src/skill-repository/skill-repository.controller.ts`
- `server/src/skill-repository/skill-repository.service.ts`
- `server/src/skill-repository/skill-repository.types.ts`
- `server/src/skill-repository/skill-repository-install-package.ts`
- `server/src/skill-repository/skill-repository-install-package.spec.ts`
- `server/src/skill-repository/skill-repository.service.spec.ts`
- `server/src/skill-repository/skill-repository.controller.spec.ts`
- `server/src/app.module.spec.ts`

### Dashboard

- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/api.test.ts`
- `dashboard/src/features/skill-repository/skill-repository-api.ts`
- `dashboard/src/features/skill-repository/skill-repository-detail-page.tsx`
- `dashboard/src/features/skill-repository/skill-repository-explore-page.tsx`
- `dashboard/src/features/skill-repository/skill-repository-public-page.tsx`
- `dashboard/src/features/skill-repository/skill-repository-settings-panel.tsx`
- `dashboard/src/features/skill-repository/use-skill-repository-detail.ts`
- `dashboard/src/features/skill-repository/use-skill-repository-actions.ts`
- `dashboard/src/features/skill-repository/index.ts`
- `dashboard/src/routes/_authenticated/skill-repositories/explore.tsx`
- `dashboard/src/routes/_authenticated/skills/$ownerHandle/$repositoryName.tsx`
- `dashboard/src/routes/_authenticated/skill-repositories/$repositoryId.tsx`
- `dashboard/src/components/layout/data/sidebar-data.ts`

### Desktop

- `desktop/src/lib/skill-repository-install-window.ts`
- `desktop/src/types/skill-repository-install.ts`
- `desktop/electron/bootstrap/protocol-router.ts`
- `desktop/electron/bootstrap/protocol-router.test.ts`
- `desktop/electron/services/skill-repository-install-service.ts`
- `desktop/electron/services/__tests__/skill-repository-install-service.test.ts`
- `desktop/electron/services/skill-repository-install-window-service.ts`
- `desktop/electron/services/__tests__/skill-repository-install-window-service.test.ts`
- `desktop/electron/modules/skill-repository-install/ipc.ts`
- `desktop/electron/modules/skill-repository-install/__tests__/ipc.test.ts`
- `desktop/src/app-shell/skill-repository-install.ts`
- `desktop/src/modules/skill-repository-install/use-skill-repository-install.ts`
- `desktop/src/modules/skill-repository-install/skill-repository-install-window-page.tsx`
- Desktop bootstrap/module registry files that currently register `content-store-install` IPC and window services.

### MCP And Built-In Skill Docs

- `desktop/electron/capabilities/skill-repository-dispatcher.ts`
- `desktop/electron/capabilities/__tests__/skill-repository-dispatcher.test.ts`
- `desktop/electron/capabilities/action-router.ts`
- `desktop/electron/capabilities/__tests__/action-router.test.ts`
- `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
- `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`

### Release Notes

- `RELEASE_NOTES_PENDING.md`

---

## Data And Contract Decisions

### Public Identity

- Public URL identity is `owner.handle + repository.name`.
- Management and mutations continue to use stable `repository.id`.
- Public pages must load through a by-path API and receive canonical path metadata.
- If `User.handle` is missing, owner can keep private repositories but cannot make them public.
- Existing `UserHandleRedirect` and `SkillRepositoryNameRedirect` support redirect resolution.

### Permission Rules

- Owner can read and mutate their active private or public repositories.
- Any signed-in user can read active public repositories.
- Any signed-in user can fork active public repositories.
- Any signed-in user can install active public repositories.
- Owners can install their own private repositories.
- Removed repositories are hidden from public and owner normal flows unless a future admin flow explicitly restores them.

### Install Package Shape

Use a Skill Repository-specific manifest, not the old Content Store manifest:

```ts
export interface SkillRepositoryInstallManifest {
  readonly schemaVersion: 1
  readonly repositoryId: string
  readonly repositoryName: string
  readonly ownerHandle: string
  readonly title: string
  readonly mainFile: "content/SKILL.md"
  readonly files: readonly {
    readonly path: string
    readonly size: number
    readonly sha256: string
    readonly kind: "text" | "binary"
  }[]
}
```

Zip layout:

```text
manifest.json
content/SKILL.md
content/<other files>
```

Desktop validates safe paths, manifest hash data, package hash, file hashes, total size, per-file size, file count, zip limits, and required `content/SKILL.md`.

---

## Implementation Tasks

### 1. Extend Shared Skill Repository Contracts

- [ ] Add Phase 3 DTOs and helpers to `shared/src/skill-repository.ts`.

Add these exports:

```ts
export const defaultSkillRepositoryInstallDeepLinkBase = "synapse://skill-install"

export interface SkillRepositoryPublicListInput {
  readonly page?: number
  readonly pageSize?: number
  readonly query?: string | null
}

export interface SkillRepositoryListResultDto {
  readonly items: readonly SkillRepositoryItemDto[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

export interface SkillRepositoryPublicPathDto {
  readonly repository: SkillRepositoryDetailDto
  readonly canonicalPath: {
    readonly ownerHandle: string
    readonly repositoryName: string
  }
  readonly redirected: boolean
}

export interface SkillRepositoryForkInput {
  readonly name?: string | null
  readonly title?: string | null
}

export interface SkillRepositoryForkResultDto {
  readonly repository: SkillRepositoryDetailDto
  readonly managementUrl: string | null
}

export interface SkillRepositoryInstallSessionDto {
  readonly id: string
  readonly repositoryId: string
  readonly repositoryName: string
  readonly ownerHandle: string
  readonly title: string
  readonly expiresAt: string
  readonly deepLinkUrl: string
}

export interface SkillRepositoryResolvedInstallSessionDto {
  readonly id: string
  readonly repository: SkillRepositoryItemDto
  readonly packageSha256: string
  readonly packageSize: number
  readonly expiresAt: string
}
```

- [ ] Extend `SkillRepositoryUpdateInput` with `visibility?: SkillRepositoryVisibility`.
- [ ] Add error code `SKILL_REPOSITORY_INSTALL_SESSION_NOT_FOUND`.
- [ ] Add helpers:

```ts
export function buildSkillRepositoryPublicUrl(publicAppUrl: string, ownerHandle: string, repositoryName: string): string
export function buildSkillRepositorySettingsUrl(publicAppUrl: string): string
```

- [ ] Update `shared/src/skill-repository.test.ts` for handle normalization, public URL building, settings URL building, and default deep link generation.

Run:

```bash
pnpm --filter @synapse/shared test -- skill-repository
```

### 2. Add Install Session Persistence

- [ ] Add Prisma model to `server/prisma/schema.prisma`.

```prisma
model SkillRepositoryInstallSession {
  id                String          @id @default(cuid())
  userId            String
  repositoryId      String
  packageStorageKey String
  packageSha256     String          @db.VarChar(64)
  packageSize       BigInt
  expiresAt         DateTime
  consumedAt        DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  user              User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  repository        SkillRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@index([repositoryId, createdAt])
  @@index([expiresAt])
}
```

- [ ] Add `installSessions SkillRepositoryInstallSession[]` relation to `User` and `SkillRepository`.
- [ ] Create `server/prisma/migrations/20260702000000_skill_repository_install_sessions/migration.sql`.

Migration SQL:

```sql
CREATE TABLE "SkillRepositoryInstallSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "packageStorageKey" TEXT NOT NULL,
  "packageSha256" VARCHAR(64) NOT NULL,
  "packageSize" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepositoryInstallSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkillRepositoryInstallSession_userId_expiresAt_idx"
  ON "SkillRepositoryInstallSession"("userId", "expiresAt");
CREATE INDEX "SkillRepositoryInstallSession_repositoryId_createdAt_idx"
  ON "SkillRepositoryInstallSession"("repositoryId", "createdAt");
CREATE INDEX "SkillRepositoryInstallSession_expiresAt_idx"
  ON "SkillRepositoryInstallSession"("expiresAt");

ALTER TABLE "SkillRepositoryInstallSession"
  ADD CONSTRAINT "SkillRepositoryInstallSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkillRepositoryInstallSession"
  ADD CONSTRAINT "SkillRepositoryInstallSession_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] Run Prisma generation/checks used by the repo.

Run:

```bash
pnpm --filter @synapse/server prisma:generate
pnpm --filter @synapse/server test -- app.module
```

### 3. Add Public Read And Visibility Service Methods

- [ ] In `server/src/skill-repository/skill-repository.service.ts`, replace private-only assumptions with explicit access helpers:

```ts
private async findOwnedActiveRepository(ownerUserId: string, repositoryId: string)
private async findReadableActiveRepository(userId: string, repositoryId: string)
private async requireOwnedActiveRepository(ownerUserId: string, repositoryId: string)
private async requireReadableActiveRepository(userId: string, repositoryId: string)
```

- [ ] Keep mutation methods owner-only.
- [ ] Allow owner `getMine` to load both private and public active repositories.
- [ ] Add `listPublic(input)` returning only `visibility: "public"` and `status: "active"`.
- [ ] Add `getPublicByPath(userId, ownerHandle, repositoryName)`:
  - Normalize handle and repository name.
  - Resolve `UserHandleRedirect` when direct handle lookup misses.
  - Resolve `SkillRepositoryNameRedirect` for that owner when direct repository name lookup misses.
  - Return `redirected: true` and canonical handle/name when either redirect was used.
  - Only return active public repositories.
- [ ] Add read-only public file content support by calling the same storage reader after `requireReadableActiveRepository`.
- [ ] Add visibility update:
  - `private -> public` requires owner `User.handle`.
  - `public -> private` allowed for owner.
  - Name changes still create name redirects.
  - Public URL canonical metadata stays derived from current owner handle and repository name.

Tests in `server/src/skill-repository/skill-repository.service.spec.ts`:

- [ ] Owner can read own public repository by id.
- [ ] Non-owner cannot read private repository.
- [ ] Signed-in non-owner can read public repository by id.
- [ ] Public list excludes private and removed repositories.
- [ ] Public by-path resolves direct handle/name.
- [ ] Public by-path resolves handle redirect.
- [ ] Public by-path resolves repository name redirect.
- [ ] Private-to-public without handle throws `USER_HANDLE_REQUIRED`.
- [ ] Public-to-private succeeds for owner.

Run:

```bash
pnpm --filter @synapse/server test -- skill-repository.service
```

### 4. Add Public Controller Routes

- [ ] Update `server/src/skill-repository/skill-repository.controller.ts` with these routes:

```ts
GET    /api/skill-repositories
GET    /api/skill-repositories/by-path/:ownerHandle/:repositoryName
GET    /api/skill-repositories/by-path/:ownerHandle/:repositoryName/files/content
PATCH  /api/skill-repositories/:id
```

- [ ] Keep existing owner management routes unchanged:

```ts
GET    /api/skill-repositories/mine
GET    /api/skill-repositories/:id
PUT    /api/skill-repositories/:id/files/text
POST   /api/skill-repositories/:id/files
PATCH  /api/skill-repositories/:id/files/rename
DELETE /api/skill-repositories/:id/files
POST   /api/skill-repositories/import
```

- [ ] Parse list query as:

```ts
const publicListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(120).optional(),
}).strict()
```

- [ ] Extend update schema with `visibility`.
- [ ] Add controller tests for public list, by-path, public file content, and visibility validation.

Run:

```bash
pnpm --filter @synapse/server test -- skill-repository.controller
```

### 5. Implement Fork

- [ ] Add `forkRepository(userId, sourceRepositoryId, input)` to `SkillRepositoryService`.
- [ ] Source must be active public unless owner is forking their own private repository; owner-private fork is optional for UI but useful for API consistency.
- [ ] Destination owner must be current user.
- [ ] Destination starts as `visibility: "private"`, `status: "active"`, `forkedFromRepositoryId: sourceRepositoryId`.
- [ ] Destination name:
  - Use `input.name` when present.
  - Otherwise use source `name`.
  - On conflict, append `-fork`, then `-fork-2`, `-fork-3`, continuing until available.
  - Always pass through `normalizeSkillRepositoryName`.
- [ ] Copy each file object to a new storage key:

```text
skill-repositories/{newRepositoryId}/files/{newFileId}/{sha256}
```

- [ ] Reuse the existing storage port: read source object bytes, write destination object bytes.
- [ ] Do not share file rows or storage keys between source and fork.
- [ ] Create cleanup tasks if any destination object was written and the transaction fails after object upload.
- [ ] Add route:

```ts
POST /api/skill-repositories/:id/fork
```

Tests:

- [ ] Fork public repository copies metadata and files.
- [ ] Fork defaults to private.
- [ ] Fork records `forkedFromRepositoryId`.
- [ ] Fork chooses unique name when current user already has the source name.
- [ ] Fork rejects private repository from another user.
- [ ] Fork rejects removed repository.

Run:

```bash
pnpm --filter @synapse/server test -- skill-repository.service
pnpm --filter @synapse/server test -- skill-repository.controller
```

### 6. Implement Server Install Package Builder

- [ ] Create `server/src/skill-repository/skill-repository-install-package.ts`.
- [ ] Export a builder that accepts repository dto, ordered file rows, and a storage reader.
- [ ] Build a zip with deterministic file order:
  - `manifest.json`
  - `content/SKILL.md`
  - remaining files sorted by normalized path.
- [ ] Validate:
  - Required root `SKILL.md`.
  - Safe normalized relative paths.
  - File count <= `skillRepositoryMaxFileCount`.
  - Total bytes <= `skillRepositoryMaxTotalBytes`.
  - Each file size <= `skillRepositoryMaxFileBytes`.
  - SHA-256 of storage bytes matches file row.
- [ ] Return:

```ts
{
  packageBuffer: Buffer
  packageSha256: string
  packageSize: number
}
```

Tests in `skill-repository-install-package.spec.ts`:

- [ ] Creates manifest and content files.
- [ ] Rejects missing `SKILL.md`.
- [ ] Rejects unsafe paths.
- [ ] Rejects hash mismatch.
- [ ] Produces deterministic package hash for same file input.

Run:

```bash
pnpm --filter @synapse/server test -- skill-repository-install-package
```

### 7. Implement Install Session Lifecycle

- [ ] Add service methods:

```ts
createInstallSession(userId: string, repositoryId: string, deepLinkBase?: string): Promise<SkillRepositoryInstallSessionDto>
resolveInstallSession(userId: string, sessionId: string): Promise<SkillRepositoryResolvedInstallSessionDto>
openInstallPackage(userId: string, sessionId: string): Promise<{ stream: NodeJS.ReadableStream; packageSha256: string; packageSize: number }>
recordInstall(userId: string, sessionId: string, clientInstanceId: string): Promise<{ ok: true }>
cleanupExpiredInstallSessions(now = new Date()): Promise<number>
```

- [ ] Session TTL should match the existing Content Store install session TTL unless that constant is private; if private, define the same 15 minute TTL locally in the skill repository service with a clear constant name.
- [ ] Store export zip under:

```text
skill-repositories/{repositoryId}/exports/{sessionId}.zip
```

- [ ] `createInstallSession` can be called by:
  - Any signed-in user for active public repositories.
  - Owner for own active private/public repositories.
- [ ] `resolveInstallSession`, `openInstallPackage`, and `recordInstall` require the same user who created the session.
- [ ] `recordInstall` writes or reuses `SkillRepositoryInstallEvent` with unique `(userId, repositoryId, clientInstanceId)`.
- [ ] Expired sessions cannot resolve, download, or complete.
- [ ] Add controller routes:

```ts
POST /api/skill-repositories/:id/install-sessions
GET  /api/skill-repositories/install-sessions/:id
GET  /api/skill-repositories/install-sessions/:id/package
POST /api/skill-repositories/install-sessions/:id/complete
```

- [ ] Add complete body schema:

```ts
z.object({
  clientInstanceId: z.string().trim().min(1).max(128),
}).strict()
```

Tests:

- [ ] Public repository creates deep link `synapse://skill-install?session=...`.
- [ ] Private repository install session allowed for owner.
- [ ] Private repository install session rejected for non-owner.
- [ ] Resolve returns package hash and size.
- [ ] Package route streams stored zip.
- [ ] Complete is idempotent for same client instance.
- [ ] Expired sessions are rejected and cleanup deletes expired rows.

Run:

```bash
pnpm --filter @synapse/server test -- skill-repository.service
pnpm --filter @synapse/server test -- skill-repository.controller
```

### 8. Wire Dashboard API Client

- [ ] Update `dashboard/src/lib/api.ts` with methods:

```ts
listPublicSkillRepositories(query)
getSkillRepositoryByPath(ownerHandle, repositoryName)
getSkillRepositoryFileContentByPath(ownerHandle, repositoryName, path)
forkSkillRepository(repositoryId, input)
createSkillRepositoryInstallSession(repositoryId)
```

- [ ] Ensure `updateSkillRepository` accepts `visibility`.
- [ ] Add API tests in `dashboard/src/lib/api.test.ts` for exact paths:

```text
GET  /api/skill-repositories?page=1&pageSize=20&query=...
GET  /api/skill-repositories/by-path/:ownerHandle/:repositoryName
GET  /api/skill-repositories/by-path/:ownerHandle/:repositoryName/files/content?path=...
POST /api/skill-repositories/:id/fork
POST /api/skill-repositories/:id/install-sessions
PATCH /api/skill-repositories/:id
```

Run:

```bash
pnpm --filter @synapse/server-dashboard test -- api
```

### 9. Add Dashboard Explore Page

- [ ] Create `dashboard/src/features/skill-repository/skill-repository-explore-page.tsx`.
- [ ] Route it at `dashboard/src/routes/_authenticated/skill-repositories/explore.tsx`.
- [ ] Use existing shadcn components and Tailwind tokens only.
- [ ] Keep layout utilitarian:
  - Header row with title `Explore`.
  - Search input.
  - Table/list rows with `owner / name`, title, description, updated time, and actions.
  - No marketing copy, no feature explanation paragraph, no gradients, no nested cards.
- [ ] Each row links to `/skills/$ownerHandle/$repositoryName`.
- [ ] Add sidebar or local navigation entry only if existing Phase 2 navigation has a natural Skill Repository section; otherwise expose Explore from the Skill Repository list page.
- [ ] Add loading, error, empty, and pagination states.

Tests:

- [ ] Explore page calls public list API.
- [ ] Search query updates request state.
- [ ] Empty state is concise and actionable.

Run:

```bash
pnpm --filter @synapse/server-dashboard test -- skill-repository
```

### 10. Add Public Repository Page

- [ ] Create `dashboard/src/features/skill-repository/skill-repository-public-page.tsx`.
- [ ] Route it at `dashboard/src/routes/_authenticated/skills/$ownerHandle/$repositoryName.tsx`.
- [ ] Reuse Phase 2 file browser and code renderer.
- [ ] Public page top bar:

```text
owner / repoName    visibility badge    Install    Fork
```

- [ ] Show Settings only when current user is owner and route can safely link to `/skill-repositories/$repositoryId`.
- [ ] If API returns `redirected: true`, navigate to canonical `/skills/$canonicalOwnerHandle/$canonicalRepositoryName` using TanStack router replace.
- [ ] Public read-only file content uses by-path file content endpoint.
- [ ] Do not show edit, upload, rename, or delete controls for non-owner public route.
- [ ] Owner public route can still use the read-only public page; actual editing happens on management id route.

Tests:

- [ ] Public route renders repository title and file tree.
- [ ] Canonical redirect replaces route.
- [ ] Non-owner route hides management controls.
- [ ] Owner route shows Settings link.

Run:

```bash
pnpm --filter @synapse/server-dashboard test -- skill-repository
```

### 11. Add Visibility Settings And Missing Handle Flow

- [ ] Update `dashboard/src/features/skill-repository/skill-repository-settings-panel.tsx`.
- [ ] Add a visibility control with private/public choices.
- [ ] On public selection, call `PATCH /api/skill-repositories/:id` with `visibility: "public"`.
- [ ] If server returns `USER_HANDLE_REQUIRED`, show a concise inline error and a button to profile/settings username route.
- [ ] Use the existing user/settings route after confirming the current dashboard route name in the repo; do not invent a new settings page.
- [ ] After successful public change, show/copy canonical public URL if owner handle is available.
- [ ] Keep repository name editing and visibility editing in one settings panel, not separate modal stacks.

Tests:

- [ ] Visibility mutation sends only changed fields.
- [ ] Missing handle error renders settings action.
- [ ] Public URL uses current owner handle and repository name.

Run:

```bash
pnpm --filter @synapse/server-dashboard test -- skill-repository
```

### 12. Add Dashboard Fork And Install Actions

- [ ] Create `dashboard/src/features/skill-repository/use-skill-repository-actions.ts`.
- [ ] Implement `forkSkillRepository` mutation:
  - Triggered from public page action.
  - On success, navigate to management route `/skill-repositories/$repositoryId`.
  - Show concise success/error toast using existing toast system.
- [ ] Implement `createInstallSession` mutation:
  - Triggered from public page and owner management page.
  - On success, set `window.location.href = deepLinkUrl`.
  - Provide fallback link display only if the browser blocks the protocol open; keep text short.
- [ ] Disable buttons while mutation is pending.
- [ ] Do not add custom styling or explanatory copy.

Tests:

- [ ] Fork calls API and navigates to new repository.
- [ ] Install calls API and opens deep link.
- [ ] Pending state disables repeated clicks.

Run:

```bash
pnpm --filter @synapse/server-dashboard test -- skill-repository
```

### 13. Add Desktop Skill Install Protocol Parser

- [ ] Create `desktop/src/lib/skill-repository-install-window.ts`.
- [ ] Mirror the minimal shape of `content-store-install-window` with skill-specific names.
- [ ] Export:

```ts
export function parseSkillRepositoryInstallProtocolUrl(rawUrl: string): SynapseSkillRepositoryInstallWindowRequest | null
export function buildSkillRepositoryInstallWindowSearchParams(request: SynapseSkillRepositoryInstallWindowRequest): URLSearchParams
```

- [ ] Add type in `desktop/src/types/skill-repository-install.ts`:

```ts
export interface SynapseSkillRepositoryInstallWindowRequest {
  readonly sessionId: string
}
```

- [ ] Update `desktop/electron/bootstrap/protocol-router.ts`:
  - Recognize both `synapse://content-install` and `synapse://skill-install`.
  - Route content install to existing content install window.
  - Route skill install to new skill repository install window.
  - Keep `shouldCreateMainWindowBeforeStart` false when the only pending URL is either install protocol.
- [ ] Adjust dependency type to accept `openSkillRepositoryInstallWindow`.
- [ ] Keep warning messages specific enough for invalid content vs invalid skill install URLs.

Tests in `desktop/electron/bootstrap/protocol-router.test.ts`:

- [ ] Parses and routes valid `synapse://skill-install?session=session-1`.
- [ ] Ignores invalid skill install URL and focuses main window.
- [ ] Existing content install tests still pass.
- [ ] Initial skill install URL does not force main window creation.

Run:

```bash
pnpm --filter @synapse/desktop test -- protocol-router
```

### 14. Add Desktop Skill Repository Install Service

- [ ] Create `desktop/electron/services/skill-repository-install-service.ts`.
- [ ] Reuse validation patterns from `ContentStoreInstallService`; extract common zip helpers only if that keeps changes smaller than copy-maintaining the existing validated logic.
- [ ] Service endpoints:

```text
GET  /skill-repositories/install-sessions/:id
GET  /skill-repositories/install-sessions/:id/package
POST /skill-repositories/install-sessions/:id/complete
```

- [ ] Prepare a skill installer source from the package:

```ts
{
  sourceKind: "skill-repository",
  repositoryId,
  repositoryName,
  ownerHandle,
  title,
  mainFile,
  mainContent,
  files
}
```

- [ ] Convert prepared source into the existing installer source shape expected by `contentInstallService.setPreparedSourceProvider` or extend the provider abstraction so both content store and skill repository providers can be registered without breaking Content Store install.
- [ ] Metadata used by installed skill should be:
  - `category: "skill-repository"`
  - `createdBy: "skill-repository"`
  - `modifiedBy: "skill-repository"`
  - Cloud identity should include `repositoryId` when the installer has an existing identity field for cloud skill repositories.
- [ ] Validate:
  - Package hash from resolve endpoint matches downloaded zip hash.
  - Manifest schema is Skill Repository manifest, not Content Store manifest.
  - Required `content/SKILL.md`.
  - Safe paths.
  - File hashes.
  - Size and count limits.
- [ ] Complete install with `clientInstanceId`.

Tests in `desktop/electron/services/__tests__/skill-repository-install-service.test.ts`:

- [ ] Resolve calls correct endpoint.
- [ ] Prepare downloads and validates package.
- [ ] Prepare rejects package hash mismatch.
- [ ] Prepare rejects missing `content/SKILL.md`.
- [ ] Prepare rejects unsafe path.
- [ ] Complete calls correct endpoint with client instance id.

Run:

```bash
pnpm --filter @synapse/desktop test -- skill-repository-install-service
```

### 15. Add Desktop Skill Install Window And IPC

- [ ] Create `desktop/electron/services/skill-repository-install-window-service.ts`.
- [ ] Create `desktop/electron/modules/skill-repository-install/ipc.ts`.
- [ ] Add IPC channels:

```text
synapse:skill-repository-install:resolve
synapse:skill-repository-install:prepare
synapse:skill-repository-install:record-complete
```

- [ ] Add app-shell bridge module `desktop/src/app-shell/skill-repository-install.ts`.
- [ ] Create renderer hook `desktop/src/modules/skill-repository-install/use-skill-repository-install.ts`.
- [ ] Create page `desktop/src/modules/skill-repository-install/skill-repository-install-window-page.tsx`.
- [ ] Reuse `SharedInstallerFlow`.
- [ ] Window title should be `Install Skill`.
- [ ] Keep UI text minimal: repository title, owner/name, install status, cancel/confirm actions.
- [ ] Register IPC/window service in the same bootstrap/module registry location as `content-store-install`.
- [ ] Preserve existing `content-store-install` window and route.

Tests:

- [ ] IPC validates required session id.
- [ ] Window service loads renderer with skill install session query.
- [ ] Renderer hook calls resolve, prepare, and record complete channels.

Run:

```bash
pnpm --filter @synapse/desktop test -- skill-repository-install
```

### 16. Update MCP Capability Dispatcher And Built-In Skill Docs

- [ ] Add actions in `desktop/electron/capabilities/skill-repository-dispatcher.ts`:

```text
app.skill_repository.item.open_public
app.skill_repository.item.fork
app.skill_repository.item.create_install_session
```

- [ ] `open_public` accepts either:
  - `repositoryId` for owned/readable repository lookup, or
  - `ownerHandle` + `repositoryName` for public path URL.
- [ ] `fork` accepts `repositoryId`, optional `name`, optional `title`, and calls account service endpoint.
- [ ] `create_install_session` accepts `repositoryId` and returns `deepLinkUrl`.
- [ ] Extend account service port in dispatcher only as far as needed; implement actual account service methods in `desktop/electron/services/account-service.ts` if missing.
- [ ] Audit/permission behavior:
  - Opening URLs may call `openExternal` only when `openInBrowser === true`.
  - Fork and install session are authenticated server operations; surface server errors directly.
- [ ] Update action router tests so `app.skill_repository.item.*` actions continue routing to this dispatcher.
- [ ] Update built-in Synapse Skill docs:
  - `desktop/resources/templates/skills/synapse-skill/files/skill-repository/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/skill-repository/api-reference.md`
- [ ] Mention:
  - Local import/update remains the way to publish from local Skill folders.
  - Public sharing requires setting repository visibility on the web page.
  - Missing username means the user must set a handle in account settings.
  - Fork creates a private independent copy.
  - Install session returns a Desktop deep link.

Tests:

- [ ] Dispatcher lists existing private repositories.
- [ ] Dispatcher opens public URL.
- [ ] Dispatcher creates fork with optional name.
- [ ] Dispatcher creates install session.
- [ ] Unknown action remains rejected.

Run:

```bash
pnpm --filter @synapse/desktop test -- skill-repository-dispatcher action-router
```

### 17. Update Release Notes And Guardrails

- [ ] Update `RELEASE_NOTES_PENDING.md` with user-facing entries:
  - Skill repositories can be public.
  - Users can browse public Skill repositories.
  - Users can fork a public Skill into their own private repository.
  - Users can install public Skills into Desktop through the new protocol link.
- [ ] Do not mention internal table names, migrations, or implementation routes.
- [ ] Confirm no AGENTS.md update is required because this phase does not add a new storage domain, does not change COS bucket ownership, and follows existing Content Store storage domain for Skill repository package objects.

### 18. Final Verification

- [ ] Run focused shared tests:

```bash
pnpm --filter @synapse/shared test -- skill-repository
```

- [ ] Run focused server tests:

```bash
pnpm --filter @synapse/server test -- skill-repository
```

- [ ] Run focused dashboard tests:

```bash
pnpm --filter @synapse/server-dashboard test -- skill-repository api
```

- [ ] Run focused desktop tests:

```bash
pnpm --filter @synapse/desktop test -- skill-repository-install protocol-router skill-repository-dispatcher action-router
```

- [ ] Run package type checks affected by this phase:

```bash
pnpm --filter @synapse/shared typecheck
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/server-dashboard typecheck
pnpm --filter @synapse/desktop typecheck
```

- [ ] Optional manual smoke test only when local services are already running or the user asks to start them:
  - Make a repository public.
  - Open `/skills/:ownerHandle/:repositoryName`.
  - Fork it.
  - Click Install.
  - Confirm Desktop opens `Install Skill`.
  - Complete install and verify installed Skill files exist locally.

---

## Rollout Notes

- Keep old Content Store install endpoints and `synapse://content-install` untouched.
- Public Skill Repository install should use `synapse://skill-install`.
- Do not expose prompt/rule sharing through the new Skill Repository UI.
- Do not create an empty cloud repository flow in this phase.
- Fork is a copy, not shared editing.
- Install is always current snapshot, not a historical version.
