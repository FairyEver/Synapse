# Personal Module Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace team-based permissions and user signup invitations with open registration plus administrator-managed personal module permissions.

**Architecture:** The server keeps teams as relationship data only and moves product access to `UserModulePermission`. The dashboard uses the existing `synapse_admin` HttpOnly cookie session, but exposes it through `/api/dashboard/*` endpoints for both administrator and normal user dashboard flows.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vitest, React, React Router, shadcn/Radix dashboard components.

---

## Context

Approved design:

- `docs/superpowers/specs/2026-05-25-personal-module-permissions-design.md`

Important existing files:

- `server/prisma/schema.prisma` currently contains the old team permission tables.
- `server/src/admin-auth/admin-auth.service.ts` already authenticates both admin and normal users into a dashboard JWT.
- `server/src/admin-auth/admin-auth.controller.ts` currently exposes those dashboard session endpoints under `/api/admin`.
- `server/src/auth/user-auth.guard.ts` already accepts bearer tokens or the `synapse_admin` dashboard cookie for normal users.
- `dashboard/src/lib/api.ts` currently calls `/api/admin/login`, `/api/admin/session`, `/api/admin/logout`.
- `dashboard/src/pages/signup-page.tsx` still requires `invitationToken`.
- `dashboard/src/pages/teams-page.tsx` still renders team permission and access role UI.

## File Map

Create:

- `server/src/dashboard/dashboard.controller.ts` - cookie-authenticated normal user dashboard profile endpoint.
- `server/src/dashboard/dashboard.module.ts` - dashboard normal user module.
- `server/src/dashboard/dashboard.controller.spec.ts` - tests for `/api/dashboard/me` behavior.
- `dashboard/src/pages/me-page.tsx` - normal user account/team page.

Modify:

- `server/prisma/schema.prisma` - add `UserModulePermission`; delete old team permission models/enums/relations.
- `server/prisma/migrations/<timestamp>_personal_module_permissions/migration.sql` - create/drop tables and delete `user_signup` invitations.
- `server/src/permissions/permission-registry.ts` - replace old keys with `module.*`.
- `server/src/permissions/permissions.service.ts` - rewrite around personal module permissions.
- `server/src/permissions/permissions.service.spec.ts` - replace team permission tests with user module permission tests.
- `server/src/auth/user-auth.controller.ts` - make registration open.
- `server/src/auth/user-auth.service.ts` - stop consuming signup invitations; reject admin email; remove permission output from normal `me`.
- `server/src/auth/user-auth.service.spec.ts` - update registration and `me` tests.
- `server/src/admin-auth/admin-auth.controller.ts` - move dashboard login/session/logout endpoints to `/api/dashboard`.
- `server/src/admin-auth/admin-auth.controller.spec.ts` - update endpoint semantics and cookie tests.
- `server/src/admin/admin.controller.ts` - remove team permission endpoints; add user module permission endpoints.
- `server/src/admin/admin.service.ts` - remove team permission methods; add user module permission methods and list summaries.
- `server/src/admin/admin.controller.spec.ts` - replace removed endpoint tests.
- `server/src/admin/admin.service.spec.ts` - replace removed team permission tests.
- `server/src/teams/teams.service.ts` - remove `PermissionsService`; team owner authorizes invitations/member removal.
- `server/src/teams/teams.service.spec.ts` - update owner/member tests and remove access role expectations.
- `server/src/app.module.ts` - import `DashboardModule`.
- `dashboard/src/lib/api.ts` - update dashboard auth paths and add module permission/user profile API methods.
- `dashboard/src/hooks/use-auth.tsx` - support admin/user sessions and redirects.
- `dashboard/src/app.tsx` - add role-aware protected routes.
- `dashboard/src/routes.ts` - split admin and user route definitions.
- `dashboard/src/components/app-sidebar.tsx` - render role-specific navigation.
- `dashboard/src/pages/signup-page.tsx` - remove invitation field.
- `dashboard/src/pages/users-page.tsx` - add module permission editor.
- `dashboard/src/pages/teams-page.tsx` - remove team permission sheet.
- `dashboard/src/pages/invitations-page.tsx` - remove user signup invitation creation/list assumptions or remove route from admin navigation.

Delete after references are gone:

- Old team permission code paths in `server/src/permissions/permissions.service.ts`.
- Dashboard UI state/types for `TeamAccessRoleRow`, `TeamEntitlementsResponse`, member access roles.

---

### Task 1: Prisma Schema And Migration

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_personal_module_permissions/migration.sql`

- [ ] **Step 1: Update Prisma schema**

Edit `server/prisma/schema.prisma` with these changes:

```prisma
enum InvitationType {
  team_join
}

model AdminUser {
  id                       String                 @id @default(cuid())
  email                    String                 @unique
  passwordHash             String
  status                   AdminStatus            @default(active)
  invitations              Invitation[]
  grantedModulePermissions UserModulePermission[]
  createdAt                DateTime               @default(now())
  updatedAt                DateTime               @updatedAt
}

model User {
  id                  String                 @id @default(cuid())
  email               String                 @unique
  passwordHash        String
  status              UserStatus             @default(active)
  memberships         TeamMembership[]
  createdTeams        Team[]                 @relation("TeamCreator")
  sessions            UserSession[]
  acceptedInvitations Invitation[]           @relation("AcceptedInvitations")
  createdInvitations  Invitation[]           @relation("UserCreatedInvitations")
  modulePermissions   UserModulePermission[]
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt
}

model Team {
  id              String           @id @default(cuid())
  name            String
  createdByUserId String           @unique
  createdByUser   User             @relation("TeamCreator", fields: [createdByUserId], references: [id])
  memberships     TeamMembership[]
  invitations     Invitation[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}

model TeamMembership {
  id        String   @id @default(cuid())
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id])
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  role      TeamRole
  createdAt DateTime @default(now())

  @@unique([teamId, userId])
  @@index([teamId])
}

model UserModulePermission {
  id               String    @id @default(cuid())
  userId           String
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  permissionKey    String
  grantedByAdminId String?
  grantedByAdmin   AdminUser? @relation(fields: [grantedByAdminId], references: [id])
  grantedAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([userId, permissionKey])
  @@index([permissionKey])
  @@index([grantedByAdminId])
}
```

Remove these enums/models and all relations to them:

```prisma
enum TeamEntitlementSource
enum TeamAccessRoleKind
model TeamEntitlement
model TeamAccessRole
model TeamAccessRolePermission
model TeamMemberAccessRole
```

- [ ] **Step 2: Create migration**

Run:

```bash
pnpm --filter @synapse/server exec prisma migrate dev --name personal_module_permissions --create-only
```

Expected: Prisma creates a new directory under `server/prisma/migrations/`.

- [ ] **Step 3: Edit migration SQL**

Open the generated `migration.sql` and make sure it explicitly deletes old signup invitations before the enum is narrowed and drops old permission tables.

The migration must contain equivalent SQL:

```sql
DELETE FROM "Invitation" WHERE "type" = 'user_signup';

