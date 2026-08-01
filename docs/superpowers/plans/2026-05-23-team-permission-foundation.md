# Team Permission Foundation Implementation Plan

> Retired on 2026-07-31. The team relationship and permission domain was removed from the product and database; this plan is historical only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side permission foundation for team entitlements, team-local access roles, effective permission calculation, and Admin APIs.

**Architecture:** The server owns permission definitions through a code registry and stores only grants and assignments in PostgreSQL. `PermissionsModule` provides registry lookup, team default role initialization, entitlement mutation, and effective permission calculation. Existing auth/team flows call the permission service so new teams and joined members receive access roles that preserve current behavior.

**Tech Stack:** NestJS 11, TypeScript, Prisma, PostgreSQL, Vitest.

---

## Scope

This plan implements the first backend slice only:

- Permission registry in server code.
- Prisma schema and migration for entitlement and role tables.
- `PermissionsService` for effective permissions.
- Default team roles for create/join/migration paths.
- `GET /api/auth/me` extended with `teams[].effectivePermissions`.
- Admin APIs for permission registry and team entitlements.

This plan does not implement Admin UI, team role-management UI, desktop login, desktop tab filtering, or Electron main-process enforcement.

## File Map

- Create `server/src/permissions/permission-registry.ts`: stable permission key definitions, grouping metadata, and validation helpers.
- Create `server/src/permissions/permissions.service.ts`: entitlement reads/writes, default role initialization, member-role assignment helpers, and effective permission calculation.
- Create `server/src/permissions/permissions.module.ts`: Nest module exporting `PermissionsService`.
- Create `server/src/permissions/permissions.service.spec.ts`: unit tests for registry validation, entitlement ceiling, default role setup, and effective permissions.
- Modify `server/prisma/schema.prisma`: add permission enums and grant tables.
- Add migration under `server/prisma/migrations/20260523000000_team_permissions/migration.sql`.
- Modify `server/src/app.module.ts`: import `PermissionsModule`.
- Modify `server/src/auth/user-auth.module.ts`: import `PermissionsModule`.
- Modify `server/src/auth/user-auth.service.ts`: inject `PermissionsService` and return teams/effective permissions from `getMe`.
- Modify `server/src/auth/user-auth.service.spec.ts`: update constructor mocks and add `getMe` coverage.
- Modify `server/src/teams/teams.module.ts`: import `PermissionsModule`.
- Modify `server/src/teams/teams.service.ts`: initialize default access roles when creating a team and assign the ordinary role when a user joins.
- Modify `server/src/teams/teams.service.spec.ts`: verify default role initialization and member assignment calls.
- Modify `server/src/admin/admin.module.ts`: import `PermissionsModule`.
- Modify `server/src/admin/admin.controller.ts`: expose registry and entitlement endpoints.
- Modify `server/src/admin/admin.service.ts`: delegate entitlement operations to `PermissionsService` and audit changes.
- Modify `server/src/admin/admin.controller.spec.ts` and `server/src/admin/admin.service.spec.ts`: cover new endpoints and service behavior.

## Permissions

Use this first-release registry:

```ts
export const permissionDefinitions = [
  { key: "content.rule.use", label: "规则", group: "content", level: "module", clientVisibility: "visible" },
  { key: "content.skill.use", label: "技能", group: "content", level: "module", clientVisibility: "visible" },
  { key: "content.prompt.use", label: "提示词", group: "content", level: "module", clientVisibility: "visible" },
  { key: "agent.chat.use", label: "对话", group: "agent", level: "module", clientVisibility: "visible" },
  { key: "agent.provider.manage", label: "模型配置", group: "agent", level: "management", clientVisibility: "visible" },
  { key: "agent.permission-mode.manage", label: "权限模式", group: "agent", level: "management", clientVisibility: "visible" },
  { key: "database.use", label: "数据", group: "database", level: "module", clientVisibility: "visible" },
  { key: "scheduler.use", label: "定时", group: "automation", level: "module", clientVisibility: "visible" },
  { key: "workflow.use", label: "工作流", group: "automation", level: "module", clientVisibility: "visible" },
  { key: "local.ide-scan.view", label: "本机", group: "local", level: "module", clientVisibility: "visible" },
  { key: "usage.view", label: "使用分析", group: "usage", level: "module", clientVisibility: "visible" },
  { key: "team.member.manage", label: "成员管理", group: "team", level: "management", clientVisibility: "visible" },
  { key: "team.role.manage", label: "角色管理", group: "team", level: "management", clientVisibility: "visible" },
  { key: "team.invitation.manage", label: "邀请管理", group: "team", level: "management", clientVisibility: "visible" },
] as const
```

---

### Task 1: Add Permission Registry

**Files:**
- Create: `server/src/permissions/permission-registry.ts`
- Test: `server/src/permissions/permissions.service.spec.ts`

- [ ] **Step 1: Create registry tests**

