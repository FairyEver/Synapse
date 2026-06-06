# Desktop Account Offline Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Synapse Desktop account login during restarts, updates, and temporary server outages by adding an authenticated offline state with automatic recovery.

**Architecture:** Desktop main remains the only owner of tokens, refresh, and retry scheduling. Renderer receives a richer account state with `connectivity: "online" | "offline"` plus small helper functions for future business checks. Refresh failures are classified before local credentials are mutated: temporary failures preserve credentials and retry, while explicit auth failures clear credentials.

**Tech Stack:** Electron main process, React renderer, TypeScript, shadcn/Radix UI, Vitest, encrypted DataRepository namespace `core.account`.

---

## File Structure

- Modify: `desktop/src/types/account.ts`
  - Add account connectivity, offline reason, retry metadata, and helper functions.
- Modify: `desktop/electron/modules/account/ipc.ts`
  - Accept the new authenticated state shape in zod schemas.
- Modify: `desktop/electron/services/account-service.ts`
  - Add refresh failure classification, offline transitions, retry timer scheduling, retry cancellation, and manual retry entrypoint behavior.
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
  - Add TDD coverage for temporary outages, explicit invalidation, retry recovery, and logout/login retry cancellation.
- Modify: `desktop/electron/main.ts`
  - Trigger an immediate recovery check when the app is activated/focused.
- Modify: `desktop/src/app-shell/components/account-user-control.tsx`
  - Render the offline account state with short UI copy.
- Modify: `desktop/src/app-shell/components/__tests__/account-user-control.test.tsx`
  - Cover offline rendering and sync action.
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
  - Cover IPC validation for `authenticated/offline`.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Record the user-visible login persistence and offline recovery behavior.

## Task 1: Extend Account Types And Helpers

**Files:**
- Modify: `desktop/src/types/account.ts`

- [ ] **Step 1: Write helper tests in the same task target**

Create a new test file `desktop/src/types/__tests__/account.test.ts` with exact helper expectations:

```ts
import { describe, expect, it } from "vitest"
import {
  hasAccountProfile,
  isAccountOnline,
  isAccountUnavailable,
  type SynapseAccountProfile,
  type SynapseAccountState,
} from "../account"

const profile = {
  user: { id: "u1", email: "u@example.com", displayName: null, status: "active" },
  teams: [],
  syncedAt: "2026-06-06T00:00:00.000Z",
} satisfies SynapseAccountProfile

const online = {
  status: "authenticated",
  connectivity: "online",
  profile,
} satisfies SynapseAccountState

const offline = {
  status: "authenticated",
  connectivity: "offline",
  offlineReason: "server_unavailable",
  profile: online.profile,
} satisfies SynapseAccountState

describe("account state helpers", () => {
  it("treats online authenticated accounts as available", () => {
    expect(hasAccountProfile(online)).toBe(true)
    expect(isAccountOnline(online)).toBe(true)
    expect(isAccountUnavailable(online)).toBe(false)
  })

  it("treats offline authenticated accounts as having a profile but unavailable", () => {
    expect(hasAccountProfile(offline)).toBe(true)
    expect(isAccountOnline(offline)).toBe(false)
    expect(isAccountUnavailable(offline)).toBe(true)
  })

  it("treats unauthenticated accounts as unavailable with no profile", () => {
    const state = { status: "unauthenticated" } satisfies SynapseAccountState
    expect(hasAccountProfile(state)).toBe(false)
    expect(isAccountOnline(state)).toBe(false)
    expect(isAccountUnavailable(state)).toBe(true)
  })
})
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/types/__tests__/account.test.ts
```

Expected: FAIL because `connectivity`, `offlineReason`, and helper exports do not exist.

- [ ] **Step 3: Implement account types and helpers**

Update `desktop/src/types/account.ts` to this shape:

```ts
export type SynapseAccountUser = {
  id: string
  email: string
  displayName: string | null
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

export type SynapseAccountOfflineReason =
  | "network_error"
  | "server_unavailable"
  | "profile_sync_failed"

export type SynapseAccountRetryState = {
  attempt: number
  nextRetryAt?: string
}

export type SynapseAccountState =
  | { status: "unauthenticated" }
  | { status: "authenticating"; loginUrl?: string }
  | {
      status: "authenticated"
      connectivity: "online" | "offline"
      profile: SynapseAccountProfile
      offlineReason?: SynapseAccountOfflineReason
      retry?: SynapseAccountRetryState
    }
  | { status: "error"; message: string; profile?: SynapseAccountProfile }

export type SynapseAccountStateChangedEvent = {
  state: SynapseAccountState
}

export function hasAccountProfile(state: SynapseAccountState): boolean {
  return "profile" in state && Boolean(state.profile)
}

export function isAccountOnline(state: SynapseAccountState): boolean {
  return state.status === "authenticated" && state.connectivity === "online"
}

export function isAccountUnavailable(state: SynapseAccountState): boolean {
  return !isAccountOnline(state)
}
```

