# Agent Personas Cloud Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Synapse agent persona settings from local desktop authority to cloud account-backed data, with desktop retaining only a read-only offline cache.

**Architecture:** Add server-side Agent Persona resources and authenticated APIs, then make the desktop `agent-personas` capability consume those APIs through the existing account service. The desktop main process owns account-state routing and cache reads; renderer and Agent runtime consume the same list result so UI and chat stay consistent.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Electron main/preload IPC, React 19, TypeScript 6, shadcn/ui, Vitest, pnpm monorepo.

---

## Scope Check

This plan intentionally covers the whole cloud-backed persona change because the subsystems are sequentially dependent:

- Server API must exist before the desktop remote client can be meaningful.
- Desktop cache contracts must exist before renderer and Agent runtime can handle offline state.
- Agent runtime must consume the same service result as the management app to avoid split authority.

The plan does not include team sharing, admin UI, import of old local personas, or content-store reuse.

## File Structure

Create server feature:

- Create: `shared/src/agent-personas.ts` — shared DTO/input types and zod schemas.
- Modify: `shared/src/index.ts` — export shared Agent Persona contracts.
- Modify: `server/prisma/schema.prisma` — add `AgentPersona` and `AgentPersonaPreference`.
- Create: `server/prisma/migrations/<timestamp>_agent_personas/migration.sql` — database migration generated from Prisma schema.
- Create: `server/src/agent-personas/agent-personas.defaults.ts` — V1 builtin seed definition.
- Create: `server/src/agent-personas/agent-personas.service.ts` — service logic, validation, merge and seed.
- Create: `server/src/agent-personas/agent-personas.controller.ts` — authenticated user API.
- Create: `server/src/agent-personas/agent-personas.module.ts` — Nest module registration.
- Create: `server/src/agent-personas/agent-personas.service.spec.ts` — service tests.
- Create: `server/src/agent-personas/agent-personas.controller.spec.ts` — controller tests.
- Modify: `server/src/app.module.ts` — import new module.

Modify desktop shared and data repo:

- Modify: `desktop/app-capabilities/agent-personas/shared/schema.ts` — add list result, cache and tool policy schemas.
- Modify: `desktop/app-capabilities/agent-personas/shared/capability.ts` — add remote cache namespace.
- Modify: `desktop/src/types/agent-persona.ts` — export new renderer-facing types.
- Modify: `desktop/src/types/bridge.ts` — change `agentPersonas.list` return type.
- Create: `desktop/electron/runtime/data-repo/schemas/agent-persona-remote-cache.ts` — cache schema.
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts` — export and register cache schema.
- Modify: `desktop/electron/runtime/data-repo/factory.ts` — map cache namespace to json backend.
- Modify: `desktop/electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts` — cover remote cache schema.
- Modify: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts` — include namespace.

Modify desktop main service:

- Create: `desktop/app-capabilities/agent-personas/main/remote-client.ts` — API client around account authenticated fetch.
- Create: `desktop/app-capabilities/agent-personas/main/cache.ts` — read-only cache helper.
- Modify: `desktop/app-capabilities/agent-personas/main/service.ts` — route by account/remote/cache state.
- Modify: `desktop/electron/bootstrap/descriptors.ts` — inject account service and cache namespace.
- Modify: `desktop/app-capabilities/agent-personas/main/__tests__/service.test.ts` — new online/offline/cache tests.
- Modify: `desktop/app-capabilities/agent-personas/main/__tests__/blackbox.test.ts` — IPC blackbox behavior.

Modify IPC/preload:

- Modify: `desktop/app-capabilities/agent-personas/main/ipc.ts` — list response schema and changed event payload.
- Modify: `desktop/electron/preload.ts` — list result bridge.
- Modify: `desktop/electron/generated/ipc-channels.generated.ts` only if the repo generator updates it.
- Modify: `desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts` — channel and response tests.
- Modify: `desktop/electron/__tests__/preload.test.ts` — preload contract.

Modify renderer and Agent runtime:

- Modify: `desktop/app-capabilities/agent-personas/renderer/index.tsx` — login/offline states and disabled write controls.
- Modify: `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx` — UI state tests.
- Modify: `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.blackbox.test.tsx` — integrated renderer tests.
- Modify: `desktop/electron/services/agent-runtime/index.ts` — pass list items helper into persona resolver.
- Modify: `desktop/electron/services/agent-runtime/persona-runtime.ts` — missing persona falls back to ordinary mode.
- Modify: `desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts` or create it if absent.
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts` — consume list result.
- Modify: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx` — cached list and missing persona cases.

Release note:

- Modify: `RELEASE_NOTES_PENDING.md` — user-facing note for cloud-backed personas.

## Task 1: Shared Contracts And Server Schema

**Files:**
- Create: `shared/src/agent-personas.ts`
- Modify: `shared/src/index.ts`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_agent_personas/migration.sql`

- [ ] **Step 1: Write shared contract tests**

Create `shared/src/agent-personas.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  agentPersonaCreateInputSchema,
  agentPersonaDtoSchema,
  agentPersonaListResponseSchema,
  agentPersonaPreferenceUpdateInputSchema,
} from "./agent-personas"

