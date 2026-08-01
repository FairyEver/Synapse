# Signup Invitation Flow Implementation Plan

> Retired on 2026-07-31. Team invitations and their public links were removed from the product and database; this plan is historical only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public user signup invitation flow at `/dashboard/signup?invite=<token>` and remove historical `user_signup` invitations.

**Architecture:** Keep administrator dashboard APIs under `adminApi`, add a separate normal-user `userAuthApi`, and render signup as a public dashboard route before admin session loading. Split signup and team invitation URL builders so team invitations no longer share the signup route.

**Tech Stack:** NestJS, Prisma, React 19, Vite, Vitest, shadcn/ui, Tailwind token classes.

---

## Pre-Flight Notes

The worktree currently has pre-existing unstaged changes in:

- `server/admin/src/pages/signup-invitation-action.tsx`
- `server/admin/src/pages/signup-invitation-action.test.tsx`

These changes rename the button from `创建邀请` to `创建用户邀请` and add a matching test. Treat them as user work. Preserve them and build on top of them.

Do not start a dev server or browser session for verification. This repository's instructions say to reason through source and run tests/builds only unless the user explicitly asks for runtime inspection.

## File Structure

Modify:

- `server/src/invitations/invitation-url.ts`  
  Owns public URL resolution, explicit signup/team invitation URL builders, and token parsing.

- `server/src/invitations/invitation-url.spec.ts`  
  Covers new signup URL shape, team URL separation, and `invite` token parsing.

- `server/src/invitations/invitations.service.ts`  
  Uses explicit URL builders for `user_signup` and `team_join`.

- `server/src/invitations/invitations.service.spec.ts`  
  Verifies signup invitations return `/dashboard/signup?invite=...` and team invitations do not.

- `server/admin/src/lib/api.ts`  
  Keeps `adminApi` and adds `userAuthApi.register`.

- `server/admin/src/pages/signup-page.tsx`  
  New public signup page with email/password form, missing-invite state, error state, and success state.

- `server/admin/src/pages/signup-page.test.tsx`  
  New page-level tests.

- `server/admin/src/App.tsx`  
  Recognizes `/dashboard/signup?invite=...` before admin session loading.

- `server/admin/src/App.test.tsx`  
  Covers the public route bypassing admin session loading.

- `server/admin/src/pages/signup-invitation-action.test.tsx`  
  Update expected invitation URL shape in the existing copy/display test.

Create:

- `server/prisma/migrations/20260522000000_clear_user_signup_invitations/migration.sql`  
  Deletes existing `user_signup` invitation rows only.

---

### Task 1: Backend Invitation URL Helpers

**Files:**
- Modify: `server/src/invitations/invitation-url.spec.ts`
- Modify: `server/src/invitations/invitation-url.ts`

- [ ] **Step 1: Write the failing URL helper tests**

Replace the tests in `server/src/invitations/invitation-url.spec.ts` with:

```ts
import { describe, expect, it } from "vitest"
import { buildSignupInviteUrl, buildTeamInviteUrl, parseInviteTokenInput, resolvePublicAppUrl } from "./invitation-url"

describe("invitation URL helpers", () => {
  it("builds signup invite URLs under the dashboard signup route", () => {
    expect(buildSignupInviteUrl({
      publicAppUrl: "https://app.example.com/",
      token: "plain-token",
    })).toBe("https://app.example.com/dashboard/signup?invite=plain-token")
  })

  it("encodes signup invite tokens in the invite query parameter", () => {
    expect(buildSignupInviteUrl({
      publicAppUrl: "https://app.example.com",
      token: "plain token+value",
    })).toBe("https://app.example.com/dashboard/signup?invite=plain+token%2Bvalue")
  })

  it("keeps team invite URL construction separate from signup", () => {
    expect(buildTeamInviteUrl({
      publicAppUrl: "https://app.example.com/",
      token: "plain-token",
    })).toBe("https://app.example.com/team-invite?token=plain-token")
  })

  it("prefers the configured public app URL over request origin", () => {
    expect(resolvePublicAppUrl({
      configuredPublicAppUrl: "https://app.example.com/",
      request: {
        protocol: "http",
        headers: { host: "api.example.com" },
        get: () => "api.example.com",
      },
    })).toBe("https://app.example.com")
  })

  it("falls back to forwarded request origin", () => {
    expect(resolvePublicAppUrl({
      configuredPublicAppUrl: "",
      request: {
        protocol: "http",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "synapse.example.com",
          host: "127.0.0.1:3000",
        },
        get: (name: string) => name.toLowerCase() === "host" ? "127.0.0.1:3000" : undefined,
      },
    })).toBe("https://synapse.example.com")
  })

  it("parses tokens from signup invite URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/dashboard/signup?invite=plain-token"))
      .toBe("plain-token")
  })

  it("parses tokens from token query URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/team-invite?token=plain-token"))
      .toBe("plain-token")
  })

  it("parses tokens from invitationToken query URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/register?invitationToken=plain-token"))
      .toBe("plain-token")
  })

  it("keeps bare tokens unchanged", () => {
    expect(parseInviteTokenInput(" plain-token ")).toBe("plain-token")
  })
})
```