- [ ] **Step 4: Run helper tests and typecheck the account test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/types/__tests__/account.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types/account.ts desktop/src/types/__tests__/account.test.ts
git commit -m "feat(desktop): add account connectivity state"
```

## Task 2: Update IPC Schemas For Offline Account State

**Files:**
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`

- [ ] **Step 1: Update IPC test for offline state**

In `desktop/electron/modules/account/__tests__/ipc.test.ts`, add this test:

```ts
it("validates offline authenticated account events", () => {
  const parsed = accountIpcModule.events.stateChanged.payload.parse({
    domain: "account",
    type: "account.stateChanged",
    payload: {
      state: {
        status: "authenticated",
        connectivity: "offline",
        offlineReason: "server_unavailable",
        retry: { attempt: 1, nextRetryAt: "2026-06-06T00:00:10.000Z" },
        profile: {
          user: { id: "u1", email: "u@example.com", displayName: "Ada", status: "active" },
          teams: [],
          syncedAt: "2026-06-06T00:00:00.000Z",
        },
      },
    },
    timestamp: "2026-06-06T00:00:00.000Z",
  })

  expect(parsed.payload.state).toMatchObject({
    status: "authenticated",
    connectivity: "offline",
    offlineReason: "server_unavailable",
  })
})
```

- [ ] **Step 2: Run IPC test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/account/__tests__/ipc.test.ts
```

Expected: FAIL because authenticated account schema does not include `connectivity`, `offlineReason`, or `retry`.

- [ ] **Step 3: Update zod schemas**

In `desktop/electron/modules/account/ipc.ts`, add schemas:

```ts
const accountOfflineReasonSchema = z.enum([
  "network_error",
  "server_unavailable",
  "profile_sync_failed",
])

const accountRetryStateSchema = z.object({
  attempt: z.number().int().nonnegative(),
  nextRetryAt: z.string().optional(),
})
```

Replace the authenticated branch of `accountStateSchema` with:

```ts
z.object({
  status: z.literal("authenticated"),
  connectivity: z.enum(["online", "offline"]),
  profile: accountProfileSchema,
  offlineReason: accountOfflineReasonSchema.optional(),
  retry: accountRetryStateSchema.optional(),
}),
```

Update the existing event validation test payload to include `connectivity: "online"` in authenticated states.

- [ ] **Step 4: Run IPC test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/account/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts
git commit -m "feat(desktop): validate account offline state"
```

## Task 3: Classify Refresh Failures Without Clearing Temporary Outages

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Add tests for temporary refresh failure and explicit auth failure**

Add these tests near the existing `refreshes from stored refresh token...` test:

```ts
it("keeps stored credentials and enters offline when refresh has a network error", async () => {
  const { namespace, service } = await createTestAccountService({
    fetch: vi.fn(async () => {
      throw new Error("connect ECONNREFUSED")
    }) as typeof fetch,
  })
  await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

  const state = await service.refreshFromStorage()

  expect(state).toMatchObject({
    status: "authenticated",
    connectivity: "offline",
    offlineReason: "network_error",
    profile: storedProfile,
  })
  expect(await namespace.getSingleton()).toMatchObject({
    refreshToken: "refresh-old",
    lastProfile: storedProfile,
  })
})

it("keeps stored credentials and enters offline when refresh returns 503", async () => {
  const { namespace, service } = await createTestAccountService({
    fetch: vi.fn(async (url) => {
      if (String(url).endsWith("/auth/refresh")) return jsonResponse({ error: "deploying" }, 503)
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch,
  })
  await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

  const state = await service.refreshFromStorage()

  expect(state).toMatchObject({
    status: "authenticated",
    connectivity: "offline",
    offlineReason: "server_unavailable",
    profile: storedProfile,
  })
  expect(await namespace.getSingleton()).toMatchObject({
    refreshToken: "refresh-old",
    lastProfile: storedProfile,
  })
})

it("clears stored credentials when refresh returns 401", async () => {
  const { namespace, service } = await createTestAccountService({
    fetch: vi.fn(async (url) => {
      if (String(url).endsWith("/auth/refresh")) return jsonResponse({ message: "expired" }, 401)
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch,
  })
  await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

  const state = await service.refreshFromStorage()

  expect(state).toEqual({ status: "unauthenticated" })
  expect(await namespace.getSingleton()).not.toHaveProperty("refreshToken")
  expect(await namespace.getSingleton()).not.toHaveProperty("lastProfile")
})
```

