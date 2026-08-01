# Admin User Team Auth Implementation Plan

> Retired on 2026-07-31. Teams, memberships and team invitations were removed from the product and database; this plan is historical only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new server account foundation with one platform administrator, one-time signup invitations, normal user API auth, teams, team invitations, and a small Admin management surface.

**Architecture:** Keep platform admin identity separate from normal users. Add focused Nest modules for invitations, user auth, and teams, backed by Prisma constraints that enforce one team per user and one created team per user. Keep the Admin frontend operational and small: users, teams, and signup invitations only.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Vitest, React 19, Vite, shadcn/ui, Tailwind utilities.

---

## Current Baseline

The server cleanup has already removed the old license domain. Current retained backend files include:

- `server/src/admin-auth/*`
- `server/src/admin/*`
- `server/src/backup/*`
- `server/src/common/*`
- `server/src/config/env.ts`
- `server/src/health/*`
- `server/src/prisma/*`
- `server/prisma/schema.prisma`

The current Prisma schema only has `AdminUser`, `AdminStatus`, and `AuditLog`. The implementation should start from that state and must not reintroduce old license, activation, device, lease, or activation-code concepts.

## File Structure

Create backend modules:

- `server/src/admin-auth/admin-bootstrap.service.ts` initializes the single administrator from env.
- `server/src/auth/password.ts` hashes and verifies passwords.
- `server/src/auth/token.ts` creates opaque tokens and hashes stored token values.
- `server/src/auth/user-auth.guard.ts` validates normal-user bearer access tokens.
- `server/src/auth/user-auth.module.ts` wires normal-user auth dependencies.
- `server/src/auth/user-auth.controller.ts` exposes `/api/auth/*`.
- `server/src/auth/user-auth.service.ts` implements registration, login, refresh, logout, and `me`.
- `server/src/invitations/invitations.module.ts` wires invitation services.
- `server/src/invitations/invitations.service.ts` creates and consumes signup/team invitations.
- `server/src/teams/teams.module.ts` wires team services.
- `server/src/teams/teams.controller.ts` exposes `/api/teams/*`.
- `server/src/teams/teams.service.ts` implements team creation, invitations, join, members, and member removal.

Modify backend files:

- `server/prisma/schema.prisma` adds user/team/invitation/session models and enums.
- `server/src/app.module.ts` imports the new modules.
- `server/src/admin-auth/admin-auth.module.ts` stops hashing env password on every boot and injects Prisma-backed services.
- `server/src/admin-auth/admin-auth.service.ts` authenticates the single persisted admin user.
- `server/src/admin-auth/admin-auth.guard.ts` verifies JWT payload against the persisted admin.
- `server/src/admin/admin.controller.ts` adds invitation, user, and team admin routes.
- `server/src/admin/admin.service.ts` adds admin list/status operations and count updates.
- `server/src/common/audit-log.service.ts` accepts actor type and normal-user audit entries without breaking old admin audit display.
- `server/src/config/env.ts` adds normal-user JWT/refresh settings.
- `server/src/test/test-app.ts` can override providers for integration tests if needed.

Create or modify tests:

- `server/src/auth/password.spec.ts`
- `server/src/auth/token.spec.ts`
- `server/src/admin-auth/admin-bootstrap.service.spec.ts`
- `server/src/admin-auth/admin-auth.service.spec.ts`
- `server/src/invitations/invitations.service.spec.ts`
- `server/src/auth/user-auth.service.spec.ts`
- `server/src/teams/teams.service.spec.ts`
- `server/src/admin/admin.controller.spec.ts`
- `server/src/admin/admin.service.spec.ts`

Modify Admin frontend files:

- `server/admin/src/lib/api.ts` adds admin user/team/invitation client methods and types.
- `server/admin/src/App.tsx` adds routes for users, teams, invitations.
- `server/admin/src/components/app-sidebar.tsx` adds navigation entries.
- `server/admin/src/pages/users-page.tsx` creates the Users page.
- `server/admin/src/pages/teams-page.tsx` creates the Teams page.
- `server/admin/src/pages/invitations-page.tsx` creates the Invitations page.
- `server/admin/src/App.test.tsx` covers route rendering.
- Add focused page tests only where behavior is not already covered by API tests.

For any Admin frontend work, read `.claude/rules/design.md` and `.claude/rules/ui-rules.md` first. Use existing shadcn components and Tailwind utility classes only. Do not add custom colors, inline styles, nested cards, or marketing copy.

---

### Task 1: Prisma Schema And Database Constraints

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: Prisma migration directory generated by `pnpm --dir server prisma migrate dev --name admin_user_team_auth`
- Test: generated Prisma client

- [ ] **Step 1: Update Prisma schema**

Add these enums and models to `server/prisma/schema.prisma` while keeping existing `AdminUser` and `AuditLog`:

```prisma
enum UserStatus {
  active
  disabled
}

enum TeamRole {
  owner
  member
}

enum InvitationType {
  user_signup
  team_join
}

model User {
  id           String           @id @default(cuid())
  email        String           @unique
  passwordHash String
  status       UserStatus       @default(active)
  memberships  TeamMembership[]
  createdTeams Team[]           @relation("TeamCreator")
  sessions     UserSession[]
  acceptedInvitations Invitation[] @relation("AcceptedInvitations")
  createdInvitations  Invitation[] @relation("UserCreatedInvitations")
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
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

model Invitation {
  id                String         @id @default(cuid())
  type              InvitationType
  tokenHash         String         @unique
  expiresAt         DateTime
  usedAt            DateTime?
  createdByAdminId  String?
  createdByAdmin    AdminUser?     @relation(fields: [createdByAdminId], references: [id])
  createdByUserId   String?
  createdByUser     User?          @relation("UserCreatedInvitations", fields: [createdByUserId], references: [id])
  teamId            String?
  team              Team?          @relation(fields: [teamId], references: [id])
  acceptedByUserId  String?
  acceptedByUser    User?          @relation("AcceptedInvitations", fields: [acceptedByUserId], references: [id])
  createdAt         DateTime       @default(now())

  @@index([type, createdAt])
  @@index([expiresAt])
  @@index([teamId])
}

model UserSession {
  id               String    @id @default(cuid())
  userId           String
  user             User      @relation(fields: [userId], references: [id])
  refreshTokenHash String    @unique
  expiresAt        DateTime
  revokedAt        DateTime?
  lastUsedAt       DateTime?
  createdAt        DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
  @@index([revokedAt])
}
```

Add relations to the existing `AdminUser`:

```prisma
model AdminUser {
  id           String      @id @default(cuid())
  email        String      @unique
  passwordHash String
  status       AdminStatus @default(active)
  invitations  Invitation[]
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}
```

- [ ] **Step 2: Generate a Prisma migration**

Run:

```bash
pnpm --dir server prisma migrate dev --name admin_user_team_auth
```

Expected: Prisma creates one migration directory and regenerates the client. If no development database is available, create a migration against the configured local Postgres after starting it with:

```bash
pnpm dev:db
pnpm --dir server prisma migrate dev --name admin_user_team_auth
```

- [ ] **Step 3: Validate schema and generated client**

Run:

```bash
pnpm --dir server prisma validate
pnpm --filter @synapse/server run prisma:generate
```

Expected: both commands exit successfully.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat: add user team auth schema"
```

---

### Task 2: Shared Auth Utilities

**Files:**
- Create: `server/src/auth/password.ts`
- Create: `server/src/auth/password.spec.ts`
- Create: `server/src/auth/token.ts`
- Create: `server/src/auth/token.spec.ts`

- [ ] **Step 1: Write password utility tests**

Create `server/src/auth/password.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { hashPassword, verifyPassword } from "./password"