describe("agent persona shared contracts", () => {
  it("accepts merged persona list responses", () => {
    expect(agentPersonaListResponseSchema.parse({
      items: [{
        id: "builtin-zh-en-translator",
        schemaVersion: 1,
        name: "中英翻译",
        description: "在中文和英文之间互译。",
        systemPrompt: "你是中英翻译智能体。",
        providerModel: null,
        toolPolicy: { mode: "disabled" },
        source: "builtin",
        readonly: true,
        version: 1,
        updatedAt: "2026-07-01T00:00:00.000Z",
      }],
    }).items[0]?.readonly).toBe(true)
  })

  it("normalizes create and preference payloads", () => {
    expect(agentPersonaCreateInputSchema.parse({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "allowlist", allowedTools: ["Read", "Grep"] },
    }).toolPolicy).toEqual({ mode: "allowlist", allowedTools: ["Read", "Grep"] })

    expect(agentPersonaPreferenceUpdateInputSchema.parse({
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    })).toEqual({
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    })
  })

  it("rejects editable builtin dto shape", () => {
    expect(agentPersonaDtoSchema.safeParse({
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      toolPolicy: null,
      source: "builtin",
      readonly: false,
      version: 1,
    }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the shared contract test and confirm failure**

Run:

```bash
pnpm --filter @synapse/shared exec vitest run src/agent-personas.test.ts
```

Expected: FAIL because `shared/src/agent-personas.ts` does not exist.

- [ ] **Step 3: Add shared DTO schemas**

Create `shared/src/agent-personas.ts`:

```ts
import { z } from "zod"

export const agentPersonaModelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])

export const agentPersonaProviderModelSchema = z.object({
  providerId: z.string().trim().min(1),
  modelTier: agentPersonaModelTierSchema,
}).strict()

export const agentPersonaToolPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
  z.object({
    mode: z.literal("allowlist"),
    allowedTools: z.array(z.string().trim().min(1)).default([]),
  }).strict(),
])

const baseAgentPersonaDtoSchema = z.object({
  id: z.string().trim().min(1),
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  systemPrompt: z.string().trim().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
  toolPolicy: agentPersonaToolPolicySchema.nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().trim().min(1).optional(),
  updatedAt: z.string().trim().min(1).optional(),
})

export const agentPersonaDtoSchema = z.discriminatedUnion("source", [
  baseAgentPersonaDtoSchema.extend({
    source: z.literal("builtin"),
    readonly: z.literal(true),
  }).strict(),
  baseAgentPersonaDtoSchema.extend({
    source: z.literal("user"),
    readonly: z.literal(false),
  }).strict(),
])

export const agentPersonaListResponseSchema = z.object({
  items: z.array(agentPersonaDtoSchema),
}).strict()

export const agentPersonaCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  systemPrompt: z.string().trim().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable().optional(),
  toolPolicy: agentPersonaToolPolicySchema.nullable().optional(),
}).strict()

export const agentPersonaUpdateInputSchema = agentPersonaCreateInputSchema

export const agentPersonaPreferenceUpdateInputSchema = z.object({
  providerModel: agentPersonaProviderModelSchema.nullable(),
  toolPolicy: agentPersonaToolPolicySchema.nullable(),
}).strict()

export type AgentPersonaModelTier = z.infer<typeof agentPersonaModelTierSchema>
export type AgentPersonaProviderModelDto = z.infer<typeof agentPersonaProviderModelSchema>
export type AgentPersonaToolPolicyDto = z.infer<typeof agentPersonaToolPolicySchema>
export type AgentPersonaDto = z.infer<typeof agentPersonaDtoSchema>
export type AgentPersonaListResponseDto = z.infer<typeof agentPersonaListResponseSchema>
export type AgentPersonaCreateInputDto = z.infer<typeof agentPersonaCreateInputSchema>
export type AgentPersonaUpdateInputDto = z.infer<typeof agentPersonaUpdateInputSchema>
export type AgentPersonaPreferenceUpdateInputDto = z.infer<typeof agentPersonaPreferenceUpdateInputSchema>
```

Modify `shared/src/index.ts`:

```ts
export * from "./drive.js"
export * from "./live.js"
export * from "./urls.js"
export * from "./webhook.js"
export * from "./content-store.js"
export * from "./agent-personas.js"
```

- [ ] **Step 4: Run the shared contract test and confirm pass**

Run:

```bash
pnpm --filter @synapse/shared exec vitest run src/agent-personas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add Prisma schema relations**

Modify `server/prisma/schema.prisma`:

```prisma
model User {
  id                          String                       @id @default(cuid())
  email                       String                       @unique
  displayName                 String?                      @db.VarChar(40)
  adminNote                   String?                      @db.VarChar(500)
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
  driveFileVersions           DriveFileVersion[]
  driveChanges                DriveChange[]
  driveAnnotationThreads      DriveAnnotationThread[]
  driveAnnotationComments     DriveAnnotationComment[]
  publicAssets                PublicAsset[]
  driveSites                  DriveSite[]
  contentStoreItems           ContentStoreItem[]
  contentStoreDrafts          ContentStoreDraft[]
  contentStoreInstallSessions ContentStoreInstallSession[]
  contentStoreInstallEvents   ContentStoreInstallEvent[]
  agentPersonas               AgentPersona[]
  agentPersonaPreferences     AgentPersonaPreference[]
  createdAt                   DateTime                     @default(now())
  updatedAt                   DateTime                     @updatedAt
}

model AgentPersona {
  id                   String                    @id @default(cuid())
  source               String                    @db.VarChar(16)
  ownerUserId          String?
  owner                User?                     @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  stableKey            String?                   @db.VarChar(120)
  name                 String                    @db.VarChar(120)
  description          String                    @db.VarChar(1000)
  systemPrompt         String
  defaultProviderModel Json?
  defaultToolPolicy    Json?
  status               String                    @db.VarChar(16)
  version              Int                       @default(1)
  createdAt            DateTime                  @default(now())
  updatedAt            DateTime                  @updatedAt
  preferences          AgentPersonaPreference[]

  @@unique([source, stableKey])
  @@index([ownerUserId, source, updatedAt])
  @@index([source, status, updatedAt])
}

model AgentPersonaPreference {
  id            String       @id @default(cuid())
  userId        String
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  personaId     String
  persona       AgentPersona @relation(fields: [personaId], references: [id], onDelete: Cascade)
  providerModel Json?
  toolPolicy    Json?
  updatedAt     DateTime     @updatedAt

  @@unique([userId, personaId])
  @@index([userId, updatedAt])
}
```

- [ ] **Step 6: Generate Prisma migration and client**

Run:

```bash
pnpm --filter @synapse/server exec prisma migrate dev --name agent_personas
pnpm --filter @synapse/server exec prisma generate
```

Expected: migration directory is created and Prisma client includes `agentPersona` and `agentPersonaPreference`.

- [ ] **Step 7: Commit shared and schema work**

Run:

```bash
git add shared/src/agent-personas.ts shared/src/agent-personas.test.ts shared/src/index.ts server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat: add cloud agent persona schema"
```

## Task 2: Server Agent Personas API

**Files:**
- Create: `server/src/agent-personas/agent-personas.defaults.ts`
- Create: `server/src/agent-personas/agent-personas.service.ts`
- Create: `server/src/agent-personas/agent-personas.controller.ts`
- Create: `server/src/agent-personas/agent-personas.module.ts`
- Create: `server/src/agent-personas/agent-personas.service.spec.ts`
- Create: `server/src/agent-personas/agent-personas.controller.spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write service tests**

Create `server/src/agent-personas/agent-personas.service.spec.ts` with these required cases:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { AgentPersonasService } from "./agent-personas.service"

describe("AgentPersonasService", () => {
  it("seeds builtin personas and merges user preferences", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)

    prisma.agentPersona.upsert.mockResolvedValueOnce(builtinRow({ providerModel: null, toolPolicy: { mode: "disabled" } }))
    prisma.agentPersona.findMany.mockResolvedValueOnce([
      builtinRow({ providerModel: null, toolPolicy: { mode: "disabled" } }),
      userRow({ id: "persona-user-1", ownerUserId: "user-1" }),
    ])
    prisma.agentPersonaPreference.findMany.mockResolvedValueOnce([{
      id: "pref-1",
      userId: "user-1",
      personaId: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "allowlist", allowedTools: ["Read"] },
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    }])

    await service.ensureBuiltins()
    const result = await service.list("user-1")

    expect(prisma.agentPersona.upsert).toHaveBeenCalled()
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "builtin-1",
        source: "builtin",
        readonly: true,
        providerModel: { providerId: "claude", modelTier: "sonnet" },
        toolPolicy: { mode: "allowlist", allowedTools: ["Read"] },
      }),
      expect.objectContaining({
        id: "persona-user-1",
        source: "user",
        readonly: false,
      }),
    ])
  })

  it("creates and updates only current user's personas", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.create.mockResolvedValueOnce(userRow({ id: "persona-user-1", ownerUserId: "user-1", name: "产品顾问" }))
    prisma.agentPersona.findFirst.mockResolvedValueOnce(userRow({ id: "persona-user-1", ownerUserId: "user-1" }))
    prisma.agentPersona.update.mockResolvedValueOnce(userRow({ id: "persona-user-1", ownerUserId: "user-1", name: "翻译助手" }))

    await expect(service.create("user-1", {
      name: " 产品顾问 ",
      description: " 整理产品判断。 ",
      systemPrompt: " 你是产品顾问。 ",
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    })).resolves.toMatchObject({ id: "persona-user-1", name: "产品顾问" })

    await expect(service.update("user-1", "persona-user-1", {
      name: "翻译助手",
      description: "翻译文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
      toolPolicy: null,
    })).resolves.toMatchObject({ name: "翻译助手" })
  })

  it("rejects editing builtin definitions through user update", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.findFirst.mockResolvedValueOnce(null)
    await expect(service.update("user-1", "builtin-1", {
      name: "x",
      description: "x",
      systemPrompt: "x",
      providerModel: null,
      toolPolicy: null,
    })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("updates builtin preferences only for builtin personas", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.findFirst.mockResolvedValueOnce(builtinRow({ id: "builtin-1" }))
    prisma.agentPersonaPreference.upsert.mockResolvedValueOnce({
      id: "pref-1",
      userId: "user-1",
      personaId: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    })
    prisma.agentPersona.findMany.mockResolvedValueOnce([builtinRow({ id: "builtin-1" })])
    prisma.agentPersonaPreference.findMany.mockResolvedValueOnce([])

    await expect(service.updateBuiltinPreference("user-1", "builtin-1", {
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
    })).resolves.toMatchObject({ id: "builtin-1", source: "builtin" })
  })

  it("rejects invalid source ownership combinations", () => {
    expect(() => assertPersonaRowShape({ source: "builtin", ownerUserId: "user-1", stableKey: "translator" })).toThrow(BadRequestException)
    expect(() => assertPersonaRowShape({ source: "user", ownerUserId: null, stableKey: null })).toThrow(BadRequestException)
    expect(() => assertPersonaRowShape({ source: "user", ownerUserId: "user-1", stableKey: "translator" })).toThrow(BadRequestException)
  })
})

