# User Display Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ordinary users can set a display name in the web personal center, and desktop shows that display name after account sync.

**Architecture:** Store the display name on the existing `User` row. Expose it through the existing dashboard and desktop account profile APIs. Keep the dashboard as the only edit surface; desktop remains read-only and only changes display priority.

**Tech Stack:** NestJS, Prisma, Vitest, React 19, TanStack Query, shadcn/ui, Electron IPC, TypeScript.

---

## File Structure

```text
server/prisma/schema.prisma
  Add nullable User.displayName.

server/prisma/migrations/20260601090000_user_display_name/migration.sql
  Add the database column.

server/src/auth/user-auth.service.ts
  Include displayName in getMe and add updateMyProfile.

server/src/auth/user-auth.service.spec.ts
  Cover getMe displayName, update validation, update persistence, audit.

server/src/dashboard/dashboard.controller.ts
  Add PATCH /api/dashboard/me.

server/src/dashboard/dashboard.controller.spec.ts
  Cover controller validation and service delegation.

dashboard/src/lib/api.ts
  Add displayName to DashboardMe and add updateMe.

dashboard/src/features/me/index.tsx
  Add ordinary-user display-name form to personal center.

desktop/src/types/account.ts
  Add displayName to SynapseAccountUser.

desktop/electron/modules/account/ipc.ts
  Accept displayName in account IPC schemas.

desktop/electron/modules/account/__tests__/ipc.test.ts
  Cover authenticated state with displayName.

desktop/src/app-shell/components/account-user-control.tsx
  Prefer displayName for the primary label and email for detail.

desktop/src/app-shell/components/__tests__/account-user-control.test.tsx
  Cover displayName and fallback rendering.

RELEASE_NOTES_PENDING.md
  Add user-facing release note.
```

## Task 1: Server Data Model And UserAuthService

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260601090000_user_display_name/migration.sql`
- Modify: `server/src/auth/user-auth.service.ts`
- Test: `server/src/auth/user-auth.service.spec.ts`

- [ ] **Step 1: Add failing service tests**

Edit `server/src/auth/user-auth.service.spec.ts`.

Change the existing test named `returns the current user and team membership shape without roles or permissions` so the mock user and expected response include `displayName`:

```ts
prisma.user.findUniqueOrThrow.mockResolvedValue({
  id: "user-1",
  email: "u@example.com",
  status: "active",
  displayName: "Ada",
  memberships: [
    {
      id: "membership-1",
      role: "owner",
      team: { id: "team-1", name: "Team One" },
    },
    {
      id: "membership-2",
      role: "member",
      team: { id: "team-2", name: "Team Two" },
    },
  ],
})