CREATE TABLE "UserModulePermission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "grantedByAdminId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserModulePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserModulePermission_userId_permissionKey_key"
  ON "UserModulePermission"("userId", "permissionKey");
CREATE INDEX "UserModulePermission_permissionKey_idx"
  ON "UserModulePermission"("permissionKey");
CREATE INDEX "UserModulePermission_grantedByAdminId_idx"
  ON "UserModulePermission"("grantedByAdminId");

ALTER TABLE "UserModulePermission"
  ADD CONSTRAINT "UserModulePermission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserModulePermission"
  ADD CONSTRAINT "UserModulePermission_grantedByAdminId_fkey"
  FOREIGN KEY ("grantedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "TeamMemberAccessRole";
DROP TABLE IF EXISTS "TeamAccessRolePermission";
DROP TABLE IF EXISTS "TeamAccessRole";
DROP TABLE IF EXISTS "TeamEntitlement";
```

If Prisma emits enum replacement SQL for `InvitationType`, keep only `team_join` and verify old `user_signup` rows are deleted first.

- [ ] **Step 4: Validate Prisma schema**

Run:

```bash
pnpm --filter @synapse/server exec prisma validate
pnpm --filter @synapse/server run prisma:generate
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(server): add personal module permission schema"
```

---

### Task 2: Rewrite Permission Registry And Service

**Files:**

- Modify: `server/src/permissions/permission-registry.ts`
- Modify: `server/src/permissions/permissions.service.ts`
- Modify: `server/src/permissions/permissions.service.spec.ts`

- [ ] **Step 1: Replace registry tests**

Replace the registry tests in `server/src/permissions/permissions.service.spec.ts` with:

```ts
import { BadRequestException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import {
  allModulePermissionKeys,
  assertActiveModulePermissionKey,
  modulePermissionDefinitions,
  normalizeModulePermissionKeys,
} from "./permission-registry"
import { PermissionsService } from "./permissions.service"

describe("module permission registry", () => {
  it("keeps module permission keys unique", () => {
    expect(new Set(allModulePermissionKeys).size).toBe(allModulePermissionKeys.length)
    expect(allModulePermissionKeys).toEqual([
      "module.skill",
      "module.rule",
      "module.prompt",
      "module.agent",
      "module.database",
      "module.scheduler",
      "module.workflow",
      "module.tools",
      "module.local",
      "module.usage",
    ])
  })

  it("rejects old action-style keys", () => {
    expect(() => assertActiveModulePermissionKey("content.skill.use")).toThrow("Unknown module permission key: content.skill.use")
    expect(() => assertActiveModulePermissionKey("workflow.use")).toThrow("Unknown module permission key: workflow.use")
  })

  it("dedupes and sorts module permission keys by registry order", () => {
    expect(normalizeModulePermissionKeys(["module.workflow", "module.skill", "module.workflow"])).toEqual([
      "module.skill",
      "module.workflow",
    ])
  })

  it("marks all first-release module permissions active", () => {
    expect(modulePermissionDefinitions.every((item) => item.status === "active")).toBe(true)
  })
})
```

- [ ] **Step 2: Replace service tests**

Add these tests in the same file:

```ts
function createPermissionPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
    },
    userModulePermission: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(createPermissionPrismaMock())),
  }
}

describe("PermissionsService", () => {
  it("lists user module permissions in registry order", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.userModulePermission.findMany.mockResolvedValue([
      { permissionKey: "module.workflow" },
      { permissionKey: "module.skill" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.listUserModulePermissions("user-1")).resolves.toEqual([
      "module.skill",
      "module.workflow",
    ])

    expect(prisma.userModulePermission.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { permissionKey: true },
    })
  })

  it("replaces user module permissions in one transaction", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.user.findUnique.mockResolvedValue({ id: "user-1" })
    tx.userModulePermission.findMany.mockResolvedValue([
      { permissionKey: "module.database" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceUserModulePermissions({
      userId: "user-1",
      permissionKeys: ["module.workflow", "module.skill", "module.workflow"],
      grantedByAdminId: "admin-1",
    })).resolves.toEqual({
      before: ["module.database"],
      after: ["module.skill", "module.workflow"],
    })

    expect(tx.userModulePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        permissionKey: { notIn: ["module.skill", "module.workflow"] },
      },
    })
    expect(tx.userModulePermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", permissionKey: "module.skill", grantedByAdminId: "admin-1" },
        { userId: "user-1", permissionKey: "module.workflow", grantedByAdminId: "admin-1" },
      ],
      skipDuplicates: true,
    })
  })

  it("throws when replacing permissions for a missing user", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.user.findUnique.mockResolvedValue(null)
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceUserModulePermissions({
      userId: "missing",
      permissionKeys: ["module.skill"],
      grantedByAdminId: "admin-1",
    })).rejects.toThrow(NotFoundException)
  })

  it("rejects unknown module permission keys", async () => {
    const service = new PermissionsService(createPermissionPrismaMock() as never)

    await expect(service.replaceUserModulePermissions({
      userId: "user-1",
      permissionKeys: ["database.use"],
      grantedByAdminId: "admin-1",
    })).rejects.toThrow(BadRequestException)
  })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- permissions.service.spec.ts
```

Expected: FAIL because old registry/service names still exist.

- [ ] **Step 4: Replace registry implementation**

Replace `server/src/permissions/permission-registry.ts` with:

```ts
export type ModulePermissionStatus = "active" | "deprecated"

export interface ModulePermissionDefinition {
  readonly key: string
  readonly label: string
  readonly group: string
  readonly sortOrder: number
  readonly status: ModulePermissionStatus
}