function createPrisma() {
  return {
    agentPersona: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentPersonaPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  }
}

function builtinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "builtin-1",
    source: "builtin",
    ownerUserId: null,
    stableKey: "zh-en-translator",
    name: "中英翻译",
    description: "在中文和英文之间互译。",
    systemPrompt: "你是中英翻译智能体。",
    defaultProviderModel: null,
    defaultToolPolicy: { mode: "disabled" },
    status: "active",
    version: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "persona-user-1",
    source: "user",
    ownerUserId: "user-1",
    stableKey: null,
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    defaultProviderModel: null,
    defaultToolPolicy: null,
    status: "active",
    version: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}

function assertPersonaRowShape(row: { source: string; ownerUserId: string | null; stableKey: string | null }) {
  if (row.source === "builtin" && row.ownerUserId !== null) throw new BadRequestException()
  if (row.source === "user" && (!row.ownerUserId || row.stableKey !== null)) throw new BadRequestException()
  if (row.source !== "builtin" && row.source !== "user") throw new ForbiddenException()
}
```

- [ ] **Step 2: Run service test and confirm failure**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/agent-personas/agent-personas.service.spec.ts
```

Expected: FAIL because `AgentPersonasService` does not exist.

- [ ] **Step 3: Implement defaults and service**

Create `server/src/agent-personas/agent-personas.defaults.ts`:

```ts
import type { AgentPersonaToolPolicyDto } from "@synapse/shared"

export const BUILTIN_AGENT_PERSONA_STABLE_KEY_ZH_EN_TRANSLATOR = "zh-en-translator"

export const builtinAgentPersonas = [{
  stableKey: BUILTIN_AGENT_PERSONA_STABLE_KEY_ZH_EN_TRANSLATOR,
  name: "中英翻译",
  description: "在中文和英文之间互译，保留原意、语气和格式。",
  systemPrompt: [
    "你是中英翻译智能体。用户输入中文时翻译成英文，输入英文时翻译成中文。",
    "保持原意、语气、格式和段落结构，不添加解释，不扩写内容。",
    "遇到术语、代码、路径、命令、变量名、品牌名时保持准确；无法确定专有名词时保留原文。",
  ].join("\n"),
  defaultProviderModel: null,
  defaultToolPolicy: { mode: "disabled" } satisfies AgentPersonaToolPolicyDto,
  version: 1,
}] as const
```

Create `server/src/agent-personas/agent-personas.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common"
import type { AgentPersonaCreateInputDto, AgentPersonaDto, AgentPersonaListResponseDto, AgentPersonaPreferenceUpdateInputDto, AgentPersonaToolPolicyDto, AgentPersonaUpdateInputDto } from "@synapse/shared"
import { agentPersonaCreateInputSchema, agentPersonaPreferenceUpdateInputSchema, agentPersonaProviderModelSchema, agentPersonaToolPolicySchema, agentPersonaUpdateInputSchema } from "@synapse/shared"
import type { AgentPersona, AgentPersonaPreference } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { builtinAgentPersonas } from "./agent-personas.defaults"

@Injectable()
export class AgentPersonasService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBuiltins()
  }

  async ensureBuiltins(): Promise<void> {
    for (const item of builtinAgentPersonas) {
      await this.prisma.agentPersona.upsert({
        where: { source_stableKey: { source: "builtin", stableKey: item.stableKey } },
        create: {
          source: "builtin",
          ownerUserId: null,
          stableKey: item.stableKey,
          name: item.name,
          description: item.description,
          systemPrompt: item.systemPrompt,
          defaultProviderModel: item.defaultProviderModel,
          defaultToolPolicy: item.defaultToolPolicy,
          status: "active",
          version: item.version,
        },
        update: {
          name: item.name,
          description: item.description,
          systemPrompt: item.systemPrompt,
          defaultProviderModel: item.defaultProviderModel,
          defaultToolPolicy: item.defaultToolPolicy,
          status: "active",
          version: item.version,
        },
      })
    }
  }

  async list(userId: string): Promise<AgentPersonaListResponseDto> {
    const rows = await this.prisma.agentPersona.findMany({
      where: {
        status: "active",
        OR: [{ source: "builtin" }, { source: "user", ownerUserId: userId }],
      },
      orderBy: [{ source: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    const preferences = await this.prisma.agentPersonaPreference.findMany({
      where: { userId, personaId: { in: rows.map((row) => row.id) } },
    })
    const preferenceByPersonaId = new Map(preferences.map((preference) => [preference.personaId, preference]))
    return { items: rows.map((row) => toDto(row, preferenceByPersonaId.get(row.id))) }
  }

  async create(userId: string, input: AgentPersonaCreateInputDto): Promise<AgentPersonaDto> {
    const parsed = agentPersonaCreateInputSchema.parse(input)
    const row = await this.prisma.agentPersona.create({
      data: {
        source: "user",
        ownerUserId: userId,
        stableKey: null,
        name: parsed.name,
        description: parsed.description,
        systemPrompt: parsed.systemPrompt,
        defaultProviderModel: parsed.providerModel ?? null,
        defaultToolPolicy: parsed.toolPolicy ?? null,
        status: "active",
        version: 1,
      },
    })
    return toDto(row)
  }

  async update(userId: string, id: string, input: AgentPersonaUpdateInputDto): Promise<AgentPersonaDto> {
    const parsed = agentPersonaUpdateInputSchema.parse(input)
    const existing = await this.prisma.agentPersona.findFirst({
      where: { id, source: "user", ownerUserId: userId, status: "active" },
    })
    if (!existing) throw new NotFoundException("智能体不存在。")
    const row = await this.prisma.agentPersona.update({
      where: { id },
      data: {
        name: parsed.name,
        description: parsed.description,
        systemPrompt: parsed.systemPrompt,
        defaultProviderModel: parsed.providerModel ?? null,
        defaultToolPolicy: parsed.toolPolicy ?? null,
        version: { increment: 1 },
      },
    })
    return toDto(row)
  }

  async delete(userId: string, id: string): Promise<void> {
    const result = await this.prisma.agentPersona.updateMany({
      where: { id, source: "user", ownerUserId: userId, status: "active" },
      data: { status: "archived" },
    })
    if (result.count === 0) throw new NotFoundException("智能体不存在。")
  }

  async updateBuiltinPreference(userId: string, id: string, input: AgentPersonaPreferenceUpdateInputDto): Promise<AgentPersonaDto> {
    const parsed = agentPersonaPreferenceUpdateInputSchema.parse(input)
    const builtin = await this.prisma.agentPersona.findFirst({
      where: { id, source: "builtin", status: "active" },
    })
    if (!builtin) throw new NotFoundException("内置智能体不存在。")
    const preference = await this.prisma.agentPersonaPreference.upsert({
      where: { userId_personaId: { userId, personaId: id } },
      create: {
        userId,
        personaId: id,
        providerModel: parsed.providerModel,
        toolPolicy: parsed.toolPolicy,
      },
      update: {
        providerModel: parsed.providerModel,
        toolPolicy: parsed.toolPolicy,
      },
    })
    return toDto(builtin, preference)
  }
}

function toDto(row: AgentPersona, preference?: AgentPersonaPreference): AgentPersonaDto {
  if (row.source === "builtin") {
    if (row.ownerUserId !== null || !row.stableKey) throw new BadRequestException("内置智能体数据无效。")
    return {
      id: row.id,
      schemaVersion: 1,
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      providerModel: normalizeProviderModel(preference?.providerModel ?? row.defaultProviderModel),
      toolPolicy: normalizeToolPolicy(preference?.toolPolicy ?? row.defaultToolPolicy),
      source: "builtin",
      readonly: true,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
  if (row.source !== "user" || !row.ownerUserId || row.stableKey !== null) throw new BadRequestException("用户智能体数据无效。")
  return {
    id: row.id,
    schemaVersion: 1,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    providerModel: normalizeProviderModel(row.defaultProviderModel),
    toolPolicy: normalizeToolPolicy(row.defaultToolPolicy),
    source: "user",
    readonly: false,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function normalizeProviderModel(value: unknown): AgentPersonaDto["providerModel"] {
  if (value === null || value === undefined) return null
  return agentPersonaProviderModelSchema.parse(value)
}

function normalizeToolPolicy(value: unknown): AgentPersonaToolPolicyDto | null {
  if (value === null || value === undefined) return null
  return agentPersonaToolPolicySchema.parse(value)
}
```