const expected: UserMeResponse = {
  user: {
    id: "user-1",
    email: "u@example.com",
    status: "active",
    displayName: "Ada",
  },
  teams: [
    {
      id: "team-1",
      name: "Team One",
      membershipId: "membership-1",
      membershipRole: "owner",
    },
    {
      id: "team-2",
      name: "Team Two",
      membershipId: "membership-2",
      membershipRole: "member",
    },
  ],
}
```

Also update the expected Prisma select inside that test:

```ts
expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
  where: { id: "user-1" },
  select: {
    id: true,
    email: true,
    status: true,
    displayName: true,
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
```

Add these tests near the `getMe` test:

```ts
it("updates the current user display name", async () => {
  const prisma = createPrismaMock()
  prisma.user.update.mockResolvedValue({
    id: "user-1",
    email: "u@example.com",
    status: "active",
    displayName: "Grace Hopper",
    memberships: [],
  })
  const auditLog = { record: vi.fn() }
  const service = createService(prisma, auditLog)

  await expect(service.updateMyProfile("user-1", {
    displayName: "  Grace Hopper  ",
  }, "203.0.113.80")).resolves.toEqual({
    user: {
      id: "user-1",
      email: "u@example.com",
      status: "active",
      displayName: "Grace Hopper",
    },
    teams: [],
  })

  expect(prisma.user.update).toHaveBeenCalledWith({
    where: { id: "user-1" },
    data: { displayName: "Grace Hopper" },
    select: {
      id: true,
      email: true,
      status: true,
      displayName: true,
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
  expect(auditLog.record).toHaveBeenCalledWith({
    adminEmail: "u@example.com",
    action: "user.profile.update",
    targetType: "user",
    targetId: "user-1",
    detail: { fields: ["displayName"] },
    ipAddress: "203.0.113.80",
  })
})

it("rejects empty current user display names", async () => {
  const prisma = createPrismaMock()
  const service = createService(prisma)

  await expect(service.updateMyProfile("user-1", {
    displayName: "   ",
  })).rejects.toThrow("displayName is required.")

  expect(prisma.user.update).not.toHaveBeenCalled()
})

it("rejects over length current user display names", async () => {
  const prisma = createPrismaMock()
  const service = createService(prisma)

  await expect(service.updateMyProfile("user-1", {
    displayName: "a".repeat(41),
  })).rejects.toThrow("displayName must be at most 40 characters.")

  expect(prisma.user.update).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/auth/user-auth.service.spec.ts
```

Expected: FAIL because `updateMyProfile` does not exist and `getMe` does not select `displayName`.

- [ ] **Step 3: Add Prisma field and migration**

Modify `server/prisma/schema.prisma` inside `model User`:

```prisma
model User {
  id                  String                 @id @default(cuid())
  email               String                 @unique
  displayName         String?                @db.VarChar(40)
  passwordHash        String
  passwordChangedAt   DateTime?
  status              UserStatus             @default(active)
  memberships         TeamMembership[]
  createdTeams        Team[]                 @relation("TeamCreator")
  sessions            UserSession[]
  desktopLoginCodes   DesktopLoginCode[]
  passwordResetTokens UserPasswordResetToken[]
  acceptedInvitations Invitation[]           @relation("AcceptedInvitations")
  createdInvitations  Invitation[]           @relation("UserCreatedInvitations")
  modulePermissions   UserModulePermission[]
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt
}
```

Create `server/prisma/migrations/20260601090000_user_display_name/migration.sql`:

```sql
ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(40);
```

- [ ] **Step 4: Implement UserAuthService changes**

In `server/src/auth/user-auth.service.ts`, change `UserMeResponse`:

```ts
export interface UserMeResponse {
  readonly user: Pick<User, "id" | "email" | "status" | "displayName">
  readonly teams: readonly UserMeTeam[]
}
```

Add helper functions near the other small helpers:

```ts
function normalizeDisplayName(value: string): string {
  const displayName = value.trim()
  if (!displayName) throw new BadRequestException("displayName is required.")
  if (displayName.length > 40) {
    throw new BadRequestException("displayName must be at most 40 characters.")
  }
  return displayName
}

function toUserMeResponse(user: {
  readonly id: string
  readonly email: string
  readonly status: User["status"]
  readonly displayName: string | null
  readonly memberships: readonly Array<{
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

Update `getMe` to select `displayName` and use the helper:

```ts
async getMe(userId: string): Promise<UserMeResponse> {
  const user = await this.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      displayName: true,
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

  return toUserMeResponse(user)
}
```

Add this public method below `getMe`:

```ts
async updateMyProfile(
  userId: string,
  input: { readonly displayName: string },
  ipAddress = "system",
): Promise<UserMeResponse> {
  const displayName = normalizeDisplayName(input.displayName)
  const user = await this.prisma.user.update({
    where: { id: userId },
    data: { displayName },
    select: {
      id: true,
      email: true,
      status: true,
      displayName: true,
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

  await this.auditLog?.record({
    adminEmail: user.email,
    action: "user.profile.update",
    targetType: "user",
    targetId: user.id,
    detail: { fields: ["displayName"] },
    ipAddress,
  })

  return toUserMeResponse(user)
}
```

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/auth/user-auth.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260601090000_user_display_name/migration.sql server/src/auth/user-auth.service.ts server/src/auth/user-auth.service.spec.ts
git commit -m "feat: add user display name service"
```

## Task 2: Dashboard Profile API

**Files:**
- Modify: `server/src/dashboard/dashboard.controller.ts`
- Test: `server/src/dashboard/dashboard.controller.spec.ts`

- [ ] **Step 1: Add failing controller tests**

Replace `server/src/dashboard/dashboard.controller.spec.ts` with:

```ts
import { describe, expect, it, vi } from "vitest"
import { DashboardController } from "./dashboard.controller"

describe("DashboardController", () => {
  it("returns the normal user dashboard profile", async () => {
    const auth = {
      getMe: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: "Ada",
        },
        teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.me({ user: { id: "user-1" } } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada",
      },
      teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
    })
    expect(auth.getMe).toHaveBeenCalledWith("user-1")
  })

  it("updates the normal user dashboard profile", async () => {
    const auth = {
      updateMyProfile: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: "Ada Lovelace",
        },
        teams: [],
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      displayName: "Ada Lovelace",
    }, {
      ip: "203.0.113.90",
      user: { id: "user-1" },
    } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada Lovelace",
      },
      teams: [],
    })
    expect(auth.updateMyProfile).toHaveBeenCalledWith(
      "user-1",
      { displayName: "Ada Lovelace" },
      "203.0.113.90",
    )
  })

  it("rejects invalid profile update bodies", async () => {
    const auth = { updateMyProfile: vi.fn() }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      displayName: "",
      extra: "no",
    }, {
      user: { id: "user-1" },
    } as never)).rejects.toThrow("Profile update request is invalid.")
    expect(auth.updateMyProfile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run controller test and confirm failure**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/dashboard/dashboard.controller.spec.ts
```

Expected: FAIL because `updateMe` does not exist.

- [ ] **Step 3: Implement PATCH /me**

Modify `server/src/dashboard/dashboard.controller.ts` to import `Body`, `Patch`, `badRequestFromZodError`, and `z`:

```ts
import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { badRequestFromZodError } from "../common/zod-validation"
```

Add schema above the controller:

```ts
const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
}).strict()
```

Add this method inside `DashboardController`:

```ts
@Patch("/me")
updateMe(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const result = updateMeSchema.safeParse(body)
  if (!result.success) {
    throw badRequestFromZodError(result.error, "Profile update request is invalid.")
  }
  return this.auth.updateMyProfile(request.user!.id, result.data, request.ip)
}
```

- [ ] **Step 4: Run controller and service tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/dashboard/dashboard.controller.spec.ts src/auth/user-auth.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/dashboard/dashboard.controller.ts server/src/dashboard/dashboard.controller.spec.ts
git commit -m "feat: add dashboard profile update api"
```

## Task 3: Dashboard Personal Center UI

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/features/me/index.tsx`

- [ ] **Step 1: Update API types and client**

Modify `dashboard/src/lib/api.ts`.

Change `DashboardMe.user`:

```ts
export type DashboardMe = {
  user: {
    id: string
    email: string
    status: 'active' | 'disabled'
    displayName: string | null
  }
  teams: Array<{
    id: string
    name: string
    membershipId: string
    membershipRole: 'owner' | 'member'
  }>
}
```

Add `updateMe` next to `getMe` in `dashboardApi`:

```ts
  getMe: () => request<DashboardMe>(`${dashboardApiBasePath}/me`),
  updateMe: (input: { displayName: string }) =>
    request<DashboardMe>(`${dashboardApiBasePath}/me`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
```

- [ ] **Step 2: Replace the personal center component**

Modify `dashboard/src/features/me/index.tsx` so it uses a controlled display-name form.

Use this structure:

```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const maxDisplayNameLength = 40

export default function MePage() {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-me'],
    queryFn: dashboardApi.getMe,
  })
  const updateProfile = useMutation({
    mutationFn: dashboardApi.updateMe,
    onSuccess: (nextData) => {
      queryClient.setQueryData(['dashboard-me'], nextData)
      toast.success('Saved')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    if (data) setDisplayName(data.user.displayName ?? '')
  }, [data])

  const trimmedDisplayName = displayName.trim()
  const isInvalid =
    trimmedDisplayName.length === 0 ||
    trimmedDisplayName.length > maxDisplayNameLength
  const hasChanged = trimmedDisplayName !== (data?.user.displayName ?? '')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isInvalid || !hasChanged) return
    updateProfile.mutate({ displayName: trimmedDisplayName })
  }

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>Personal Center</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>Loading</div>
        ) : data ? (
          <div className='grid max-w-lg gap-4'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Account</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>Email</span>
                  <span className='truncate'>{data.user.email}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>Status</span>
                  <Badge variant={data.user.status === 'active' ? 'default' : 'secondary'}>
                    {data.user.status === 'active' ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <form className='space-y-3' onSubmit={handleSubmit}>
                  <div className='space-y-2'>
                    <Label htmlFor='display-name'>Display name</Label>
                    <Input
                      id='display-name'
                      value={displayName}
                      maxLength={maxDisplayNameLength}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </div>
                  <Button
                    type='submit'
                    disabled={isInvalid || !hasChanged || updateProfile.isPending}
                  >
                    Save
                  </Button>
                </form>
              </CardContent>
            </Card>
            {data.teams.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Teams</CardTitle>
                </CardHeader>
                <CardContent className='space-y-2'>
                  {data.teams.map((team) => (
                    <div key={team.id} className='flex justify-between gap-4'>
                      <span className='truncate'>{team.name}</span>
                      <Badge variant='outline'>{team.membershipRole}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </Main>
    </>
  )
}
```

If implementing with Chinese UI copy, keep the same structure and only change string literals. Do not add explanatory helper paragraphs.

- [ ] **Step 3: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 4: Run dashboard build**

Run:

```bash
pnpm --filter @synapse/dashboard run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/features/me/index.tsx
git commit -m "feat: add dashboard display name editor"
```

## Task 4: Desktop Account Display

**Files:**
- Modify: `desktop/src/types/account.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Test: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/src/app-shell/components/account-user-control.tsx`
- Create: `desktop/src/app-shell/components/__tests__/account-user-control.test.tsx`

- [ ] **Step 1: Add failing IPC schema test**

Modify the authenticated payload in `desktop/electron/modules/account/__tests__/ipc.test.ts`:

```ts
user: {
  id: "u1",
  email: "u@example.com",
  status: "active",
  displayName: "Ada",
},
```

Add this assertion:

```ts
expect(parsed.payload.state).toMatchObject({
  status: "authenticated",
  profile: {
    user: {
      displayName: "Ada",
    },
  },
})
```

- [ ] **Step 2: Add failing component tests**

Create `desktop/src/app-shell/components/__tests__/account-user-control.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseAccountState } from "@/types/account"

const accountState = vi.hoisted(() => ({
  current: {
    status: "authenticated",
    profile: {
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada",
      },
      teams: [],
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  } satisfies SynapseAccountState,
}))

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: accountState.current,
    isLoading: false,
    pendingAction: null,
    startLogin: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ warning: vi.fn() }),
}))