Add these tests to `server/src/permissions/permissions.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  allPermissionKeys,
  assertActivePermissionKey,
  permissionDefinitions,
} from "./permission-registry"

describe("permission registry", () => {
  it("keeps permission keys unique and kebab-case", () => {
    expect(new Set(allPermissionKeys).size).toBe(allPermissionKeys.length)
    for (const key of allPermissionKeys) {
      expect(key).toMatch(/^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*){1,2}$/)
    }
  })

  it("rejects unknown permission keys", () => {
    expect(() => assertActivePermissionKey("database.use")).not.toThrow()
    expect(() => assertActivePermissionKey("page.database")).toThrow("Unknown permission key: page.database")
  })

  it("marks first-release permissions as active", () => {
    expect(permissionDefinitions.every((item) => item.status === "active")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/server test -- permissions.service.spec.ts`

Expected: FAIL with module resolution errors for `./permission-registry`.

- [ ] **Step 3: Implement the registry**

Create `server/src/permissions/permission-registry.ts`:

```ts
export type PermissionLevel = "module" | "action" | "management"
export type PermissionStatus = "active" | "deprecated"
export type PermissionClientVisibility = "visible" | "hidden"

export interface PermissionDefinition {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly group: string
  readonly level: PermissionLevel
  readonly status: PermissionStatus
  readonly clientVisibility: PermissionClientVisibility
}

const definitions = [
  { key: "content.rule.use", label: "规则", group: "content", level: "module", clientVisibility: "visible" },
  { key: "content.skill.use", label: "技能", group: "content", level: "module", clientVisibility: "visible" },
  { key: "content.prompt.use", label: "提示词", group: "content", level: "module", clientVisibility: "visible" },
  { key: "agent.chat.use", label: "对话", group: "agent", level: "module", clientVisibility: "visible" },
  { key: "agent.provider.manage", label: "模型配置", group: "agent", level: "management", clientVisibility: "visible" },
  { key: "agent.permission-mode.manage", label: "权限模式", group: "agent", level: "management", clientVisibility: "visible" },
  { key: "database.use", label: "数据", group: "database", level: "module", clientVisibility: "visible" },
  { key: "scheduler.use", label: "定时", group: "automation", level: "module", clientVisibility: "visible" },
  { key: "workflow.use", label: "工作流", group: "automation", level: "module", clientVisibility: "visible" },
  { key: "local.ide-scan.view", label: "本机", group: "local", level: "module", clientVisibility: "visible" },
  { key: "usage.view", label: "使用分析", group: "usage", level: "module", clientVisibility: "visible" },
  { key: "team.member.manage", label: "成员管理", group: "team", level: "management", clientVisibility: "visible" },
  { key: "team.role.manage", label: "角色管理", group: "team", level: "management", clientVisibility: "visible" },
  { key: "team.invitation.manage", label: "邀请管理", group: "team", level: "management", clientVisibility: "visible" },
] as const satisfies readonly Omit<PermissionDefinition, "status">[]

export const permissionDefinitions: readonly PermissionDefinition[] = definitions.map((item) => ({
  ...item,
  status: "active",
}))

export const allPermissionKeys = permissionDefinitions.map((item) => item.key)

const definitionByKey = new Map(permissionDefinitions.map((item) => [item.key, item]))

export function getPermissionDefinition(key: string): PermissionDefinition | null {
  return definitionByKey.get(key) ?? null
}

export function isActivePermissionKey(key: string): boolean {
  return getPermissionDefinition(key)?.status === "active"
}

export function assertActivePermissionKey(key: string): void {
  const definition = getPermissionDefinition(key)
  if (!definition) throw new Error(`Unknown permission key: ${key}`)
  if (definition.status !== "active") throw new Error(`Permission key is not active: ${key}`)
}

export function normalizePermissionKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const key of keys) {
    assertActivePermissionKey(key)
    seen.add(key)
  }
  return [...seen].sort()
}
```

- [ ] **Step 4: Run registry tests**

Run: `pnpm --filter @synapse/server test -- permissions.service.spec.ts`

Expected: PASS for the registry tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/permissions/permission-registry.ts server/src/permissions/permissions.service.spec.ts
git commit -m "feat(server): add permission registry"
```

---

### Task 2: Add Permission Tables

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260523000000_team_permissions/migration.sql`

- [ ] **Step 1: Update Prisma schema**

Add these enums and models to `server/prisma/schema.prisma`:

```prisma
enum TeamEntitlementSource {
  manual
  plan
  migration
}

enum TeamAccessRoleKind {
  system
  custom
}

model TeamEntitlement {
  id               String                @id @default(cuid())
  teamId           String
  team             Team                  @relation(fields: [teamId], references: [id], onDelete: Cascade)
  permissionKey    String
  source           TeamEntitlementSource @default(manual)
  grantedByAdminId String?
  grantedByAdmin   AdminUser?            @relation(fields: [grantedByAdminId], references: [id])
  grantedAt        DateTime              @default(now())
  expiresAt        DateTime?

  @@unique([teamId, permissionKey])
  @@index([teamId])
  @@index([permissionKey])
  @@index([expiresAt])
}

model TeamAccessRole {
  id          String                     @id @default(cuid())
  teamId      String
  team        Team                       @relation(fields: [teamId], references: [id], onDelete: Cascade)
  name        String
  description String?
  kind        TeamAccessRoleKind
  locked      Boolean                    @default(false)
  sortOrder   Int                        @default(0)
  permissions TeamAccessRolePermission[]
  members     TeamMemberAccessRole[]
  createdAt   DateTime                   @default(now())
  updatedAt   DateTime                   @updatedAt

  @@unique([teamId, name])
  @@index([teamId])
}

model TeamAccessRolePermission {
  id            String         @id @default(cuid())
  roleId        String
  role          TeamAccessRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permissionKey String
  createdAt     DateTime       @default(now())

  @@unique([roleId, permissionKey])
  @@index([permissionKey])
}

model TeamMemberAccessRole {
  id               String         @id @default(cuid())
  teamMembershipId String
  teamMembership   TeamMembership @relation(fields: [teamMembershipId], references: [id], onDelete: Cascade)
  roleId           String
  role             TeamAccessRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  assignedByUserId String?
  assignedByUser   User?          @relation("AssignedAccessRoles", fields: [assignedByUserId], references: [id])
  assignedAt       DateTime       @default(now())

  @@unique([teamMembershipId, roleId])
  @@index([roleId])
}
```