- [ ] **Step 4: Run service test and confirm pass**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/agent-personas/agent-personas.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write controller tests**

Create `server/src/agent-personas/agent-personas.controller.spec.ts`:

```ts
import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { AgentPersonasController } from "./agent-personas.controller"
import { AgentPersonasService } from "./agent-personas.service"

type SupertestRequest = {
  readonly send: (body: unknown) => SupertestRequest
  readonly expect: (status: number) => Promise<{ readonly body: unknown }>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly post: (path: string) => SupertestRequest
  readonly put: (path: string) => SupertestRequest
  readonly delete: (path: string) => SupertestRequest
}

describe("AgentPersonasController", () => {
  let app: INestApplication | null = null
  const service = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateBuiltinPreference: vi.fn(),
  }

  beforeEach(async () => {
    service.list.mockResolvedValue({ items: [] })
    service.create.mockResolvedValue(persona("persona-1"))
    service.update.mockResolvedValue(persona("persona-1"))
    service.delete.mockResolvedValue(undefined)
    service.updateBuiltinPreference.mockResolvedValue({ ...persona("builtin-1"), source: "builtin", readonly: true })

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentPersonasController],
      providers: [{ provide: AgentPersonasService, useValue: service }],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: { id: string } } } }) => {
        ctx.switchToHttp().getRequest().user = { id: "user-1" }
        return true
      } })
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
    vi.clearAllMocks()
  })

  it("routes authenticated list and writes to the current user", async () => {
    await request(app!.getHttpServer()).get("/api/agent-personas").expect(200)
    expect(service.list).toHaveBeenCalledWith("user-1")

    await request(app!.getHttpServer()).post("/api/agent-personas").send({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      toolPolicy: null,
    }).expect(201)
    expect(service.create).toHaveBeenCalledWith("user-1", expect.objectContaining({ name: "产品顾问" }))
  })

  it("routes update, delete and builtin preferences", async () => {
    await request(app!.getHttpServer()).put("/api/agent-personas/persona-1").send({
      name: "翻译助手",
      description: "翻译文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
      toolPolicy: null,
    }).expect(200)
    expect(service.update).toHaveBeenCalledWith("user-1", "persona-1", expect.objectContaining({ name: "翻译助手" }))

    await request(app!.getHttpServer()).put("/api/agent-personas/builtin/builtin-1/preferences").send({
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    }).expect(200)
    expect(service.updateBuiltinPreference).toHaveBeenCalledWith("user-1", "builtin-1", expect.objectContaining({ toolPolicy: { mode: "disabled" } }))

    await request(app!.getHttpServer()).delete("/api/agent-personas/persona-1").expect(200)
    expect(service.delete).toHaveBeenCalledWith("user-1", "persona-1")
  })

  it("rejects invalid payloads", async () => {
    await request(app!.getHttpServer()).post("/api/agent-personas").send({
      name: "",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      toolPolicy: null,
    }).expect(400)
  })
})

function persona(id: string) {
  return {
    id,
    schemaVersion: 1,
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    providerModel: null,
    toolPolicy: null,
    source: "user",
    readonly: false,
    version: 1,
  }
}
```

- [ ] **Step 6: Implement controller and module**

Create `server/src/agent-personas/agent-personas.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common"
import { agentPersonaCreateInputSchema, agentPersonaPreferenceUpdateInputSchema, agentPersonaUpdateInputSchema } from "@synapse/shared"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { AgentPersonasService } from "./agent-personas.service"

@UseGuards(UserAuthGuard)
@Controller("/api/agent-personas")
export class AgentPersonasController {
  constructor(private readonly service: AgentPersonasService) {}

  @Get()
  list(@Req() request: AuthenticatedUserRequest) {
    return this.service.list(requireUserId(request))
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(agentPersonaCreateInputSchema, body, "智能体请求无效。")
    return this.service.create(requireUserId(request), parsed)
  }

  @Put("/:id")
  update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(agentPersonaUpdateInputSchema, body, "智能体请求无效。")
    return this.service.update(requireUserId(request), id, parsed)
  }

  @Delete("/:id")
  async delete(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    await this.service.delete(requireUserId(request), id)
    return { ok: true }
  }

  @Put("/builtin/:id/preferences")
  updateBuiltinPreference(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(agentPersonaPreferenceUpdateInputSchema, body, "智能体设置请求无效。")
    return this.service.updateBuiltinPreference(requireUserId(request), id, parsed)
  }
}

function requireUserId(request: AuthenticatedUserRequest): string {
  if (!request.user?.id) throw new BadRequestException("账号信息无效。")
  return request.user.id
}

function parseBody<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown } }, body: unknown, message: string): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw badRequestFromZodError(parsed.error, message)
  return parsed.data
}
```

Create `server/src/agent-personas/agent-personas.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { AgentPersonasController } from "./agent-personas.controller"
import { AgentPersonasService } from "./agent-personas.service"

@Module({
  imports: [UserAuthModule, PrismaModule],
  controllers: [AgentPersonasController],
  providers: [AgentPersonasService],
  exports: [AgentPersonasService],
})
export class AgentPersonasModule {}
```

Modify `server/src/app.module.ts`:

```ts
import { AgentPersonasModule } from "./agent-personas/agent-personas.module"
```

Add `AgentPersonasModule` to `imports` before `ContentStoreModule`.

- [ ] **Step 7: Run server feature tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/agent-personas/agent-personas.service.spec.ts src/agent-personas/agent-personas.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server API**

Run:

```bash
git add server/src/agent-personas server/src/app.module.ts
git commit -m "feat: add cloud agent personas api"
```

## Task 3: Desktop Contracts And Remote Cache Schema

**Files:**
- Modify: `desktop/app-capabilities/agent-personas/shared/capability.ts`
- Modify: `desktop/app-capabilities/agent-personas/shared/schema.ts`
- Modify: `desktop/src/types/agent-persona.ts`
- Modify: `desktop/src/types/bridge.ts`
- Create: `desktop/electron/runtime/data-repo/schemas/agent-persona-remote-cache.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/factory.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`

- [ ] **Step 1: Write cache schema tests**

Add to `desktop/electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts`:

```ts
import { agentPersonaRemoteCacheSchema, type AgentPersonaRemoteCacheEntryV1 } from "../schemas/agent-persona-remote-cache"

it("accepts remote cache entries partitioned by user id", () => {
  const entry: AgentPersonaRemoteCacheEntryV1 = {
    schemaVersion: 1,
    users: {
      "user-1": {
        syncedAt: "2026-07-01T00:00:00.000Z",
        items: [{
          id: "persona-1",
          schemaVersion: 1,
          name: "产品顾问",
          description: "整理产品判断。",
          systemPrompt: "你是产品顾问。",
          providerModel: null,
          toolPolicy: { mode: "disabled" },
          source: "user",
          readonly: false,
          version: 1,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        }],
      },
    },
  }
  expect(agentPersonaRemoteCacheSchema.validate(entry)).toBe(true)
})
```

