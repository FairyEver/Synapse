# Desktop Account Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Synapse Desktop account login through browser-based dashboard authentication and `synapse://auth/callback`, while moving repository controls into the three content pages.

**Architecture:** Server adds a one-time desktop login code handoff that exchanges code+state for tokens and never returns user profile data from exchange. Dashboard preserves `client=desktop&state=...` through login, issues a code after authenticated login, and opens the custom protocol. Desktop main owns token persistence, refresh, `/me`, protocol callback handling, and account events; renderer only sees account state and actions.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vite React dashboard, Electron main/preload IPC modules, React 19 renderer, shadcn/Radix UI, Vitest.

---

## File Structure

Server:

- Modify: `server/prisma/schema.prisma` to add `DesktopLoginCode`.
- Create: `server/prisma/migrations/20260528000000_desktop_login_codes/migration.sql`.
- Modify: `server/src/auth/user-auth.service.ts` to add issue/exchange helpers.
- Modify: `server/src/auth/user-auth.controller.ts` to expose `/api/auth/desktop/issue-code` and `/api/auth/desktop/exchange`.
- Modify: `server/src/auth/user-auth.service.spec.ts` and `server/src/auth/user-auth.controller.spec.ts`.

Dashboard:

- Modify: `dashboard/src/lib/api.ts` to add desktop issue-code API.
- Modify: `dashboard/src/pages/login-page.tsx` to preserve desktop login query and route authenticated users into handoff.
- Create: `dashboard/src/pages/desktop-login-handoff-page.tsx`.
- Modify: `dashboard/src/app.tsx` to add the handoff route.

Desktop main and shared types:

- Create: `desktop/src/types/account.ts`.
- Modify: `desktop/src/types/bridge.ts` for account bridge.
- Create: `desktop/src/app-shell/account.ts`.
- Create: `desktop/src/app-shell/account-context.tsx`.
- Create: `desktop/electron/services/account-service.ts`.
- Create: `desktop/electron/modules/account/ipc.ts`.
- Modify: `desktop/electron/runtime/event-bus/types.ts` to add the `account` event domain.
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`.
- Modify: `desktop/electron/preload.ts`.
- Modify: `desktop/electron/bootstrap/app-events.ts` and `desktop/electron/main.ts` for protocol registration and callback forwarding.

Desktop renderer UI:

- Create: `desktop/src/app-shell/components/account-actions.tsx`.
- Modify: `desktop/src/main.tsx` to install `AccountProvider`.
- Modify: `desktop/src/App.tsx` to show account actions in the global top bar.
- Modify: `desktop/src/modules/settings/types.ts`, `desktop/src/modules/settings/data.ts`, and `desktop/src/modules/settings/index.tsx`.
- Create: `desktop/src/modules/settings/components/account-panel.tsx`.
- Create: `desktop/src/modules/settings/components/__tests__/account-panel.test.tsx`.

Repository action relocation:

- Create: `desktop/src/modules/content/components/content-repository-actions.tsx`.
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`.
- Modify or remove global toolbar wiring in `desktop/src/App.tsx`.
- Add/modify tests under `desktop/src/app-shell/__tests__/` and `desktop/src/modules/content/__tests__/`.

Release notes:

- Modify: `RELEASE_NOTES_PENDING.md`.

## Task 1: Server Desktop Login Code Model

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260528000000_desktop_login_codes/migration.sql`

- [ ] **Step 1: Add the Prisma model**

Add this relation to `model User`:

```prisma
  desktopLoginCodes  DesktopLoginCode[]
```

Add this model near `UserSession`:

```prisma
model DesktopLoginCode {
  id        String    @id @default(cuid())
  codeHash  String    @unique
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  state     String
  expiresAt DateTime
  usedAt    DateTime?
  ipAddress String
  userAgent String?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
  @@index([usedAt])
}
```

- [ ] **Step 2: Add the migration SQL**

Create `server/prisma/migrations/20260528000000_desktop_login_codes/migration.sql`:

```sql
CREATE TABLE "DesktopLoginCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "ipAddress" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DesktopLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesktopLoginCode_codeHash_key" ON "DesktopLoginCode"("codeHash");
CREATE INDEX "DesktopLoginCode_userId_idx" ON "DesktopLoginCode"("userId");
CREATE INDEX "DesktopLoginCode_expiresAt_idx" ON "DesktopLoginCode"("expiresAt");
CREATE INDEX "DesktopLoginCode_usedAt_idx" ON "DesktopLoginCode"("usedAt");

ALTER TABLE "DesktopLoginCode"
  ADD CONSTRAINT "DesktopLoginCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
```

Expected: command exits 0 and generated Prisma types include `desktopLoginCode`.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260528000000_desktop_login_codes/migration.sql
git commit -m "feat(server): add desktop login code model"
```

## Task 2: Server Issue And Exchange APIs

**Files:**
- Modify: `server/src/auth/user-auth.service.ts`
- Modify: `server/src/auth/user-auth.controller.ts`
- Modify: `server/src/auth/user-auth.service.spec.ts`
- Modify: `server/src/auth/user-auth.controller.spec.ts`

- [ ] **Step 1: Write service tests for code lifecycle**

Add tests in `server/src/auth/user-auth.service.spec.ts` that prove:

```ts
it("issues and exchanges a desktop login code without returning user profile", async () => {
  const prisma = createPrismaMock()
  prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "desktop@example.com", status: "active" })
  prisma.desktopLoginCode.create.mockResolvedValue({ id: "code-1" })
  prisma.desktopLoginCode.findUnique.mockResolvedValue({
    id: "code-1",
    userId: "user-1",
    codeHash: "hash",
    state: "state-1234567890",
    usedAt: null,
    expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    user: { id: "user-1", email: "desktop@example.com", status: "active" },
  })
  prisma.desktopLoginCode.updateMany.mockResolvedValue({ count: 1 })
  const service = createService(prisma)

  const issued = await service.issueDesktopLoginCode({
    userId: "user-1",
    state: "state-1234567890",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })

  expect(issued.code).toHaveLength(43)
  expect(issued.deepLinkUrl).toBe(`synapse://auth/callback?code=${encodeURIComponent(issued.code)}&state=state-1234567890`)

  const exchanged = await service.exchangeDesktopLoginCode({
    code: issued.code,
    state: "state-1234567890",
    ipAddress: "127.0.0.1",
  })

  expect(exchanged.accessToken).toEqual(expect.any(String))
  expect(exchanged.refreshToken).toEqual(expect.any(String))
  expect(exchanged).not.toHaveProperty("user")
})