Add these fields inside the existing models:

```prisma
// Inside model AdminUser
grantedTeamEntitlements TeamEntitlement[]

// Inside model User
assignedAccessRoles TeamMemberAccessRole[] @relation("AssignedAccessRoles")

// Inside model Team
entitlements TeamEntitlement[]
accessRoles  TeamAccessRole[]

// Inside model TeamMembership
accessRoles TeamMemberAccessRole[]
```

- [ ] **Step 2: Create SQL migration**

Create `server/prisma/migrations/20260523000000_team_permissions/migration.sql`:

```sql
CREATE TYPE "TeamEntitlementSource" AS ENUM ('manual', 'plan', 'migration');
CREATE TYPE "TeamAccessRoleKind" AS ENUM ('system', 'custom');

CREATE TABLE "TeamEntitlement" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "source" "TeamEntitlementSource" NOT NULL DEFAULT 'manual',
  "grantedByAdminId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "TeamEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamAccessRole" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" "TeamAccessRoleKind" NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamAccessRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamAccessRolePermission" (
  "id" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamAccessRolePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMemberAccessRole" (
  "id" TEXT NOT NULL,
  "teamMembershipId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "assignedByUserId" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMemberAccessRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamEntitlement_teamId_permissionKey_key" ON "TeamEntitlement"("teamId", "permissionKey");
CREATE INDEX "TeamEntitlement_teamId_idx" ON "TeamEntitlement"("teamId");
CREATE INDEX "TeamEntitlement_permissionKey_idx" ON "TeamEntitlement"("permissionKey");
CREATE INDEX "TeamEntitlement_expiresAt_idx" ON "TeamEntitlement"("expiresAt");
CREATE UNIQUE INDEX "TeamAccessRole_teamId_name_key" ON "TeamAccessRole"("teamId", "name");
CREATE INDEX "TeamAccessRole_teamId_idx" ON "TeamAccessRole"("teamId");
CREATE UNIQUE INDEX "TeamAccessRolePermission_roleId_permissionKey_key" ON "TeamAccessRolePermission"("roleId", "permissionKey");
CREATE INDEX "TeamAccessRolePermission_permissionKey_idx" ON "TeamAccessRolePermission"("permissionKey");
CREATE UNIQUE INDEX "TeamMemberAccessRole_teamMembershipId_roleId_key" ON "TeamMemberAccessRole"("teamMembershipId", "roleId");
CREATE INDEX "TeamMemberAccessRole_roleId_idx" ON "TeamMemberAccessRole"("roleId");

ALTER TABLE "TeamEntitlement" ADD CONSTRAINT "TeamEntitlement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamEntitlement" ADD CONSTRAINT "TeamEntitlement_grantedByAdminId_fkey" FOREIGN KEY ("grantedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamAccessRole" ADD CONSTRAINT "TeamAccessRole_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAccessRolePermission" ADD CONSTRAINT "TeamAccessRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "TeamAccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMemberAccessRole" ADD CONSTRAINT "TeamMemberAccessRole_teamMembershipId_fkey" FOREIGN KEY ("teamMembershipId") REFERENCES "TeamMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMemberAccessRole" ADD CONSTRAINT "TeamMemberAccessRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "TeamAccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMemberAccessRole" ADD CONSTRAINT "TeamMemberAccessRole_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run: `pnpm --filter @synapse/server run prisma:generate`

Expected: PASS and Prisma Client generated.

- [ ] **Step 4: Typecheck schema references**

Run: `pnpm --filter @synapse/server run typecheck`

Expected: PASS or only failures from later tasks not yet implemented if running after partial edits. If this task is run in isolation, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260523000000_team_permissions/migration.sql
git commit -m "feat(server): add team permission schema"
```

---

### Task 3: Implement PermissionsService Core

**Files:**
- Create: `server/src/permissions/permissions.service.ts`
- Create: `server/src/permissions/permissions.module.ts`
- Test: `server/src/permissions/permissions.service.spec.ts`

- [ ] **Step 1: Add service tests**

Merge these imports into the top of `server/src/permissions/permissions.service.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { PermissionsService } from "./permissions.service"
```

Then append these tests to `server/src/permissions/permissions.service.spec.ts`:

```ts
function createPermissionPrismaMock() {
  return {
    teamEntitlement: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    teamAccessRole: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    teamAccessRolePermission: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    teamMemberAccessRole: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    teamMembership: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(createPermissionPrismaMock())),
  }
}

describe("PermissionsService", () => {
  it("replaces team entitlements with normalized active keys", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    const service = new PermissionsService(prisma as never)

    await service.replaceTeamEntitlements({
      teamId: "team-1",
      permissionKeys: ["workflow.use", "database.use", "database.use"],
      grantedByAdminId: "admin-1",
      source: "manual",
    })

    expect(tx.teamEntitlement.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
    expect(tx.teamEntitlement.createMany).toHaveBeenCalledWith({
      data: [
        { teamId: "team-1", permissionKey: "database.use", grantedByAdminId: "admin-1", source: "manual" },
        { teamId: "team-1", permissionKey: "workflow.use", grantedByAdminId: "admin-1", source: "manual" },
      ],
    })
  })

  it("rejects role permissions outside team entitlements", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamEntitlement.findMany.mockResolvedValue([{ permissionKey: "database.use" }])
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceRolePermissions({
      teamId: "team-1",
      roleId: "role-1",
      permissionKeys: ["workflow.use"],
    })).rejects.toThrow(BadRequestException)
  })

  it("intersects role permissions with entitlements for effective permissions", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamEntitlement.findMany.mockResolvedValue([
      { permissionKey: "database.use" },
      { permissionKey: "workflow.use" },
    ])
    prisma.teamMemberAccessRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permissionKey: "database.use" }, { permissionKey: "team.role.manage" }] } },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.getEffectivePermissions("user-1", "team-1")).resolves.toEqual(["database.use"])
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @synapse/server test -- permissions.service.spec.ts`

Expected: FAIL with module resolution errors for `./permissions.service`.

- [ ] **Step 3: Implement service and module**

Create `server/src/permissions/permissions.service.ts`:

```ts
import { BadRequestException, Injectable } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import {
  allPermissionKeys,
  normalizePermissionKeys,
  permissionDefinitions,
} from "./permission-registry"

type PrismaClientLike = PrismaService | Prisma.TransactionClient

export const teamAdminRoleName = "团队管理员"
export const ordinaryMemberRoleName = "普通成员"

const teamManagementPermissions = [
  "team.member.manage",
  "team.role.manage",
  "team.invitation.manage",
] as const

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  listPermissionDefinitions() {
    return permissionDefinitions
  }

  async listTeamEntitlements(teamId: string, client: PrismaClientLike = this.prisma): Promise<string[]> {
    const rows = await client.teamEntitlement.findMany({
      where: {
        teamId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { permissionKey: true },
      orderBy: { permissionKey: "asc" },
    })
    return rows.map((row) => row.permissionKey)
  }

  async replaceTeamEntitlements(input: {
    readonly teamId: string
    readonly permissionKeys: readonly string[]
    readonly grantedByAdminId?: string
    readonly source: "manual" | "plan" | "migration"
  }): Promise<string[]> {
    const keys = normalizePermissionKeys(input.permissionKeys)
    await this.prisma.$transaction(async (tx) => {
      await tx.teamEntitlement.deleteMany({ where: { teamId: input.teamId } })
      if (keys.length > 0) {
        await tx.teamEntitlement.createMany({
          data: keys.map((permissionKey) => ({
            teamId: input.teamId,
            permissionKey,
            grantedByAdminId: input.grantedByAdminId,
            source: input.source,
          })),
        })
      }
    })
    return keys
  }

  async ensureDefaultTeamAccess(input: {
    readonly teamId: string
    readonly ownerMembershipId: string
    readonly ownerUserId: string
    readonly client?: PrismaClientLike
  }): Promise<void> {
    const client = input.client ?? this.prisma
    await this.ensureTeamEntitlements(input.teamId, allPermissionKeys, client)
    const adminRole = await this.ensureRole({
      teamId: input.teamId,
      name: teamAdminRoleName,
      kind: "system",
      locked: true,
      sortOrder: 0,
      permissionKeys: allPermissionKeys,
      client,
    })
    await this.ensureRole({
      teamId: input.teamId,
      name: ordinaryMemberRoleName,
      kind: "system",
      locked: true,
      sortOrder: 1,
      permissionKeys: allPermissionKeys.filter((key) => !teamManagementPermissions.includes(key as never)),
      client,
    })
    await client.teamMemberAccessRole.createMany({
      data: [{ teamMembershipId: input.ownerMembershipId, roleId: adminRole.id, assignedByUserId: input.ownerUserId }],
      skipDuplicates: true,
    })
  }

  async assignOrdinaryMemberRole(input: {
    readonly teamId: string
    readonly teamMembershipId: string
    readonly assignedByUserId?: string
    readonly client?: PrismaClientLike
  }): Promise<void> {
    const client = input.client ?? this.prisma
    const role = await client.teamAccessRole.findFirst({
      where: { teamId: input.teamId, name: ordinaryMemberRoleName },
      select: { id: true },
    })
    if (!role) throw new BadRequestException("团队默认角色不存在。")
    await client.teamMemberAccessRole.createMany({
      data: [{ teamMembershipId: input.teamMembershipId, roleId: role.id, assignedByUserId: input.assignedByUserId }],
      skipDuplicates: true,
    })
  }

  async replaceRolePermissions(input: {
    readonly teamId: string
    readonly roleId: string
    readonly permissionKeys: readonly string[]
  }): Promise<string[]> {
    const keys = normalizePermissionKeys(input.permissionKeys)
    await this.assertWithinTeamEntitlements(input.teamId, keys)
    await this.prisma.$transaction(async (tx) => {
      await tx.teamAccessRolePermission.deleteMany({ where: { roleId: input.roleId } })
      if (keys.length > 0) {
        await tx.teamAccessRolePermission.createMany({
          data: keys.map((permissionKey) => ({ roleId: input.roleId, permissionKey })),
        })
      }
    })
    return keys
  }

  async getEffectivePermissions(userId: string, teamId: string): Promise<string[]> {
    const [entitlements, roleAssignments] = await Promise.all([
      this.listTeamEntitlements(teamId),
      this.prisma.teamMemberAccessRole.findMany({
        where: {
          teamMembership: { userId, teamId },
        },
        include: {
          role: {
            include: {
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      }),
    ])
    const entitlementSet = new Set(entitlements)
    const roleKeys = new Set<string>()
    for (const assignment of roleAssignments) {
      for (const permission of assignment.role.permissions) {
        if (entitlementSet.has(permission.permissionKey)) roleKeys.add(permission.permissionKey)
      }
    }
    return [...roleKeys].sort()
  }

  private async ensureTeamEntitlements(teamId: string, permissionKeys: readonly string[], client: PrismaClientLike): Promise<void> {
    const keys = normalizePermissionKeys(permissionKeys)
    if (keys.length === 0) return
    await client.teamEntitlement.createMany({
      data: keys.map((permissionKey) => ({ teamId, permissionKey, source: "migration" })),
      skipDuplicates: true,
    })
  }

  private async ensureRole(input: {
    readonly teamId: string
    readonly name: string
    readonly kind: "system" | "custom"
    readonly locked: boolean
    readonly sortOrder: number
    readonly permissionKeys: readonly string[]
    readonly client: PrismaClientLike
  }): Promise<{ id: string }> {
    const existing = await input.client.teamAccessRole.findFirst({
      where: { teamId: input.teamId, name: input.name },
      select: { id: true },
    })
    const role = existing ?? await input.client.teamAccessRole.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        kind: input.kind,
        locked: input.locked,
        sortOrder: input.sortOrder,
      },
      select: { id: true },
    })
    await input.client.teamAccessRolePermission.createMany({
      data: normalizePermissionKeys(input.permissionKeys).map((permissionKey) => ({ roleId: role.id, permissionKey })),
      skipDuplicates: true,
    })
    return role
  }

  private async assertWithinTeamEntitlements(teamId: string, permissionKeys: readonly string[]): Promise<void> {
    const entitlements = new Set(await this.listTeamEntitlements(teamId))
    const missing = permissionKeys.filter((key) => !entitlements.has(key))
    if (missing.length > 0) {
      throw new BadRequestException(`权限未对团队开通：${missing.join("，")}`)
    }
  }
}
```