- [ ] **Step 2: Run account service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because all refresh failures currently clear the refresh token and authenticated states lack `connectivity`.

- [ ] **Step 3: Add HTTP classification helpers**

In `desktop/electron/services/account-service.ts`, update the account type import:

```ts
import type {
  SynapseAccountOfflineReason,
  SynapseAccountProfile,
  SynapseAccountState,
} from "../../src/types/account"
```

Then add these types near `PersistedAccount`:

```ts
type AccountHttpFailureKind = "temporary" | "auth" | "other"

type AccountHttpError = Error & {
  status?: number
  url?: string
  method?: string
}
```

Replace `createHttpError` with a version that preserves status metadata:

```ts
async function createHttpError(method: string, url: string, response: Response, fallbackMessage: string): Promise<AccountHttpError> {
  const detail = await formatHttpFailureBody(response)
  const detailText = detail ? `: ${detail}` : ""
  const error = new Error(`${fallbackMessage} (${method} ${endpointPath(url)} HTTP ${response.status})${detailText}`) as AccountHttpError
  error.status = response.status
  error.url = url
  error.method = method
  return error
}
```

Add helpers near `endpointPath`:

```ts
function classifyAccountRefreshFailure(error: unknown): AccountHttpFailureKind {
  if (isAccountHttpError(error)) {
    if (error.status === 401 || error.status === 403) return "auth"
    if (error.status >= 500) return "temporary"
    return "other"
  }
  return "temporary"
}

function offlineReasonForFailure(error: unknown): SynapseAccountOfflineReason {
  if (isAccountHttpError(error) && error.status >= 500) return "server_unavailable"
  return "network_error"
}

function isAccountHttpError(error: unknown): error is AccountHttpError {
  return error instanceof Error && typeof (error as AccountHttpError).status === "number"
}
```

- [ ] **Step 4: Add online connectivity to successful states**

In `handleAuthCallback()` and `refreshFromStorage()`, change all successful authenticated states from:

```ts
this.setState({ status: "authenticated", profile })
```

to:

```ts
this.setState({ status: "authenticated", connectivity: "online", profile })
```

Also update tests that expect `state.status === "authenticated"` to keep that assertion but not require the old object shape.

- [ ] **Step 5: Preserve refresh token for temporary startup refresh failures**

Add a credential clear helper inside `AccountService`:

```ts
  private async clearStoredCredentialsIfRefreshTokenCurrent(expectedRefreshToken: string | undefined): Promise<void> {
    if (!expectedRefreshToken) return
    await this.runStorageMutation(async () => {
      const persisted = await this.readPersisted("Failed to read stored account before clearing credentials.")
      if (persisted?.refreshToken !== expectedRefreshToken) return
      const nextPersisted: PersistedAccount = { ...persisted }
      delete nextPersisted.refreshToken
      delete nextPersisted.lastProfile
      await this.namespace.setSingleton(nextPersisted)
    }).catch((error) => {
      logger.warn("Failed to clear stored account credentials.", { error })
    })
  }
```

Replace the `catch` block in `refreshFromStorage()` with:

```ts
    } catch (error) {
      logger.warn("Account refresh failed.", { error })
      this.accessToken = null
      const failureKind = classifyAccountRefreshFailure(error)
      const latest = await this.readPersisted("Failed to read stored account after account refresh failed.")
      if (latest?.activeAttempt) return this.state
      if (failureKind === "temporary" && latest?.refreshToken === attemptedRefreshToken && latest.lastProfile) {
        this.setState({
          status: "authenticated",
          connectivity: "offline",
          offlineReason: offlineReasonForFailure(error),
          profile: latest.lastProfile,
        })
        return this.state
      }
      await this.clearStoredCredentialsIfRefreshTokenCurrent(attemptedRefreshToken)
      this.setState({ status: "unauthenticated" })
    }
```

- [ ] **Step 6: Run account service tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: PASS after updating existing expected authenticated objects to include `connectivity: "online"` where they compare full state.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "fix(desktop): preserve account credentials during outages"
```

## Task 4: Add Offline Retry Scheduling In AccountService

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Add fake-timer tests for retry success and retry auth failure**

Update the Vitest import in `desktop/electron/services/__tests__/account-service.test.ts` to include `afterEach`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
```

Add this `afterEach` cleanup near the test setup:

```ts
afterEach(() => {
  vi.useRealTimers()
})
```

Add these tests:

```ts
it("automatically retries offline refresh and returns online when the server recovers", async () => {
  vi.useFakeTimers()
  const calls: string[] = []
  const { namespace, service } = await createTestAccountService({
    fetch: vi.fn(async (url, init) => {
      calls.push(String(url))
      if (String(url).endsWith("/auth/refresh") && calls.length === 1) {
        return jsonResponse({ error: "deploying" }, 503)
      }
      if (String(url).endsWith("/auth/refresh")) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
        return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch,
  })
  await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

  const offline = await service.refreshFromStorage()
  expect(offline).toMatchObject({ status: "authenticated", connectivity: "offline" })

  await vi.advanceTimersByTimeAsync(10_000)

  expect(service.getState()).toMatchObject({ status: "authenticated", connectivity: "online" })
  expect(await namespace.getSingleton()).toMatchObject({ refreshToken: "refresh-new" })
})

it("clears credentials when offline retry receives an auth failure", async () => {
  vi.useFakeTimers()
  let refreshCount = 0
  const { namespace, service } = await createTestAccountService({
    fetch: vi.fn(async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshCount += 1
        return refreshCount === 1
          ? jsonResponse({ error: "deploying" }, 503)
          : jsonResponse({ message: "expired" }, 401)
      }
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch,
  })
  await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

  await service.refreshFromStorage()
  await vi.advanceTimersByTimeAsync(10_000)

  expect(service.getState()).toEqual({ status: "unauthenticated" })
  expect(await namespace.getSingleton()).not.toHaveProperty("refreshToken")
  expect(await namespace.getSingleton()).not.toHaveProperty("lastProfile")
})

it("backs off consecutive temporary offline retry failures", async () => {
  vi.useFakeTimers()
  const { namespace, service } = await createTestAccountService({
    fetch: vi.fn(async (url) => {
      if (String(url).endsWith("/auth/refresh")) return jsonResponse({ error: "deploying" }, 503)
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch,
  })
  await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

  const first = await service.refreshFromStorage()
  expect(first).toMatchObject({
    status: "authenticated",
    connectivity: "offline",
    retry: { attempt: 0 },
  })

  await vi.advanceTimersByTimeAsync(10_000)
  expect(service.getState()).toMatchObject({
    status: "authenticated",
    connectivity: "offline",
    retry: { attempt: 1 },
  })

  await vi.advanceTimersByTimeAsync(29_999)
  expect((service.getState() as { retry?: { attempt: number } }).retry?.attempt).toBe(1)

  await vi.advanceTimersByTimeAsync(1)
  expect(service.getState()).toMatchObject({
    status: "authenticated",
    connectivity: "offline",
    retry: { attempt: 2 },
  })
})
```

- [ ] **Step 2: Run account service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because no retry timer exists.

- [ ] **Step 3: Add retry fields and delay helper**

In `AccountService`, add fields:

```ts
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
```

Add constants near `ATTEMPT_TTL_MS`:

```ts
const ACCOUNT_RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000] as const
```

Add helper:

```ts
function retryDelayMs(attempt: number): number {
  return ACCOUNT_RETRY_DELAYS_MS[Math.min(attempt, ACCOUNT_RETRY_DELAYS_MS.length - 1)] ?? 300_000
}
```

- [ ] **Step 4: Add retry scheduler methods**

Inside `AccountService`, add:

```ts
  private clearOfflineRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private scheduleOfflineRetry(reason: SynapseAccountOfflineReason, profile: SynapseAccountProfile): void {
    if (this.retryTimer) return
    const delayMs = retryDelayMs(this.retryAttempt)
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString()
    this.setState({
      status: "authenticated",
      connectivity: "offline",
      offlineReason: reason,
      profile,
      retry: { attempt: this.retryAttempt, nextRetryAt },
    })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryAttempt += 1
      void this.refreshFromStorage({ resetRetryBackoff: false })
    }, delayMs)
    this.retryTimer.unref?.()
  }

  private cancelOfflineRetry(): void {
    this.clearOfflineRetryTimer()
    this.retryAttempt = 0
  }
```

- [ ] **Step 5: Wire retry cancellation and scheduling**

Call `this.cancelOfflineRetry()` at the start of `startLogin()` and `logout()`.

In successful authentication paths, call `this.cancelOfflineRetry()` before setting online state.

In the temporary failure branch from Task 3, replace direct `setState` with:

```ts
this.scheduleOfflineRetry(offlineReasonForFailure(error), latest.lastProfile)
```

Keep the direct return after scheduling.