const definitions = [
  { key: "module.skill", label: "技能", group: "content", sortOrder: 10 },
  { key: "module.rule", label: "规则", group: "content", sortOrder: 20 },
  { key: "module.prompt", label: "提示词", group: "content", sortOrder: 30 },
  { key: "module.agent", label: "对话", group: "agent", sortOrder: 40 },
  { key: "module.database", label: "数据", group: "database", sortOrder: 50 },
  { key: "module.scheduler", label: "定时", group: "automation", sortOrder: 60 },
  { key: "module.workflow", label: "工作流", group: "automation", sortOrder: 70 },
  { key: "module.tools", label: "工具", group: "tools", sortOrder: 80 },
  { key: "module.local", label: "本机", group: "local", sortOrder: 90 },
  { key: "module.usage", label: "使用分析", group: "usage", sortOrder: 100 },
] as const satisfies readonly Omit<ModulePermissionDefinition, "status">[]

export const modulePermissionDefinitions: readonly ModulePermissionDefinition[] = definitions.map((item) => ({
  ...item,
  status: "active",
}))

export const allModulePermissionKeys: readonly string[] = modulePermissionDefinitions.map((item) => item.key)

const definitionByKey = new Map(modulePermissionDefinitions.map((item) => [item.key, item]))
const registryOrder = new Map(allModulePermissionKeys.map((key, index) => [key, index]))

export function getModulePermissionDefinition(key: string): ModulePermissionDefinition | null {
  return definitionByKey.get(key) ?? null
}

export function isActiveModulePermissionKey(key: string): boolean {
  return getModulePermissionDefinition(key)?.status === "active"
}

export function assertActiveModulePermissionKey(key: string): void {
  const definition = getModulePermissionDefinition(key)
  if (!definition) throw new Error(`Unknown module permission key: ${key}`)
  if (definition.status !== "active") throw new Error(`Module permission key is not active: ${key}`)
}

export function normalizeModulePermissionKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const key of keys) {
    assertActiveModulePermissionKey(key)
    seen.add(key)
  }
  return [...seen].sort((a, b) => (registryOrder.get(a) ?? 0) - (registryOrder.get(b) ?? 0))
}
```

- [ ] **Step 5: Replace service implementation**

Replace `server/src/permissions/permissions.service.ts` with:

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { modulePermissionDefinitions, normalizeModulePermissionKeys } from "./permission-registry"
import { PrismaService } from "../prisma/prisma.service"

type PrismaClientLike = PrismaService | Prisma.TransactionClient

export interface ReplaceUserModulePermissionsResult {
  readonly before: string[]
  readonly after: string[]
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  listModulePermissionDefinitions() {
    return modulePermissionDefinitions
  }

  async listUserModulePermissions(userId: string, client: PrismaClientLike = this.prisma): Promise<string[]> {
    const rows = await client.userModulePermission.findMany({
      where: { userId },
      select: { permissionKey: true },
    })
    return normalizeModulePermissionKeys(rows.map((row) => row.permissionKey))
  }

  async replaceUserModulePermissions(input: {
    readonly userId: string
    readonly permissionKeys: readonly string[]
    readonly grantedByAdminId?: string
  }): Promise<ReplaceUserModulePermissionsResult> {
    let nextKeys: string[]
    try {
      nextKeys = normalizeModulePermissionKeys(input.permissionKeys)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "模块权限无效。")
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      })
      if (!user) throw new NotFoundException("用户不存在。")

      const before = await this.listUserModulePermissions(input.userId, tx)
      await tx.userModulePermission.deleteMany({
        where: {
          userId: input.userId,
          permissionKey: { notIn: nextKeys },
        },
      })
      if (nextKeys.length > 0) {
        await tx.userModulePermission.createMany({
          data: nextKeys.map((permissionKey) => ({
            userId: input.userId,
            permissionKey,
            grantedByAdminId: input.grantedByAdminId,
          })),
          skipDuplicates: true,
        })
      }
      return { before, after: nextKeys }
    })
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- permissions.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/permissions
git commit -m "feat(server): replace team permissions with module registry"
```

---

### Task 3: Open Registration And Normal User Profile Shape

**Files:**

- Modify: `server/src/auth/user-auth.controller.ts`
- Modify: `server/src/auth/user-auth.service.ts`
- Modify: `server/src/auth/user-auth.service.spec.ts`
- Modify: `server/src/auth/user-auth.controller.spec.ts`

- [ ] **Step 1: Update service registration tests**

In `server/src/auth/user-auth.service.spec.ts`, remove invalid invitation registration tests and replace the registration success test with:

```ts
it("registers users without an invitation and starts with no module permissions", async () => {
  const prisma = createPrismaMock()
  prisma.adminUser = {
    findUnique: vi.fn().mockResolvedValue(null),
  } as never
  const tx = {
    user: {
      create: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", status: "active" }),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
    },
  }
  prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
  const auditLog = { record: vi.fn() }
  const service = new UserAuthService(
    prisma as never,
    new JwtService({ secret: "user-secret-at-least-32-characters!" }),
    { accessMinutes: 15, refreshDays: 30 },
    auditLog as never,
  )

  await service.register({
    email: "U@example.com",
    password: "StrongPassword123!",
  }, "203.0.113.25")

  expect(tx.user.create).toHaveBeenCalledWith({
    data: {
      email: "u@example.com",
      passwordHash: expect.any(String),
    },
  })
  expect(auditLog.record).toHaveBeenCalledWith({
    adminEmail: "u@example.com",
    action: "user.register.success",
    targetType: "user",
    targetId: "user-1",
    ipAddress: "203.0.113.25",
  })
})
```

Also add:

```ts
it("rejects registration with the administrator email", async () => {
  const prisma = createPrismaMock()
  prisma.adminUser = {
    findUnique: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com" }),
  } as never
  const service = new UserAuthService(
    prisma as never,
    new JwtService({ secret: "user-secret-at-least-32-characters!" }),
    { accessMinutes: 15, refreshDays: 30 },
  )

  await expect(service.register({
    email: "admin@example.com",
    password: "StrongPassword123!",
  })).rejects.toThrow("邮箱已注册。")
})
```

- [ ] **Step 2: Update controller tests**

In `server/src/auth/user-auth.controller.spec.ts`, change register body expectations from `{ invitationToken, email, password }` to `{ email, password }`.

Add:

```ts
it("rejects registration bodies with invitation tokens", async () => {
  const auth = { register: vi.fn() }
  const controller = new UserAuthController(auth as never)

  await expect(controller.register({
    invitationToken: "old-token",
    email: "user@example.com",
    password: "StrongPassword123!",
  }, { ip: "203.0.113.20" } as never)).rejects.toThrow("注册请求无效。")

  expect(auth.register).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- user-auth.service.spec.ts user-auth.controller.spec.ts
```

Expected: FAIL because the service/controller still require invitations.