Create `server/src/permissions/permissions.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { PrismaModule } from "../prisma/prisma.module"
import { PermissionsService } from "./permissions.service"

@Module({
  imports: [PrismaModule],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
```

- [ ] **Step 4: Run permission tests**

Run: `pnpm --filter @synapse/server test -- permissions.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/permissions/permissions.service.ts server/src/permissions/permissions.module.ts server/src/permissions/permissions.service.spec.ts
git commit -m "feat(server): add permission service"
```

---

### Task 4: Wire Defaults Into Team Creation and Join

**Files:**
- Modify: `server/src/teams/teams.module.ts`
- Modify: `server/src/teams/teams.service.ts`
- Test: `server/src/teams/teams.service.spec.ts`

- [ ] **Step 1: Add TeamsService tests**

Update `server/src/teams/teams.service.spec.ts` with constructor mocks for permissions and add:

```ts
it("initializes default access roles when creating a team", async () => {
  const prisma = createPrismaMock()
  prisma.teamMembership.findUnique.mockResolvedValue(null)
  const membership = { id: "membership-1", teamId: "team-1", userId: "user-1", role: "owner" }
  const tx = {
    team: { create: vi.fn().mockResolvedValue({ id: "team-1", name: "Team", createdByUserId: "user-1" }) },
    teamMembership: { create: vi.fn().mockResolvedValue(membership) },
  }
  prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
  const permissions = { ensureDefaultTeamAccess: vi.fn() }
  const service = new TeamsService(
    prisma as never,
    { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never,
    permissions as never,
  )

  await service.createTeam("user-1", { name: "Team" })

  expect(permissions.ensureDefaultTeamAccess).toHaveBeenCalledWith({
    teamId: "team-1",
    ownerMembershipId: "membership-1",
    ownerUserId: "user-1",
    client: tx,
  })
})

it("assigns the ordinary access role when joining a team", async () => {
  const prisma = createPrismaMock()
  const member = {
    id: "membership-2",
    teamId: "team-1",
    userId: "user-2",
    role: "member",
    user: { id: "user-2", email: "member@example.com", status: "active" },
  }
  const tx = {
    teamMembership: { create: vi.fn().mockResolvedValue(member) },
  }
  prisma.teamMembership.findUnique.mockResolvedValue(null)
  prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
  const permissions = { assignOrdinaryMemberRole: vi.fn() }
  const invitations = { consumeInvitation: vi.fn().mockResolvedValue({ teamId: "team-1" }) }
  const service = new TeamsService(prisma as never, invitations as never, permissions as never)

  await service.joinTeam("user-2", { invitationToken: "team-token" })

  expect(permissions.assignOrdinaryMemberRole).toHaveBeenCalledWith({
    teamId: "team-1",
    teamMembershipId: "membership-2",
    assignedByUserId: "user-2",
    client: tx,
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @synapse/server test -- teams.service.spec.ts`