import { AccountUserControl } from "../account-user-control"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function renderControl(variant: "toolbar" | "panel") {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<AccountUserControl variant={variant} />)
  })
  return container
}

describe("AccountUserControl", () => {
  it("shows display name as the panel title and email as detail", () => {
    const container = renderControl("panel")

    expect(container.textContent).toContain("Ada")
    expect(container.textContent).toContain("user@example.com")
  })

  it("falls back to email when display name is empty", () => {
    accountState.current = {
      status: "authenticated",
      profile: {
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: null,
        },
        teams: [],
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    }

    const container = renderControl("panel")

    expect(container.textContent).toContain("user@example.com")
  })
})
```

- [ ] **Step 3: Run desktop focused tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/account/__tests__/ipc.test.ts src/app-shell/components/__tests__/account-user-control.test.tsx
```

Expected: FAIL because `displayName` is not in the schema/type and UI still uses email as title.

- [ ] **Step 4: Update desktop account types and schema**

Modify `desktop/src/types/account.ts`:

```ts
export type SynapseAccountUser = {
  id: string
  email: string
  displayName: string | null
  status: "active" | "disabled"
}
```

Modify `desktop/electron/modules/account/ipc.ts`:

```ts
const accountUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
})
```

- [ ] **Step 5: Update account display helpers**