- [ ] **Step 2: Run the URL helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server test -- src/invitations/invitation-url.spec.ts
```

Expected: FAIL because `buildSignupInviteUrl` and `buildTeamInviteUrl` are not exported yet, or because the old helper still builds `/invite#token=...`.

- [ ] **Step 3: Implement explicit URL helpers**

Replace the helper section in `server/src/invitations/invitation-url.ts` with explicit builders. Keep `resolvePublicAppUrl` and `normalizePublicAppUrl` behavior unchanged.

```ts
function buildSignupInviteUrl(input: {
  readonly publicAppUrl: string
  readonly token: string
}): string {
  const url = new URL("/dashboard/signup", `${normalizePublicAppUrl(input.publicAppUrl)}/`)
  url.searchParams.set("invite", input.token)
  return url.toString()
}

function buildTeamInviteUrl(input: {
  readonly publicAppUrl: string
  readonly token: string
}): string {
  const url = new URL("/team-invite", `${normalizePublicAppUrl(input.publicAppUrl)}/`)
  url.searchParams.set("token", input.token)
  return url.toString()
}

function parseInviteTokenInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  try {
    const url = new URL(trimmed)
    const queryToken = url.searchParams.get("invite")
      ?? url.searchParams.get("token")
      ?? url.searchParams.get("invitationToken")
    if (queryToken) return queryToken.trim()
  } catch {
    return trimmed
  }

  return trimmed
}

export { buildSignupInviteUrl, buildTeamInviteUrl, parseInviteTokenInput, resolvePublicAppUrl }
```

Remove the old `buildInviteUrl` export. Do not keep hash-fragment parsing for old `/invite#token=...` links.

- [ ] **Step 4: Run the URL helper tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/server test -- src/invitations/invitation-url.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Stage only Task 1 files:

```bash
git add server/src/invitations/invitation-url.ts server/src/invitations/invitation-url.spec.ts
git commit -m "feat(server): split invitation URL helpers"
```

---

### Task 2: Invitation Service Uses Split URL Builders

**Files:**
- Modify: `server/src/invitations/invitations.service.ts`
- Modify: `server/src/invitations/invitations.service.spec.ts`

- [ ] **Step 1: Update failing service expectations**

In `server/src/invitations/invitations.service.spec.ts`, update the URL expectations:

```ts
it("returns a dashboard signup invite URL", async () => {
  const prisma = createPrismaMock()
  const service = new InvitationsService(prisma as never)

  const result = await service.createSignupInvitation({
    adminId: "admin-1",
    publicAppUrl: "https://app.example.com/",
  })

  expect(result.inviteUrl).toBe(`https://app.example.com/dashboard/signup?invite=${result.token}`)
})

