# 状态同步（State Sync）与统一开放 SDK 分发 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Synapse's two-layer realtime JSON tree sync service **状态同步（State Sync）v1** and the unified zero-npm open SDK static distribution pipeline (`/sdk/...`) across `@synapse/shared`, `server/`, `sdk/`, `dashboard/`, `document/`, and `desktop/` (MCP + System Skill).

**Architecture:** A single-instance NestJS `StateSyncModule` persists `StateSyncSpace` (`ss_...`), `StateSyncToken` (`sys_...` SHA-256 hashed), and `StateSyncDoc` (`ssd_...` 128-bit random IDs for client creation, optional slug for management) in PostgreSQL while an in-memory `StateSyncHub` maintains per-doc authoritative JSON trees, serial write queues, path-prefix subscription Tries, 100-item / 5-minute replay ring buffers, `onDisconnect` hooks, hidden Console observers, and debounced async persistence (500ms debounce / 2000ms max wait, immediate flush on last production disconnect, HTTP write, doc create/delete, and graceful shutdown). A new top-level `@synapse/sdk` (`sdk/`) workspace package compiles a single zero-dependency TypeScript source via `esbuild` into Browser Global IIFE, ESM, Node CJS, `.d.ts`, and `/sdk/manifest.json` (merging frozen historical versions from `sdk/releases/`), baked into `server/Dockerfile` and served statically by Nginx under `/sdk/`. Dashboard Console, OpenAPI + copyable VitePress docs, and 14 desktop MCP tools expose the three product surfaces aligned with `channels`.