describe("password utilities", () => {
  it("verifies a hashed password", async () => {
    const hash = await hashPassword("StrongPassword123!")

    await expect(verifyPassword("StrongPassword123!", hash)).resolves.toBe(true)
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Write token utility tests**

Create `server/src/auth/token.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createOpaqueToken, hashToken } from "./token"

describe("token utilities", () => {
  it("creates opaque tokens and stable hashes", () => {
    const token = createOpaqueToken()

    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toBe(token)
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- src/auth/password.spec.ts src/auth/token.spec.ts
```

Expected: fail because the utility modules do not exist.

- [ ] **Step 4: Implement utilities**

Create `server/src/auth/password.ts`:

```ts
import bcrypt from "bcryptjs"

const passwordHashRounds = 10

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, passwordHashRounds)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
```

Create `server/src/auth/token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto"

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm --filter @synapse/server run test -- src/auth/password.spec.ts src/auth/token.spec.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/password.ts server/src/auth/password.spec.ts server/src/auth/token.ts server/src/auth/token.spec.ts
git commit -m "feat: add auth token utilities"
```

---

### Task 3: Persisted Single Administrator

**Files:**
- Create: `server/src/admin-auth/admin-bootstrap.service.ts`
- Create: `server/src/admin-auth/admin-bootstrap.service.spec.ts`
- Modify: `server/src/admin-auth/admin-auth.module.ts`
- Modify: `server/src/admin-auth/admin-auth.service.ts`
- Modify: `server/src/admin-auth/admin-auth.guard.ts`
- Modify: `server/src/admin-auth/admin-auth.service.spec.ts`

- [ ] **Step 1: Write admin bootstrap tests**

Create `server/src/admin-auth/admin-bootstrap.service.spec.ts` with a Prisma mock that covers initial creation and non-overwrite:

```ts
import { describe, expect, it, vi } from "vitest"
import { AdminBootstrapService } from "./admin-bootstrap.service"

function createPrismaMock(existingAdmin: unknown = null) {
  return {
    adminUser: {
      findFirst: vi.fn().mockResolvedValue(existingAdmin),
      create: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com" }),
    },
  }
}

describe("AdminBootstrapService", () => {
  it("creates the first administrator from env", async () => {
    const prisma = createPrismaMock()
    const service = new AdminBootstrapService(prisma as never, {
      adminEmail: "Admin@Example.com",
      adminPassword: "StrongPassword123!",
    })

    await service.onApplicationBootstrap()

    expect(prisma.adminUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "admin@example.com" }),
    })
  })

  it("does not overwrite an existing administrator", async () => {
    const prisma = createPrismaMock({ id: "admin-1", email: "old@example.com" })
    const service = new AdminBootstrapService(prisma as never, {
      adminEmail: "new@example.com",
      adminPassword: "StrongPassword123!",
    })

    await service.onApplicationBootstrap()

    expect(prisma.adminUser.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Update admin auth service tests**

Modify `server/src/admin-auth/admin-auth.service.spec.ts` so `AdminAuthService` reads admin users from Prisma instead of constructor email/hash:

```ts
import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "../auth/password"
import { AdminAuthService } from "./admin-auth.service"

async function createTestService() {
  const passwordHash = await hashPassword("admin@pwd1234!")
  const prisma = {
    adminUser: {
      findFirst: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@d2.com",
        passwordHash,
        status: "active",
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@d2.com",
        passwordHash,
        status: "active",
      }),
    },
  }
  const jwt = new JwtService({ secret: "test-secret-at-least-32-chars-long!", signOptions: { expiresIn: "1h" } })
  return new AdminAuthService(jwt, prisma as never)
}
```

Keep the existing accepted/rejected password assertions and add:

```ts
it("rejects a disabled administrator", async () => {
  const service = await createTestService()
  vi.spyOn((service as unknown as { prisma: { adminUser: { findFirst: ReturnType<typeof vi.fn> } } }).prisma.adminUser, "findFirst")
    .mockResolvedValueOnce({
      id: "admin-1",
      email: "admin@d2.com",
      passwordHash: await hashPassword("admin@pwd1234!"),
      status: "disabled",
    })

  await expect(service.login("admin@d2.com", "admin@pwd1234!")).rejects.toThrow("管理员账号或密码错误。")
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- src/admin-auth/admin-bootstrap.service.spec.ts src/admin-auth/admin-auth.service.spec.ts
```

Expected: fail because the new bootstrap service and updated constructor do not exist.

- [ ] **Step 4: Implement admin bootstrap service**

Create `server/src/admin-auth/admin-bootstrap.service.ts`:

```ts
import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common"
import { hashPassword } from "../auth/password"
import { PrismaService } from "../prisma/prisma.service"

interface AdminBootstrapEnv {
  readonly adminEmail: string
  readonly adminPassword: string
}

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    @Inject("ADMIN_BOOTSTRAP_ENV") private readonly env: AdminBootstrapEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    if (existing) return

    await this.prisma.adminUser.create({
      data: {
        email: this.env.adminEmail.trim().toLowerCase(),
        passwordHash: await hashPassword(this.env.adminPassword),
      },
    })
  }
}
```

- [ ] **Step 5: Refactor AdminAuthService**

Replace `server/src/admin-auth/admin-auth.service.ts` with Prisma-backed login and verification:

```ts
import { Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { verifyPassword } from "../auth/password"
import { PrismaService } from "../prisma/prisma.service"

interface AdminJwtPayload {
  readonly sub: string
  readonly email: string
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async getEmail(): Promise<string> {
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    return admin?.email ?? ""
  }

  async login(email: string, password: string): Promise<{ email: string; token: string }> {
    const normalizedEmail = email.trim().toLowerCase()
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    const passwordMatches = admin ? await verifyPassword(password, admin.passwordHash) : false
    if (!admin || admin.status !== "active" || admin.email !== normalizedEmail || !passwordMatches) {
      throw new UnauthorizedException("管理员账号或密码错误。")
    }

    const token = this.jwt.sign({ sub: admin.id, email: admin.email } satisfies AdminJwtPayload)
    return { email: admin.email, token }
  }

  async verify(token: string): Promise<{ id: string; email: string } | null> {
    try {
      const payload = this.jwt.verify<AdminJwtPayload>(token)
      const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } })
      if (!admin || admin.status !== "active" || admin.email !== payload.email) return null
      return { id: admin.id, email: admin.email }
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 6: Update module and guard**

In `server/src/admin-auth/admin-auth.module.ts`, remove `bcrypt` and the manual `AdminAuthService` factory. Add `PrismaModule` import and provide `AdminBootstrapService` with the env injection token:

```ts
import { Module } from "@nestjs/common"
import { JwtModule } from "@nestjs/jwt"
import { loadEnv } from "../config/env"
import { PrismaModule } from "../prisma/prisma.module"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"
import { AdminBootstrapService } from "./admin-bootstrap.service"

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv(process.env)
        return {
          secret: env.adminJwtSecret,
          signOptions: { expiresIn: "8h" },
        }
      },
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    {
      provide: "ADMIN_BOOTSTRAP_ENV",
      useFactory: () => {
        const env = loadEnv(process.env)
        return { adminEmail: env.adminEmail, adminPassword: env.adminPassword }
      },
    },
    AdminBootstrapService,
    AdminAuthGuard,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
```

Update `server/src/admin-auth/admin-auth.guard.ts` to await verification:

```ts
export interface AdminRequest extends Request {
  admin?: { id: string; email: string }
  cookies?: Record<string, string>
}

async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest<AdminRequest>()
  const token = request.cookies?.synapse_admin
  const admin = typeof token === "string" ? await this.auth.verify(token) : null
  if (!admin) {
    throw new ForbiddenException("未登录或登录已过期。")
  }
  request.admin = admin
  return true
}
```

- [ ] **Step 7: Update session controller**

In `server/src/admin-auth/admin-auth.controller.ts`, make `getSession` async:

```ts
@UseGuards(AdminAuthGuard)
@Get("/session")
async getSession() {
  return { email: await this.auth.getEmail() }
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/admin-auth/admin-bootstrap.service.spec.ts src/admin-auth/admin-auth.service.spec.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add server/src/admin-auth server/src/auth
git commit -m "feat: persist single admin auth"
```

---

### Task 4: Invitation Service

**Files:**
- Create: `server/src/invitations/invitations.module.ts`
- Create: `server/src/invitations/invitations.service.ts`
- Create: `server/src/invitations/invitations.service.spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write invitation service tests**

Create `server/src/invitations/invitations.service.spec.ts` covering:

```ts
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { InvitationsService } from "./invitations.service"

function createPrismaMock() {
  return {
    invitation: {
      create: vi.fn().mockResolvedValue({ id: "invite-1" }),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }
}

describe("InvitationsService", () => {
  it("creates a signup invitation with a returned plaintext token", async () => {
    const prisma = createPrismaMock()
    const service = new InvitationsService(prisma as never)

    const result = await service.createSignupInvitation({ adminId: "admin-1" })

    expect(result.token.length).toBeGreaterThanOrEqual(40)
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "user_signup",
        createdByAdminId: "admin-1",
      }),
    })
  })

  it("rejects invalid invitation tokens", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.findUnique.mockResolvedValue(null)
    const service = new InvitationsService(prisma as never)

    await expect(service.consumeInvitation({
      token: "missing",
      type: "user_signup",
      acceptedByUserId: "user-1",
    })).rejects.toThrow(BadRequestException)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- src/invitations/invitations.service.spec.ts
```

Expected: fail because the invitation service does not exist.

- [ ] **Step 3: Implement InvitationsService**

Create `server/src/invitations/invitations.service.ts`:

```ts
import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma, type InvitationType } from "@prisma/client"
import { createOpaqueToken, hashToken } from "../auth/token"
import { PrismaService } from "../prisma/prisma.service"

const invitationDays = 7

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createSignupInvitation(input: { readonly adminId: string }) {
    const token = createOpaqueToken()
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "user_signup",
        tokenHash: hashToken(token),
        expiresAt: addDays(new Date(), invitationDays),
        createdByAdminId: input.adminId,
      },
    })
    return { id: invitation.id, token, expiresAt: invitation.expiresAt }
  }

  async createTeamInvitation(input: { readonly userId: string; readonly teamId: string }) {
    const token = createOpaqueToken()
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "team_join",
        tokenHash: hashToken(token),
        expiresAt: addDays(new Date(), invitationDays),
        createdByUserId: input.userId,
        teamId: input.teamId,
      },
    })
    return { id: invitation.id, token, expiresAt: invitation.expiresAt }
  }

  async consumeInvitation(input: {
    readonly token: string
    readonly type: InvitationType
    readonly acceptedByUserId: string
  }, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const invitation = await client.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
    })
    if (!invitation || invitation.type !== input.type || invitation.usedAt || invitation.expiresAt <= new Date()) {
      throw new BadRequestException("邀请无效或已过期。")
    }

    return client.invitation.update({
      where: { id: invitation.id },
      data: {
        usedAt: new Date(),
        acceptedByUserId: input.acceptedByUserId,
      },
    })
  }
}
```

- [ ] **Step 4: Wire module**

Create `server/src/invitations/invitations.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { PrismaModule } from "../prisma/prisma.module"
import { InvitationsService } from "./invitations.service"