it("returns a separate team invite URL", async () => {
  const prisma = createPrismaMock()
  const service = new InvitationsService(prisma as never)

  const result = await service.createTeamInvitation({
    userId: "user-1",
    teamId: "team-1",
    publicAppUrl: "https://app.example.com",
  })

  expect(result.inviteUrl).toBe(`https://app.example.com/team-invite?token=${result.token}`)
})
```

Replace the old "accepts full invite URLs when consuming invitations" test with the new signup URL:

```ts
it("accepts dashboard signup URLs when consuming invitations", async () => {
  const prisma = createPrismaMock()
  prisma.invitation.updateMany.mockResolvedValue({ count: 1 })
  prisma.invitation.findUnique.mockResolvedValue({
    id: "invite-1",
    type: "user_signup",
    tokenHash: "hash",
    expiresAt: new Date("2026-05-28T00:00:00.000Z"),
    usedAt: new Date("2026-05-21T00:00:00.000Z"),
    teamId: null,
    acceptedByUserId: "user-1",
  })
  const service = new InvitationsService(prisma as never)

  await service.consumeInvitation({
    token: "https://app.example.com/dashboard/signup?invite=plain-token",
    type: "user_signup",
    acceptedByUserId: "user-1",
  })

  expect(prisma.invitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      tokenHash: expect.not.stringContaining("https://app.example.com"),
    }),
  }))
})
```

- [ ] **Step 2: Run the invitation service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server test -- src/invitations/invitations.service.spec.ts
```

Expected: FAIL because `InvitationsService` still imports and calls `buildInviteUrl`.

- [ ] **Step 3: Update the service imports and calls**

In `server/src/invitations/invitations.service.ts`, change the import to:

```ts
import { buildSignupInviteUrl, buildTeamInviteUrl, parseInviteTokenInput } from "./invitation-url"
```

Change signup creation to:

```ts
inviteUrl: buildSignupInviteUrl({ publicAppUrl: input.publicAppUrl, token }),
```

Change team creation to:

```ts
inviteUrl: buildTeamInviteUrl({ publicAppUrl: input.publicAppUrl, token }),
```

- [ ] **Step 4: Run the invitation service tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/server test -- src/invitations/invitations.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/src/invitations/invitations.service.ts server/src/invitations/invitations.service.spec.ts
git commit -m "feat(server): generate dashboard signup invitations"
```

---

### Task 3: Clear Historical User Signup Invitations

**Files:**
- Create: `server/prisma/migrations/20260522000000_clear_user_signup_invitations/migration.sql`

- [ ] **Step 1: Create the migration file**

Create `server/prisma/migrations/20260522000000_clear_user_signup_invitations/migration.sql` with:

```sql
DELETE FROM "Invitation" WHERE "type" = 'user_signup';
```

- [ ] **Step 2: Review the migration**

Run:

```bash
cat server/prisma/migrations/20260522000000_clear_user_signup_invitations/migration.sql
```

Expected output:

```sql
DELETE FROM "Invitation" WHERE "type" = 'user_signup';
```

- [ ] **Step 3: Commit Task 3**

```bash
git add server/prisma/migrations/20260522000000_clear_user_signup_invitations/migration.sql
git commit -m "chore(server): clear old signup invitations"
```

---

### Task 4: Public Signup API Client and Page

**Files:**
- Modify: `server/admin/src/lib/api.ts`
- Create: `server/admin/src/pages/signup-page.tsx`
- Create: `server/admin/src/pages/signup-page.test.tsx`

- [ ] **Step 1: Write failing signup page tests**

Create `server/admin/src/pages/signup-page.test.tsx`:

```tsx
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { userAuthApi } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { SignupPage } from "./signup-page"

vi.mock("@/lib/api", () => ({
  userAuthApi: {
    register: vi.fn(),
  },
}))

describe("SignupPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("shows an invalid link state when invite is missing", async () => {
    const result = await render(<SignupPage inviteToken="" />)
    cleanup = result.unmount

    expect(result.container.textContent).toContain("邀请链接无效")
    expect(result.container.querySelector("form")).toBeNull()
  })

  it("registers with the invite token and shows success", async () => {
    vi.mocked(userAuthApi.register).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    })
    const result = await render(<SignupPage inviteToken="plain-token" />)
    cleanup = result.unmount

    const email = result.container.querySelector<HTMLInputElement>("#signup-email")!
    const password = result.container.querySelector<HTMLInputElement>("#signup-password")!
    changeInput(email, "new@example.com")
    changeInput(password, "password123")

    await act(async () => {
      result.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }))
    })

    await waitFor(() => {
      expect(result.container.textContent).toContain("注册成功")
    })
    expect(result.container.textContent).toContain("去登录")
    expect(userAuthApi.register).toHaveBeenCalledWith({
      invitationToken: "plain-token",
      email: "new@example.com",
      password: "password123",
    })
  })

  it("shows registration failures", async () => {
    vi.mocked(userAuthApi.register).mockRejectedValue(new Error("邀请无效或已过期。"))
    const result = await render(<SignupPage inviteToken="plain-token" />)
    cleanup = result.unmount

    changeInput(result.container.querySelector<HTMLInputElement>("#signup-email")!, "new@example.com")
    changeInput(result.container.querySelector<HTMLInputElement>("#signup-password")!, "password123")

    await act(async () => {
      result.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }))
    })

    await waitFor(() => {
      expect(result.container.textContent).toContain("邀请无效或已过期。")
    })
  })
})
```

- [ ] **Step 2: Run the signup page tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server test:admin -- admin/src/pages/signup-page.test.tsx
```