it("rejects desktop login code replay", async () => {
  const prisma = createPrismaMock()
  prisma.desktopLoginCode.findUnique.mockResolvedValue({
    id: "code-1",
    userId: "user-1",
    state: "state-1234567890",
    usedAt: new Date("2026-05-28T00:00:00.000Z"),
    expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    user: { id: "user-1", email: "replay@example.com", status: "active" },
  })
  const service = createService(prisma)

  await expect(service.exchangeDesktopLoginCode({
    code: "already-used-code",
    state: "state-1234567890",
    ipAddress: "127.0.0.1",
  })).rejects.toThrow("登录凭证无效或已过期。")
})

it("rejects desktop login code state mismatch", async () => {
  const prisma = createPrismaMock()
  prisma.desktopLoginCode.findUnique.mockResolvedValue({
    id: "code-1",
    userId: "user-1",
    state: "expected-state",
    usedAt: null,
    expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    user: { id: "user-1", email: "state@example.com", status: "active" },
  })
  const service = createService(prisma)

  await expect(service.exchangeDesktopLoginCode({
    code: "code-1",
    state: "wrong-state",
    ipAddress: "127.0.0.1",
  })).rejects.toThrow("登录凭证无效或已过期。")
})
```

Extend `createPrismaMock()` in the same file with:

```ts
desktopLoginCode: {
  create: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
},
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/auth/user-auth.service.spec.ts
```

Expected: FAIL because `issueDesktopLoginCode` and `exchangeDesktopLoginCode` do not exist.

- [ ] **Step 3: Implement service methods**

In `server/src/auth/user-auth.service.ts`, add the import:

```ts
import { timingSafeEqual } from "node:crypto"
```

Then add:

```ts
const desktopLoginCodeTtlMs = 5 * 60 * 1000

function buildDesktopDeepLink(code: string, state: string): string {
  const query = new URLSearchParams({ code, state })
  return `synapse://auth/callback?${query.toString()}`
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
```

Add methods to `UserAuthService`:

```ts
async issueDesktopLoginCode(input: {
  readonly userId: string
  readonly state: string
  readonly ipAddress: string
  readonly userAgent?: string
}): Promise<{ code: string; deepLinkUrl: string; expiresAt: Date }> {
  const state = input.state.trim()
  if (!state) throw new BadRequestException("登录状态无效。")

  const user = await this.prisma.user.findUnique({ where: { id: input.userId } })
  if (!user || user.status !== "active") {
    throw new UnauthorizedException("未登录或登录已过期。")
  }

  const code = createOpaqueToken()
  const expiresAt = new Date(Date.now() + desktopLoginCodeTtlMs)
  await this.prisma.desktopLoginCode.create({
    data: {
      codeHash: hashToken(code),
      userId: user.id,
      state,
      expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  })

  await this.auditLog?.record({
    adminEmail: user.email,
    action: "user.desktop_login.issue",
    targetType: "user",
    targetId: user.id,
    ipAddress: input.ipAddress,
  })

  return { code, deepLinkUrl: buildDesktopDeepLink(code, state), expiresAt }
}

async exchangeDesktopLoginCode(input: {
  readonly code: string
  readonly state: string
  readonly ipAddress: string
}): Promise<UserTokenPair> {
  const code = input.code.trim()
  const state = input.state.trim()
  if (!code || !state) throw new UnauthorizedException("登录凭证无效或已过期。")

  const codeHash = hashToken(code)
  const record = await this.prisma.desktopLoginCode.findUnique({
    where: { codeHash },
    include: { user: true },
  })
  const now = new Date()
  if (
    !record
    || record.usedAt
    || record.expiresAt <= now
    || !timingSafeEqualText(record.state, state)
    || record.user.status !== "active"
  ) {
    await this.recordUserAudit({
      adminEmail: record?.user.email ?? "unknown",
      action: "user.desktop_login.exchange.failure",
      targetId: record?.userId ?? "unknown",
      ipAddress: input.ipAddress,
    })
    throw new UnauthorizedException("登录凭证无效或已过期。")
  }

  const updated = await this.prisma.desktopLoginCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  })
  if (updated.count !== 1) {
    throw new UnauthorizedException("登录凭证无效或已过期。")
  }

  const tokens = await this.issueTokenPair(record.user)
  await this.recordUserAudit({
    adminEmail: record.user.email,
    action: "user.desktop_login.exchange.success",
    targetId: record.user.id,
    ipAddress: input.ipAddress,
  })
  return tokens
}
```

- [ ] **Step 4: Write controller tests**

Add tests in `server/src/auth/user-auth.controller.spec.ts`:

```ts
it("passes valid desktop issue-code requests with user and request metadata to the service", () => {
  const auth = {
    issueDesktopLoginCode: vi.fn().mockResolvedValue({
      code: "code",
      deepLinkUrl: "synapse://auth/callback?code=code&state=state-1234567890",
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    }),
  }
  const controller = new UserAuthController(auth as unknown as UserAuthService)

  controller.issueDesktopCode(
    { state: "state-1234567890" },
    {
      ip: "203.0.113.30",
      user: { id: "user-1" },
      headers: { "user-agent": "vitest" },
    } as never,
  )

  expect(auth.issueDesktopLoginCode).toHaveBeenCalledWith({
    userId: "user-1",
    state: "state-1234567890",
    ipAddress: "203.0.113.30",
    userAgent: "vitest",
  })
})

it("passes valid desktop exchange requests with request ip to the service", () => {
  const auth = {
    exchangeDesktopLoginCode: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
  }
  const controller = new UserAuthController(auth as unknown as UserAuthService)

  controller.exchangeDesktopCode(
    { code: "code-1", state: "state-1234567890" },
    { ip: "203.0.113.31" } as never,
  )

  expect(auth.exchangeDesktopLoginCode).toHaveBeenCalledWith({
    code: "code-1",
    state: "state-1234567890",
    ipAddress: "203.0.113.31",
  })
})