Add namespace expectation:

```ts
expect(allSchemas.some((schema) => schema.name === "app.agent-personas.remote-cache")).toBe(true)
```

- [ ] **Step 2: Run schema tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: FAIL because remote cache schema is missing.

- [ ] **Step 3: Add desktop shared result and cache contracts**

Modify `desktop/app-capabilities/agent-personas/shared/capability.ts`:

```ts
export const AGENT_PERSONAS_APP_ID = "agent-personas" as const
export const AGENT_PERSONAS_ITEMS_NAMESPACE = "app.agent-personas.items" as const
export const AGENT_PERSONAS_SETTINGS_NAMESPACE = "app.agent-personas.settings" as const
export const AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE = "app.agent-personas.remote-cache" as const
```

Modify `desktop/app-capabilities/agent-personas/shared/schema.ts` so it imports from shared and exposes desktop list state:

```ts
import {
  agentPersonaCreateInputSchema,
  agentPersonaDtoSchema,
  agentPersonaPreferenceUpdateInputSchema,
  agentPersonaProviderModelSchema,
  agentPersonaToolPolicySchema,
  agentPersonaUpdateInputSchema,
  type AgentPersonaDto,
} from "@synapse/shared"
import { z } from "zod"

export const agentPersonaModelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])
export { agentPersonaProviderModelSchema, agentPersonaToolPolicySchema }

export const agentPersonaSourceSchema = z.enum(["builtin", "user"])
export const agentPersonaSchema = agentPersonaDtoSchema

export const agentPersonaDesktopListStatusSchema = z.enum([
  "unauthenticated",
  "online",
  "offline-cache",
  "offline-empty",
])

export const agentPersonaListResultSchema = z.object({
  status: agentPersonaDesktopListStatusSchema,
  items: z.array(agentPersonaSchema),
  syncedAt: z.string().min(1).optional(),
}).strict()

export const agentPersonaCreateInputDesktopSchema = agentPersonaCreateInputSchema
export const agentPersonaUpdateInputDesktopSchema = agentPersonaUpdateInputSchema.extend({
  id: z.string().min(1),
})
export const agentPersonaBuiltinModelUpdateInputSchema = z.object({
  id: z.string().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
  toolPolicy: agentPersonaToolPolicySchema.nullable().optional(),
}).strict()
export const agentPersonaIdInputSchema = z.object({ id: z.string().min(1) }).strict()

export const agentPersonaChangedEventSchema = z.object({
  result: agentPersonaListResultSchema,
  items: z.array(agentPersonaSchema),
}).strict()

export type AgentPersona = AgentPersonaDto
export type AgentPersonaModelTier = z.infer<typeof agentPersonaModelTierSchema>
export type AgentPersonaProviderModel = z.infer<typeof agentPersonaProviderModelSchema>
export type AgentPersonaToolPolicy = z.infer<typeof agentPersonaToolPolicySchema>
export type AgentPersonaListResult = z.infer<typeof agentPersonaListResultSchema>
export type AgentPersonaBuiltinModelUpdateInput = z.infer<typeof agentPersonaBuiltinModelUpdateInputSchema>
export type AgentPersonaCreateInput = z.infer<typeof agentPersonaCreateInputDesktopSchema>
export type AgentPersonaUpdateInput = z.infer<typeof agentPersonaUpdateInputDesktopSchema>
export type AgentPersonaIdInput = z.infer<typeof agentPersonaIdInputSchema>
export type AgentPersonaChangedEvent = z.infer<typeof agentPersonaChangedEventSchema>
```

Keep compatibility aliases only if existing imports require old names:

```ts
export { agentPersonaCreateInputDesktopSchema as agentPersonaCreateInputSchema }
export { agentPersonaUpdateInputDesktopSchema as agentPersonaUpdateInputSchema }
```

- [ ] **Step 4: Add remote cache schema**

Create `desktop/electron/runtime/data-repo/schemas/agent-persona-remote-cache.ts`:

```ts
import { agentPersonaDtoSchema } from "@synapse/shared"
import { AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE } from "../../../../app-capabilities/agent-personas/shared/capability"
import type { NamespaceSchema } from "../types"

export interface AgentPersonaRemoteCacheUserBucketV1 extends Record<string, unknown> {
  syncedAt: string
  items: unknown[]
}

export interface AgentPersonaRemoteCacheEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  users: Record<string, AgentPersonaRemoteCacheUserBucketV1>
}

export const agentPersonaRemoteCacheSchema: NamespaceSchema<AgentPersonaRemoteCacheEntryV1> = {
  name: AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE,
  backend: "json",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  defaults: () => ({ schemaVersion: 1, users: {} }),
  validate: isAgentPersonaRemoteCacheEntryV1,
}

function isAgentPersonaRemoteCacheEntryV1(value: unknown): value is AgentPersonaRemoteCacheEntryV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.users)) return false
  return Object.entries(value.users).every(([userId, bucket]) =>
    typeof userId === "string"
    && userId.trim().length > 0
    && isRecord(bucket)
    && typeof bucket.syncedAt === "string"
    && !Number.isNaN(Date.parse(bucket.syncedAt))
    && Array.isArray(bucket.items)
    && bucket.items.every((item) => agentPersonaDtoSchema.safeParse(item).success),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

Register it in `desktop/electron/runtime/data-repo/schemas/index.ts` and `desktop/electron/runtime/data-repo/factory.ts` using the same patterns as existing json namespaces.

- [ ] **Step 5: Update renderer-facing bridge types**

Modify `desktop/src/types/agent-persona.ts`:

```ts
import type {
  AgentPersona,
  AgentPersonaBuiltinModelUpdateInput,
  AgentPersonaChangedEvent,
  AgentPersonaCreateInput,
  AgentPersonaIdInput,
  AgentPersonaListResult,
  AgentPersonaProviderModel,
  AgentPersonaToolPolicy,
  AgentPersonaUpdateInput,
} from "../../app-capabilities/agent-personas/shared/schema"

export type SynapseAgentPersona = AgentPersona
export type SynapseAgentPersonaProviderModel = AgentPersonaProviderModel
export type SynapseAgentPersonaToolPolicy = AgentPersonaToolPolicy
export type SynapseAgentPersonaListResult = AgentPersonaListResult
export type SynapseAgentPersonaBuiltinModelUpdateInput = AgentPersonaBuiltinModelUpdateInput
export type SynapseAgentPersonaCreateInput = AgentPersonaCreateInput
export type SynapseAgentPersonaUpdateInput = AgentPersonaUpdateInput
export type SynapseAgentPersonaIdInput = AgentPersonaIdInput
export type SynapseAgentPersonaChangedEvent = AgentPersonaChangedEvent
```

Modify `desktop/src/types/bridge.ts`:

```ts
agentPersonas: {
  list: () => Promise<SynapseAgentPersonaListResult>
  create: (input: SynapseAgentPersonaCreateInput) => Promise<SynapseAgentPersona>
  update: (input: SynapseAgentPersonaUpdateInput) => Promise<SynapseAgentPersona>
  updateBuiltinModel: (input: SynapseAgentPersonaBuiltinModelUpdateInput) => Promise<SynapseAgentPersona>
  delete: (input: SynapseAgentPersonaIdInput) => Promise<void>
  onChanged: (listener: (event: SynapseAgentPersonaChangedEvent) => void) => () => void
}
```

- [ ] **Step 6: Run desktop schema/type tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts electron/runtime/data-repo/__tests__/schemas.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: schema tests PASS. Typecheck may fail until service and IPC are updated in later tasks; record the current errors and proceed.

- [ ] **Step 7: Commit contracts and cache schema**

Run:

```bash
git add desktop/app-capabilities/agent-personas/shared desktop/src/types/agent-persona.ts desktop/src/types/bridge.ts desktop/electron/runtime/data-repo
git commit -m "feat: add agent persona cloud cache contract"
```

## Task 4: Desktop Remote Client And Main Service Routing

**Files:**
- Create: `desktop/app-capabilities/agent-personas/main/remote-client.ts`
- Create: `desktop/app-capabilities/agent-personas/main/cache.ts`
- Modify: `desktop/app-capabilities/agent-personas/main/service.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/app-capabilities/agent-personas/main/__tests__/service.test.ts`
- Modify: `desktop/app-capabilities/agent-personas/main/__tests__/blackbox.test.ts`

- [ ] **Step 1: Replace service tests with cloud-routing tests**

In `desktop/app-capabilities/agent-personas/main/__tests__/service.test.ts`, keep local validation tests where still relevant, then add:

```ts
it("returns unauthenticated without reading old local items", async () => {
  const harness = createCloudHarness({ accountState: { status: "unauthenticated" } })
  harness.localItems.records.set("legacy", legacyUserPersona())
  const service = createAgentPersonaService(harness.deps)

  await expect(service.list()).resolves.toEqual({ status: "unauthenticated", items: [] })
  expect(harness.remote.list).not.toHaveBeenCalled()
})