Modify `desktop/src/app-shell/components/account-user-control.tsx`.

Add helper:

```ts
function getDisplayName(state: SynapseAccountState): string | null {
  if (state.status !== "authenticated") return null
  const displayName = state.profile.user.displayName?.trim()
  return displayName ? displayName : null
}
```

Change `getAccountTitle`:

```ts
function getAccountTitle(state: SynapseAccountState): string {
  if (state.status === "authenticated") return getDisplayName(state) ?? state.profile.user.email
  if (state.status === "authenticating") return "Logging in"
  return "Not signed in"
}
```

Change `getAccountDetail`:

```ts
function getAccountDetail(state: SynapseAccountState): string {
  if (state.status === "authenticated") return state.profile.user.email
  if (state.status === "authenticating") return "Waiting for browser login"
  if (state.status === "error") return state.message
  return "Optional"
}
```

If the actual implementation keeps the existing localized desktop copy, change only the authenticated branch. Do not rewrite unrelated strings just to match this ASCII plan snippet.

In toolbar trigger, change the visible label:

```tsx
<span className="truncate">{getAccountTitle(state)}</span>
```

In dropdown label, show primary and email when display name exists:

```tsx
<DropdownMenuLabel className="font-normal">
  <div className="flex min-w-0 flex-col gap-1">
    <span className="truncate text-sm font-medium">{getAccountTitle(state)}</span>
    {getDisplayName(state) ? (
      <span className="truncate text-xs text-muted-foreground">{state.profile.user.email}</span>
    ) : null}
  </div>
</DropdownMenuLabel>
```