Expected: FAIL because `SignupPage` and `userAuthApi` do not exist.

- [ ] **Step 3: Add the normal-user auth API boundary**

In `server/admin/src/lib/api.ts`, add these interfaces near the other API response types:

```ts
export interface UserRegisterInput {
  readonly invitationToken: string
  readonly email: string
  readonly password: string
}

export interface UserTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
}
```

Add this export after `adminApi` or before it. It should use the existing private `request` function:

```ts
export const userAuthApi = {
  register: (input: UserRegisterInput) =>
    request<UserTokenPair>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
}
```

- [ ] **Step 4: Implement the signup page**

Create `server/admin/src/pages/signup-page.tsx`:

```tsx
import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { userAuthApi } from "@/lib/api"

type SignupPageProps = {
  readonly inviteToken: string
}

export function SignupPage({ inviteToken }: SignupPageProps) {
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [registered, setRegistered] = React.useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await userAuthApi.register({ invitationToken: inviteToken, email, password })
      setRegistered(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (!inviteToken) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>邀请链接无效</CardTitle>
          </CardHeader>
        </Card>
      </main>
    )
  }

  if (registered) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>注册成功</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/dashboard/login">去登录</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>注册账号</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="signup-email">邮箱</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="signup-password">密码</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? "注册中" : "注册"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
```

This UI follows existing login-page composition and uses only shadcn components plus token classes.

- [ ] **Step 5: Run the signup page tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/server test:admin -- admin/src/pages/signup-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add server/admin/src/lib/api.ts server/admin/src/pages/signup-page.tsx server/admin/src/pages/signup-page.test.tsx
git commit -m "feat(admin): add public signup page"
```

---

### Task 5: Dashboard App Public Signup Route

**Files:**
- Modify: `server/admin/src/App.tsx`
- Modify: `server/admin/src/App.test.tsx`

- [ ] **Step 1: Write the failing public route test**

Update the mock in `server/admin/src/App.test.tsx` so it includes both `adminApi` and `userAuthApi`:

```ts
vi.mock("@/lib/api", () => ({
  adminApi: {
    getSession: vi.fn(),
    logout: vi.fn(),
    getSystemOverview: vi.fn(),
    listUsers: vi.fn(),
  },
  userAuthApi: {
    register: vi.fn(),
  },
}))
```

Add this test:

```tsx
it("renders signup without loading an admin session", async () => {
  window.history.pushState({}, "", "/dashboard/signup?invite=plain-token")

  const result = await render(<App />)
  cleanup = result.unmount

  await waitFor(() => {
    expect(result.container.textContent).toContain("注册账号")
  })
  expect(result.container.querySelector<HTMLInputElement>("#signup-email")).not.toBeNull()
  expect(adminApi.getSession).not.toHaveBeenCalled()
})
```

In `afterEach`, restore the URL so other tests stay isolated:

```ts
window.history.pushState({}, "", "/")
```

- [ ] **Step 2: Run the App tests and verify the new test fails**

Run:

```bash
pnpm --filter @synapse/server test:admin -- admin/src/App.test.tsx
```

Expected: FAIL because `App` still checks admin session before rendering signup.

- [ ] **Step 3: Implement public signup route detection**

In `server/admin/src/App.tsx`, import the page:

```ts
import { SignupPage } from "@/pages/signup-page"
```

Add helpers near `routeFromHash`:

```ts
function isSignupRoute(): boolean {
  return window.location.pathname.replace(/\/+$/, "") === "/dashboard/signup"
}