- [ ] **Step 4: Update controller schema**

In `server/src/auth/user-auth.controller.ts`, change:

```ts
const registerSchema = z.object({
  invitationToken: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
}).strict()
```

to:

```ts
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
}).strict()
```

- [ ] **Step 5: Update `UserAuthService` constructor and register**

Remove `InvitationsService` and `PermissionsService` from the constructor and module wiring. The constructor should become:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly jwt: JwtService,
  @Inject(userAuthOptionsToken) private readonly options: UserAuthOptions,
  @Optional() private readonly auditLog?: AuditLogService,
) {}
```

In `server/src/auth/user-auth.service.ts`, change register to:

```ts
async register(input: { email: string; password: string }, ipAddress = "system"): Promise<UserTokenPair> {
  const email = input.email.trim().toLowerCase()
  const adminWithEmail = await this.prisma.adminUser.findUnique({
    where: { email },
    select: { id: true },
  })
  if (adminWithEmail) {
    await this.recordUserRegistrationFailure({
      adminEmail: email,
      reason: "duplicate_email",
      ipAddress,
    })
    throw new BadRequestException("邮箱已注册。")
  }
  try {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: await hashPassword(input.password),
        },
      })
      const tokens = await this.issueTokenPair(user, tx)
      return { tokens, user }
    })
    await this.auditLog?.record({
      adminEmail: result.user.email,
      action: "user.register.success",
      targetType: "user",
      targetId: result.user.id,
      ipAddress,
    })
    return result.tokens
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await this.recordUserRegistrationFailure({
        adminEmail: email,
        reason: "duplicate_email",
        ipAddress,
      })
      throw new BadRequestException("邮箱已注册。")
    }
    throw error
  }
}
```

Update the failure reason type to only include `"duplicate_email"`.

- [ ] **Step 6: Update normal user `me` shape**

In `getMe`, remove `accessRoles` selection and `effectivePermissions`. The membership selection should only include `id`, `teamId`, `role`, and `team`. Return only:

```ts
const teams = user.memberships.map((membership) => ({
  id: membership.team.id,
  name: membership.team.name,
  membershipId: membership.id,
  membershipRole: membership.role,
}))
```

- [ ] **Step 7: Update module wiring**

In `server/src/auth/user-auth.module.ts`:

- Remove `InvitationsModule` import.
- Remove `PermissionsModule` import.
- Update constructor tests accordingly.

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- user-auth.service.spec.ts user-auth.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/auth
git commit -m "feat(server): allow open user registration"
```

---

### Task 4: Admin APIs For Personal Module Permissions

**Files:**

- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.spec.ts`
- Modify: `server/src/admin/admin.service.spec.ts`

- [ ] **Step 1: Replace controller tests**

In `server/src/admin/admin.controller.spec.ts`, remove tests for team entitlements, team permissions, access roles, and member access roles.

Add:

```ts
it("lists module permission definitions through the service", () => {
  const listModulePermissions = vi.fn().mockReturnValue([{ key: "module.skill" }])
  const controller = createController({ listModulePermissions } as never)

  expect(controller.listModulePermissions()).toEqual([{ key: "module.skill" }])
  expect(listModulePermissions).toHaveBeenCalledWith()
})

it("lists a user's module permissions through the service", async () => {
  const listUserModulePermissions = vi.fn().mockResolvedValue({ permissionKeys: ["module.skill"] })
  const controller = createController({ listUserModulePermissions } as never)

  await expect(controller.listUserModulePermissions("user-1")).resolves.toEqual({ permissionKeys: ["module.skill"] })
  expect(listUserModulePermissions).toHaveBeenCalledWith("user-1")
})

it("replaces a user's module permissions through the service", async () => {
  const replaceUserModulePermissions = vi.fn().mockResolvedValue({ permissionKeys: ["module.skill"] })
  const controller = createController({ replaceUserModulePermissions } as never)

  await expect(controller.replaceUserModulePermissions(
    "user-1",
    { permissionKeys: ["module.skill"] },
    { admin: { id: "admin-1", email: "admin@example.com" }, ip: "203.0.113.88" } as never,
  )).resolves.toEqual({ permissionKeys: ["module.skill"] })

  expect(replaceUserModulePermissions).toHaveBeenCalledWith(
    "user-1",
    ["module.skill"],
    { id: "admin-1", email: "admin@example.com" },
    "203.0.113.88",
  )
})