it("rejects invalid desktop issue-code states", () => {
  const auth = { issueDesktopLoginCode: vi.fn() }
  const controller = new UserAuthController(auth as unknown as UserAuthService)

  expect(() => controller.issueDesktopCode(
    { state: "short" },
    { ip: "203.0.113.30", user: { id: "user-1" }, headers: {} } as never,
  )).toThrow(BadRequestException)
  expect(auth.issueDesktopLoginCode).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: Implement controller endpoints**

In `server/src/auth/user-auth.controller.ts`, add schemas:

```ts
const desktopIssueCodeSchema = z.object({
  state: z.string().trim().min(16),
}).strict()

const desktopExchangeSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(16),
}).strict()
```

Add endpoints:

```ts
@UseGuards(UserAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 10 } })
@Post("/desktop/issue-code")
issueDesktopCode(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const input = parseBody(desktopIssueCodeSchema, body, "登录请求无效。")
  return this.auth.issueDesktopLoginCode({
    userId: request.user!.id,
    state: input.state,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  })
}

@Throttle({ default: { ttl: 60000, limit: 10 } })
@Post("/desktop/exchange")
exchangeDesktopCode(@Body() body: unknown, @Req() request: Request) {
  const input = parseBody(desktopExchangeSchema, body, "登录请求无效。")
  return this.auth.exchangeDesktopLoginCode({
    code: input.code,
    state: input.state,
    ipAddress: request.ip,
  })
}
```

- [ ] **Step 6: Run server tests**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/auth/user-auth.service.spec.ts server/src/auth/user-auth.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/auth/user-auth.service.ts server/src/auth/user-auth.controller.ts server/src/auth/user-auth.service.spec.ts server/src/auth/user-auth.controller.spec.ts
git commit -m "feat(server): add desktop auth exchange"
```

## Task 3: Dashboard Desktop Handoff

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/pages/login-page.tsx`
- Create: `dashboard/src/pages/desktop-login-handoff-page.tsx`
- Modify: `dashboard/src/app.tsx`

- [ ] **Step 1: Add dashboard API type and method**

In `dashboard/src/lib/api.ts`, add:

```ts
export type DesktopLoginCodeIssueResult = {
  code: string;
  deepLinkUrl: string;
  expiresAt: string;
};
```

Add to `dashboardApi`:

```ts
issueDesktopLoginCode: (input: { state: string }) =>
  request<DesktopLoginCodeIssueResult>('/api/auth/desktop/issue-code', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
```

- [ ] **Step 2: Create the handoff page**

Create `dashboard/src/pages/desktop-login-handoff-page.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';

import { BrandIcon } from '@/components/brand-icon';
import { ErrorState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { dashboardApi } from '@/lib/api';

function readDesktopState(value: string | null) {
  const state = value?.trim() ?? '';
  return state.length >= 16 ? state : null;
}

export function DesktopLoginHandoffPage() {
  const { isAuthenticated, isLoading, session } = useAuth();
  const [searchParams] = useSearchParams();
  const state = useMemo(() => readDesktopState(searchParams.get('state')), [searchParams]);
  const [deepLinkUrl, setDeepLinkUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated || !state || deepLinkUrl) return;
    let cancelled = false;
    dashboardApi.issueDesktopLoginCode({ state })
      .then((result) => {
        if (cancelled) return;
        setDeepLinkUrl(result.deepLinkUrl);
        window.location.href = result.deepLinkUrl;
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '打开失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkUrl, isAuthenticated, state]);

  if (!state) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted p-6">
        <ErrorState message="登录请求无效" />
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中
      </main>
    );
  }

  if (!isAuthenticated || !session) {
    return <Navigate to={`/login?client=desktop&state=${encodeURIComponent(state)}`} replace />;
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BrandIcon className="size-6 rounded-md" />
            <CardTitle>打开 Synapse</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            disabled={!deepLinkUrl}
            onClick={() => {
              if (deepLinkUrl) window.location.href = deepLinkUrl;
            }}
          >
            打开 Synapse
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Preserve desktop query through login**

In `dashboard/src/pages/login-page.tsx`, read query params:

```ts
const searchParams = new URLSearchParams(location.search);
const desktopState = searchParams.get('client') === 'desktop'
  ? searchParams.get('state')
  : null;
const desktopReturnPath = desktopState && desktopState.trim().length >= 16
  ? `/desktop-login?state=${encodeURIComponent(desktopState.trim())}`
  : null;
```

Use `desktopReturnPath` before the normal return path:

```tsx
if (isAuthenticated) {
  return (
    <Navigate
      to={desktopReturnPath ?? from ?? (session?.role === 'user' ? '/me' : '/system')}
      replace
    />
  );
}
```

After `login`, navigate to the desktop return path when present:

```ts
navigate(
  desktopReturnPath ??
    getSafeReturnPath(location, nextSession.role) ??
    (nextSession.role === 'admin' ? '/system' : '/me'),
  { replace: true },
);
```

- [ ] **Step 4: Register the route**

In `dashboard/src/app.tsx`, import:

```ts
import { DesktopLoginHandoffPage } from '@/pages/desktop-login-handoff-page';
```

Add public route:

```tsx
<Route path="/desktop-login" element={<DesktopLoginHandoffPage />} />
```

- [ ] **Step 5: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/pages/login-page.tsx dashboard/src/pages/desktop-login-handoff-page.tsx dashboard/src/app.tsx
git commit -m "feat(dashboard): add desktop login handoff"
```

## Task 4: Desktop Account Types, Service, IPC, And Protocol

**Files:**
- Create: `desktop/src/types/account.ts`
- Modify: `desktop/src/types/bridge.ts`
- Create: `desktop/electron/services/account-service.ts`
- Create: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/runtime/event-bus/types.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/bootstrap/app-events.ts`
- Modify: `desktop/electron/bootstrap/index.ts`
- Modify: `desktop/electron/main.ts`
- Test: `desktop/electron/services/__tests__/account-service.test.ts`
- Test: `desktop/electron/modules/account/__tests__/ipc.test.ts`

- [ ] **Step 1: Define shared account types**

Create `desktop/src/types/account.ts`:

```ts
export type SynapseAccountUser = {
  id: string
  email: string
  status: "active" | "disabled"
}

export type SynapseAccountTeam = {
  id: string
  name: string
  membershipId: string
  membershipRole: "owner" | "member"
}

export type SynapseAccountProfile = {
  user: SynapseAccountUser
  teams: SynapseAccountTeam[]
  syncedAt: string
}

export type SynapseAccountState =
  | { status: "unauthenticated" }
  | { status: "authenticating"; loginUrl?: string }
  | { status: "authenticated"; profile: SynapseAccountProfile }
  | { status: "error"; message: string; profile?: SynapseAccountProfile }

export type SynapseAccountStateChangedEvent = {
  state: SynapseAccountState
}
```

In `desktop/electron/runtime/event-bus/types.ts`, add `"account"` to `EventDomain`.

- [ ] **Step 2: Write account service tests**

Create `desktop/electron/services/__tests__/account-service.test.ts` with:

```ts
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  EncryptedJsonNamespace,
  type SafeStorage,
} from "../../runtime/data-repo/backends/encrypted-json"
import type { SynapseAccountProfile } from "../../../src/types/account"
import { AccountService } from "../account-service"

type PersistedAccountForTest = Record<string, unknown> & {
  refreshToken?: string
  accessTokenExpiresAt?: string
  lastProfile?: SynapseAccountProfile
  activeAttempt?: {
    state: string
    apiBaseUrl: string
    createdAt: string
    expiresAt: string
  }
}

function makeFakeSafeStorage(): SafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher) => cipher.toString("utf8"),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function createTestAccountService(input: {
  fetch?: typeof fetch
  isPackaged?: boolean
} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-account-test-"))
  const namespace = new EncryptedJsonNamespace<PersistedAccountForTest>({
    name: "core.account",
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath: path.join(dir, "core.account.bin"),
    safeStorage: makeFakeSafeStorage(),
  })
  const openExternal = vi.fn().mockResolvedValue(undefined)
  const service = new AccountService({
    namespace,
    fetch: input.fetch ?? vi.fn(),
    openExternal,
    isPackaged: input.isPackaged ?? false,
  })
  return { namespace, openExternal, service }
}