function inviteTokenFromSearch(): string {
  return new URLSearchParams(window.location.search).get("invite")?.trim() ?? ""
}
```

At the start of `App`, before the `useEffect` that calls `adminApi.getSession`, compute:

```ts
const signupRoute = isSignupRoute()
```

Change the session-loading effect so it does nothing for signup:

```ts
React.useEffect(() => {
  if (signupRoute) return
  let alive = true
  adminApi
    .getSession()
    .then((result) => {
      if (alive) setSession(result)
    })
    .catch(() => {
      if (alive) setSession(null)
    })
  return () => {
    alive = false
  }
}, [signupRoute])
```

Render the public page before admin session states:

```tsx
if (signupRoute) {
  return <SignupPage inviteToken={inviteTokenFromSearch()} />
}
```

- [ ] **Step 4: Run the App tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/server test:admin -- admin/src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add server/admin/src/App.tsx server/admin/src/App.test.tsx
git commit -m "feat(admin): expose signup as public route"
```

---

### Task 6: Existing Invitation Action Uses New Link Shape

**Files:**
- Modify: `server/admin/src/pages/signup-invitation-action.test.tsx`
- Preserve existing user changes in `server/admin/src/pages/signup-invitation-action.tsx`

- [ ] **Step 1: Update expected generated link values in the existing tests**

In `server/admin/src/pages/signup-invitation-action.test.tsx`, change mocked `inviteUrl` values from:

```ts
inviteUrl: "https://app.example.com/invite#token=plain-token",
```

to:

```ts
inviteUrl: "https://app.example.com/dashboard/signup?invite=plain-token",
```

Change assertions from:

```ts
expect((result.container.querySelector("input") as HTMLInputElement).value)
  .toBe("https://app.example.com/invite#token=plain-token")
expect(writeText).toHaveBeenCalledWith("https://app.example.com/invite#token=plain-token")
```

to:

```ts
expect((result.container.querySelector("input") as HTMLInputElement).value)
  .toBe("https://app.example.com/dashboard/signup?invite=plain-token")
expect(writeText).toHaveBeenCalledWith("https://app.example.com/dashboard/signup?invite=plain-token")
```

If the second test also asserts the input value, update it to the same dashboard signup URL.

- [ ] **Step 2: Run the invitation action tests**

Run:

```bash
pnpm --filter @synapse/server test:admin -- admin/src/pages/signup-invitation-action.test.tsx
```

Expected: PASS. The component displays whatever URL the API returns.

- [ ] **Step 3: Commit Task 6**

Stage the test file and the pre-existing component change if it is still unstaged and belongs to this feature:

```bash
git add server/admin/src/pages/signup-invitation-action.tsx server/admin/src/pages/signup-invitation-action.test.tsx
git commit -m "test(admin): expect signup invitation links"
```

---

### Task 7: Final Verification

**Files:**
- No new code files unless a previous task exposed a type or lint error.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
pnpm --filter @synapse/server test -- src/invitations/invitation-url.spec.ts src/invitations/invitations.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused admin tests**

Run:

```bash
pnpm --filter @synapse/server test:admin -- admin/src/pages/signup-page.test.tsx admin/src/App.test.tsx admin/src/pages/signup-invitation-action.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run package typecheck**

Run:

```bash
pnpm --filter @synapse/server typecheck
```

Expected: PASS.

- [ ] **Step 4: Run package build**

Run:

```bash
pnpm --filter @synapse/server build
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected:

- No unexpected files.
- Only signup invitation flow files and migration are modified.

If all prior tasks committed their changes, `git status --short` should be clean.

---

## Spec Coverage Review

- `/dashboard/signup?invite=<token>` URL generation: Task 1 and Task 2.
- Public signup route before admin session loading: Task 5.
- Registration through `/api/auth/register`: Task 4.
- Success state with "去登录": Task 4.
- Split user signup and team join invitation URL construction: Task 1 and Task 2.
- Delete all historical `user_signup` invitation rows: Task 3.
- Update admin invitation display/copy expectations: Task 6.
- Focused tests and build/typecheck: Task 7.