Expected: FAIL because `TeamsService` does not inject or call `PermissionsService`.

- [ ] **Step 3: Update TeamsModule**

Modify `server/src/teams/teams.module.ts`:

```ts
import { PermissionsModule } from "../permissions/permissions.module"

@Module({
  imports: [PrismaModule, InvitationsModule, UserAuthModule, AdminAuthModule, PermissionsModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsAuthGuard, AuditLogService],
  exports: [TeamsService],
})
export class TeamsModule {}
```

- [ ] **Step 4: Update TeamsService constructor and calls**

Modify `server/src/teams/teams.service.ts`:

```ts
import { PermissionsService } from "../permissions/permissions.service"

constructor(
  private readonly prisma: PrismaService,
  private readonly invitations: InvitationsService,
  private readonly permissions: PermissionsService,
  @Optional() private readonly auditLog?: AuditLogService,
) {}
```

In `createTeam`, keep the transaction and add default access setup:

```ts
const team = await this.prisma.$transaction(async (tx) => {
  const team = await tx.team.create({
    data: { name: input.name.trim(), createdByUserId: userId },
  })
  const membership = await tx.teamMembership.create({
    data: { teamId: team.id, userId, role: "owner" },
  })
  await this.permissions.ensureDefaultTeamAccess({
    teamId: team.id,
    ownerMembershipId: membership.id,
    ownerUserId: userId,
    client: tx,
  })
  return team
})
```

In `joinTeam`, after creating the membership:

```ts
await this.permissions.assignOrdinaryMemberRole({
  teamId: invitation.teamId,
  teamMembershipId: membership.id,
  assignedByUserId: userId,
  client: tx,
})
```

- [ ] **Step 5: Update older test constructors**

Every existing `new TeamsService(...)` call now needs the third constructor argument:

```ts
const permissions = { ensureDefaultTeamAccess: vi.fn(), assignOrdinaryMemberRole: vi.fn() }
const service = new TeamsService(prisma as never, invitations as never, permissions as never)
```

For tests that pass an audit log, use:

```ts
const service = new TeamsService(prisma as never, invitations as never, permissions as never, auditLog as never)
```

- [ ] **Step 6: Run team tests**

Run: `pnpm --filter @synapse/server test -- teams.service.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/teams/teams.module.ts server/src/teams/teams.service.ts server/src/teams/teams.service.spec.ts
git commit -m "feat(server): assign default team access roles"
```

---

### Task 5: Extend User Session With Effective Permissions

**Files:**
- Modify: `server/src/auth/user-auth.module.ts`
- Modify: `server/src/auth/user-auth.service.ts`
- Test: `server/src/auth/user-auth.service.spec.ts`

- [ ] **Step 1: Add getMe test**

Add to `server/src/auth/user-auth.service.spec.ts`:

```ts
it("returns teams with effective permissions from getMe", async () => {
  const prisma = createPrismaMock()
  prisma.user.findUniqueOrThrow = vi.fn().mockResolvedValue({
    id: "user-1",
    email: "u@example.com",
    status: "active",
    memberships: [
      {
        id: "membership-1",
        teamId: "team-1",
        role: "owner",
        accessRoles: [{ role: { id: "access-role-1", name: "团队管理员" } }],
        team: { id: "team-1", name: "Team", createdByUserId: "user-1" },
      },
    ],
  })
  const permissions = { getEffectivePermissions: vi.fn().mockResolvedValue(["database.use", "workflow.use"]) }
  const service = new UserAuthService(
    prisma as never,
    { consumeInvitation: vi.fn() } as never,
    new JwtService({ secret: "user-secret-at-least-32-characters!" }),
    { accessMinutes: 15, refreshDays: 30 },
    permissions as never,
  )

  await expect(service.getMe("user-1")).resolves.toEqual({
    user: { id: "user-1", email: "u@example.com", status: "active" },
    teams: [{
      id: "team-1",
      name: "Team",
      membershipId: "membership-1",
      membershipRole: "owner",
      roles: [{ id: "access-role-1", name: "团队管理员" }],
      effectivePermissions: ["database.use", "workflow.use"],
    }],
  })
})
```

- [ ] **Step 2: Run auth tests to verify failure**

Run: `pnpm --filter @synapse/server test -- user-auth.service.spec.ts`