**Tech Stack:** TypeScript 6, NestJS, Prisma (PostgreSQL), `ws`, Zod, `esbuild`, HeroUI v3 + React 19 + TanStack Router/Query, VitePress, Electron 44 MCP capability registry, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-state-sync-design.md`

## Global Constraints

- Product Chinese name is **状态同步** across Console nav/titles, OpenAPI docs, API Key capability labels, MCP descriptions, and `RELEASE_NOTES_PENDING.md`; English/code identifier is `state-sync` / `state_sync` / `StateSync`.
- Runtime Open API (`/api/open/v1/state-sync/...`) and Open WS (`/api/open/v1/state-sync/spaces/:spaceId/docs/:docId/ws`) MUST ignore cookies and SY login JWTs; never authenticate via URL query parameters (`?token=...` / `?access_token=...` rejected).
- Existing `UserApiKey` records MUST NOT implicitly gain `state_sync.*` scopes; default `stateSyncAccessMode = "selected"`, `stateSyncSpaceIds = []`; only `all_owned` + `state_sync.manage` may create spaces via Open API.
- Client space tokens (`sys_...`) MUST NEVER enumerate rooms in a space, NEVER delete rooms, and NEVER pass custom `docId` (server always generates 128-bit random `ssd_...`); when space `defaultDocTtlSeconds` is non-null, client room creation cannot pass `null` to bypass expiry.
- `path` segment regex `^[a-zA-Z0-9._:-]{1,64}$` and max depth `16` apply to `path` arguments only; JSON payload values (`initialData`, `set` value, `patch` object) allow arbitrary JSON keys (including CJK/spaces) while recursively blocking `__proto__`, `constructor`, `prototype` and capping value nesting depth at `32`. Document root `/` MUST always remain a plain JSON object.
- `onDisconnect` hooks (max 8/connection) execute on normal close (`1000`), network drop, and heartbeat timeout (`4008`), and MUST be skipped & discarded on `4003` (revoked/deleted), `4004` (write-scope loss), and `1001` (graceful server shutdown).
- Limits: doc JSON `<= 256 KiB` UTF-8, single write payload `<= 64 KiB` UTF-8, WS frame `<= 128 KiB`, HTTP body `<= 256 KiB`, `meta <= 2 KiB` UTF-8, max 32 subscribed paths/connection, max 20 active tokens/space, default 100 docs/space (cap 500), 50 production connections/doc + 5 Console observers/doc, 200 connections/space, 300/account, 2000 global, WS write rate 20/s (burst 60), doc write rate 60/s (burst 120), doc create 10/min (burst 30) per space, auth timeout 5s, heartbeat 25s (2 missed = `4008`), slow consumer `bufferedAmount > 512 KiB` = `4008`, debounce flush 500ms (max wait 2000ms), idle memory evict 5 min, expiry sweep 5 min, shutdown flush deadline 5s.
- SDK `/sdk/` MUST be zero-runtime-dependency, built from `sdk/` during `server/Dockerfile`, served statically by Nginx (and dev static middleware when `NODE_ENV !== "production"`) with `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options: nosniff`, immutable 1-year cache on semver paths, 5-min cache on `/v1/`, 60s cache on `manifest.json`; no public npm publishing, no new COS bucket.
- No cross-room queries, no Security Rules DSL, no CRDT, no change history table, no space trash bin, no new Desktop System App / Dock / Workflow Node / Automation Action / Deep Link / iOS pages.
- Desktop code MUST pass `pnpm --filter @synapse/desktop run check:hard-constraints`; no `console.log` in production code; Dashboard UI MUST follow `dashboard/CLAUDE.md` & `dashboard/DESIGN.md`; sensitive access logs disabled in `server/src/app.module.ts` and `server/nginx.conf`.

## Review Focus

1. **Multi-byte UTF-8 size caps (`256 KiB` doc / `64 KiB` write / `2 KiB` meta) and recursive prototype-pollution inside JSON values**: CJK strings whose JS `.length` is below limit but UTF-8 byte length exceeds it MUST be rejected without mutating memory, and nested `__proto__`/`constructor`/`prototype` inside `initialData`/`set`/`patch` values MUST be blocked even while CJK/spaced keys are allowed (pinned in Tasks 1 & 3).
2. **Ancestor overwrite vs. overlapping child subscriptions & `exists: false` deduplication**: When a client subscribes to both `/players` and `/players/p1` and another client executes `set("/", {})` or `delete("/players")`, the subscriber MUST receive deduplicated updates with `exists: false` for `/players/p1` and never stale state (pinned in Tasks 3 & 6).
3. **`onDisconnect` suppression on `4003`, `4004`, and `1001` vs. execution on `1000`/`4008`**: Server deploy shutdown (`1001`), token revocation/doc deletion (`4003`), and API Key write-scope downgrade (`4004`) MUST drop pending `onDisconnect` actions, whereas normal disconnect / timeout (`4008`) MUST execute them through the doc's serial write queue (pinned in Tasks 3 & 5).
4. **SDK `room.transaction()` contention, `abort()`/`undefined`, `remove()`, retry exhaustion, and unsubscribed paths**: Two clients racing on `/board/4` MUST result in one `{ committed: true }` and the second seeing the winner's value on retry and aborting cleanly (`{ committed: false }`); exhausting 5 `REV_CONFLICT` retries MUST reject with `REV_CONFLICT`; targeting a path outside partial subscriptions MUST fail fast with `PATH_NOT_SUBSCRIBED` (pinned in Task 6).
5. **Cold-load / restart `evictedUpToRev` continuity & Desktop MCP mid-flight account switch**: Reloading a room from PostgreSQL after idle eviction or server restart MUST initialize `evictedUpToRev = doc.rev` so reconnecting clients with stale `sinceRev` get `replayTruncated: true` + fresh `snapshots`; switching desktop accounts mid-request MUST abort `app_state_sync_*` with `STATE_SYNC_ACCOUNT_CHANGED` (pinned in Tasks 3, 4 & 9).

---

## File Structure

- **Shared (`shared/`)**
  - Create: `shared/src/state-sync-contracts.ts`, `shared/src/state-sync-contracts.spec.ts`
  - Modify: `shared/package.json` (export `./state-sync-contracts`)
- **Server (`server/`)**
  - Modify: `server/prisma/schema.prisma`, create Prisma migration `server/prisma/migrations/<timestamp>_add_state_sync/migration.sql`
  - Modify: `server/src/api-keys/api-key-capabilities.ts`, `api-key-change-notifier.ts`, `api-key.service.ts`, `api-key.controller.ts`, `api-key.service.spec.ts`, `api-key.controller.spec.ts`
  - Create: `server/src/state-sync/state-sync-config.ts`, `state-sync-token.ts`, `state-sync-debug-ticket.ts`, `state-sync-trie.ts`, `state-sync-hub.ts`, `state-sync.service.ts`, `state-sync-http.ts`, `state-sync.controller.ts`, `state-sync.gateway.ts`, `state-sync-openapi.ts`, `state-sync.module.ts`
  - Create tests: `server/src/state-sync/state-sync-hub.spec.ts`, `state-sync.service.spec.ts`, `state-sync.http.spec.ts`, `state-sync.gateway.spec.ts`, `state-sync-openapi.spec.ts`
  - Modify: `server/src/open-api/open-api-contract.ts`, `server/src/app.module.ts`, `server/src/main.ts`, `server/nginx.conf`, `server/Dockerfile`, `server/src/deploy-config.spec.ts`, `deploy.sh`
- **SDK (`sdk/`)**
  - Modify: `pnpm-workspace.yaml` (add `sdk`)
  - Create: `sdk/package.json`, `sdk/tsconfig.json`, `sdk/vitest.config.ts`, `sdk/scripts/build.mjs`, `sdk/releases/state-sync/.gitkeep`
  - Create: `sdk/src/shared/errors.ts`, `sdk/src/shared/path.ts`, `sdk/src/shared/ws-transport.ts`, `sdk/src/state-sync/index.ts`, `sdk/src/state-sync/state-sync.spec.ts`
- **Docs (`document/`)**
  - Create: `document/open-api/api/state-sync.md`, `document/open-api/sdk.md`
  - Modify: `document/open-api/index.md`, `document/.vitepress/config.mts`
- **Dashboard (`dashboard/`)**
  - Create: `dashboard/src/features/state-sync/state-sync-api.ts`, `use-state-sync.ts`, `state-sync-debugger.tsx`, `state-sync-tokens.tsx`, `state-sync-examples.tsx`, `state-sync-dialogs.tsx`, `state-sync-key-resources.tsx`, `index.tsx`, `state-sync.test.tsx`, `state-sync.browser.tsx`
  - Create: `dashboard/src/routes/_authenticated/state-sync/index.tsx`
  - Modify: `dashboard/src/components/layout/navigation.ts`, `dashboard/src/features/settings/api-keys-settings.tsx`, `dashboard/src/lib/api.ts`, `dashboard/src/routeTree.gen.ts`
- **Desktop (`desktop/`) & Repo Docs**
  - Create: `desktop/app-capabilities/state-sync/shared/capability.ts`, `desktop/app-capabilities/state-sync/main/dispatcher.ts`, `desktop/app-capabilities/state-sync/main/__tests__/dispatcher.test.ts`
  - Create: `desktop/app-capabilities/synapse-skill/skill-package/state-sync/index.md`, `desktop/app-capabilities/synapse-skill/skill-package/state-sync/multiplayer-game.md`
  - Create: `desktop/electron/services/agent-runtime/synapse-tool-router-state-sync-app.ts`
  - Modify: `desktop/synapse-capabilities/shared/naming.ts`, `registry.ts`, `desktop/electron/bootstrap/descriptors.ts`, `desktop/electron/capabilities/action-router.ts`, `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts`, `synapse-tool-router.ts`, `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`, desktop unit tests
  - Modify: `docs/agents/capability-registry.md`, `RELEASE_NOTES_PENDING.md`

---

### Task 1: Shared State Sync Contracts & Pure JSON Tree Engine (`@synapse/shared/state-sync-contracts`)

**Files:**
- Create: `shared/src/state-sync-contracts.ts`
- Create: `shared/src/state-sync-contracts.spec.ts`
- Modify: `shared/package.json`

**Interfaces:**
- Produces:
  - Constants: `STATE_SYNC_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/`, `STATE_SYNC_CUSTOM_DOC_ID_REGEX = /^[a-zA-Z0-9._:-]{3,64}$/`, `STATE_SYNC_CLIENT_ID_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/`, `STATE_SYNC_MAX_PATH_DEPTH = 16`, `STATE_SYNC_MAX_VALUE_DEPTH = 32`, `STATE_SYNC_DOC_MAX_BYTES = 262144`, `STATE_SYNC_WRITE_MAX_BYTES = 65536`, `STATE_SYNC_WS_FRAME_MAX_BYTES = 131072`, `STATE_SYNC_META_MAX_BYTES = 2048`, `STATE_SYNC_MAX_SUBSCRIBED_PATHS = 32`, `STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS = 8`, `STATE_SYNC_TTL_MIN_SECONDS = 60`, `STATE_SYNC_TTL_MAX_SECONDS = 2592000`, `STATE_SYNC_TTL_DEFAULT_SECONDS = 86400`, `STATE_SYNC_MAX_DOCS_DEFAULT = 100`, `STATE_SYNC_MAX_DOCS_CAP = 500`, `STATE_SYNC_TOKEN_ROLES = ["read", "write", "create_write"] as const`, `STATE_SYNC_MUTATION_OPS = ["set", "patch", "delete"] as const`, `STATE_SYNC_WS_CLOSE_CODES` (`1000`, `1001`, `4001`, `4003`, `4004`, `4008`, `4029`).
  - Path & JSON helpers:
    - `parseStateSyncPath(path: string): { ok: true; segments: string[]; normalized: string } | { ok: false; message: string }`
    - `isAncestorOrEqualPath(ancestor: string, target: string): boolean`
    - `validateStateSyncJsonValue(value: unknown, opts?: { maxBytes?: number; maxDepth?: number; requirePlainObject?: boolean }): { ok: true; bytes: number } | { ok: false; code: "INVALID_INPUT" | "PAYLOAD_TOO_LARGE"; message: string }`
    - `readStateSyncPath(root: Record<string, unknown>, path: string): { exists: boolean; value: unknown }` (returns cloned value)
    - `applyStateSyncMutation(root: Record<string, unknown>, input: { op: "set" | "patch" | "delete"; path: string; value?: unknown; maxDocBytes?: number }): { ok: true; nextRoot: Record<string, unknown>; changed: boolean; bytes: number } | { ok: false; code: "INVALID_INPUT" | "PATH_CONFLICT" | "DOC_TOO_LARGE"; message: string }` (does not mutate `root` on failure)
  - Zod schemas & types: `stateSyncRoleSchema`, `stateSyncKeyResourcesSchema` (`{ mode: "selected" | "all_owned", spaceIds: string[] }`), `stateSyncPathSchema`, `stateSyncSpaceCreateSchema`, `stateSyncSpaceUpdateSchema`, `stateSyncTokenCreateSchema`, `stateSyncDocCreateSchema`, `stateSyncMutateHttpSchema`, `stateSyncOnDisconnectActionSchema`, `stateSyncWsClientFrameSchema` (`auth` | `subscribe` | `unsubscribe` | `mutate` | `onDisconnect.set` | `onDisconnect.clear` | `presence.update` | `ping`), `stateSyncWsServerFrameSchema` (`ready` | `mutation` | `snapshot` | `ack` | `presence.join` | `presence.leave` | `presence.update` | `pong` | `error`).

- [ ] **Step 1: Write failing tests in `shared/src/state-sync-contracts.spec.ts`**
  - Test `parseStateSyncPath`: accepts `"/"`, `"/board/0"`, `"/players/p1/hp"`; rejects `""`, `"board"`, `"/board/"`, `"/a//b"`, `"/__proto__/x"`, `"/constructor"`, depth 17, and invalid segment characters.
  - Test `validateStateSyncJsonValue` (Review Focus #1): accepts CJK and spaced object keys (`{ "玩家 名称": "张三" }`); rejects nested `JSON.parse('{"a":{"__proto__":{"polluted":1}}}')` and `constructor`/`prototype` keys recursively; rejects depth > 32; rejects CJK string whose `.length < 65536` but UTF-8 byte length `> 65536`.
  - Test `applyStateSyncMutation`:
    - `set("/a/b/c", 1)` auto-creates `{ a: { b: { c: 1 } } }`; `set("/a/b", 2)` on `{ a: 5 }` returns `PATH_CONFLICT` without mutating input.
    - `set("/", "not-object")` and `delete("/")` return `INVALID_INPUT`; `set("/", {})` succeeds.
    - `patch("/p1", { ready: true, note: null })` shallow-merges and preserves `null`; `patch("/arr", { a: 1 })` when `/arr` is `[]` returns `PATH_CONFLICT`.
    - `delete("/missing/key")` returns `{ ok: true, changed: false }`.
    - Mutation pushing total UTF-8 JSON size past `262144` bytes returns `DOC_TOO_LARGE` without mutating original tree.
  - Test `stateSyncWsClientFrameSchema`: validates `auth` (`paths` max 32), `mutate` (including `expectedRev` non-negative integer), `onDisconnect.set` (max 8 actions, forbids `delete "/"`).

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/shared test -- state-sync-contracts`
  - Expected: FAIL (`Cannot find module './state-sync-contracts'`).