it("starts login by persisting an attempt and opening the browser", async () => {
  const { namespace, openExternal, service } = await createTestAccountService()
  const result = await service.startLogin()

  expect(result.state.status).toBe("authenticating")
  expect(result.loginUrl).toContain("client=desktop")
  expect(result.loginUrl).toContain("state=")
  expect(openExternal).toHaveBeenCalledWith(result.loginUrl)
  expect(await namespace.getSingleton()).toMatchObject({
    activeAttempt: { state: expect.any(String), apiBaseUrl: expect.any(String) },
  })
})

it("exchanges protocol callback, stores refresh token, and loads me", async () => {
  const { namespace, service } = await createTestAccountService({
    fetch: async (url, init) => {
      if (String(url).endsWith("/auth/desktop/exchange")) {
        return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
      }
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    },
  })
  await service.startLogin()
  const attempt = (await namespace.getSingleton())?.activeAttempt
  expect(attempt).toBeTruthy()

  const state = await service.handleAuthCallback(`synapse://auth/callback?code=code-1&state=${attempt!.state}`)

  if (state.status !== "authenticated") {
    throw new Error("expected authenticated account state")
  }
  expect(state.profile.user.email).toBe("u@example.com")
  expect((await namespace.getSingleton())?.refreshToken).toBe("refresh-1")
})