it("loads remote personas online and writes read-only cache", async () => {
  const harness = createCloudHarness({
    accountState: authenticatedOnline("user-1"),
    remoteItems: [remoteBuiltin(), remoteUser()],
  })
  const service = createAgentPersonaService(harness.deps)

  await expect(service.list()).resolves.toMatchObject({
    status: "online",
    items: [expect.objectContaining({ id: "builtin-1" }), expect.objectContaining({ id: "persona-1" })],
  })
  expect(harness.cache.singleton?.users["user-1"]?.items.map((item) => item.id)).toEqual(["builtin-1", "persona-1"])
})

it("falls back to current user cache when remote list fails", async () => {
  const harness = createCloudHarness({
    accountState: authenticatedOffline("user-1"),
    remoteError: new Error("network down"),
    cacheUsers: {
      "user-1": { syncedAt: "2026-07-01T00:00:00.000Z", items: [remoteUser()] },
      "user-2": { syncedAt: "2026-07-01T00:00:00.000Z", items: [remoteBuiltin({ id: "other-user-cache" })] },
    },
  })
  const service = createAgentPersonaService(harness.deps)

  await expect(service.list()).resolves.toEqual({
    status: "offline-cache",
    syncedAt: "2026-07-01T00:00:00.000Z",
    items: [remoteUser()],
  })
})

it("does not write cache on failed mutations", async () => {
  const harness = createCloudHarness({
    accountState: authenticatedOffline("user-1"),
    remoteError: new Error("network down"),
  })
  const service = createAgentPersonaService(harness.deps)

  await expect(service.create({
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    providerModel: null,
    toolPolicy: null,
  })).rejects.toThrow("当前离线，无法保存智能体")
  expect(harness.cache.singleton).toBeNull()
})
```

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/service.test.ts
```

Expected: FAIL because service still reads local DataRepository authority.

- [ ] **Step 3: Implement remote client**

Create `desktop/app-capabilities/agent-personas/main/remote-client.ts`:

```ts
import { agentPersonaDtoSchema, agentPersonaListResponseSchema } from "@synapse/shared"
import type {
  AgentPersona,
  AgentPersonaBuiltinModelUpdateInput,
  AgentPersonaCreateInput,
  AgentPersonaUpdateInput,
} from "../shared/schema"

export type AgentPersonaAccountPort = {
  fetchAuthenticated(pathOrUrl: string, init?: RequestInit, errorMessage?: string): Promise<Response>
}

export class RemoteAgentPersonaClient {
  constructor(private readonly account: AgentPersonaAccountPort) {}

  async list(): Promise<AgentPersona[]> {
    const response = await this.account.fetchAuthenticated("/agent-personas", {}, "智能体加载失败。")
    const payload = await readJson(response)
    return agentPersonaListResponseSchema.parse(payload).items
  }

  async create(input: AgentPersonaCreateInput): Promise<AgentPersona> {
    return this.write("POST", "/agent-personas", input, "智能体保存失败。")
  }

  async update(input: AgentPersonaUpdateInput): Promise<AgentPersona> {
    const { id, ...body } = input
    return this.write("PUT", `/agent-personas/${encodeURIComponent(id)}`, body, "智能体保存失败。")
  }

  async updateBuiltinModel(input: AgentPersonaBuiltinModelUpdateInput): Promise<AgentPersona> {
    return this.write("PUT", `/agent-personas/builtin/${encodeURIComponent(input.id)}/preferences`, {
      providerModel: input.providerModel,
      toolPolicy: input.toolPolicy ?? null,
    }, "智能体设置保存失败。")
  }

  async delete(input: { id: string }): Promise<void> {
    await this.account.fetchAuthenticated(`/agent-personas/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
    }, "智能体删除失败。")
  }

  private async write(method: string, path: string, body: unknown, errorMessage: string): Promise<AgentPersona> {
    const response = await this.account.fetchAuthenticated(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, errorMessage)
    return agentPersonaDtoSchema.parse(await readJson(response))
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : undefined
}
```

- [ ] **Step 4: Implement cache helper**

Create `desktop/app-capabilities/agent-personas/main/cache.ts`:

```ts
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentPersonaRemoteCacheEntryV1 } from "../../../electron/runtime/data-repo/schemas/agent-persona-remote-cache"
import type { AgentPersona } from "../shared/schema"

export type AgentPersonaCacheBucket = {
  readonly syncedAt: string
  readonly items: readonly AgentPersona[]
}

export class AgentPersonaCache {
  constructor(private readonly namespace: DataNamespace<AgentPersonaRemoteCacheEntryV1>) {}

  async read(userId: string): Promise<AgentPersonaCacheBucket | null> {
    const cache = await this.namespace.getSingleton()
    const bucket = cache?.users[userId]
    if (!bucket) return null
    return { syncedAt: bucket.syncedAt, items: bucket.items as AgentPersona[] }
  }

  async write(userId: string, items: readonly AgentPersona[], syncedAt: string): Promise<void> {
    const current = await this.namespace.getSingleton() ?? { schemaVersion: 1 as const, users: {} }
    await this.namespace.setSingleton({
      schemaVersion: 1,
      users: {
        ...current.users,
        [userId]: {
          syncedAt,
          items: [...items],
        },
      },
    })
  }
}
```

- [ ] **Step 5: Refactor service to cloud authority**

Modify `desktop/app-capabilities/agent-personas/main/service.ts` to use deps:

```ts
export type AgentPersonaServiceDeps = {
  readonly remote: RemoteAgentPersonaClient
  readonly cache: AgentPersonaCache
  readonly account: {
    getState(): SynapseAccountState
  }
  readonly now?: () => Date
  readonly logger: AgentPersonaLogger
}
```

Service routing:

```ts
async function list(): Promise<AgentPersonaListResult> {
  const state = deps.account.getState()
  if (state.status !== "authenticated") return { status: "unauthenticated", items: [] }
  const userId = state.profile.user.id
  try {
    const items = await deps.remote.list()
    const syncedAt = timestamp()
    await deps.cache.write(userId, items, syncedAt)
    return { status: "online", items, syncedAt }
  } catch (error) {
    deps.logger.warn("Agent personas remote list failed.", { error, boundary: "agent-personas.remote.list" })
    const cached = await deps.cache.read(userId)
    if (!cached) return { status: "offline-empty", items: [] }
    return { status: "offline-cache", items: [...cached.items], syncedAt: cached.syncedAt }
  }
}