@Module({
  imports: [PrismaModule],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
```

Import `InvitationsModule` in `server/src/app.module.ts`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/invitations/invitations.service.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/invitations server/src/app.module.ts
git commit -m "feat: add invitation service"
```

---

### Task 5: Normal User Auth API

**Files:**
- Create: `server/src/auth/user-auth.module.ts`
- Create: `server/src/auth/user-auth.controller.ts`
- Create: `server/src/auth/user-auth.service.ts`
- Create: `server/src/auth/user-auth.guard.ts`
- Create: `server/src/auth/user-auth.service.spec.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/src/config/env.ts`

- [ ] **Step 1: Extend env config**

Add to `server/src/config/env.ts` schema and interface:

```ts
USER_ACCESS_JWT_SECRET: z.string().min(32).optional(),
USER_ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(15),
USER_REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
```

Map to:

```ts
readonly userAccessJwtSecret: string
readonly userAccessTokenMinutes: number
readonly userRefreshTokenDays: number
```

Use `ADMIN_JWT_SECRET` as the fallback for `userAccessJwtSecret` only when `USER_ACCESS_JWT_SECRET` is absent:

```ts
userAccessJwtSecret: result.data.USER_ACCESS_JWT_SECRET ?? result.data.ADMIN_JWT_SECRET,
```

- [ ] **Step 2: Write user auth service tests**

Create `server/src/auth/user-auth.service.spec.ts` covering:

```ts
import { BadRequestException, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "./password"
import { UserAuthService } from "./user-auth.service"

function createPrismaMock() {
  return {
    $transaction: vi.fn((callback) => callback({
      user: {
        create: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", status: "active" }),
        findUnique: vi.fn(),
      },
      userSession: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    })),
    user: {
      findUnique: vi.fn(),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }
}

describe("UserAuthService", () => {
  it("rejects login for unknown users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
    )

    await expect(service.login({ email: "missing@example.com", password: "x" })).rejects.toThrow(UnauthorizedException)
  })

  it("rejects disabled users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "disabled",
    })
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
    )

    await expect(service.login({ email: "u@example.com", password: "StrongPassword123!" })).rejects.toThrow("账号已停用。")
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- src/auth/user-auth.service.spec.ts
```

Expected: fail because `UserAuthService` does not exist.

- [ ] **Step 4: Implement user auth service**

Create `server/src/auth/user-auth.service.ts` with these public methods:

```ts
export interface UserTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
}

export class UserAuthService {
  async register(input: { invitationToken: string; email: string; password: string }): Promise<UserTokenPair>
  async login(input: { email: string; password: string }): Promise<UserTokenPair>
  async refresh(input: { refreshToken: string }): Promise<UserTokenPair>
  async logout(input: { refreshToken: string }): Promise<{ ok: true }>
  async getMe(userId: string): Promise<unknown>
  async verifyAccessToken(token: string): Promise<{ userId: string }>
}
```

Core implementation details:

```ts
private signAccessToken(user: { id: string; email: string }): string {
  return this.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: `${this.options.accessMinutes}m` })
}

private async issueTokenPair(
  user: { id: string; email: string },
  client: Prisma.TransactionClient | PrismaService = this.prisma,
): Promise<UserTokenPair> {
  const refreshToken = createOpaqueToken()
  await client.userSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: addDays(new Date(), this.options.refreshDays),
    },
  })
  return { accessToken: this.signAccessToken(user), refreshToken }
}
```

For registration, use one transaction:

```ts
return this.prisma.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
    },
  })
  await this.invitations.consumeInvitation({
    token: input.invitationToken,
    type: "user_signup",
    acceptedByUserId: user.id,
  }, tx)
  return this.issueTokenPair(user, tx)
})
```

If Prisma unique constraint indicates duplicate email, throw:

```ts
throw new BadRequestException("邮箱已注册。")
```

For login, unknown user or wrong password throws:

```ts
throw new UnauthorizedException("邮箱或密码错误。")
```

Disabled user throws:

```ts
throw new UnauthorizedException("账号已停用。")
```

- [ ] **Step 5: Implement user auth guard**

Create `server/src/auth/user-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { UserAuthService } from "./user-auth.service"

export interface AuthenticatedUserRequest extends Request {
  user?: { id: string }
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly auth: UserAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedUserRequest>()
    const header = request.headers.authorization
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("未登录或登录已过期。")
    const result = await this.auth.verifyAccessToken(header.slice("Bearer ".length))
    if (!result.userId) throw new ForbiddenException("未登录或登录已过期。")
    request.user = { id: result.userId }
    return true
  }
}
```

- [ ] **Step 6: Implement controller and module**

Create `server/src/auth/user-auth.controller.ts` with zod validation for each body:

```ts
@Controller("/api/auth")
export class UserAuthController {
  constructor(private readonly auth: UserAuthService) {}

  @Post("/register")
  register(@Body() body: unknown) {
    const input = registerSchema.parse(body)
    return this.auth.register(input)
  }

  @Post("/login")
  login(@Body() body: unknown) {
    const input = loginSchema.parse(body)
    return this.auth.login(input)
  }

  @Post("/refresh")
  refresh(@Body() body: unknown) {
    const input = refreshSchema.parse(body)
    return this.auth.refresh(input)
  }

  @Post("/logout")
  logout(@Body() body: unknown) {
    const input = refreshSchema.parse(body)
    return this.auth.logout(input)
  }

  @UseGuards(UserAuthGuard)
  @Get("/me")
  me(@Req() request: AuthenticatedUserRequest) {
    return this.auth.getMe(request.user!.id)
  }
}
```

Create `server/src/auth/user-auth.module.ts` importing `JwtModule`, `PrismaModule`, and `InvitationsModule`, and exporting `UserAuthService` and `UserAuthGuard`.

Import `UserAuthModule` in `server/src/app.module.ts`.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/auth/user-auth.service.spec.ts
pnpm --filter @synapse/server run typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/auth server/src/config/env.ts server/src/app.module.ts
git commit -m "feat: add user auth api"
```

---

### Task 6: Team Service And API

**Files:**
- Create: `server/src/teams/teams.module.ts`
- Create: `server/src/teams/teams.controller.ts`
- Create: `server/src/teams/teams.service.ts`
- Create: `server/src/teams/teams.service.spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write team service tests**

Create `server/src/teams/teams.service.spec.ts` covering:

```ts
import { BadRequestException, ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { TeamsService } from "./teams.service"

function createPrismaMock() {
  return {
    teamMembership: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    team: {
      create: vi.fn().mockResolvedValue({ id: "team-1", name: "Team", createdByUserId: "user-1" }),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({
      team: {
        create: vi.fn().mockResolvedValue({ id: "team-1", name: "Team", createdByUserId: "user-1" }),
      },
      teamMembership: {
        create: vi.fn().mockResolvedValue({ id: "membership-1", teamId: "team-1", userId: "user-1", role: "owner" }),
      },
    })),
  }
}

describe("TeamsService", () => {
  it("rejects team creation when the user already belongs to a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findUnique.mockResolvedValue({ id: "membership-1" })
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn(), consumeInvitation: vi.fn() } as never)

    await expect(service.createTeam("user-1", { name: "Team" })).rejects.toThrow(BadRequestException)
  })

  it("rejects team invitations from non-owners", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findFirst.mockResolvedValue({ role: "member", teamId: "team-1" })
    const service = new TeamsService(prisma as never, { createTeamInvitation: vi.fn() } as never)

    await expect(service.createInvitation("user-1")).rejects.toThrow(ForbiddenException)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- src/teams/teams.service.spec.ts
```

Expected: fail because `TeamsService` does not exist.

- [ ] **Step 3: Implement TeamsService**

Create `server/src/teams/teams.service.ts` with these methods:

```ts
async createTeam(userId: string, input: { name: string })
async getMyTeam(userId: string)
async createInvitation(userId: string)
async joinTeam(userId: string, input: { invitationToken: string })
async listMembers(userId: string)
async removeMember(ownerUserId: string, targetUserId: string)
```

Important implementation snippets:

```ts
private async getMembership(userId: string) {
  return this.prisma.teamMembership.findUnique({
    where: { userId },
    include: { team: true },
  })
}

async createTeam(userId: string, input: { name: string }) {
  const existing = await this.getMembership(userId)
  if (existing) throw new BadRequestException("账号已属于一个团队。")

  return this.prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { name: input.name.trim(), createdByUserId: userId },
    })
    await tx.teamMembership.create({
      data: { teamId: team.id, userId, role: "owner" },
    })
    return team
  })
}

async createInvitation(userId: string) {
  const membership = await this.getMembership(userId)
  if (!membership || membership.role !== "owner") throw new ForbiddenException()
  return this.invitations.createTeamInvitation({ userId, teamId: membership.teamId })
}
```

For join:

```ts
async joinTeam(userId: string, input: { invitationToken: string }) {
  const existing = await this.getMembership(userId)
  if (existing) throw new BadRequestException("账号已属于一个团队。")
  return this.prisma.$transaction(async (tx) => {
    const invitation = await this.invitations.consumeInvitation({
      token: input.invitationToken,
      type: "team_join",
      acceptedByUserId: userId,
    }, tx)
    if (!invitation.teamId) throw new BadRequestException("邀请无效或已过期。")
    return tx.teamMembership.create({
      data: { teamId: invitation.teamId, userId, role: "member" },
    })
  })
}
```

- [ ] **Step 4: Implement controller and module**

Create `server/src/teams/teams.controller.ts`:

```ts
@UseGuards(UserAuthGuard)
@Controller("/api/teams")
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  createTeam(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.teams.createTeam(request.user!.id, createTeamSchema.parse(body))
  }

  @Get("/me")
  getMyTeam(@Req() request: AuthenticatedUserRequest) {
    return this.teams.getMyTeam(request.user!.id)
  }

  @Post("/invitations")
  createInvitation(@Req() request: AuthenticatedUserRequest) {
    return this.teams.createInvitation(request.user!.id)
  }

  @Post("/join")
  joinTeam(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.teams.joinTeam(request.user!.id, joinTeamSchema.parse(body))
  }

  @Get("/members")
  listMembers(@Req() request: AuthenticatedUserRequest) {
    return this.teams.listMembers(request.user!.id)
  }

  @Delete("/members/:userId")
  removeMember(@Req() request: AuthenticatedUserRequest, @Param("userId") userId: string) {
    return this.teams.removeMember(request.user!.id, userId)
  }
}
```

Create `server/src/teams/teams.module.ts` importing `PrismaModule`, `InvitationsModule`, and `UserAuthModule`.

Import `TeamsModule` in `server/src/app.module.ts`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/teams/teams.service.spec.ts
pnpm --filter @synapse/server run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/teams server/src/app.module.ts
git commit -m "feat: add team api"
```

---

### Task 7: Admin API For Users, Teams, And Invitations

**Files:**
- Modify: `server/src/admin/admin.service.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.service.spec.ts`
- Modify: `server/src/admin/admin.controller.spec.ts`

- [ ] **Step 1: Write admin service tests**

Update `server/src/admin/admin.service.spec.ts` to cover:

```ts
it("includes user and team counts in system overview", async () => {
  const prisma = createPrismaMock({
    auditLogs: 2,
    users: 3,
    teams: 1,
    invitations: 4,
  })
  const service = new AdminService(prisma as never, {} as never)

  await expect(service.getSystemOverview()).resolves.toMatchObject({
    counts: { auditLogs: 2, users: 3, teams: 1, invitations: 4 },
  })
})

it("disables a user", async () => {
  const prisma = createPrismaMock()
  const service = new AdminService(prisma as never, {} as never)

  await service.updateUserStatus("user-1", { status: "disabled" })

  expect(prisma.user.update).toHaveBeenCalledWith({
    where: { id: "user-1" },
    data: { status: "disabled" },
  })
})
```

- [ ] **Step 2: Write admin controller tests**

Update `server/src/admin/admin.controller.spec.ts` to cover request validation:

```ts
it("creates signup invitations through the service", async () => {
  const createSignupInvitation = vi.fn().mockResolvedValue({ token: "plain-token" })
  const controller = createController({ createSignupInvitation } as never)

  await expect(controller.createSignupInvitation({ id: "admin-1" } as never)).resolves.toEqual({ token: "plain-token" })
})

it("rejects invalid user status", async () => {
  const controller = createController({ updateUserStatus: vi.fn() } as never)

  await expect(controller.updateUserStatus("user-1", { status: "bad" })).rejects.toThrow("用户状态无效。")
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/server run test -- src/admin/admin.service.spec.ts src/admin/admin.controller.spec.ts
```

Expected: fail because new methods do not exist.

- [ ] **Step 4: Implement admin service methods**

Add methods to `server/src/admin/admin.service.ts`:

```ts
async createSignupInvitation(adminId: string) {
  return this.invitations.createSignupInvitation({ adminId })
}

async listUsers(pagination?: PaginationQuery) {
  const args = pagination ? toPrismaArgs(pagination) : { skip: 0, take: 20, orderBy: { createdAt: "desc" as const } }
  const [data, total] = await this.prisma.$transaction([
    this.prisma.user.findMany({
      ...args,
      include: { memberships: { include: { team: true } } },
    }),
    this.prisma.user.count(),
  ])
  return { data, total, page: pagination?.page ?? 1, pageSize: pagination?.pageSize ?? 20 }
}

async updateUserStatus(id: string, input: { status: "active" | "disabled" }) {
  return this.prisma.user.update({ where: { id }, data: { status: input.status } })
}

async listTeams(pagination?: PaginationQuery) {
  const args = pagination ? toPrismaArgs(pagination) : { skip: 0, take: 20, orderBy: { createdAt: "desc" as const } }
  const [data, total] = await this.prisma.$transaction([
    this.prisma.team.findMany({
      ...args,
      include: {
        createdByUser: { select: { email: true } },
        memberships: { include: { user: { select: { email: true } } } },
      },
    }),
    this.prisma.team.count(),
  ])
  return { data, total, page: pagination?.page ?? 1, pageSize: pagination?.pageSize ?? 20 }
}

async listInvitations(pagination?: PaginationQuery) {
  const args = pagination ? toPrismaArgs(pagination) : { skip: 0, take: 20, orderBy: { createdAt: "desc" as const } }
  const [data, total] = await this.prisma.$transaction([
    this.prisma.invitation.findMany({
      ...args,
      where: { type: "user_signup" },
      include: { acceptedByUser: { select: { email: true } } },
    }),
    this.prisma.invitation.count({ where: { type: "user_signup" } }),
  ])
  return { data, total, page: pagination?.page ?? 1, pageSize: pagination?.pageSize ?? 20 }
}
```

Update `getSystemOverview` counts to include `users`, `teams`, and `invitations`.

- [ ] **Step 5: Implement admin controller routes**

Add to `server/src/admin/admin.controller.ts`:

```ts
@Post("/invitations")
createSignupInvitation(@Req() request: Request & { admin?: { id: string } }) {
  return this.admin.createSignupInvitation(request.admin!.id)
}

@Get("/invitations")
listInvitations(@Query() query: Record<string, unknown>) {
  return this.admin.listInvitations(parsePagination(query))
}

@Get("/users")
listUsers(@Query() query: Record<string, unknown>) {
  return this.admin.listUsers(parsePagination(query))
}

@Patch("/users/:id/status")
updateUserStatus(@Param("id") id: string, @Body() body: unknown) {
  const result = userStatusSchema.safeParse(body)
  if (!result.success) throw new BadRequestException("用户状态无效。")
  return this.admin.updateUserStatus(id, result.data)
}

@Get("/teams")
listTeams(@Query() query: Record<string, unknown>) {
  return this.admin.listTeams(parsePagination(query))
}
```

Update `AdminAuthGuard` to place admin id on the request after verification so `createSignupInvitation` can record `createdByAdminId`.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/admin/admin.service.spec.ts src/admin/admin.controller.spec.ts
pnpm --filter @synapse/server run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/admin server/src/admin-auth
git commit -m "feat: add admin user team APIs"
```

---

### Task 8: Admin Frontend Pages

**Files:**
- Modify: `server/admin/src/lib/api.ts`
- Modify: `server/admin/src/App.tsx`
- Modify: `server/admin/src/components/app-sidebar.tsx`
- Create: `server/admin/src/pages/users-page.tsx`
- Create: `server/admin/src/pages/teams-page.tsx`
- Create: `server/admin/src/pages/invitations-page.tsx`
- Modify: `server/admin/src/App.test.tsx`

- [ ] **Step 1: Read UI rules**

Run:

```bash
sed -n '1,220p' .claude/rules/design.md
sed -n '1,220p' .claude/rules/ui-rules.md
```

Apply these constraints:

- Use existing shadcn primitives in `server/admin/src/components/ui`.
- Use Tailwind utility classes for layout only.
- Do not add hex/rgb/hsl colors, gradients, inline styles, or card-in-card layouts.
- Keep UI copy short: labels, states, and actions only.

- [ ] **Step 2: Extend API client types and methods**

In `server/admin/src/lib/api.ts`, add:

```ts
export interface AdminUserRow {
  readonly id: string
  readonly email: string
  readonly status: "active" | "disabled"
  readonly memberships: Array<{ readonly role: "owner" | "member"; readonly team: { readonly id: string; readonly name: string } }>
  readonly createdAt: string
}

export interface AdminTeamRow {
  readonly id: string
  readonly name: string
  readonly createdByUser: { readonly email: string }
  readonly memberships: Array<{ readonly role: "owner" | "member"; readonly user: { readonly email: string }; readonly createdAt: string }>
  readonly createdAt: string
}

export interface AdminInvitationRow {
  readonly id: string
  readonly type: "user_signup" | "team_join"
  readonly expiresAt: string
  readonly usedAt: string | null
  readonly acceptedByUser: { readonly email: string } | null
  readonly createdAt: string
}
```

Add methods:

```ts
createSignupInvitation: () =>
  request<{ id: string; token: string; expiresAt: string }>("/admin/api/invitations", { method: "POST" }),
listInvitations: (options: { page?: number; pageSize?: number } = {}) =>
  request<PaginatedResponse<AdminInvitationRow>>(`/admin/api/invitations${paginationSuffix(options)}`),
listUsers: (options: { page?: number; pageSize?: number } = {}) =>
  request<PaginatedResponse<AdminUserRow>>(`/admin/api/users${paginationSuffix(options)}`),
updateUserStatus: (id: string, status: "active" | "disabled") =>
  request<AdminUserRow>(`/admin/api/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
listTeams: (options: { page?: number; pageSize?: number } = {}) =>
  request<PaginatedResponse<AdminTeamRow>>(`/admin/api/teams${paginationSuffix(options)}`),
```

Add a local helper:

```ts
function paginationSuffix(options: { page?: number; pageSize?: number }): string {
  const query = new URLSearchParams()
  if (options.page) query.set("page", String(options.page))
  if (options.pageSize) query.set("pageSize", String(options.pageSize))
  const value = query.toString()
  return value ? `?${value}` : ""
}
```

- [ ] **Step 3: Create Users page**

Create `server/admin/src/pages/users-page.tsx` using existing `Button`, `Badge`, `Table`, and `PageState`.

Required behavior:

- Fetch `adminApi.listUsers()`.
- Show columns: 邮箱, 状态, 团队, 创建时间, 操作.
- Button toggles active/disabled by calling `adminApi.updateUserStatus`.
- No helper paragraph under the title.

- [ ] **Step 4: Create Teams page**

Create `server/admin/src/pages/teams-page.tsx`.

Required behavior:

- Fetch `adminApi.listTeams()`.
- Show columns: 名称, Owner, 成员数, 创建时间.
- Expanded details are not required in the first pass; showing member count is enough for this task.

- [ ] **Step 5: Create Invitations page**

Create `server/admin/src/pages/invitations-page.tsx`.

Required behavior:

- Fetch `adminApi.listInvitations()`.
- Provide one button `创建邀请`.
- On create, call `adminApi.createSignupInvitation()` and render the plaintext token in a read-only input for this page session.
- Show list columns: 状态, 使用人, 过期时间, 创建时间.
- Do not try to recover plaintext tokens from existing rows.

- [ ] **Step 6: Wire routes and sidebar**

In `server/admin/src/App.tsx`, extend route union:

```ts
| { name: "users" }
| { name: "teams" }
| { name: "invitations" }
```

Map hash routes:

```ts
if (route === "users") return { name: "users" }
if (route === "teams") return { name: "teams" }
if (route === "invitations") return { name: "invitations" }
```

Add titles and render the three pages.

In `server/admin/src/components/app-sidebar.tsx`, add sidebar links for:

- 用户
- 团队
- 邀请

- [ ] **Step 7: Update frontend tests**

Update `server/admin/src/App.test.tsx` to cover one new route, for example `#/users`, by mocking `adminApi.getSession` and `adminApi.listUsers`.

- [ ] **Step 8: Run frontend checks**

Run:

```bash
pnpm --filter @synapse/server run test:admin
pnpm --filter @synapse/server run typecheck
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add server/admin/src
git commit -m "feat: add admin user team pages"
```

---

### Task 9: Audit Logging And Final Integration

**Files:**
- Modify: `server/src/common/audit-log.service.ts`
- Modify: `server/src/admin-auth/admin-auth.controller.ts`
- Modify: `server/src/auth/user-auth.service.ts`
- Modify: `server/src/invitations/invitations.service.ts`
- Modify: `server/src/teams/teams.service.ts`
- Modify: tests touched by audit behavior
- Modify: `server/README.md` and `server/.env.example` if new env values are missing

- [ ] **Step 1: Extend audit service input without breaking Admin display**

Allow `adminEmail` to carry either admin email or user email for now, and use `targetType` to distinguish resources. Keep the existing `AuditLog` table unchanged unless a stricter actor schema is required by implementation.

Use actions:

```ts
admin.login.success
admin.login.failure
admin.invitation.create
admin.user.status_update
user.register.success
user.login.success
user.login.failure
team.create
team.invitation.create
team.join
team.member.remove
```

- [ ] **Step 2: Add audit records at service boundaries**

Record audit entries after successful mutations:

- Admin login success/failure in `AdminAuthController` or `AdminAuthService`.
- Signup invitation creation in `AdminService.createSignupInvitation`.
- User status update in `AdminService.updateUserStatus`.
- User register/login in `UserAuthService`.
- Team creation, invitation, join, and member removal in `TeamsService`.

Use `ipAddress: "system"` in service-level tests when request IP is not available. If request IP is needed for controller-level logging, pass it explicitly from controllers.

- [ ] **Step 3: Update `.env.example`**

Add:

```env
USER_ACCESS_JWT_SECRET=replace-with-at-least-32-chars
USER_ACCESS_TOKEN_MINUTES=15
USER_REFRESH_TOKEN_DAYS=30
```

- [ ] **Step 4: Update server README**

Document:

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` initializes the only platform admin on first boot.
- The admin creates one-time signup invitations.
- Normal user auth uses `/api/auth/*`.
- Team APIs use `/api/teams/*`.

Keep the README concise and remove any stale license wording if it remains.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm --dir server prisma validate
pnpm --filter @synapse/server run prisma:generate
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test
pnpm --filter @synapse/server run test:admin
pnpm --filter @synapse/server run build
rg "ActivationCode|ActivationAttempt|License|Lease|activationCode|activations|LICENSE_|ACTIVATION_" server
```

Expected:

- All commands pass.
- `rg` returns no old authorization source references. If it returns benign dependency or generated output matches, inspect manually and do not delete unrelated files.

- [ ] **Step 6: Commit**

```bash
git add server/.env.example server/README.md server/src server/admin/src server/prisma
git commit -m "feat: wire user team auth audit"
```

---

## Self-Review Checklist

- The plan covers every spec item: single admin, signup invitations, normal user auth API, refresh sessions, teams, team invitations, Admin pages, error handling, audit, and verification.
- The plan keeps admin identity separate from normal user identity.
- The plan enforces the one-team-per-user rule at the Prisma level with `TeamMembership.userId @unique`.
- The plan enforces one-created-team-per-user with `Team.createdByUserId @unique`.
- The plan stores only token hashes for invitations and refresh sessions.
- The plan avoids normal-user web pages.
- The plan does not add dependencies.
- The plan does not start a dev server or browser verification.