- [ ] **Step 3: Implement `shared/src/state-sync-contracts.ts` and export `./state-sync-contracts` in `shared/package.json`**
  - Use `TextEncoder` for browser-compatible UTF-8 byte counting (`new TextEncoder().encode(JSON.stringify(value)).byteLength`) so `dashboard/` and `server/` share identical enforcement.
  - Check forbidden keys (`__proto__`, `constructor`, `prototype`) with `Object.keys` / `Object.prototype.hasOwnProperty` recursively up to depth 32; use `structuredClone` when cloning roots before applying mutations so failed writes never taint caller state.
  - Mirror `./channel-contracts` export entry in `shared/package.json`.

- [ ] **Step 4: Run tests & build to verify pass**
  - Run: `pnpm --filter @synapse/shared test -- state-sync-contracts && pnpm --filter @synapse/shared build`
  - Expected: PASS and `shared/dist/state-sync-contracts.*` emitted.

- [ ] **Step 5: Commit**
  - `git add shared/src/state-sync-contracts.ts shared/src/state-sync-contracts.spec.ts shared/package.json`
  - `git commit -m "feat(shared): 新增状态同步协议契约与路径 JSON 树变更引擎"`

---

### Task 2: Prisma Models, `UserApiKey` State Sync Scopes & Change Notifier Extension

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_add_state_sync/migration.sql`
- Modify: `server/src/api-keys/api-key-capabilities.ts`
- Modify: `server/src/api-keys/api-key-change-notifier.ts`
- Modify: `server/src/api-keys/api-key.service.ts`
- Modify: `server/src/api-keys/api-key.controller.ts`
- Modify: `server/src/api-keys/api-key.service.spec.ts`, `server/src/api-keys/api-key.controller.spec.ts`

**Interfaces:**
- Consumes: `@synapse/shared/state-sync-contracts` (`StateSyncKeyResources`, `stateSyncKeyResourcesSchema`).
- Produces:
  - Prisma models:
    - `StateSyncSpace` (`id`, `ownerId`, `name`, `description`, `defaultDocTtlSeconds: Int? @default(86400)`, `maxDocs: Int @default(100)`, `createdAt`, `updatedAt`, `tokens`, `docs`, `@@index([ownerId, createdAt])`)
    - `StateSyncToken` (`id`, `spaceId`, `name`, `role`, `tokenHash @unique`, `tokenPrefix`, `lastUsedAt`, `revokedAt`, `createdAt`, `@@index([spaceId, revokedAt, createdAt])`)
    - `StateSyncDoc` (`id`, `spaceId`, `data: Json @default("{}")`, `rev: BigInt @default(0)`, `ttlSeconds: Int?`, `expiresAt: DateTime?`, `createdAt`, `updatedAt`, `@@id([spaceId, id])`, `@@index([spaceId, updatedAt])`, `@@index([expiresAt])`)
  - `UserApiKey` columns: `stateSyncAccessMode String? @default("selected") @db.VarChar(16)`, `stateSyncSpaceIds String[] @default([])`.
  - Scopes: `STATE_SYNC_MANAGE_SCOPE = "state_sync.manage"`, `STATE_SYNC_READ_SCOPE = "state_sync.read"`, `STATE_SYNC_WRITE_SCOPE = "state_sync.write"`.
  - Extended `ApiKeyChangeEvent` (`kind: "updated"` now also includes `stateSyncAccessMode: "selected" | "all_owned"` and `stateSyncSpaceIds: readonly string[]`).
  - `UserApiKeyDto.stateSyncResources?: StateSyncKeyResources`, `ApiKeyService.updateStateSyncResourcesForUser(...)`, and `stateSyncAccessMode` / `stateSyncSpaceIds` exposed on `OpenApiPrincipal`.

- [ ] **Step 1: Add failing tests in `server/src/api-keys/api-key.service.spec.ts` and `api-key.controller.spec.ts`**
  - Verify existing API keys without `stateSyncResources` default to `mode: "selected"`, `spaceIds: []`, and contain no `state_sync.*` scopes.
  - Verify creating/updating a key with `state_sync.*` scopes and `stateSyncResources` validates owned `spaceIds` and rejects foreign space IDs with 404/400.
  - Verify updating `stateSyncResources` or scopes emits `ApiKeyChangeNotifier` `updated` event containing `stateSyncAccessMode` and `stateSyncSpaceIds`.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/server test -- api-key`
  - Expected: FAIL (`state_sync.*` scopes / `stateSyncResources` missing).