it("rejects state mismatch without exchanging", async () => {
  const fetch = vi.fn()
  const { service } = await createTestAccountService({ fetch })
  await service.startLogin()

  const state = await service.handleAuthCallback("synapse://auth/callback?code=code-1&state=wrong")

  expect(state.status).toBe("error")
  expect(fetch).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Implement `AccountService`**

Create `desktop/electron/services/account-service.ts` with:

```ts
import { randomBytes } from "node:crypto"
import { app, safeStorage, shell } from "electron"
import path from "node:path"
import type { EventBus } from "../runtime/event-bus"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"
import { createMainLogger } from "./log-store"
import type { SynapseAccountProfile, SynapseAccountState } from "../../src/types/account"

const logger = createMainLogger("service.account")
const CORE_ACCOUNT_NAMESPACE = "core.account"
const ATTEMPT_TTL_MS = 10 * 60 * 1000
const PROD_API_BASE_URL = "https://synapse.d2.pub/api"
const DEV_API_BASE_URL = "http://localhost:3000/api"

type PersistedAccount = Record<string, unknown> & {
  refreshToken?: string
  accessTokenExpiresAt?: string
  lastProfile?: SynapseAccountProfile
  activeAttempt?: {
    state: string
    apiBaseUrl: string
    createdAt: string
    expiresAt: string
  }
}

function createState(): string {
  return randomBytes(32).toString("base64url")
}

function apiBaseUrl(isPackaged: boolean): string {
  return isPackaged ? PROD_API_BASE_URL : DEV_API_BASE_URL
}

function dashboardLoginUrl(baseUrl: string, state: string): string {
  const origin = baseUrl.replace(/\/api\/?$/u, "")
  const query = new URLSearchParams({ client: "desktop", state })
  return `${origin}/dashboard/login?${query.toString()}`
}

function createNamespace() {
  return new EncryptedJsonNamespace<PersistedAccount>({
    name: CORE_ACCOUNT_NAMESPACE,
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath: path.join(app.getPath("userData"), "data-v1", `${CORE_ACCOUNT_NAMESPACE}.bin`),
    safeStorage,
  })
}

type AccountServiceDeps = {
  namespace?: EncryptedJsonNamespace<PersistedAccount>
  fetch?: typeof fetch
  openExternal?: (url: string) => Promise<void>
  isPackaged?: boolean
}

class AccountService {
  private readonly namespace: EncryptedJsonNamespace<PersistedAccount>
  private readonly fetchImpl: typeof fetch
  private readonly openExternal: (url: string) => Promise<void>
  private readonly isPackaged: boolean
  private accessToken: string | null = null
  private eventBus: EventBus | null = null
  private state: SynapseAccountState = { status: "unauthenticated" }
  private listeners = new Set<(state: SynapseAccountState) => void>()

  constructor(deps: AccountServiceDeps = {}) {
    this.namespace = deps.namespace ?? createNamespace()
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis)
    this.openExternal = deps.openExternal ?? shell.openExternal
    this.isPackaged = deps.isPackaged ?? app.isPackaged
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  onStateChanged(listener: (state: SynapseAccountState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): SynapseAccountState {
    return this.state
  }

  async startLogin(): Promise<{ state: SynapseAccountState; loginUrl: string }> {
    const baseUrl = apiBaseUrl(this.isPackaged)
    const state = createState()
    const now = new Date()
    const attempt = {
      state,
      apiBaseUrl: baseUrl,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS).toISOString(),
    }
    const loginUrl = dashboardLoginUrl(baseUrl, state)
    try {
      const current = await this.namespace.getSingleton()
      await this.namespace.setSingleton({ ...(current ?? {}), activeAttempt: attempt })
      this.setState({ status: "authenticating", loginUrl })
      await this.openExternal(loginUrl)
    } catch (error) {
      logger.warn("Failed to start desktop account login.", { error })
      this.setState({ status: "error", message: "无法保存登录状态。" })
    }
    return { state: this.state, loginUrl }
  }

  async handleAuthCallback(rawUrl: string): Promise<SynapseAccountState> {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "synapse:" || parsed.hostname !== "auth" || parsed.pathname !== "/callback") {
      logger.warn("Ignored unknown protocol callback.", { protocol: parsed.protocol, host: parsed.hostname, pathname: parsed.pathname })
      return this.state
    }
    const code = parsed.searchParams.get("code")?.trim()
    const state = parsed.searchParams.get("state")?.trim()
    const persisted = await this.namespace.getSingleton()
    const attempt = persisted?.activeAttempt
    if (!code || !state || !attempt || attempt.state !== state || new Date(attempt.expiresAt).getTime() <= Date.now()) {
      const nextPersisted: PersistedAccount = { ...(persisted ?? {}) }
      delete nextPersisted.activeAttempt
      await this.namespace.setSingleton(nextPersisted)
      this.setState({ status: "error", message: "登录已失效，请重试。", profile: persisted?.lastProfile })
      return this.state
    }

    try {
      const tokens = await this.postJson<{ accessToken: string; refreshToken: string }>(
        `${attempt.apiBaseUrl}/auth/desktop/exchange`,
        { code, state },
      )
      this.accessToken = tokens.accessToken
      const profile = await this.loadMe(attempt.apiBaseUrl)
      await this.namespace.setSingleton({
        refreshToken: tokens.refreshToken,
        lastProfile: profile,
      })
      this.setState({ status: "authenticated", profile })
      return this.state
    } catch (error) {
      logger.warn("Desktop auth callback exchange failed.", { error })
      this.setState({ status: "error", message: error instanceof Error ? error.message : "登录失败。", profile: persisted?.lastProfile })
      return this.state
    }
  }

  async refreshFromStorage(): Promise<SynapseAccountState> {
    try {
      const persisted = await this.namespace.getSingleton()
      if (!persisted?.refreshToken) {
        this.setState({ status: "unauthenticated" })
        return this.state
      }
      const baseUrl = apiBaseUrl(this.isPackaged)
      const tokens = await this.postJson<{ accessToken: string; refreshToken: string }>(
        `${baseUrl}/auth/refresh`,
        { refreshToken: persisted.refreshToken },
      )
      this.accessToken = tokens.accessToken
      const profile = await this.loadMe(baseUrl)
      await this.namespace.setSingleton({ refreshToken: tokens.refreshToken, lastProfile: profile })
      this.setState({ status: "authenticated", profile })
    } catch (error) {
      logger.warn("Account refresh failed.", { error })
      await this.namespace.clearSingleton().catch((clearError) => {
        logger.warn("Failed to clear stored account after refresh failure.", { error: clearError })
      })
      this.accessToken = null
      this.setState({ status: "unauthenticated" })
    }
    return this.state
  }

  async logout(): Promise<SynapseAccountState> {
    const persisted = await this.namespace.getSingleton().catch((error) => {
      logger.warn("Failed to read stored account before logout.", { error })
      return null
    })
    if (persisted?.refreshToken) {
      await this.postJson(`${apiBaseUrl(this.isPackaged)}/auth/logout`, { refreshToken: persisted.refreshToken }).catch((error) => {
        logger.warn("Remote account logout revoke failed.", { error })
      })
    }
    await this.namespace.clearSingleton().catch((error) => {
      logger.warn("Failed to clear stored account on logout.", { error })
    })
    this.accessToken = null
    this.setState({ status: "unauthenticated" })
    return this.state
  }

  private async loadMe(baseUrl: string): Promise<SynapseAccountProfile> {
    const response = await this.fetchImpl(`${baseUrl}/auth/me`, {
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined,
    })
    if (!response.ok) throw new Error("账号信息同步失败。")
    const payload = await response.json() as Omit<SynapseAccountProfile, "syncedAt">
    return { ...payload, syncedAt: new Date().toISOString() }
  }

  private async postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error("请求失败。")
    return await response.json() as T
  }

  private setState(nextState: SynapseAccountState): void {
    this.state = nextState
    for (const listener of this.listeners) listener(nextState)
    this.eventBus?.emit({
      domain: "account",
      type: "account.stateChanged",
      payload: { state: nextState },
      timestamp: new Date().toISOString(),
    })
  }
}

const accountService = new AccountService()

export { accountService, AccountService }
```

Add constructor parameters to `AccountService` for `namespace`, `fetch`, `openExternal`, and `isPackaged` so the tests above can inject fakes. The production singleton uses the real namespace, `globalThis.fetch`, `shell.openExternal`, and `app.isPackaged`.

- [ ] **Step 4: Add IPC module**

Create `desktop/electron/modules/account/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { accountService } from "../../services/account-service"

const accountUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  status: z.enum(["active", "disabled"]),
})

const accountTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  membershipId: z.string(),
  membershipRole: z.enum(["owner", "member"]),
})

const accountProfileSchema = z.object({
  user: accountUserSchema,
  teams: z.array(accountTeamSchema),
  syncedAt: z.string(),
})

const accountStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("authenticating"), loginUrl: z.string().optional() }),
  z.object({ status: z.literal("authenticated"), profile: accountProfileSchema }),
  z.object({ status: z.literal("error"), message: z.string(), profile: accountProfileSchema.optional() }),
])

const accountStateChangedDomainEventSchema = z.object({
  domain: z.literal("account"),
  type: z.literal("account.stateChanged"),
  payload: z.object({ state: accountStateSchema }),
  timestamp: z.string(),
})

export const accountIpcModule: IpcModule = {
  id: "account",
  methods: {
    getState: {
      kind: "invoke",
      channel: "synapse:account:get-state",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.getState(),
    },
    startLogin: {
      kind: "invoke",
      channel: "synapse:account:start-login",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => (await accountService.startLogin()).state,
    },
    refresh: {
      kind: "invoke",
      channel: "synapse:account:refresh",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.refreshFromStorage(),
    },
    logout: {
      kind: "invoke",
      channel: "synapse:account:logout",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.logout(),
    },
  },
  events: {
    stateChanged: {
      kind: "event",
      channel: "synapse:events:account",
      payload: accountStateChangedDomainEventSchema,
    },
  },
}
```

- [ ] **Step 5: Add IPC descriptor tests**

Create `desktop/electron/modules/account/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { accountIpcModule } from "../ipc"

describe("accountIpcModule", () => {
  it("declares account invoke channels", () => {
    expect(accountIpcModule.id).toBe("account")
    expect(accountIpcModule.methods.getState.channel).toBe("synapse:account:get-state")
    expect(accountIpcModule.methods.startLogin.channel).toBe("synapse:account:start-login")
    expect(accountIpcModule.methods.refresh.channel).toBe("synapse:account:refresh")
    expect(accountIpcModule.methods.logout.channel).toBe("synapse:account:logout")
  })

  it("validates state changed domain events", () => {
    const parsed = accountIpcModule.events.stateChanged.payload.parse({
      domain: "account",
      type: "account.stateChanged",
      payload: {
        state: {
          status: "authenticated",
          profile: {
            user: { id: "u1", email: "u@example.com", status: "active" },
            teams: [],
            syncedAt: "2026-05-28T00:00:00.000Z",
          },
        },
      },
      timestamp: "2026-05-28T00:00:00.000Z",
    })

    expect(parsed.payload.state.status).toBe("authenticated")
  })
})
```

- [ ] **Step 6: Wire IPC and preload**

In `desktop/electron/bootstrap/ipc-registry.ts`, import and register `accountIpcModule`.

In `desktop/electron/preload.ts`, add channels:

```ts
"account": {
  "getState": "synapse:account:get-state",
  "startLogin": "synapse:account:start-login",
  "refresh": "synapse:account:refresh",
  "logout": "synapse:account:logout",
  "event": "synapse:events:account",
},
```

Add the preload type import:

```ts
import type { SynapseAccountStateChangedEvent } from "../src/types/account"
```

Add bridge:

```ts
account: {
  getState: invoke(IPC_CHANNELS.account.getState),
  startLogin: invoke(IPC_CHANNELS.account.startLogin),
  refresh: invoke(IPC_CHANNELS.account.refresh),
  logout: invoke(IPC_CHANNELS.account.logout),
  onStateChanged: createDomainEventPayloadSubscription<SynapseAccountStateChangedEvent>(
    subscribe,
    "account",
    "account.stateChanged",
  ),
},
```

In `desktop/src/types/bridge.ts`, import account types and add:

```ts
account: {
  getState: () => Promise<SynapseAccountState>
  startLogin: () => Promise<SynapseAccountState>
  refresh: () => Promise<SynapseAccountState>
  logout: () => Promise<SynapseAccountState>
  onStateChanged: (listener: (event: SynapseAccountStateChangedEvent) => void) => () => void
}
```

- [ ] **Step 7: Add protocol handling**

In `desktop/electron/bootstrap/app-events.ts`, add:

```ts
export function registerAuthProtocol(): void {
  if (process.defaultApp) {
    const args = process.argv[1] ? [process.argv[1]] : []
    app.setAsDefaultProtocolClient("synapse", process.execPath, args)
    return
  }
  app.setAsDefaultProtocolClient("synapse")
}

export function attachOpenUrlHandler(handleUrl: (url: string) => void): void {
  app.on("open-url", (event, url) => {
    event.preventDefault()
    handleUrl(url)
  })
}

export function attachSecondInstanceProtocolHandler(handleUrl: (url: string) => void): void {
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((item) => item.startsWith("synapse://"))
    if (url) handleUrl(url)
  })
}
```

Keep the existing `attachSecondInstanceFocus`; do not remove its focus behavior.

In `desktop/electron/bootstrap/index.ts`, export the new helpers from `./app-events`:

```ts
export {
  attachOpenUrlHandler,
  attachSecondInstanceProtocolHandler,
  registerAuthProtocol,
} from "./app-events"
```

In `desktop/electron/main.ts`, call `registerAuthProtocol()` before `requestSingleInstanceLock()`. After creating the service registry, define:

```ts
const pendingProtocolUrls: string[] = process.argv.filter((item) => item.startsWith("synapse://"))
let canHandleProtocolUrls = false

function handleProtocolUrl(url: string): void {
  pendingProtocolUrls.push(url)
  if (canHandleProtocolUrls) {
    drainProtocolUrls()
  }
}

function drainProtocolUrls(): void {
  for (const url of pendingProtocolUrls.splice(0)) {
    void accountService.handleAuthCallback(url).finally(() => focusOrCreateMainWindow())
  }
}
```

Import `accountService` and attach URL handlers before `whenReady()`:

```ts
attachOpenUrlHandler(handleProtocolUrl)
attachSecondInstanceProtocolHandler(handleProtocolUrl)
```

After `registry.startAll()`, drain any queued URL:

```ts
accountService.setEventBus(registry.get<EventBus>("core.event-bus"))
canHandleProtocolUrls = true
drainProtocolUrls()
void accountService.refreshFromStorage()
```

- [ ] **Step 8: Run desktop tests and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/types/account.ts desktop/src/types/bridge.ts desktop/electron/runtime/event-bus/types.ts desktop/electron/services/account-service.ts desktop/electron/modules/account/ipc.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/electron/bootstrap/app-events.ts desktop/electron/bootstrap/index.ts desktop/electron/main.ts desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/__tests__/ipc.test.ts
git commit -m "feat(desktop): add account auth bridge"
```

## Task 5: Desktop Account Renderer UI

**Files:**
- Create: `desktop/src/app-shell/account.ts`
- Create: `desktop/src/app-shell/account-context.tsx`
- Create: `desktop/src/app-shell/components/account-actions.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Create: `desktop/src/modules/settings/components/account-panel.tsx`
- Create: `desktop/src/modules/settings/components/__tests__/account-panel.test.tsx`
- Create: `desktop/src/app-shell/__tests__/account-actions.test.tsx`

- [ ] **Step 1: Add renderer account bridge helpers**

Create `desktop/src/app-shell/account.ts`:

```ts
import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAccountState } from "@/types/account"

const DEFAULT_ACCOUNT_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的账号桥接。请确认你打开的是桌面应用窗口。"

type AccountBridge = NonNullable<Window["synapse"]>["account"]

function getAccountBridge(): AccountBridge | undefined {
  return getSynapseBridge()?.account
}

function requireAccountBridge(): AccountBridge {
  const bridge = getAccountBridge()
  if (!bridge) throw createMissingBridgeError(DEFAULT_ACCOUNT_BRIDGE_ERROR_MESSAGE)
  return bridge
}

function readAccountState(): Promise<SynapseAccountState> {
  return requireAccountBridge().getState()
}

function startAccountLogin(): Promise<SynapseAccountState> {
  return requireAccountBridge().startLogin()
}

function refreshAccount(): Promise<SynapseAccountState> {
  return requireAccountBridge().refresh()
}

function logoutAccount(): Promise<SynapseAccountState> {
  return requireAccountBridge().logout()
}

function subscribeAccountState(listener: (state: SynapseAccountState) => void): () => void {
  return requireAccountBridge().onStateChanged((event) => listener(event.state))
}

export {
  logoutAccount,
  readAccountState,
  refreshAccount,
  startAccountLogin,
  subscribeAccountState,
}
```

- [ ] **Step 2: Add AccountProvider**

Create `desktop/src/app-shell/account-context.tsx`:

```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import {
  logoutAccount,
  readAccountState,
  refreshAccount,
  startAccountLogin,
  subscribeAccountState,
} from "@/app-shell/account"
import type { SynapseAccountState } from "@/types/account"

type AccountContextValue = {
  accountState: SynapseAccountState
  isReady: boolean
  login: () => Promise<SynapseAccountState>
  logout: () => Promise<SynapseAccountState>
  refresh: () => Promise<SynapseAccountState>
}

const AccountContext = createContext<AccountContextValue | null>(null)
const logger = createRendererLogger("app.account")

function AccountProvider({ children }: { children: ReactNode }) {
  const [accountState, setAccountState] = useState<SynapseAccountState>({ status: "unauthenticated" })
  const [isReady, setIsReady] = useState(false)

  const refresh = useCallback(async () => {
    const nextState = await refreshAccount()
    setAccountState(nextState)
    return nextState
  }, [])

  const login = useCallback(async () => {
    const nextState = await startAccountLogin()
    setAccountState(nextState)
    return nextState
  }, [])

  const logout = useCallback(async () => {
    const nextState = await logoutAccount()
    setAccountState(nextState)
    return nextState
  }, [])

  useEffect(() => {
    let cancelled = false
    void readAccountState()
      .then((nextState) => {
        if (!cancelled) setAccountState(nextState)
      })
      .catch((error) => {
        logger.warn("Failed to read account state.", error)
      })
      .finally(() => {
        if (!cancelled) setIsReady(true)
      })
    const unsubscribe = subscribeAccountState((nextState) => {
      setAccountState(nextState)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const value = useMemo<AccountContextValue>(() => ({
    accountState,
    isReady,
    login,
    logout,
    refresh,
  }), [accountState, isReady, login, logout, refresh])

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

function useAccount(): AccountContextValue {
  const context = useContext(AccountContext)
  if (!context) throw new Error("useAccount must be used within AccountProvider.")
  return context
}

export { AccountProvider, useAccount }
```

- [ ] **Step 3: Add top bar account actions**

Create `desktop/src/app-shell/components/account-actions.tsx`:

```tsx
import { LoaderCircle, LogOut, RefreshCw, UserCircle } from "lucide-react"
import { useAccount } from "@/app-shell/account-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function AccountActions() {
  const { accountState, isReady, login, logout, refresh } = useAccount()

  if (!isReady || accountState.status === "authenticating") {
    return (
      <Button variant="ghost" size="sm" disabled>
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
        登录中
      </Button>
    )
  }

  if (accountState.status !== "authenticated") {
    return (
      <Button variant="ghost" size="sm" onClick={() => void login()}>
        <UserCircle data-icon="inline-start" />
        登录
      </Button>
    )
  }

  const email = accountState.profile.user.email

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <UserCircle data-icon="inline-start" />
          <span className="max-w-48 truncate">{email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void refresh()}>
          <RefreshCw />
          重新同步
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void logout()}>
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AccountActions }
```

- [ ] **Step 4: Install provider and global top bar**

In `desktop/src/main.tsx`, wrap `App` with `AccountProvider` inside `IdentityProvider`:

```tsx
<IdentityProvider>
  <AccountProvider>
    <AppNotificationsProvider>
      <ActiveRepositorySwitchProvider>
        <App />
      </ActiveRepositorySwitchProvider>
    </AppNotificationsProvider>
  </AccountProvider>
</IdentityProvider>
```

In `desktop/src/App.tsx`, import `AccountActions` and replace the `AppShellActions` global `actions` block with:

```tsx
actions={<AccountActions />}
```

Remove the now-unused global toolbar wiring in the same edit: `AppShellActions`, `useAppShellToolbarState`, `useAppNotifications`, `useRepositoryActions`, `toolbarState`, and `handleManualRepositorySync`.

- [ ] **Step 5: Add account settings category**

In `desktop/src/modules/settings/types.ts`, prepend `"account"` to `SettingsCategoryId`.

In `desktop/src/modules/settings/data.ts`, import `UserCircle` and put first:

```ts
{
  id: "account",
  icon: UserCircle,
  label: "账号",
  description: "登录状态。",
},
```

Create `desktop/src/modules/settings/components/account-panel.tsx`:

```tsx
import { LoaderCircle } from "lucide-react"
import { useAccount } from "@/app-shell/account-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function AccountPanel() {
  const { accountState, isReady, login, logout, refresh } = useAccount()

  if (!isReady) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>账号</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          加载中
        </CardContent>
      </Card>
    )
  }

  if (accountState.status !== "authenticated") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>账号</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button onClick={() => void login()}>登录</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>账号</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1 text-sm">
          <span className="text-muted-foreground">邮箱</span>
          <span>{accountState.profile.user.email}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => void refresh()}>
            重新同步
          </Button>
          <Button variant="outline" onClick={() => void logout()}>
            退出登录
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export { AccountPanel }
```

In `desktop/src/modules/settings/index.tsx`, import `AccountPanel` and render before regular setting items:

```tsx
{isReady && activeCategory === "account" ? <AccountPanel /> : null}
```

Change the default category state from `"general"` to `"account"`:

```tsx
const [activeCategory, setActiveCategoryRaw] = useState<SettingsCategoryId>("account")
```

- [ ] **Step 6: Add renderer tests**

Add `desktop/src/modules/settings/components/__tests__/account-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccountPanel } from "../account-panel"

vi.mock("@/app-shell/account-context", () => ({
  useAccount: () => ({
    isReady: true,
    accountState: {
      status: "authenticated",
      profile: {
        user: { id: "u1", email: "u@example.com", status: "active" },
        teams: [],
        syncedAt: "2026-05-28T00:00:00.000Z",
      },
    },
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}))

describe("AccountPanel", () => {
  it("renders account email without token data", () => {
    render(<AccountPanel />)
    expect(screen.getByText("u@example.com")).toBeInTheDocument()
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument()
  })
})
```

Add `desktop/src/app-shell/__tests__/account-actions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccountActions } from "@/app-shell/components/account-actions"

vi.mock("@/app-shell/account-context", () => ({
  useAccount: () => ({
    isReady: true,
    accountState: { status: "unauthenticated" },
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}))

describe("AccountActions", () => {
  it("shows optional login entry", () => {
    render(<AccountActions />)
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument()
  })
})
```

Add/modify `desktop/src/modules/settings/__tests__/settings-categories.test.ts`:

```ts
expect(settingsCategories[0]?.id).toBe("account")
```

- [ ] **Step 7: Run renderer tests and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/settings/components/__tests__/account-panel.test.tsx desktop/src/modules/settings/__tests__/settings-categories.test.ts
pnpm --filter @synapse/desktop test -- desktop/src/app-shell/__tests__/account-actions.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/app-shell/account.ts desktop/src/app-shell/account-context.tsx desktop/src/app-shell/components/account-actions.tsx desktop/src/app-shell/__tests__/account-actions.test.tsx desktop/src/main.tsx desktop/src/App.tsx desktop/src/modules/settings/types.ts desktop/src/modules/settings/data.ts desktop/src/modules/settings/index.tsx desktop/src/modules/settings/components/account-panel.tsx desktop/src/modules/settings/components/__tests__/account-panel.test.tsx desktop/src/modules/settings/__tests__/settings-categories.test.ts
git commit -m "feat(desktop): show account state in shell"
```

## Task 6: Move Repository Controls Into Content Pages

**Files:**
- Create: `desktop/src/modules/content/components/content-repository-actions.tsx`
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`
- Modify: `desktop/src/App.tsx`
- Test: `desktop/src/modules/content/__tests__/content-repository-actions.test.tsx`

- [ ] **Step 1: Create reusable content repository actions**

Create `desktop/src/modules/content/components/content-repository-actions.tsx`:

```tsx
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { useAppNotifications } from "@/app-shell/notifications"
import { useAppShellToolbarState } from "@/app-shell/use-app-shell-toolbar-state"
import { useActiveRepository, useRepositoryActions } from "@/app-shell/use-repository-manager"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"

type ContentRepositoryActionsProps = {
  hasBlockingModalOpen?: boolean
  onOpenRepositorySettings?: () => void
}

function ContentRepositoryActions({
  hasBlockingModalOpen = false,
  onOpenRepositorySettings,
}: ContentRepositoryActionsProps) {
  const activeRepository = useActiveRepository()
  const { promise } = useAppNotifications()
  const { syncRepository } = useRepositoryActions()
  const { isSwitchingRepository, openRepositorySwitchDialog } = useActiveRepositorySwitch()
  const toolbarState = useAppShellToolbarState({ hasBlockingModalOpen })

  function handleSync(source: "refresh" | "sync-status") {
    if (!activeRepository) return
    void promise(
      () => syncRepository(activeRepository.uuid),
      {
        loading: "正在同步仓库...",
        success: (result) => result.message ?? "仓库同步完成。",
        error: (error) => error instanceof Error ? error.message : "同步仓库失败。",
      },
    )
  }

  return (
    <AppShellActions
      activeRepository={activeRepository}
      activityLabel={toolbarState.activityLabel}
      pendingPushCount={toolbarState.pendingPushCount}
      refreshBusy={toolbarState.refreshBusy}
      refreshDisabled={toolbarState.refreshDisabled}
      refreshTitle={toolbarState.refreshTitle}
      repositorySwitchDisabled={toolbarState.repositorySwitchDisabled}
      repositorySwitchTitle={toolbarState.repositorySwitchTitle}
      showRefresh={toolbarState.showRefresh}
      showRepositorySwitch={toolbarState.showRepositorySwitch}
      syncSnapshot={toolbarState.syncSnapshot}
      syncStatus={toolbarState.syncStatus}
      onOpenRepositorySettings={onOpenRepositorySettings}
      onRefresh={() => handleSync("refresh")}
      onRepositorySwitch={() => {
        if (!toolbarState.repositorySwitchDisabled && !isSwitchingRepository) {
          openRepositorySwitchDialog()
        }
      }}
      onSyncStatusRetry={() => handleSync("sync-status")}
    />
  )
}

export { ContentRepositoryActions }
```

- [ ] **Step 2: Render it in the content title row**

In `desktop/src/modules/content/components/content-browser-page.tsx`, import `ContentRepositoryActions`.

Find the title row containing the content type title and sort selector. Add the actions on the same row, right aligned:

```tsx
<div className="flex min-w-0 items-center justify-between gap-3">
  <h1 className="truncate text-xl font-semibold">{definition.pluralLabel}</h1>
  <div className="flex shrink-0 items-center gap-2">
    <ContentRepositoryActions />
    <Select
      value={sortOrder}
      onValueChange={(value) => setSortOrder(value as SynapseContentSortOrder)}
    >
      <SelectTrigger className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <span className="text-sm text-muted-foreground">{summaryLabel}</span>
  </div>
</div>
```

Use the existing JSX shape around `Select`; do not duplicate sort controls.

- [ ] **Step 3: Remove global repository toolbar logic**

In `desktop/src/App.tsx`:

- Remove `AppShellActions` import.
- Remove `useAppShellToolbarState` import.
- Remove `useAppNotifications` import if only used for manual sync.
- Remove `useRepositoryActions` import if only used for manual sync.
- Remove `toolbarState` and `handleManualRepositorySync`.
- Keep `actions={<AccountActions />}` from Task 5.

- [ ] **Step 4: Add tests**

Add `desktop/src/modules/content/__tests__/content-repository-actions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContentRepositoryActions } from "../components/content-repository-actions"

vi.mock("@/app-shell/components/app-shell-actions", () => ({
  AppShellActions: () => <div>repository-actions</div>,
}))
vi.mock("@/app-shell/notifications", () => ({ useAppNotifications: () => ({ promise: vi.fn() }) }))
vi.mock("@/app-shell/use-app-shell-toolbar-state", () => ({
  useAppShellToolbarState: () => ({
    activityLabel: null,
    pendingPushCount: 0,
    refreshBusy: false,
    refreshDisabled: false,
    refreshTitle: "同步仓库",
    repositorySwitchDisabled: false,
    repositorySwitchTitle: "切换仓库",
    showRefresh: true,
    showRepositorySwitch: true,
    syncSnapshot: undefined,
    syncStatus: "synced",
  }),
}))
vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => ({ uuid: "repo-1" }),
  useRepositoryActions: () => ({ syncRepository: vi.fn() }),
}))
vi.mock("@/app-shell/active-repository-switch", () => ({
  useActiveRepositorySwitch: () => ({ isSwitchingRepository: false, openRepositorySwitchDialog: vi.fn() }),
}))

describe("ContentRepositoryActions", () => {
  it("reuses app shell repository actions", () => {
    render(<ContentRepositoryActions />)
    expect(screen.getByText("repository-actions")).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/content/__tests__/content-repository-actions.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/content/components/content-repository-actions.tsx desktop/src/modules/content/components/content-browser-page.tsx desktop/src/App.tsx desktop/src/modules/content/__tests__/content-repository-actions.test.tsx
git commit -m "feat(desktop): move repository actions into content pages"
```

## Task 7: Release Notes And Full Validation

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add a user-facing entry:

```md
- Desktop 增加可选账号登录入口：点击顶栏账号区会打开浏览器登录，登录完成后自动回到客户端；仓库同步和切换入口移动到技能、规则、提示词页面内。
```

- [ ] **Step 2: Run focused package validation**

Run:

```bash
pnpm --filter @synapse/server test -- server/src/auth/user-auth.service.spec.ts server/src/auth/user-auth.controller.spec.ts
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/src/app-shell/__tests__/account-actions.test.tsx desktop/src/modules/settings/components/__tests__/account-panel.test.tsx desktop/src/modules/content/__tests__/content-repository-actions.test.tsx
```

Expected: all commands exit 0.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. Pay particular attention that new IPC code uses `IpcModule` and no new renderer code imports Electron directly.

- [ ] **Step 4: Final commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note desktop account login"
```

## Self-Review

- Spec coverage: server issue/exchange, dashboard handoff, desktop protocol, cold-start handling, token storage, `/me` separation, optional login, settings first account panel, and repository action relocation all have tasks.
- Token boundary: refresh token is main-process persisted through the existing encrypted JSON backend, access token is memory-only, and renderer bridge returns state only.
- UI rules: tasks use shadcn/Radix components and no custom colors or decorative gradients.
- Known sequencing: Task 5 temporarily replaces global repository actions with account actions; Task 6 moves repository actions into content pages and removes leftover toolbar logic.