Expected: FAIL because `UserAuthService` does not inject `PermissionsService` and `getMe` returns the old shape.

- [ ] **Step 3: Update UserAuthModule**

Modify `server/src/auth/user-auth.module.ts`:

```ts
import { PermissionsModule } from "../permissions/permissions.module"
```

Add `PermissionsModule` to the existing module imports after `InvitationsModule`:

```ts
imports: [
  PrismaModule,
  InvitationsModule,
  PermissionsModule,
  JwtModule.registerAsync({
    useFactory: () => {
      const env = loadEnv(process.env)
      return { secret: env.userAccessJwtSecret }
    },
  }),
],
```

- [ ] **Step 4: Update UserAuthService constructor**

Modify `server/src/auth/user-auth.service.ts`:

```ts
import { PermissionsService } from "../permissions/permissions.service"

constructor(
  private readonly prisma: PrismaService,
  private readonly invitations: InvitationsService,
  private readonly jwt: JwtService,
  @Inject(userAuthOptionsToken) private readonly options: UserAuthOptions,
  private readonly permissions: PermissionsService,
  @Optional() private readonly auditLog?: AuditLogService,
) {}
```

- [ ] **Step 5: Update getMe implementation**

Replace `getMe` with:

```ts
async getMe(userId: string): Promise<unknown> {
  const user = await this.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      memberships: {
        select: {
          id: true,
          teamId: true,
          role: true,
          accessRoles: {
            select: {
              role: { select: { id: true, name: true } },
            },
            orderBy: { assignedAt: "asc" },
          },
          team: { select: { id: true, name: true, createdByUserId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  const teams = await Promise.all(user.memberships.map(async (membership) => ({
    id: membership.team.id,
    name: membership.team.name,
    membershipId: membership.id,
    membershipRole: membership.role,
    roles: membership.accessRoles.map((item) => item.role),
    effectivePermissions: await this.permissions.getEffectivePermissions(user.id, membership.teamId),
  })))

  return {
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
    },
    teams,
  }
}
```

- [ ] **Step 6: Update existing test constructors**

Every existing `new UserAuthService(...)` call needs a permissions argument before `auditLog`:

```ts
const permissions = { getEffectivePermissions: vi.fn().mockResolvedValue([]) }
const service = new UserAuthService(prisma as never, invitations as never, jwt, options, permissions as never)
```

When an audit log is passed:

```ts
const service = new UserAuthService(prisma as never, invitations as never, jwt, options, permissions as never, auditLog as never)
```

- [ ] **Step 7: Run auth tests**

Run: `pnpm --filter @synapse/server test -- user-auth.service.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/auth/user-auth.module.ts server/src/auth/user-auth.service.ts server/src/auth/user-auth.service.spec.ts
git commit -m "feat(server): return effective permissions from user session"
```

---

### Task 6: Add Admin Permission and Entitlement APIs

**Files:**
- Modify: `server/src/admin/admin.module.ts`
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Test: `server/src/admin/admin.service.spec.ts`
- Test: `server/src/admin/admin.controller.spec.ts`

- [ ] **Step 1: Add AdminService tests**

Add to `server/src/admin/admin.service.spec.ts`:

```ts
it("lists permission definitions through permissions service", () => {
  const permissions = { listPermissionDefinitions: vi.fn().mockReturnValue([{ key: "database.use" }]) }
  const service = new AdminService(createPrismaMock() as never, { createSignupInvitation: vi.fn() } as never, permissions as never)

  expect(service.listPermissions()).toEqual([{ key: "database.use" }])
})

it("updates team entitlements and records an audit log", async () => {
  const auditLog = { record: vi.fn() }
  const permissions = {
    replaceTeamEntitlements: vi.fn().mockResolvedValue(["database.use", "workflow.use"]),
  }
  const service = new AdminService(
    createPrismaMock() as never,
    { createSignupInvitation: vi.fn() } as never,
    permissions as never,
    auditLog as never,
  )

  await expect(service.replaceTeamEntitlements(
    "team-1",
    ["workflow.use", "database.use"],
    { id: "admin-1", email: "admin@example.com" },
    "203.0.113.40",
  )).resolves.toEqual({ permissionKeys: ["database.use", "workflow.use"] })

  expect(permissions.replaceTeamEntitlements).toHaveBeenCalledWith({
    teamId: "team-1",
    permissionKeys: ["workflow.use", "database.use"],
    grantedByAdminId: "admin-1",
    source: "manual",
  })
  expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
    adminEmail: "admin@example.com",
    action: "admin.team_entitlements.update",
    targetType: "team",
    targetId: "team-1",
    detail: { permissionKeys: ["database.use", "workflow.use"] },
    ipAddress: "203.0.113.40",
  }))
})
```

- [ ] **Step 2: Add AdminController tests**

Add to `server/src/admin/admin.controller.spec.ts`:

```ts
it("lists permission definitions", () => {
  const controller = new AdminController({
    listPermissions: vi.fn().mockReturnValue([{ key: "database.use" }]),
  } as never, { list: vi.fn() } as never)

  expect(controller.listPermissions()).toEqual([{ key: "database.use" }])
})

it("updates team entitlements through the service", async () => {
  const replaceTeamEntitlements = vi.fn().mockResolvedValue({ permissionKeys: ["database.use"] })
  const controller = new AdminController({
    replaceTeamEntitlements,
  } as never, { list: vi.fn() } as never)

  await expect(controller.replaceTeamEntitlements(
    "team-1",
    { permissionKeys: ["database.use"] },
    { admin: { id: "admin-1", email: "admin@example.com" }, ip: "203.0.113.40" } as never,
  )).resolves.toEqual({ permissionKeys: ["database.use"] })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm --filter @synapse/server test -- admin.service.spec.ts admin.controller.spec.ts`

Expected: FAIL because Admin service/controller do not expose permission APIs.

- [ ] **Step 4: Import PermissionsModule**

Modify `server/src/admin/admin.module.ts`:

```ts
import { PermissionsModule } from "../permissions/permissions.module"

@Module({
  imports: [PrismaModule, InvitationsModule, AdminAuthModule, PermissionsModule],
  controllers: [AdminController, LogFileController],
  providers: [AdminService, AuditLogService, LogFileService],
})
export class AdminModule {}
```

- [ ] **Step 5: Update AdminService**

Modify constructor:

```ts
import { PermissionsService } from "../permissions/permissions.service"

constructor(
  private readonly prisma: PrismaService,
  private readonly invitations: InvitationsService,
  private readonly permissions: PermissionsService,
  @Optional() private readonly auditLog?: AuditLogService,
) {}
```

Add methods:

```ts
listPermissions() {
  return this.permissions.listPermissionDefinitions()
}

async listTeamEntitlements(teamId: string) {
  return { permissionKeys: await this.permissions.listTeamEntitlements(teamId) }
}

async replaceTeamEntitlements(
  teamId: string,
  permissionKeys: readonly string[],
  admin: { readonly id: string; readonly email: string },
  ipAddress = "system",
) {
  const next = await this.permissions.replaceTeamEntitlements({
    teamId,
    permissionKeys,
    grantedByAdminId: admin.id,
    source: "manual",
  })
  await this.auditLog?.record({
    adminEmail: admin.email,
    action: "admin.team_entitlements.update",
    targetType: "team",
    targetId: teamId,
    detail: { permissionKeys: next },
    ipAddress,
  })
  return { permissionKeys: next }
}
```

- [ ] **Step 6: Update AdminController**

Add schema:

```ts
const teamEntitlementsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)),
}).strict()
```

Add endpoints:

```ts
@Get("/permissions")
listPermissions() {
  return this.admin.listPermissions()
}

@Get("/teams/:teamId/entitlements")
listTeamEntitlements(@Param("teamId") teamId: string) {
  return this.admin.listTeamEntitlements(teamId)
}

@Put("/teams/:teamId/entitlements")
replaceTeamEntitlements(
  @Param("teamId") teamId: string,
  @Body() body: unknown,
  @Req() request: AdminRequest,
) {
  const result = teamEntitlementsSchema.safeParse(body)
  if (!result.success) throw new BadRequestException("团队权限无效。")
  return this.admin.replaceTeamEntitlements(teamId, result.data.permissionKeys, request.admin!, request.ip)
}
```

- [ ] **Step 7: Update existing AdminService constructor tests**

Every `new AdminService(...)` call now needs a permissions argument:

```ts
const permissions = {
  listPermissionDefinitions: vi.fn(),
  listTeamEntitlements: vi.fn(),
  replaceTeamEntitlements: vi.fn(),
}
const service = new AdminService(prisma as never, invitations as never, permissions as never)
```

When audit log is passed:

```ts
const service = new AdminService(prisma as never, invitations as never, permissions as never, auditLog as never)
```

- [ ] **Step 8: Run admin tests**

Run: `pnpm --filter @synapse/server test -- admin.service.spec.ts admin.controller.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/admin/admin.module.ts server/src/admin/admin.service.ts server/src/admin/admin.controller.ts server/src/admin/admin.service.spec.ts server/src/admin/admin.controller.spec.ts
git commit -m "feat(server): add team entitlement admin api"
```

---

### Task 7: Register PermissionsModule in AppModule and Verify

**Files:**
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Import module**

Modify `server/src/app.module.ts`:

```ts
import { PermissionsModule } from "./permissions/permissions.module"
```

Add it once in `imports` after `PrismaModule`:

```ts
PrismaModule,
PermissionsModule,
InvitationsModule,
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/server test -- permissions.service.spec.ts teams.service.spec.ts user-auth.service.spec.ts admin.service.spec.ts admin.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full server checks**

Run:

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server test
```

Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/app.module.ts
git commit -m "feat(server): register permissions module"
```

---

## Self-Review Checklist

- Permission keys are stable product capability keys and do not reference routes.
- First-release effective permissions use `team entitlements ∩ assigned role permissions`.
- Existing team creation and join paths assign default access roles.
- Existing users can be migrated without losing access because default entitlements include the first-release permission registry.
- `GET /api/auth/me` returns team arrays and effective permissions for future desktop use.
- Admin APIs allow registry reads and team entitlement writes, but no Admin UI is included in this plan.
- Desktop login, UI filtering, and Electron main-process enforcement are intentionally separate follow-up plans.