- [ ] **Step 3: Update `server/prisma/schema.prisma`, create SQL migration, and extend `api-keys` module**
  - Add `StateSyncSpace`, `StateSyncToken`, `StateSyncDoc`, `User.stateSyncSpaces`, and `UserApiKey` columns; write idempotent migration SQL under `server/prisma/migrations/<timestamp>_add_state_sync/migration.sql` and run `pnpm --filter @synapse/server exec prisma generate`.
  - Register `state_sync.manage` (`管理状态同步`), `state_sync.read` (`读取状态同步`), `state_sync.write` (`写入状态同步`) with `documentationPath: "/open-api/api/state-sync"` in `api-key-capabilities.ts`.
  - Mirror `channelResources` logic in `ApiKeyService` and `ApiKeyController` (including `PUT /api/console/api-keys/:id/state-sync-resources` or matching existing update endpoint).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `pnpm --filter @synapse/server test -- api-key`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add server/prisma server/src/api-keys`
  - `git commit -m "feat(server): 新增状态同步数据模型与 API 密钥空间权限范围"`

---

### Task 3: In-Memory `StateSyncHub`, Path Subscription Trie, `onDisconnect`, Replay Buffer & Debounced Persistence

**Files:**
- Create: `server/src/state-sync/state-sync-config.ts`
- Create: `server/src/state-sync/state-sync-token.ts`
- Create: `server/src/state-sync/state-sync-debug-ticket.ts`
- Create: `server/src/state-sync/state-sync-trie.ts`
- Create: `server/src/state-sync/state-sync-hub.ts`
- Create: `server/src/state-sync/state-sync-hub.spec.ts`

**Interfaces:**
- Consumes: `@synapse/shared/state-sync-contracts` (`parseStateSyncPath`, `applyStateSyncMutation`, `readStateSyncPath`, `STATE_SYNC_WS_CLOSE_CODES`, frame types).
- Produces:
  - `StateSyncLimitsConfig` (`loadStateSyncConfig(env)` with exact defaults from Global Constraints).
  - `createStateSyncTokenSecret()`, `hashStateSyncTokenSecret(secret)`, `getStateSyncTokenPrefix(secret)`, `isStateSyncTokenSecret(value)` (`sys_` prefix), `createStateSyncDocId()` (`ssd_` + 22 base64url chars from `randomBytes(16)`).
  - `StateSyncDebugTicketStore`: `issue(spaceId, docId, ownerId): { ticket, expiresAt }`, `consume(ticket, spaceId, docId): { ownerId } | null` (60s TTL, single-use).
  - `StateSyncSubscriptionTrie`: `subscribe(connectionId, paths)`, `unsubscribe(connectionId, paths)`, `removeConnection(connectionId)`, `getSubscribedPaths(connectionId)`, `resolveAffected(writePath)` returning `{ mutationRecipients: Set<string>; snapshotRecipients: Map<string, string[]> }` (deduplicating overlapping subscriptions per connection).
  - `StateSyncHub`:
    - `configurePersister(persister: (docKey: { spaceId: string; docId: string; data: Record<string, unknown>; rev: bigint; expiresAt: Date | null }) => Promise<void>): void`
    - `loadOrAttachDoc(snapshot: LoadedDocSnapshot): ActiveDocHandle` (initializes `evictedUpToRev = snapshot.rev` on cold load)
    - `registerConnection(input: RegisterStateSyncConnectionInput): { ok: true; connection: LiveStateSyncConnection; readyPayload: ReadyStateSyncPayload; replayedMutations: MutationBroadcastFrame[] } | { ok: false; code: string; closeCode: number; message: string }`
    - `unregisterConnection(spaceId: string, docId: string, connectionId: string, reason: DisconnectReason): Promise<void>` where `DisconnectReason = "normal" | "timeout_or_slow" | "revoked" | "scope_changed" | "shutdown"`
    - `updateSubscriptions(spaceId: string, docId: string, connectionId: string, op: "subscribe" | "unsubscribe", paths: readonly string[]): { ok: true; snapshots: SnapshotItem[]; rev: bigint } | { ok: false; code: string; message: string }`
    - `mutate(spaceId: string, docId: string, input: HubMutateInput): Promise<HubMutateResult>` (serialized per doc, enforces `expectedRev`, `256 KiB` cap, rate limit, broadcasts `mutation` & ancestor-overwrite `snapshot`s, schedules 500ms/2000ms debounced flush or awaits immediate flush when `syncPersist: true`)
    - `setOnDisconnect(spaceId: string, docId: string, connectionId: string, actions: readonly StateSyncOnDisconnectAction[]): { ok: true } | { ok: false; code: string; message: string }`
    - `updatePresence(...)`, `getPresence(spaceId, docId)`, `getLiveDocStats(spaceId)`, `disconnectBySpace(spaceId, closeCode)`, `disconnectByDoc(spaceId, docId, closeCode)`, `disconnectByToken(tokenId, closeCode)`, `handleApiKeyChange(event)`, `shutdown(): Promise<void>` (sends `1001`, suppresses `onDisconnect`, flushes all dirty docs within 5s).

- [ ] **Step 1: Write failing tests in `server/src/state-sync/state-sync-hub.spec.ts`**
  - Test Trie & ancestor overwrite deduplication (Review Focus #2): Client A subscribed to `["/players", "/players/p1"]`; Client B runs `delete("/players")` and `set("/", {})`; verify Client A receives deduplicated update with `exists: false` for `/players/p1`, never stale data.
  - Test serial write ordering, `expectedRev` CAS (`REV_CONFLICT` with `currentRev`), and `DOC_TOO_LARGE` (>256 KiB UTF-8 CJK) rollback leaving in-memory tree untouched (Review Focus #1).
  - Test `sinceRev` replay within 100-op / 5-min window and cold-load `evictedUpToRev = doc.rev` returning `replayTruncated: true` + fresh `snapshots` (Review Focus #5).
  - Test `onDisconnect` execution on `"normal"` and `"timeout_or_slow"` vs. strict suppression on `"revoked"` (`4003`), `"scope_changed"` (`4004`), and `"shutdown"` (`1001`) (Review Focus #3).
  - Test debounced flush (500ms / maxWait 2000ms), immediate flush on last production disconnect, slow-consumer `bufferedAmount > 512 KiB` disconnect (`4008`) without breaking healthy subscribers, hidden Console observer exclusion from Presence and production 50-conn cap, and `shutdown()` flushing all dirty docs.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/server test -- state-sync-hub`
  - Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `state-sync-config.ts`, `state-sync-token.ts`, `state-sync-debug-ticket.ts`, `state-sync-trie.ts`, and `state-sync-hub.ts`**
  - Maintain a per-doc Promise tail (`writeChain`) for strict write serialization; on `shutdown()`, mark `shuttingDown = true`, close all active WS with `1001` (suppressing `onDisconnect`), and `Promise.allSettled` flush dirty docs bounded by `shutdownFlushTimeoutMs` (5000ms).
  - Schedule idle memory eviction (5 min after last disconnect & clean flush) using unref'd timers so Vitest exits cleanly.