async function create(input: AgentPersonaCreateInput): Promise<AgentPersona> {
  requireOnlineAccount()
  const saved = await deps.remote.create(input)
  await refreshCacheAfterWrite()
  return saved
}
```

Implement `update`, `updateBuiltinModel`, and `delete` with the same pattern:

- Require authenticated online state.
- Call remote mutation.
- Refresh remote list and overwrite cache on success.
- Emit changed event with latest list result.
- Do not read or mutate old `items` and `settings` namespaces.

Keep user-facing write error:

```ts
function requireOnlineAccount(): { userId: string } {
  const state = deps.account.getState()
  if (state.status !== "authenticated") throw new Error("请先登录。")
  if (state.connectivity !== "online") throw new Error("当前离线，无法保存智能体。")
  return { userId: state.profile.user.id }
}
```

- [ ] **Step 6: Update bootstrap descriptor**

Modify `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { AgentPersonaCache } from "../../app-capabilities/agent-personas/main/cache"
import { RemoteAgentPersonaClient } from "../../app-capabilities/agent-personas/main/remote-client"
import { AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE } from "../../app-capabilities/agent-personas/shared/capability"
import type { AgentPersonaRemoteCacheEntryV1 } from "../runtime/data-repo/schemas/agent-persona-remote-cache"
import { accountService } from "../services/account-service"
```

Descriptor create:

```ts
return createAgentPersonaService({
  remote: new RemoteAgentPersonaClient(accountService),
  cache: new AgentPersonaCache(dataRepository.namespace<AgentPersonaRemoteCacheEntryV1>(AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE)),
  account: accountService,
  logger: ctx.logger.child("agent-personas"),
})
```

- [ ] **Step 7: Run main service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/service.test.ts app-capabilities/agent-personas/main/__tests__/blackbox.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit desktop main service**

Run:

```bash
git add desktop/app-capabilities/agent-personas/main desktop/electron/bootstrap/descriptors.ts
git commit -m "feat: route agent personas through cloud service"
```

## Task 5: IPC And Preload List Result

**Files:**
- Modify: `desktop/app-capabilities/agent-personas/main/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Update IPC tests for list result**

Modify `desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts`:

```ts
it("returns list result status over IPC", async () => {
  const service = {
    events: { on: vi.fn() },
    list: vi.fn(async () => ({ status: "unauthenticated", items: [] })),
  }
  const ctx = createCtx(service)

  await expect(agentPersonasIpcModule.methods.list.handler(ctx as never, undefined))
    .resolves.toEqual({ status: "unauthenticated", items: [] })
  expect(agentPersonasIpcModule.methods.list.response.safeParse({ status: "unauthenticated", items: [] }).success).toBe(true)
})

it("broadcasts changed result and compatibility items", async () => {
  const broadcast = vi.fn()
  const service = createEventService()
  const ctx = createCtx(service, broadcast)

  await agentPersonasIpcModule.methods.list.handler(ctx as never, undefined)
  service.emitChanged({ status: "online", items: [persona()], syncedAt: "2026-07-01T00:00:00.000Z" })

  expect(broadcast).toHaveBeenCalledWith("synapse:agent-personas:changed", {
    result: { status: "online", items: [persona()], syncedAt: "2026-07-01T00:00:00.000Z" },
    items: [persona()],
  })
})
```

- [ ] **Step 2: Run IPC tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: FAIL because IPC still returns `AgentPersona[]`.

- [ ] **Step 3: Update IPC module**

Modify `desktop/app-capabilities/agent-personas/main/ipc.ts`:

```ts
import {
  agentPersonaChangedEventSchema,
  agentPersonaListResultSchema,
} from "../shared/schema"
```

Use:

```ts
list: {
  channel: "synapse:agent-personas:list",
  kind: "invoke",
  request: z.void(),
  response: agentPersonaListResultSchema,
  handler: (ctx) => resolveAgentPersonaService(ctx).list(),
},
```

Event broadcast:

```ts
service.events.on("changed", (result) => {
  windowManager.broadcast(agentPersonasIpcModule.events.changed.channel, {
    result,
    items: result.items,
  })
})
```

- [ ] **Step 4: Update preload bridge**

Modify `desktop/electron/preload.ts` only where type or helper assumptions require it. The list invocation stays:

```ts
agentPersonas: {
  list: () => invoke(IPC_CHANNELS.agentPersonas.list)(),
  create: (input) => invoke(IPC_CHANNELS.agentPersonas.create)(input),
  update: (input) => invoke(IPC_CHANNELS.agentPersonas.update)(input),
  updateBuiltinModel: (input) => invoke(IPC_CHANNELS.agentPersonas.updateBuiltinModel)(input),
  delete: (input) => invoke(IPC_CHANNELS.agentPersonas.delete)(input),
  onChanged: (listener) => on(
    IPC_CHANNELS.agentPersonas.changed,
    listener,
  ),
}
```

Regenerate the IPC channel snapshot:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` is unchanged or updated only for the agent personas channel contract, and `check:ipc-codegen` passes.

- [ ] **Step 5: Run IPC/preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit IPC work**

Run:

```bash
git add desktop/app-capabilities/agent-personas/main/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat: expose agent persona list state over ipc"
```

## Task 6: Renderer App Login And Offline States

**Files:**
- Modify: `desktop/app-capabilities/agent-personas/renderer/index.tsx`
- Modify: `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx`
- Modify: `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.blackbox.test.tsx`

- [ ] **Step 1: Update renderer tests**

Add test cases in `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx`:

```ts
it("shows login action when personas require authentication", async () => {
  bridge.list.mockResolvedValueOnce({ status: "unauthenticated", items: [] })
  await renderModule()

  expect(document.body.textContent).toContain("登录后使用智能体")
  expect(buttonWithText("登录")).toBeTruthy()
  expect(buttonWithText("新增")).toBeNull()
})

it("disables writes when rendering offline cache", async () => {
  bridge.list.mockResolvedValueOnce({
    status: "offline-cache",
    syncedAt: "2026-07-01T00:00:00.000Z",
    items: fixtures.items,
  })
  await renderModule()

  expect(document.body.textContent).toContain("离线")
  await clickButton("我的")
  expect(buttonWithText("新增")?.hasAttribute("disabled")).toBe(true)
  expect(buttonByLabel("编辑智能体：产品顾问")?.hasAttribute("disabled")).toBe(true)
  expect(buttonByLabel("删除智能体：产品顾问")?.hasAttribute("disabled")).toBe(true)
})

it("shows reconnect state when offline cache is empty", async () => {
  bridge.list.mockResolvedValueOnce({ status: "offline-empty", items: [] })
  await renderModule()

  expect(document.body.textContent).toContain("重新连接后加载")
  expect(buttonWithText("新增")).toBeNull()
})
```

Update existing `bridge.list` fixture to return:

```ts
list: vi.fn(async () => ({ status: "online", items: fixtures.items })),
```

Update event fixture:

```ts
onChanged: vi.fn(() => vi.fn()),
```

When invoking changed events in blackbox tests, pass:

```ts
{ result: { status: "online", items: fixtures.items }, items: fixtures.items }
```

- [ ] **Step 2: Run renderer tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.blackbox.test.tsx
```

Expected: FAIL because renderer expects `list()` to return an array.

- [ ] **Step 3: Implement renderer state handling**

Modify `desktop/app-capabilities/agent-personas/renderer/index.tsx` state:

```ts
const [listResult, setListResult] = useState<SynapseAgentPersonaListResult>({ status: "offline-empty", items: [] })
const items = listResult.items
const isReadOnly = listResult.status === "offline-cache"
const requiresLogin = listResult.status === "unauthenticated"
const offlineEmpty = listResult.status === "offline-empty"
```

Reload:

```ts
const result = await agentPersonasBridge.list()
setListResult(result)
```

Changed subscription:

```ts
return agentPersonasBridge.onChanged((event) => {
  setListResult(event.result)
})
```

Actions:

```tsx
actions={activeTab === "user" && !requiresLogin && !offlineEmpty ? (
  <Button type="button" onClick={openCreateForm} disabled={isReadOnly}>
    <Plus data-icon="inline-start" />
    新增
  </Button>
) : null}
```

Status surfaces:

```tsx
{requiresLogin ? (
  <Empty className="min-h-40 border bg-background">
    <EmptyHeader>
      <EmptyTitle>登录后使用智能体</EmptyTitle>
    </EmptyHeader>
    <Button type="button" onClick={() => void openAccountSettings()}>
      登录
    </Button>
  </Empty>
) : offlineEmpty ? (
  <Empty className="min-h-40 border bg-background">
    <EmptyHeader>
      <EmptyTitle>重新连接后加载</EmptyTitle>
    </EmptyHeader>
  </Empty>
) : isReadOnly ? (
  <Alert>
    <CircleAlert />
    <AlertTitle>离线</AlertTitle>
    <AlertDescription>可使用上次同步的智能体，暂不能修改。</AlertDescription>
  </Alert>
) : null}
```

Use existing account navigation helper if available. In this repo, prefer `requestOpenSettingsAccount` from `desktop/src/app-shell/navigation.ts` if exported; otherwise use `requireBridgeDomain("apps").openSystemApp("settings", ...)` following existing app-open patterns.

Disable table actions by passing `readOnly={isReadOnly}`:

```tsx
<AgentPersonaTable
  items={visibleItems}
  tab={activeTab}
  readOnly={isReadOnly}
  onConfigureModel={(item) => openItem(item, "configureBuiltinModel")}
  onEdit={(item) => openItem(item, "edit")}
  onDelete={setDeleteTarget}
/>
```

Inside action buttons:

```tsx
<Button disabled={readOnly} ... />
```

- [ ] **Step 4: Keep form submission guarded**

At the top of `submitForm`:

```ts
if (isReadOnly) {
  toast.error("离线时不能修改智能体")
  return
}
```

At the top of `deleteItem`:

```ts
if (isReadOnly) {
  toast.error("离线时不能删除智能体")
  return
}
```

- [ ] **Step 5: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.blackbox.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit renderer state work**

Run:

```bash
git add desktop/app-capabilities/agent-personas/renderer
git commit -m "feat: show cloud persona account states"
```

## Task 7: Agent Runtime And Chat Consumption

**Files:**
- Modify: `desktop/electron/services/agent-runtime/persona-runtime.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Create or modify: `desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`

- [ ] **Step 1: Write runtime resolver tests**

Create `desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts` if it does not exist:

```ts
import { describe, expect, it } from "vitest"
import { createAgentPersonaRuntimeResolver } from "../persona-runtime"

describe("Agent persona runtime resolver", () => {
  it("falls back to ordinary mode when saved persona is missing", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [],
    })

    await expect(resolver.resolve({
      agentConfig: {
        activeMainThreadPersonaId: "missing",
        activeMainThreadPersonaSnapshot: {
          id: "missing",
          name: "旧智能体",
          source: "user",
          definitionHash: "old",
        },
      },
    })).resolves.toMatchObject({
      activePersonaId: null,
      activeAgentName: undefined,
      agents: {},
    })
  })

  it("maps cached or remote personas to SDK main thread agents", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [{
        id: "persona-1",
        schemaVersion: 1,
        name: "产品顾问",
        description: "整理产品判断。",
        systemPrompt: "你是产品顾问。",
        providerModel: null,
        toolPolicy: { mode: "disabled" },
        source: "user",
        readonly: false,
        version: 1,
      }],
    })

    const result = await resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: "persona-1" },
    })

    expect(result.activeAgentName).toBe("synapse-persona__persona-1")
    expect(result.agents["synapse-persona__persona-1"]).toMatchObject({
      description: "整理产品判断。",
      prompt: "你是产品顾问。",
      disallowedTools: ["Agent"],
    })
  })
})
```

- [ ] **Step 2: Run runtime resolver test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/persona-runtime.test.ts
```

Expected: FAIL because missing persona currently throws.

- [ ] **Step 3: Make missing persona fall back ordinary**

Modify `desktop/electron/services/agent-runtime/persona-runtime.ts`:

```ts
const persona = personas.find((item) => item.id === activePersonaId)
if (!persona) {
  return { activePersonaId: null, agents, definitionsHash }
}
```

Keep `AGENT_PERSONA_UNAVAILABLE_MESSAGE` only if other callers still use it; otherwise remove dead references after typecheck.

- [ ] **Step 4: Update agent runtime service list adapter**

Modify `desktop/electron/services/agent-runtime/index.ts`:

```ts
const personaRuntimeResolver = agentPersonas
  ? createAgentPersonaRuntimeResolver({
    listPersonas: async () => (await agentPersonas.list()).items,
  })
  : undefined
```

- [ ] **Step 5: Update chat hook tests**

Modify `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx` bridge mock:

```ts
agentPersonas: {
  list: vi.fn(async () => ({
    status: "online",
    items: [{
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      toolPolicy: { mode: "disabled" },
      source: "builtin",
      readonly: true,
      version: 1,
    }],
  })),
  onChanged: vi.fn(() => vi.fn()),
}
```

Add an offline cache case:

```ts
it("loads persona menu from offline cache result", async () => {
  bridge.agentPersonas.list.mockResolvedValueOnce({
    status: "offline-cache",
    syncedAt: "2026-07-01T00:00:00.000Z",
    items: [cachedPersona()],
  })
  const chat = await renderUseAgentChat()
  expect(chat?.personas.map((item) => item.id)).toEqual(["persona-cache"])
})
```

- [ ] **Step 6: Update chat connection implementation**

Modify `desktop/src/modules/agent/hooks/use-chat-connection.ts`:

```ts
const personaResult = await bridge.agentPersonas.list()
dispatch({ type: "SET_PERSONAS", personas: personaResult.items })
```

Changed event:

```ts
dispatch({ type: "SET_PERSONAS", personas: event.items })
```

Keep event compatibility by reading `event.result.items` if `event.items` is absent:

```ts
const items = event.items ?? event.result.items
dispatch({ type: "SET_PERSONAS", personas: items })
```

- [ ] **Step 7: Run runtime and chat tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/persona-runtime.test.ts src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit runtime integration**

Run:

```bash
git add desktop/electron/services/agent-runtime desktop/src/modules/agent/hooks
git commit -m "feat: use cloud persona list in agent runtime"
```

## Task 8: Final Verification And Release Note

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add under the pending release section in `RELEASE_NOTES_PENDING.md`:

```md
- 智能体配置改为跟随账号云端同步；未登录时需要先登录，离线时可继续使用上次同步的智能体但不能编辑，旧本地智能体不会自动迁移到云端。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/shared exec vitest run src/agent-personas.test.ts
pnpm --filter @synapse/server exec vitest run src/agent-personas/agent-personas.service.spec.ts src/agent-personas/agent-personas.controller.spec.ts
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts electron/runtime/data-repo/__tests__/schemas.test.ts app-capabilities/agent-personas/main/__tests__/service.test.ts app-capabilities/agent-personas/main/__tests__/ipc.test.ts app-capabilities/agent-personas/main/__tests__/blackbox.test.ts app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.blackbox.test.tsx electron/services/agent-runtime/__tests__/persona-runtime.test.ts src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx electron/__tests__/preload.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run typechecks**

Run:

```bash
pnpm --filter @synapse/shared run typecheck
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/desktop run typecheck
```

Expected: all typechecks PASS. If any package has no `typecheck` script, inspect its `package.json` and run the closest existing check script.

- [ ] **Step 4: Run lint or build check if available**

Run:

```bash
pnpm --filter @synapse/server run lint
pnpm --filter @synapse/desktop run lint
```

Expected: PASS if scripts exist. If a script is absent, record that it was not available and do not invent a new command.

- [ ] **Step 5: Commit release note and final fixes**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note cloud agent personas"
```

## Self-Review Notes

- Spec coverage: server resource, cloud authority, no local migration, read-only cache, login/offline UI, account isolation, runtime fallback, and release note are each covered by tasks.
- Old local `app.agent-personas.items/settings` are intentionally not used by the new service; tests in Task 4 assert this.
- The plan keeps V1 builtin management as service seed and does not add admin UI.
- The plan changes list return type once and adapts IPC, renderer, and Agent chat consumers in later tasks.
- Each implementation task has focused tests and a commit checkpoint.