- [ ] **Step 6: Run desktop focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/account/__tests__/ipc.test.ts src/app-shell/components/__tests__/account-user-control.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/types/account.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/src/app-shell/components/account-user-control.tsx desktop/src/app-shell/components/__tests__/account-user-control.test.tsx
git commit -m "feat: show account display name on desktop"
```

## Task 5: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet under the feature-additions section in `RELEASE_NOTES_PENDING.md`:

```markdown
- Ordinary users can set a display name in the web personal center, and desktop shows it after account sync.
```

- [ ] **Step 2: Run server focused tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/auth/user-auth.service.spec.ts src/dashboard/dashboard.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run server typecheck**

Run:

```bash
pnpm --filter @synapse/server run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run dashboard checks**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run build
```

Expected: PASS.

- [ ] **Step 5: Run desktop focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/account/__tests__/ipc.test.ts src/app-shell/components/__tests__/account-user-control.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run desktop hard constraints and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 7: Inspect changed files**

Run:

```bash
git diff --check
git status --short
```

Expected:

```text
git diff --check exits 0.
Only intended files are modified.
```

- [ ] **Step 8: Commit release note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note user display name"
```

## Self Review

Spec coverage:

- Ordinary-user edit surface: Task 3.
- Desktop read-only display: Task 4.
- User.displayName persistence: Task 1.
- Dashboard PATCH API: Task 2.
- Desktop `/api/auth/me` profile payload: Task 1 and Task 4.
- Admin accounts out of scope: Task 2 relies on `UserAuthGuard`, which rejects admin dashboard cookies.
- Avatar out of scope: no avatar field or UI in any task.
- Release notes: Task 5.

Dashboard automated UI test gap:

- The dashboard package currently has no test script or React test setup. This plan uses `tsc` and `build` for dashboard verification and covers behavior through server unit tests. Do not add a dashboard test framework just for this feature.

Type consistency:

- Backend property name: `displayName`.
- API property name: `displayName`.
- Desktop type and IPC schema property name: `displayName`.
- Dashboard form field name: `displayName`.