- [ ] **Step 6: Run account service tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat(desktop): retry offline account sessions"
```

## Task 5: Add Manual And Activation Recovery Hooks

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Add focused recovery method**

Add this public method to `AccountService`:

```ts
  async retryOfflineNow(): Promise<SynapseAccountState> {
    if (this.state.status !== "authenticated" || this.state.connectivity !== "offline") {
      return this.state
    }
    this.cancelOfflineRetry()
    return this.refreshFromStorage()
  }
```

- [ ] **Step 2: Make manual refresh immediate without breaking scheduled backoff**

Change `refreshFromStorage` to accept an optional backoff reset flag:

```ts
async refreshFromStorage(options: { resetRetryBackoff?: boolean } = {}): Promise<SynapseAccountState> {
  const resetRetryBackoff = options.resetRetryBackoff ?? true
  if (resetRetryBackoff) {
    this.cancelOfflineRetry()
  } else {
    this.clearOfflineRetryTimer()
  }
  // existing method body continues here
}
```

The existing IPC `refresh` still calls `refreshFromStorage()` with no arguments, so user-triggered sync resets the backoff and retries immediately. The scheduled retry callback from Task 4 calls `refreshFromStorage({ resetRetryBackoff: false })`, so consecutive temporary failures progress through `10s -> 30s -> 1m -> 2m -> 5m`.

- [ ] **Step 3: Trigger recovery on app activation**

In `desktop/electron/main.ts`, change the activate handler from:

```ts
attachActivateHandler(focusOrCreateMainWindow)
```

to:

```ts
attachActivateHandler(() => {
  focusOrCreateMainWindow()
  void accountService.retryOfflineNow()
})
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/main.ts
git commit -m "feat(desktop): recover account session on activation"
```

## Task 6: Update Account UI For Offline State

**Files:**
- Modify: `desktop/src/app-shell/components/account-user-control.tsx`
- Modify: `desktop/src/app-shell/components/__tests__/account-user-control.test.tsx`

- [ ] **Step 1: Add UI tests for offline state**

In `account-user-control.test.tsx`, add:

```ts
it("shows offline account identity and keeps sync available", () => {
  accountState.current = {
    status: "authenticated",
    connectivity: "offline",
    offlineReason: "server_unavailable",
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
  }

  const panel = renderControl("panel")

  expect(panel.textContent).toContain("Ada")
  expect(panel.textContent).toContain("离线")
  expect(panel.textContent).toContain("同步")
  expect(panel.textContent).toContain("退出")
})
```

Update existing authenticated test fixtures to include `connectivity: "online"`.

- [ ] **Step 2: Run UI test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/app-shell/components/__tests__/account-user-control.test.tsx
```

Expected: FAIL because offline detail rendering does not exist and old fixtures need `connectivity`.

- [ ] **Step 3: Update UI helpers**

In `account-user-control.tsx`, update:

```ts
function getAccountTitle(state: SynapseAccountState): string {
  if (state.status === "authenticated") return getDisplayName(state) ?? state.profile.user.email
  if (state.status === "authenticating") return "登录中"
  return "未登录"
}

function getAccountDetail(state: SynapseAccountState): string {
  if (state.status === "authenticated" && state.connectivity === "offline") return "离线"
  if (state.status === "authenticated") return state.profile.user.email
  if (state.status === "authenticating") return "正在等待浏览器登录"
  if (state.status === "error") return state.message
  return "可选"
}
```

Keep button and dropdown styling on existing shadcn primitives. Do not add custom colors.

- [ ] **Step 4: Run UI test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/app-shell/components/__tests__/account-user-control.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/components/account-user-control.tsx desktop/src/app-shell/components/__tests__/account-user-control.test.tsx
git commit -m "feat(desktop): show offline account state"
```

## Task 7: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this user-facing note under `## 功能优化` in `RELEASE_NOTES_PENDING.md`:

```md
- 桌面端账号登录现在会在服务器临时不可用时保留本地账号信息，显示离线状态，并在服务恢复后自动重新同步。
```

- [ ] **Step 2: Run focused account tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/src/types/__tests__/account.test.ts desktop/src/app-shell/components/__tests__/account-user-control.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note desktop account offline recovery"
```

## Self-Review

- Spec coverage: account state model is covered by Task 1 and Task 2; failure classification by Task 3; retry policy by Task 4 and Task 5; UI behavior by Task 6; release note and verification by Task 7.
- Placeholder scan: this plan gives exact files, commands, expected outcomes, and code snippets.
- Type consistency: the plan consistently uses `connectivity`, `offlineReason`, `retry`, `SynapseAccountOfflineReason`, and `SynapseAccountRetryState`.
- Scope check: the plan stays inside Desktop account state and UI. It does not introduce server endpoint changes or general offline workflow support.