it("rejects invalid user module permission keys", async () => {
  const replaceUserModulePermissions = vi.fn()
  const controller = createController({ replaceUserModulePermissions } as never)

  await expect(controller.replaceUserModulePermissions(
    "user-1",
    { permissionKeys: ["database.use"] },
    { admin: { id: "admin-1", email: "admin@example.com" } } as never,
  )).rejects.toThrow("用户模块权限无效。")

  expect(replaceUserModulePermissions).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run controller tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- admin.controller.spec.ts
```

Expected: FAIL because the new endpoints do not exist.

- [ ] **Step 3: Update controller schemas and methods**

In `server/src/admin/admin.controller.ts`, import `isActiveModulePermissionKey`.

Add:

```ts
const modulePermissionKeysSchema = z.array(z.string().trim().min(1).refine(isActiveModulePermissionKey))

const userModulePermissionsSchema = z.object({
  permissionKeys: modulePermissionKeysSchema,
}).strict()
```

Add methods:

```ts
@Get("/module-permissions")
listModulePermissions() {
  return this.admin.listModulePermissions()
}

@Get("/users/:id/module-permissions")
listUserModulePermissions(@Param("id") id: string) {
  return this.admin.listUserModulePermissions(id)
}

@Put("/users/:id/module-permissions")
async replaceUserModulePermissions(
  @Param("id") id: string,
  @Body() body: unknown,
  @Req() request: AdminRequest,
) {
  const result = userModulePermissionsSchema.safeParse(body)
  if (!result.success) throw new BadRequestException("用户模块权限无效。")
  return this.admin.replaceUserModulePermissions(id, result.data.permissionKeys, request.admin!, request.ip)
}
```

Remove all team permission/access-role route methods and schemas.

- [ ] **Step 4: Update admin service**

In `server/src/admin/admin.service.ts`:

- Remove `TeamRolePermissionsInput` import and team permission methods.
- Update `adminUserSelect` to include `modulePermissions`.

Use:

```ts
const adminUserSelect = {
  id: true,
  email: true,
  status: true,
  memberships: {
    select: {
      id: true,
      role: true,
      createdAt: true,
      team: { select: { id: true, name: true } },
    },
  },
  modulePermissions: {
    select: { permissionKey: true },
    orderBy: { permissionKey: "asc" },
  },
  createdAt: true,
  updatedAt: true,
} as const
```

Update `adminTeamSelect` to remove `accessRoles`.

Add:

```ts
listModulePermissions() {
  return this.permissions.listModulePermissionDefinitions()
}

async listUserModulePermissions(userId: string) {
  await this.assertUserExists(userId)
  return { permissionKeys: await this.permissions.listUserModulePermissions(userId) }
}

async replaceUserModulePermissions(
  userId: string,
  permissionKeys: readonly string[],
  admin: { readonly id: string; readonly email: string },
  ipAddress = "system",
) {
  const result = await this.permissions.replaceUserModulePermissions({
    userId,
    permissionKeys,
    grantedByAdminId: admin.id,
  })
  await this.auditLog?.record({
    adminEmail: admin.email,
    action: "admin.user_module_permissions.replace",
    targetType: "user",
    targetId: userId,
    detail: result,
    ipAddress,
  })
  return { permissionKeys: result.after }
}
```

Add helper:

```ts
private async assertUserExists(userId: string): Promise<void> {
  const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw new NotFoundException("用户不存在。")
}
```

- [ ] **Step 5: Update admin service tests**

Replace old team permission tests with service tests for:

```ts
it("lists module permission definitions", () => {
  const permissions = { listModulePermissionDefinitions: vi.fn().mockReturnValue([{ key: "module.skill" }]) }
  const service = new AdminService({} as never, {} as never, permissions as never)

  expect(service.listModulePermissions()).toEqual([{ key: "module.skill" }])
})

it("replaces user module permissions and records audit", async () => {
  const permissions = {
    replaceUserModulePermissions: vi.fn().mockResolvedValue({
      before: ["module.database"],
      after: ["module.skill"],
    }),
  }
  const auditLog = { record: vi.fn() }
  const service = new AdminService({} as never, {} as never, permissions as never, auditLog as never)

  await expect(service.replaceUserModulePermissions(
    "user-1",
    ["module.skill"],
    { id: "admin-1", email: "admin@example.com" },
    "203.0.113.90",
  )).resolves.toEqual({ permissionKeys: ["module.skill"] })

  expect(auditLog.record).toHaveBeenCalledWith({
    adminEmail: "admin@example.com",
    action: "admin.user_module_permissions.replace",
    targetType: "user",
    targetId: "user-1",
    detail: {
      before: ["module.database"],
      after: ["module.skill"],
    },
    ipAddress: "203.0.113.90",
  })
})
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- admin.controller.spec.ts admin.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/admin
git commit -m "feat(server): add user module permission admin api"
```

---

### Task 5: Remove Team Permission Behavior

**Files:**

- Modify: `server/src/teams/teams.service.ts`
- Modify: `server/src/teams/teams.service.spec.ts`
- Modify: `server/src/teams/teams.controller.spec.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`

- [ ] **Step 1: Update team tests**

In `server/src/teams/teams.service.spec.ts`, remove expectations for:

- `ensureDefaultTeamAccess`
- `assignOrdinaryMemberRole`
- `accessRoles` includes
- `team.invitation.manage`
- `team.member.manage`

Add tests:

```ts
it("lets team owners create team invitations", async () => {
  const prisma = createTeamsPrismaMock()
  prisma.teamMembership.findUnique.mockResolvedValue({
    id: "membership-1",
    teamId: "team-1",
    userId: "owner-1",
    role: "owner",
    team: { id: "team-1" },
  })
  const invitations = {
    createTeamInvitation: vi.fn().mockResolvedValue({ id: "invite-1" }),
  }
  const service = new TeamsService(prisma as never, invitations as never)

  await expect(service.createInvitation("owner-1", "https://app.example.com")).resolves.toEqual({ id: "invite-1" })
})

it("rejects team invitation creation for non-owners", async () => {
  const prisma = createTeamsPrismaMock()
  prisma.teamMembership.findUnique.mockResolvedValue({
    id: "membership-1",
    teamId: "team-1",
    userId: "member-1",
    role: "member",
    team: { id: "team-1" },
  })
  const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

  await expect(service.createInvitation("member-1", "https://app.example.com")).rejects.toThrow(ForbiddenException)
})
```

- [ ] **Step 2: Run team tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- teams.service.spec.ts teams.controller.spec.ts
```

Expected: FAIL because service still depends on permission roles.

- [ ] **Step 3: Remove `PermissionsService` from `TeamsService`**

In `server/src/teams/teams.service.ts`:

- Remove `PermissionsService` import and constructor parameter.
- In `createTeam`, remove `ensureDefaultTeamAccess`.
- In `joinTeam`, remove `assignOrdinaryMemberRole` and `accessRoles` include.
- In `getMyTeam` and `listMembers`, remove `accessRoles` include.
- Replace `requireTeamPermission` with `requireTeamOwner`.

Use:

```ts
private async requireTeamOwner(userId: string) {
  const membership = await this.getMembership(userId)
  if (!membership || membership.role !== "owner") throw new ForbiddenException()
  return membership
}
```

Then:

```ts
const membership = await this.requireTeamOwner(userId)
```

for `createInvitation`, and:

```ts
actorMembership = await this.requireTeamOwner(actorUserId)
```

for `removeMember`.

- [ ] **Step 4: Update admin list selectors**

Make sure `server/src/admin/admin.service.ts` does not select or return `accessRoles` under users or team memberships.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- teams.service.spec.ts teams.controller.spec.ts admin.service.spec.ts admin.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/teams server/src/admin
git commit -m "feat(server): remove team access roles"
```

---

### Task 6: Dashboard Session Endpoints And User Profile Endpoint

**Files:**

- Modify: `server/src/admin-auth/admin-auth.controller.ts`
- Modify: `server/src/admin-auth/admin-auth.controller.spec.ts`
- Create: `server/src/dashboard/dashboard.controller.ts`
- Create: `server/src/dashboard/dashboard.module.ts`
- Create: `server/src/dashboard/dashboard.controller.spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Update auth controller tests for `/api/dashboard` intent**

In `server/src/admin-auth/admin-auth.controller.spec.ts`, keep direct method tests but rename descriptions from admin session to dashboard session:

```ts
it("sets dashboard session cookies with shared options", async () => {
  const auth = {
    login: vi.fn().mockResolvedValue({
      email: "user@example.com",
      role: "user",
      token: "dashboard-token",
    }),
  }
  const controller = new AdminAuthController(auth as never)
  const response = { cookie: vi.fn() }

  await expect(controller.login({
    email: "user@example.com",
    password: "secret",
  }, { ip: "203.0.113.11" } as never, response as never)).resolves.toEqual({
    email: "user@example.com",
    role: "user",
  })

  expect(response.cookie).toHaveBeenCalledWith("synapse_admin", "dashboard-token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })
})
```

- [ ] **Step 2: Move controller route prefix**

In `server/src/admin-auth/admin-auth.controller.ts`, change:

```ts
@Controller("/api/admin")
```

to:

```ts
@Controller("/api/dashboard")
```

Keep method paths as `/login`, `/logout`, `/session`.

- [ ] **Step 3: Add dashboard profile controller tests**

Create `server/src/dashboard/dashboard.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { DashboardController } from "./dashboard.controller"

describe("DashboardController", () => {
  it("returns the normal user dashboard profile", async () => {
    const auth = {
      getMe: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", status: "active" },
        teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.me({ user: { id: "user-1" } } as never)).resolves.toEqual({
      user: { id: "user-1", email: "user@example.com", status: "active" },
      teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
    })
    expect(auth.getMe).toHaveBeenCalledWith("user-1")
  })
})
```

- [ ] **Step 4: Create dashboard controller/module**

Create `server/src/dashboard/dashboard.controller.ts`:

```ts
import { Controller, Get, Req, UseGuards } from "@nestjs/common"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"

@UseGuards(UserAuthGuard)
@Controller("/api/dashboard")
export class DashboardController {
  constructor(private readonly auth: UserAuthService) {}

  @Get("/me")
  me(@Req() request: AuthenticatedUserRequest) {
    return this.auth.getMe(request.user!.id)
  }
}
```

Create `server/src/dashboard/dashboard.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { DashboardController } from "./dashboard.controller"

@Module({
  imports: [UserAuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
```

Add `DashboardModule` to `server/src/app.module.ts`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- admin-auth.controller.spec.ts dashboard.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/admin-auth server/src/dashboard server/src/app.module.ts
git commit -m "feat(server): add dashboard session endpoints"
```

---

### Task 7: Dashboard API Client And Role-Aware Auth

**Files:**

- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/hooks/use-auth.tsx`
- Modify: `dashboard/src/routes.ts`
- Modify: `dashboard/src/app.tsx`

- [ ] **Step 1: Update API types and client**

In `dashboard/src/lib/api.ts`:

- Change `adminApiBasePath` session calls to `/api/dashboard`.
- Keep admin business APIs under `/api/admin`.
- Add module permission and dashboard user profile types.

Add:

```ts
export type ModulePermissionDefinition = {
  key: string;
  label: string;
  group: string;
  sortOrder: number;
  status: 'active' | 'deprecated';
};

export type DashboardMe = {
  user: {
    id: string;
    email: string;
    status: 'active' | 'disabled';
  };
  teams: Array<{
    id: string;
    name: string;
    membershipId: string;
    membershipRole: 'owner' | 'member';
  }>;
};
```

Update session methods:

```ts
const dashboardApiBasePath = '/api/dashboard';
const adminApiBasePath = '/api/admin';

export const dashboardApi = {
  getSession: () => request<AdminSession>(`${dashboardApiBasePath}/session`),
  login: (credentials: { email: string; password: string }) =>
    request<AdminSession>(`${dashboardApiBasePath}/login`, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  logout: () =>
    request<{ ok: true }>(`${dashboardApiBasePath}/logout`, { method: 'POST' }),
  getMe: () => request<DashboardMe>(`${dashboardApiBasePath}/me`),
};
```

Add admin methods:

```ts
listModulePermissions: () =>
  request<ModulePermissionDefinition[]>(`${adminApiBasePath}/module-permissions`),
listUserModulePermissions: (id: string) =>
  request<{ permissionKeys: string[] }>(
    `${adminApiBasePath}/users/${encodeURIComponent(id)}/module-permissions`,
  ),
replaceUserModulePermissions: (id: string, permissionKeys: string[]) =>
  request<{ permissionKeys: string[] }>(
    `${adminApiBasePath}/users/${encodeURIComponent(id)}/module-permissions`,
    {
      method: 'PUT',
      body: JSON.stringify({ permissionKeys }),
    },
  ),
```

Remove old team permission/access-role client methods and types.

- [ ] **Step 2: Update `useAuth`**

In `dashboard/src/hooks/use-auth.tsx`, import `dashboardApi` instead of using admin session APIs.

Change `login` to allow both roles:

```ts
const login = useCallback(
  async (credentials: { email: string; password: string }) => {
    const nextSession = await dashboardApi.login(credentials);
    setSession(nextSession);
  },
  [],
);
```

Change `logout` to call `dashboardApi.logout()`.

- [ ] **Step 3: Split routes**

In `dashboard/src/routes.ts`, export:

```ts
export const adminRouteItems: RouteItem[] = [
  { title: '系统', path: '/system', icon: GaugeIcon },
  { title: '用户', path: '/users', icon: UsersIcon },
  { title: '团队', path: '/teams', icon: ShieldIcon },
  { title: '审计日志', path: '/audit-logs', icon: FileSearchIcon },
  { title: '备份', path: '/backup', icon: ArchiveIcon },
  { title: '系统日志', path: '/logs', icon: FileTextIcon },
];

export const userRouteItems: RouteItem[] = [
  { title: '账号', path: '/me', icon: UsersIcon },
  { title: '设置', path: '/settings', icon: GaugeIcon },
];

export const routeItems = adminRouteItems;
```

Do not include “邀请” unless the implementation keeps a real team invitation administration page.

- [ ] **Step 4: Update protected route logic**

In `dashboard/src/app.tsx`, change `ProtectedRoute` to accept roles:

```tsx
function ProtectedRoute({ roles }: { roles: Array<'admin' | 'user'> }) {
  const { isAuthenticated, isLoading, session } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中
      </div>
    );
  }

  if (!isAuthenticated || !session || !roles.includes(session.role)) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
```

Route admin pages under `roles={['admin']}` and user pages under `roles={['user']}`.

- [ ] **Step 5: Update login redirect**

In `dashboard/src/pages/login-page.tsx`, after `await login`, read the returned session from `dashboardApi.login` or have `login` return the session:

```ts
const nextSession = await login({ email, password });
navigate(nextSession.role === 'admin' ? '/system' : '/me', { replace: true });
```

Update `AuthContextValue.login` type to:

```ts
login: (credentials: { email: string; password: string }) => Promise<AdminSession>;
```

- [ ] **Step 6: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: FAIL until downstream pages are updated in later tasks. Confirm the failures are from removed API methods/types.

- [ ] **Step 7: Commit after downstream tasks**

Do not commit this task alone if typecheck fails. Commit with Tasks 8 and 9 after the dashboard compiles.

---

### Task 8: Dashboard Registration And Normal User Pages

**Files:**

- Modify: `dashboard/src/pages/signup-page.tsx`
- Create: `dashboard/src/pages/me-page.tsx`
- Modify: `dashboard/src/app.tsx`

- [ ] **Step 1: Remove signup invitation field**

In `dashboard/src/pages/signup-page.tsx`:

- Remove `useSearchParams`.
- Remove `invitationToken` state and field.
- Call `userApi.register({ email, password })`.

The form content should contain only:

```tsx
<div className="grid gap-2">
  <Label htmlFor="email">邮箱</Label>
  <Input
    id="email"
    type="email"
    value={email}
    onChange={(event) => setEmail(event.target.value)}
    required
  />
</div>
<div className="grid gap-2">
  <Label htmlFor="password">密码</Label>
  <Input
    id="password"
    type="password"
    value={password}
    onChange={(event) => setPassword(event.target.value)}
    required
  />
</div>
```

- [ ] **Step 2: Update `userApi.register`**

In `dashboard/src/lib/api.ts`, change:

```ts
register: (input: { email: string; password: string }) =>
  request<UserTokenPair>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
```

- [ ] **Step 3: Create normal user page**

Create `dashboard/src/pages/me-page.tsx`:

```tsx
import { useCallback } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dashboardApi, type DashboardMe } from '@/lib/api';
import { formatTeamRole } from '@/lib/format';
import { useAdminList } from '@/hooks/use-admin-list';

export function MePage() {
  const loader = useCallback(async () => {
    const profile = await dashboardApi.getMe();
    return {
      data: [profile],
      total: 1,
      page: 1,
      pageSize: 1,
    };
  }, []);
  const { error, isLoading, refresh, rows } = useAdminList<DashboardMe>(loader, 1);
  const profile = rows[0];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error && profile ? (
        <>
          <section className="grid gap-2">
            <h2 className="text-base font-medium">账号</h2>
            <div className="text-sm">{profile.user.email}</div>
          </section>
          <section className="grid gap-2">
            <h2 className="text-base font-medium">团队</h2>
            {profile.teams.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>身份</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.teams.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell>{team.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatTeamRole(team.membershipRole)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 4: Wire user route**

In `dashboard/src/app.tsx`, import `MePage` and add:

```tsx
<Route element={<ProtectedRoute roles={['user']} />}>
  <Route element={<DashboardLayout />}>
    <Route path="me" element={<MePage />} />
    <Route path="settings" element={<SystemPage />} />
  </Route>
</Route>
```

Use `SystemPage` as a temporary settings page only if no better settings page exists. Do not add marketing or explanatory UI.

- [ ] **Step 5: Commit after Task 9 compiles**

Do not commit until the admin pages are updated and `pnpm --filter @synapse/dashboard run tsc` passes.

---

### Task 9: Dashboard Admin Users And Teams Pages

**Files:**

- Modify: `dashboard/src/pages/users-page.tsx`
- Modify: `dashboard/src/pages/teams-page.tsx`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/app-sidebar.tsx`
- Modify: `dashboard/src/components/dashboard-layout.tsx`

- [ ] **Step 1: Update API row types**

In `dashboard/src/lib/api.ts`, update `AdminUserRow`:

```ts
export type AdminUserRow = {
  id: string;
  email: string;
  status: 'active' | 'disabled';
  memberships: Array<{
    id?: string;
    role: 'owner' | 'member';
    team: { id: string; name: string };
  }>;
  modulePermissions: Array<{ permissionKey: string }>;
  createdAt: string;
  updatedAt: string;
};
```

Update `AdminTeamRow.memberships` to remove `accessRoles`.

Remove old types:

- `TeamEntitlementsResponse`
- `ReplaceTeamEntitlementsResponse`
- `TeamAccessRoleRow`
- `MemberAccessRolesResponse`
- `DeletedRolePermission`

- [ ] **Step 2: Add module permission editor to users page**

In `dashboard/src/pages/users-page.tsx`, import `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`.

Add state:

```ts
const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
const [definitions, setDefinitions] = useState<ModulePermissionDefinition[]>([]);
const [permissionKeys, setPermissionKeys] = useState<ReadonlySet<string>>(() => new Set());
const [permissionError, setPermissionError] = useState('');
const [permissionFeedback, setPermissionFeedback] = useState('');
const [isPermissionLoading, setIsPermissionLoading] = useState(false);
const [isPermissionSaving, setIsPermissionSaving] = useState(false);
```

Add helper:

```ts
function toggleSetValue(values: ReadonlySet<string>, value: string, checked: boolean) {
  const next = new Set(values);
  if (checked) next.add(value);
  else next.delete(value);
  return next;
}
```

Add `openPermissions`:

```ts
async function openPermissions(user: AdminUserRow) {
  setSelectedUser(user);
  setPermissionError('');
  setPermissionFeedback('');
  setIsPermissionLoading(true);
  try {
    const [nextDefinitions, permissions] = await Promise.all([
      adminApi.listModulePermissions(),
      adminApi.listUserModulePermissions(user.id),
    ]);
    setDefinitions(nextDefinitions);
    setPermissionKeys(new Set(permissions.permissionKeys));
  } catch (nextError) {
    setPermissionError(nextError instanceof Error ? nextError.message : '加载失败');
  } finally {
    setIsPermissionLoading(false);
  }
}
```

Add `savePermissions`:

```ts
async function savePermissions() {
  if (!selectedUser) return;
  setPermissionError('');
  setPermissionFeedback('');
  setIsPermissionSaving(true);
  try {
    const result = await adminApi.replaceUserModulePermissions(selectedUser.id, [...permissionKeys]);
    setPermissionKeys(new Set(result.permissionKeys));
    setPermissionFeedback('模块权限已保存');
    await refresh();
  } catch (nextError) {
    setPermissionError(nextError instanceof Error ? nextError.message : '保存失败');
  } finally {
    setIsPermissionSaving(false);
  }
}
```

In the table, replace access role column with module summary:

```tsx
<TableHead>模块</TableHead>
```

Cell:

```tsx
<TableCell>
  {user.modulePermissions.map((item) => item.permissionKey).join('、') || '-'}
</TableCell>
```

Add action button:

```tsx
<Button variant="outline" onClick={() => openPermissions(user)}>
  模块权限
</Button>
```

Render Sheet:

```tsx
<Sheet open={selectedUser !== null} onOpenChange={(open) => !open && setSelectedUser(null)}>
  <SheetContent className="overflow-y-auto sm:max-w-xl">
    <SheetHeader>
      <SheetTitle>{selectedUser?.email ?? '模块权限'}</SheetTitle>
    </SheetHeader>
    <div className="flex flex-col gap-4 px-4 pb-4">
      {isPermissionLoading ? <LoadingState /> : null}
      {permissionError ? <ErrorState message={permissionError} onRetry={() => selectedUser && openPermissions(selectedUser)} /> : null}
      {permissionFeedback ? <p className="text-sm text-muted-foreground">{permissionFeedback}</p> : null}
      {!isPermissionLoading ? (
        <>
          <div className="grid gap-2">
            {definitions.map((definition) => (
              <label key={definition.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={permissionKeys.has(definition.key)}
                  onChange={(event) =>
                    setPermissionKeys((current) => toggleSetValue(current, definition.key, event.target.checked))
                  }
                />
                <span>{definition.label}</span>
              </label>
            ))}
          </div>
          <Button disabled={isPermissionSaving} onClick={savePermissions}>
            保存
          </Button>
        </>
      ) : null}
    </div>
  </SheetContent>
</Sheet>
```

- [ ] **Step 3: Simplify teams page**

In `dashboard/src/pages/teams-page.tsx`:

- Remove imports for `PermissionDefinition`, `TeamAccessRoleRow`, and `Sheet`.
- Remove all permission state and handlers.
- Remove “管理权限” button.
- Remove access role badge rendering.

Membership row should render only:

```tsx
<div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
  <Badge variant="outline">{formatTeamRole(membership.role)}</Badge>
</div>
```

- [ ] **Step 4: Role-specific sidebar**

In `dashboard/src/components/app-sidebar.tsx`, choose routes by session:

```ts
import { adminRouteItems, userRouteItems } from '@/routes';

const routes = session?.role === 'user' ? userRouteItems : adminRouteItems;
const mainRoutes = routes.slice(0, 5);
const operationRoutes = routes.slice(5);
const homePath = session?.role === 'user' ? '/me' : '/system';
```

Use `homePath` for the logo link.

- [ ] **Step 5: Role-specific breadcrumb**

In `dashboard/src/components/dashboard-layout.tsx`, find active route from both route arrays:

```ts
import { adminRouteItems, userRouteItems } from '@/routes';

const activeRoute = [...adminRouteItems, ...userRouteItems].find(
  (item) => item.path === location.pathname,
);
```

- [ ] **Step 6: Run dashboard typecheck/build**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run build
```

Expected: PASS.

- [ ] **Step 7: Commit dashboard changes**

```bash
git add dashboard/src
git commit -m "feat(dashboard): manage personal module permissions"
```

---

### Task 10: Remove User Signup Invitation Product Flow

**Files:**

- Modify: `server/src/invitations/invitations.service.ts`
- Modify: `server/src/invitations/invitations.service.spec.ts`
- Modify: `server/src/invitations/invitation-url.ts`
- Modify: `server/src/invitations/invitation-url.spec.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `dashboard/src/pages/invitations-page.tsx` or remove route from `dashboard/src/routes.ts`

- [ ] **Step 1: Remove signup invitation tests**

In invitation service/url tests:

- Delete tests that create or build `user_signup` links.
- Keep tests for `team_join` links.
- Keep parser tests only if team invite parsing still needs them.

Add:

```ts
it("builds team invite URLs only", () => {
  expect(buildTeamInviteUrl({
    publicAppUrl: "https://app.example.com",
    token: "plain token",
  })).toBe("https://app.example.com/dashboard/team-invite?token=plain+token")
})
```

- [ ] **Step 2: Remove signup invitation service method**

In `server/src/invitations/invitations.service.ts`, remove `createSignupInvitation`.

Keep `createTeamInvitation`.

- [ ] **Step 3: Remove admin signup invitation methods**

In `server/src/admin/admin.controller.ts` and `server/src/admin/admin.service.ts`, remove:

- `createSignupInvitation`
- `POST /api/admin/invitations`

Keep invitation listing/deletion only if the product still needs operational visibility. If kept, filter or label team invitations only.

- [ ] **Step 4: Remove dashboard creation entry**

If `dashboard/src/pages/invitations-page.tsx` remains, remove “创建邀请” for user signup. If it no longer has useful team-invite content, remove the route from `adminRouteItems` and do not render it in the sidebar.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- invitations.service.spec.ts invitation-url.spec.ts admin.controller.spec.ts admin.service.spec.ts
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/invitations server/src/admin dashboard/src
git commit -m "feat: remove user signup invitations"
```

---

### Task 11: Full Verification And Hard Constraint Check

**Files:**

- Read-only verification across repo.

- [ ] **Step 1: Search for removed concepts**

Run:

```bash
rg -n "TeamEntitlement|TeamAccessRole|TeamAccessRolePermission|TeamMemberAccessRole|teamEntitlement|teamAccessRole|teamMemberAccessRole|content\\.skill\\.use|workflow\\.use|team\\.role\\.manage|user_signup|invitationToken" server dashboard
```

Expected: no matches in live implementation code. Matches in superseded docs or migration SQL are acceptable.

- [ ] **Step 2: Run server tests**

Run:

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test
pnpm --filter @synapse/server run build
```

Expected: all pass.

- [ ] **Step 3: Run dashboard checks**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run build
```

Expected: both pass.

- [ ] **Step 4: Run desktop hard constraint check if server changes affected shared workspace scripts**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS, or command is unavailable only if the package script no longer exists. If unavailable, record that in the final implementation summary.

- [ ] **Step 5: Commit verification fixes**

If verification reveals small fixes, commit them:

```bash
git add server dashboard
git commit -m "fix: complete personal module permission migration"
```

If no fixes are needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: schema deletion/addition, open registration, dashboard session, admin module permission APIs, team relationship-only behavior, dashboard UI, invitation decoupling, and verification are covered.
- Placeholder scan: no `TBD`, `TODO`, or “implement later” steps are intentionally present.
- Type consistency: plan uses `UserModulePermission`, `module.*`, `ModulePermissionDefinition`, `DashboardMe`, and `permissionKeys` consistently.