- [ ] **Step 4: Run tests to verify pass**
  - Run: `pnpm --filter @synapse/server test -- state-sync-hub`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add server/src/state-sync/state-sync-config.ts server/src/state-sync/state-sync-token.ts server/src/state-sync/state-sync-debug-ticket.ts server/src/state-sync/state-sync-trie.ts server/src/state-sync/state-sync-hub.ts server/src/state-sync/state-sync-hub.spec.ts`
  - `git commit -m "feat(server): 实现状态同步内存 Hub、路径订阅树、掉线钩子与防抖刷盘"`

---

### Task 4: `StateSyncService`, Auth Isolation, Expiry Sweeper & Open/Console REST API

**Files:**
- Create: `server/src/state-sync/state-sync-http.ts`
- Create: `server/src/state-sync/state-sync.service.ts`
- Create: `server/src/state-sync/state-sync.controller.ts`
- Create: `server/src/state-sync/state-sync.module.ts`
- Create: `server/src/state-sync/state-sync.service.spec.ts`
- Create: `server/src/state-sync/state-sync.http.spec.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ApiKeyService`, `ApiKeyChangeNotifier`, `StateSyncHub`, `StateSyncDebugTicketStore`, `@synapse/shared/state-sync-contracts`.
- Produces:
  - `stateSyncCors(requestUrl)`, `registerStateSyncIngress(app)`, `registerStateSyncBodyErrors(app)` (256 KiB body cap, `X-Request-Id`, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Credentials: false`).
  - `StateSyncService`:
    - Console owner operations: `listSpaces`, `getSpace`, `createSpace`, `updateSpace`, `deleteSpace`, `listTokens`, `createToken`, `revokeToken`, `listDocs`, `createDoc`, `getDoc`, `mutateDoc`, `deleteDoc`, `issueDebugTicket`, `getPreflight` (includes latest SDK manifest URL/version metadata).
    - Open runtime/management operations + `authenticateOpenCredential(authorizationHeader)` (strictly ignores Cookie & user JWT) + `authenticateWsToken(spaceId, docId, token)` (supports `sys_...`, `syk_...`, and single-use Console debug tickets).
    - Background expiry sweeper (`sweepExpiredDocs()` every 5 min removing `expiresAt < now` docs with zero active connections).
  - HTTP routes:
    - Open: `/api/open/v1/state-sync/spaces`, `/spaces/:spaceId`, `/spaces/:spaceId/tokens`, `/spaces/:spaceId/tokens/:tokenId`, `/spaces/:spaceId/docs`, `/spaces/:spaceId/docs/:docId` (`GET`, `PATCH`, `DELETE`), `/spaces/:spaceId/docs/:docId/presence`.
    - Console: `/api/console/state-sync/preflight`, `/spaces`, `/spaces/:spaceId`, `/spaces/:spaceId/tokens`, `/spaces/:spaceId/tokens/:tokenId`, `/spaces/:spaceId/docs`, `/spaces/:spaceId/docs/:docId` (`GET`, `PATCH`, `DELETE`), `/spaces/:spaceId/docs/:docId/debug-ticket`.

- [ ] **Step 1: Write failing tests in `state-sync.service.spec.ts` and `state-sync.http.spec.ts`**
  - Verify Open API strictly ignores cookies / user JWTs (`401`).
  - Verify role matrix: `read` cannot `PATCH` or `POST /docs`; `write` can `GET`/`PATCH` known doc but cannot `POST /docs`; `create_write` can `POST /docs` (receives `ssd_...` random ID, rejects custom `docId` with `403`, rejects `ttlSeconds: null` when space has finite TTL, cannot `GET /docs` list or `DELETE /docs/:docId`).
  - Verify `UserApiKey`: only `all_owned + state_sync.manage` can create spaces; `selected` restricts to `stateSyncSpaceIds`; `ApiKeyChangeNotifier` events propagate to `StateSyncHub.handleApiKeyChange`.
  - Verify `maxDocs` ceiling rejects room creation with `DOC_LIMIT_EXCEEDED`, `PATCH` persists synchronously to PG and broadcasts to live Hub subscribers, `409 REV_CONFLICT` returns `currentRev`, and `sweepExpiredDocs` deletes expired idle docs while preserving active ones.
  - Verify HTTP ingress rejects bodies > 256 KiB with structured error envelope and CORS headers.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/server test -- state-sync.service state-sync.http`
  - Expected: FAIL.

- [ ] **Step 3: Implement `state-sync-http.ts`, `state-sync.service.ts`, `state-sync.controller.ts`, `state-sync.module.ts`, and wire into `app.module.ts`**
  - Add `/api/open/v1/state-sync` and `/api/console/state-sync` to `hasSensitiveRequestUrl` in `server/src/app.module.ts` so bearer tokens and private state paths never hit request logs.
  - Skip global NestJS throttler on state-sync Open/Console routes where module-owned rate limiting applies (matching `channels` commit `f2406a5db`).
  - Subscribe `StateSyncService` to `ApiKeyChangeNotifier` on module init and clean up on destroy; configure `StateSyncHub` persister to upsert/update `StateSyncDoc` (`data`, `rev`, `expiresAt`).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `pnpm --filter @synapse/server test -- state-sync`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add server/src/state-sync server/src/app.module.ts`
  - `git commit -m "feat(server): 实现状态同步核心服务、鉴权隔离、过期清理与 REST 接口"`

---

### Task 5: `StateSyncGateway` (WebSocket), `main.ts` Wiring & Nginx Rules

**Files:**
- Create: `server/src/state-sync/state-sync.gateway.ts`
- Create: `server/src/state-sync/state-sync.gateway.spec.ts`
- Modify: `server/src/state-sync/state-sync.module.ts`
- Modify: `server/src/main.ts`
- Modify: `server/nginx.conf`
- Modify: `server/src/deploy-config.spec.ts`

**Interfaces:**
- Consumes: `StateSyncService` (`authenticateWsToken`, `loadDocForGateway`), `StateSyncHub`, `loadStateSyncConfig`, `@synapse/shared/state-sync-contracts`.
- Produces:
  - `StateSyncGateway` (`attach(server: HttpServer)`, `onApplicationShutdown()`): claims `/api/open/v1/state-sync/spaces/:spaceId/docs/:docId/ws` on shared HTTP `upgrade` without interfering with desktop/mobile/drive/channels gateways.
  - Nginx locations for State Sync WS (`3600s` timeouts, `proxy_buffering off`, `access_log off`), State Sync HTTP (`client_max_body_size 256k`, `access_log off`), and `/sdk/` static distribution (60s manifest, 300s `/v<N>/`, 1y `immutable` `/<semver>/`, CORS + CORP + `nosniff`).

- [ ] **Step 1: Write failing tests in `state-sync.gateway.spec.ts` and `deploy-config.spec.ts`**
  - Test WS Upgrade with `?token=sys_...` or `?access_token=...` is rejected immediately (HTTP 400 / never authenticates).
  - Test first-frame `auth` (including 5s auth timeout → `4001`) and Upgrade `Authorization: Bearer <token>` (immediate `ready`).
  - Test end-to-end WS flows: `mutate` (`set`/`patch`/`delete`/`expectedRev` conflict), dynamic `subscribe`/`unsubscribe` returning initial `snapshot`, ancestor overwrite pushing `snapshot` to child subscriber, `onDisconnect.set` firing on normal close (`1000`) and skipped on `4003` revoke / `4004` downgrade / `1001` shutdown (Review Focus #3), `sinceRev` replay after reconnect, and `ping`/`pong`.
  - Test `deploy-config.spec.ts` asserts `server/nginx.conf` contains State Sync WS block, State Sync HTTP block, and `/sdk/` cache & CORS blocks.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/server test -- state-sync.gateway deploy-config`
  - Expected: FAIL.

- [ ] **Step 3: Implement `state-sync.gateway.ts`, wire `main.ts` & `state-sync.module.ts`, and update `server/nginx.conf`**
  - Mirror `ChannelGateway`'s async auth serialization (buffering/rejecting frames arriving before auth completes, handling early close during async DB lookup).
  - Register `stateSyncCors`, `registerStateSyncIngress`, `registerStateSyncBodyErrors`, `StateSyncGateway.attach(app.getHttpServer())`, and dev-only static `/sdk/` serving from `../sdk/dist` (with matching CORS/CORP headers when `NODE_ENV !== "production"`) in `server/src/main.ts`.

- [ ] **Step 4: Run tests to verify pass**
  - Run: `pnpm --filter @synapse/server test -- state-sync deploy-config`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add server/src/state-sync server/src/main.ts server/nginx.conf server/src/deploy-config.spec.ts`
  - `git commit -m "feat(server): 实现状态同步 WebSocket 网关并配置 Nginx 长连接与 SDK 静态路由"`

---

### Task 6: Unified Open SDK Workspace (`sdk/` — `@synapse/sdk`), Build Pipeline, `Dockerfile` & `deploy.sh`

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `sdk/package.json`, `sdk/tsconfig.json`, `sdk/vitest.config.ts`, `sdk/scripts/build.mjs`, `sdk/releases/state-sync/.gitkeep`
- Create: `sdk/src/shared/errors.ts`, `sdk/src/shared/path.ts`, `sdk/src/shared/ws-transport.ts`
- Create: `sdk/src/state-sync/index.ts`, `sdk/src/state-sync/state-sync.spec.ts`
- Modify: `server/Dockerfile`, `deploy.sh`, `server/src/deploy-config.spec.ts`

**Interfaces:**
- Consumes: State Sync Open HTTP & WS protocol (`/api/open/v1/state-sync/...`).
- Produces:
  - Zero-dependency `@synapse/sdk` exports from `sdk/src/state-sync/index.ts`:
    - `SDK_VERSION = "1.0.0"`, `StateSyncError` (`code`, `message`, `currentRev?`, `status?`)
    - `createClient(options: { baseUrl: string; spaceId: string; token: string; WebSocket?: typeof WebSocket; fetch?: typeof fetch }): StateSyncClient`
    - `StateSyncClient`: `createRoom(opts?: { initialData?: Record<string, unknown>; ttlSeconds?: number | null; clientId?: string; clientName?: string; meta?: Record<string, unknown>; paths?: string[]; connect?: boolean })`, `join(docId: string, opts?: { clientId?: string; clientName?: string; meta?: Record<string, unknown>; paths?: string[] }): Promise<StateSyncRoom>`, `getSnapshot(docId: string, path?: string)`
    - `StateSyncRoom`: `docId`, `rev`, `connectionId`, `clientId`, `get(path?: string)`, `on(path: string, cb: (value: unknown, meta: { rev: number; path: string; exists: boolean }) => void): () => void`, `set(path, value, opts?)`, `patch(path, partialObj, opts?)`, `delete(path, opts?)`, `transaction(path, updater, opts?: { maxRetries?: number }): Promise<{ committed: boolean; rev: number; value: unknown }>`, `onDisconnect(actions)`, `clearOnDisconnect()`, `onPresence(cb)`, `updatePresence(patch)`, `onStatus(cb)`, `close()`
  - Build outputs in `sdk/dist/`:
    - `manifest.json` (root discovery manifest with `schemaVersion: 1`, `sdks["state-sync"]`)
    - `state-sync/manifest.json`
    - `state-sync/1.0.0/{state-sync.global.min.js, state-sync.esm.min.js, state-sync.cjs, index.d.ts}`
    - `state-sync/v1/{state-sync.global.min.js, state-sync.esm.min.js, state-sync.cjs, index.d.ts}`

- [ ] **Step 1: Write failing tests in `sdk/src/state-sync/state-sync.spec.ts`**
  - Spin up an in-process mock/real State Sync WS+HTTP server and test:
    - `createRoom` + `join` + `on("/board", cb)` immediate initial callback + incremental `patch` + ancestor `set("/", {})` firing child listener with `exists: false` (Review Focus #2).
    - `transaction("/board/4", ...)` under concurrent contention: 2 clients race, one gets `{ committed: true, value: "X" }`, second sees `"X"` on retry and returns `abort()` (or `undefined`) getting `{ committed: false, value: "X" }`; `remove()` sends `delete`; exhausting 5 retries rejects with `StateSyncError("REV_CONFLICT")`; calling `transaction` on an unsubscribed path rejects with `StateSyncError("PATH_NOT_SUBSCRIBED")` (Review Focus #4).
    - `onDisconnect` re-registers automatically after simulated disconnect (`1001`) + reconnect, and `4003` stops reconnect loop cleanly.
    - Build verification test: runs `sdk/scripts/build.mjs` and checks `sdk/dist/manifest.json`, `sdk/dist/state-sync/manifest.json`, all 4 files under `1.0.0/` and `v1/`, SHA-256 `integrity` match, `global.min.js` attaches `SynapseStateSync.createClient`, and `state-sync.cjs` loads via `require()`.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/sdk test`
  - Expected: FAIL.

- [ ] **Step 3: Implement `sdk/` package, `build.mjs`, and wire `server/Dockerfile` + `deploy.sh`**
  - Keep `sdk/package.json` `dependencies` empty; use `esbuild` (already in workspace lockfile) + `typescript` in `devDependencies`.
  - In `sdk/scripts/build.mjs`, bundle IIFE (`globalName: "SynapseStateSync"`), ESM, and CJS, emit `.d.ts`, copy frozen versions from `sdk/releases/state-sync/<semver>/` into `sdk/dist/state-sync/`, copy latest `1.x` to `v1/`, compute SHA-256 `integrity` and byte sizes, and write both `manifest.json` files.
  - Update `server/Dockerfile` (`COPY sdk/package.json`, install `--filter @synapse/sdk...`, `RUN pnpm --filter @synapse/sdk build`, `COPY --from=build /app/sdk/dist ./sdk`) and `deploy.sh` (`--include='/sdk/***'`, `--exclude='sdk/node_modules'`, `--exclude='sdk/dist'`, remote health check `check_body_contains "sdk manifest" "http://127.0.0.1:3000/sdk/manifest.json" '"state-sync"'`); add assertions to `server/src/deploy-config.spec.ts`.

- [ ] **Step 4: Run SDK tests, build, and deploy-config tests to verify pass**
  - Run: `pnpm --filter @synapse/sdk build && pnpm --filter @synapse/sdk test && pnpm --filter @synapse/sdk typecheck && pnpm --filter @synapse/server test -- deploy-config`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add pnpm-workspace.yaml sdk server/Dockerfile deploy.sh server/src/deploy-config.spec.ts`
  - `git commit -m "feat(sdk): 新增统一开放 SDK 构建分发底座与状态同步零依赖客户端"`

---

### Task 7: OpenAPI Contract & Copyable Open Documentation

**Files:**
- Create: `server/src/state-sync/state-sync-openapi.ts`
- Create: `server/src/state-sync/state-sync-openapi.spec.ts`
- Modify: `server/src/open-api/open-api-contract.ts`
- Create: `document/open-api/api/state-sync.md`
- Create: `document/open-api/sdk.md`
- Modify: `document/open-api/index.md`
- Modify: `document/.vitepress/config.mts`

**Interfaces:**
- Consumes: `server/src/open-api/open-api-contract.ts` helpers, State Sync HTTP/WS/SDK contracts.
- Produces:
  - `STATE_SYNC_OPEN_API_PATHS` and `STATE_SYNC_OPEN_API_SCHEMAS` merged into `/api/open/openapi.json`.
  - Copyable Markdown pages `/open-api/api/state-sync` (「状态同步」) and `/open-api/sdk` (「开放 SDK 与版本发现」).

- [ ] **Step 1: Write failing OpenAPI contract tests in `server/src/state-sync/state-sync-openapi.spec.ts`**
  - Verify `/api/open/openapi.json` includes all State Sync Open HTTP paths, `409 REV_CONFLICT` with `currentRev`, `429 RATE_LIMITED`, `403`, and `state_sync.*` scopes.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/server test -- state-sync-openapi open-api-contract`
  - Expected: FAIL.

- [ ] **Step 3: Implement `state-sync-openapi.ts`, register in `open-api-contract.ts`, and write `document/open-api/api/state-sync.md` & `document/open-api/sdk.md`**
  - Follow `.claude/rules/document-copy.md` and `document/open-api/api/channels.md` conventions; use deployment link placeholders (`https://synapse.d2.pub` auto-replaced by VitePress plugin).
  - Include in `state-sync.md`: distinction vs Cloud Tables & Channels, Space→Doc model, role matrix (`read`/`write`/`create_write`), SDK quickstart (Browser `<script>`, Browser ESM, Node.js `curl` single-file import), `transaction()` & `onDisconnect` patterns, raw WS/HTTP reference, error codes & Close Codes, and two copy-ready end-to-end templates (① pure static 2-player Tic-Tac-Toe game; ② Node.js worker + Web live board).
  - Include in `sdk.md`: `/sdk/manifest.json` schema, `v1` vs exact semver guidance, SRI integrity, Browser & Node zero-npm usage, and roadmap slots for future `channels` & `cloud-tables` SDKs.
  - Register both pages in `document/.vitepress/config.mts` and `document/open-api/index.md`.

- [ ] **Step 4: Run OpenAPI tests & build document site to verify pass**
  - Run: `pnpm --filter @synapse/server test -- state-sync-openapi open-api-contract && pnpm --filter @synapse/document build`
  - Expected: PASS with zero VitePress dead-link errors.

- [ ] **Step 5: Commit**
  - `git add server/src/state-sync/state-sync-openapi.ts server/src/state-sync/state-sync-openapi.spec.ts server/src/open-api/open-api-contract.ts document`
  - `git commit -m "docs: 补充状态同步 OpenAPI 契约、可复制开放文档与 SDK 分发指南"`

---

### Task 8: Dashboard Console「状态同步」Management Page, Real-time JSON Debugger & API Key Space Resources

**Files:**
- Create: `dashboard/src/features/state-sync/state-sync-api.ts`
- Create: `dashboard/src/features/state-sync/use-state-sync.ts`
- Create: `dashboard/src/features/state-sync/state-sync-debugger.tsx`
- Create: `dashboard/src/features/state-sync/state-sync-tokens.tsx`
- Create: `dashboard/src/features/state-sync/state-sync-examples.tsx`
- Create: `dashboard/src/features/state-sync/state-sync-dialogs.tsx`
- Create: `dashboard/src/features/state-sync/state-sync-key-resources.tsx`
- Create: `dashboard/src/features/state-sync/index.tsx`
- Create: `dashboard/src/features/state-sync/state-sync.test.tsx`
- Create: `dashboard/src/features/state-sync/state-sync.browser.tsx`
- Create: `dashboard/src/routes/_authenticated/state-sync/index.tsx`
- Modify: `dashboard/src/components/layout/navigation.ts`
- Modify: `dashboard/src/features/settings/api-keys-settings.tsx`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: Console REST `/api/console/state-sync/...`, Open WS via debug-ticket, `GET /sdk/manifest.json`, HeroUI v3 & Dashboard shared `Header`/`Main`/`ServerDataTable`.
- Produces:
  - Console nav item **「状态同步」** at `/_authenticated/state-sync/`.
  - `StateSyncKeyResourcesField` embedded in `api-keys-settings.tsx` when any `state_sync.*` scope is selected.

- [ ] **Step 1: Write failing unit & browser tests in `state-sync.test.tsx` and `state-sync.browser.tsx`**
  - Test space list creation/deletion, token creation one-time secret modal + revoke confirmation, room list + live debugger connecting via debug-ticket and rendering incoming JSON updates + path mutation submit (`set`/`patch`/`delete` + optional `expectedRev`), SDK examples tab rendering live version from `/sdk/manifest.json`, and API Key dialog selecting `state_sync.*` scopes + `selected`/`all_owned` space resources.
  - Browser visual/layout checks covering desktop and narrow viewports with dropdowns/modals expanded (per `dashboard/CLAUDE.md`).

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/dashboard test -- state-sync`
  - Expected: FAIL.

- [ ] **Step 3: Implement Dashboard State Sync feature, route, navigation, and API Key settings integration**
  - Strictly follow `dashboard/CLAUDE.md` & `dashboard/DESIGN.md` (HeroUI v3 components, theme tokens only, no custom hex/rgb colors, no nested cards, standard Button sizes, no marketing copy).
  - Read `dashboard/src/features/channels/` as the direct structural template; replace Retain tab with **房间与实时调试** (active room selector + live JSON tree view + online Presence + path mutation debugger + rolling mutation log) and update **接入与 SDK 示例** to display `/sdk/manifest.json` + Browser `<script>` / Browser ESM / Node.js `curl` / HTTP `PATCH` copy blocks.

- [ ] **Step 4: Run Dashboard tests, typecheck & build to verify pass**
  - Run: `pnpm --filter @synapse/dashboard test -- state-sync && pnpm --filter @synapse/dashboard typecheck && pnpm --filter @synapse/dashboard build`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add dashboard`
  - `git commit -m "feat(dashboard): 新增状态同步管理页、实时 JSON 调试台与 API 密钥空间范围配置"`

---

### Task 9: Desktop MCP `state_sync` Domain (14 Tools), Tool Router, System Skill & Capability Registry

**Files:**
- Create: `desktop/app-capabilities/state-sync/shared/capability.ts`
- Create: `desktop/app-capabilities/state-sync/main/dispatcher.ts`
- Create: `desktop/app-capabilities/state-sync/main/__tests__/dispatcher.test.ts`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/state-sync/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/state-sync/multiplayer-game.md`
- Create: `desktop/electron/services/agent-runtime/synapse-tool-router-state-sync-app.ts`
- Modify: `desktop/synapse-capabilities/shared/naming.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts`
- Modify: `desktop/electron/services/agent-runtime/synapse-tool-router.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/synapse-tool-router.test.ts`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`
- Modify: `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts`
- Modify: `desktop/tests/unit/api-mcp-capability-surface.test.ts`
- Modify: `docs/agents/capability-registry.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: `AccountService.fetchAuthenticated`, `PermissionGuard` (`network.connect`), `AuditSink` (`synapse-state-sync`), Console REST `/api/console/state-sync/...`.
- Produces:
  - 14 MCP capabilities under domain `state_sync`:
    1. `app_state_sync_publish_preflight_get`
    2. `app_state_sync_space_list`
    3. `app_state_sync_space_get`
    4. `app_state_sync_space_create`
    5. `app_state_sync_space_update`
    6. `app_state_sync_space_delete`
    7. `app_state_sync_token_list`
    8. `app_state_sync_token_create`
    9. `app_state_sync_token_revoke`
    10. `app_state_sync_doc_list`
    11. `app_state_sync_doc_create`
    12. `app_state_sync_doc_get`
    13. `app_state_sync_doc_mutate`
    14. `app_state_sync_doc_delete`
  - Updated global capability counts in `docs/agents/capability-registry.md`: global capability `382 -> 396`, MCP index `378 -> 392`, public tools still `2` (`search` / `invoke`), System App / Dock / Workflow / Automation / Deep Link unchanged.

- [ ] **Step 1: Write failing tests in `dispatcher.test.ts`, `synapse-tool-router.test.ts`, `service.test.ts`, and `api-mcp-capability-surface.test.ts`**
  - Test all 14 actions route to `/api/console/state-sync/...`, enforce `mcp-http`/`mcp-stdio` caller boundary, check `PermissionGuard` & `AuditSink`, and abort with `STATE_SYNC_ACCOUNT_CHANGED` if desktop account switches mid-request (Review Focus #5).
  - Test `synapse-tool-router` surfaces `app_state_sync_*` for queries like “状态同步”, “多人联机小游戏”, “共享 JSON 实时同步”, “野狗”, “SDK 最新版本链接”.
  - Test `synapse-skill` package includes `state-sync/index.md` and `state-sync/multiplayer-game.md`.
  - Test `api-mcp-capability-surface.test.ts` expects `396` capabilities / `392` MCP tools.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `pnpm --filter @synapse/desktop test -- app-capabilities/state-sync synapse-tool-router synapse-skill api-mcp-capability-surface`
  - Expected: FAIL.

- [ ] **Step 3: Implement Desktop `state_sync` MCP domain, intent router, System Skill docs, capability registry, and `RELEASE_NOTES_PENDING.md`**
  - Mirror `desktop/app-capabilities/channels/` implementation cleanly; never ask users for personal API keys in MCP tools.
  - Ensure `app_state_sync_publish_preflight_get` returns public HTTP/WS base URLs, `sdkManifestUrl` (`<publicUrl>/sdk/manifest.json`), and `state-sync` latest SDK URLs so AI can generate working zero-backend pages in one pass.
  - Update `docs/agents/capability-registry.md` top changelog + table row (状态同步: 应用页=否, 默认 Dock=否, Workflow=—, Automation=—, MCP=14, Deep Link=—) and add user-facing Chinese bullet in `RELEASE_NOTES_PENDING.md`.

- [ ] **Step 4: Run Desktop verification suite (hard-constraints, tests, typecheck)**
  - Run: `pnpm --filter @synapse/desktop run check:hard-constraints && pnpm --filter @synapse/desktop test -- app-capabilities/state-sync synapse-tool-router synapse-skill api-mcp-capability-surface && pnpm --filter @synapse/desktop run typecheck`
  - Expected: PASS with zero constraint violations.

- [ ] **Step 5: Run Cross-Package Final Verification & Commit**
  - Run: `pnpm --filter @synapse/shared build && pnpm --filter @synapse/sdk build && pnpm --filter @synapse/sdk test && pnpm --filter @synapse/server typecheck && pnpm --filter @synapse/server test -- state-sync api-key open-api-contract deploy-config && pnpm --filter @synapse/dashboard typecheck && pnpm --filter @synapse/dashboard build && pnpm --filter @synapse/document build`
  - Expected: All builds, typechecks, and test suites PASS.
  - `git add desktop docs/agents/capability-registry.md RELEASE_NOTES_PENDING.md`
  - `git commit -m "feat(desktop): 接入状态同步 MCP 工具域、意图路由、系统 Skill 与能力注册清单"`
