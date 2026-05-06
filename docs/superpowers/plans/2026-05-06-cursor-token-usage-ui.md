# Cursor Token Usage UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UI for connecting Cursor accounts and managing them within the token-usage module, so users can view Cursor token usage alongside other agents.

**Architecture:** Entry point is a "Cursor · 未连接" badge in the toolbar area. Clicking it opens an Electron BrowserWindow popup to cursor.com/login. After login, the cookie is captured, validated, and the account is saved. A manage panel (Popover) lets users sync, add accounts, or disconnect. Data flows through existing scan/report pipeline.

**Tech Stack:** React 19, Electron BrowserWindow, shadcn/ui (Badge, Button, Popover, Separator), existing IPC bridge pattern.

---

## File Structure

### New Files (Renderer)

| File | Responsibility |
|------|---------------|
| `desktop/src/modules/token-usage/components/cursor-connect-badge.tsx` | Badge in toolbar: shows "未连接" or account info, click opens login or manage panel |
| `desktop/src/modules/token-usage/hooks/use-cursor-accounts.ts` | Hook wrapping cursor IPC calls (list, add, remove, sync, validate) |

### New Files (Main Process)

| File | Responsibility |
|------|---------------|
| `desktop/electron/services/token-usage/cursor-sync/login-window.ts` | Creates BrowserWindow, monitors cookies, returns session token |

### Modified Files

| File | Change |
|------|--------|
| `desktop/src/types/bridge.ts` | Add cursor method types to `tokenUsage` section |
| `desktop/electron/token-usage/channels.ts` | Add `cursorLogin` channel |
| `desktop/electron/token-usage/ipc-handlers.ts` | Add `cursorLogin` handler |
| `desktop/electron/preload.ts` | Add `cursorLogin` bridge method |
| `desktop/src/modules/token-usage/index.tsx` | Insert `CursorConnectBadge` in toolbar area |

---

## Task 1: Add Bridge Types for Cursor Methods

**Files:**
- Modify: `desktop/src/types/bridge.ts:558`

- [ ] **Step 1: Add cursor method types to the tokenUsage bridge interface**

In `desktop/src/types/bridge.ts`, after line 558 (`clearData: () => Promise<void>`), add the cursor methods before the closing `}`:

```typescript
    cursorAddAccount: (params: { sessionToken: string; label?: string }) => Promise<{ accountId: string; error?: string }>
    cursorRemoveAccount: (params: { accountId: string }) => Promise<void>
    cursorListAccounts: () => Promise<{ id: string; label?: string; userId?: string; active: boolean; createdAt: string; lastSyncAt?: string }[]>
    cursorSetActive: (params: { accountId: string }) => Promise<void>
    cursorSync: () => Promise<{ synced: boolean; rows: number; error?: string }>
    cursorValidate: (params: { sessionToken: string }) => Promise<{ valid: boolean; membershipType?: string; error?: string }>
    cursorLogin: () => Promise<{ sessionToken: string | null; cancelled: boolean }>
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/types/bridge.ts
git commit -m "feat(token-usage): add cursor bridge types"
```

---

## Task 2: Create Login Window (Main Process)

**Files:**
- Create: `desktop/electron/services/token-usage/cursor-sync/login-window.ts`

- [ ] **Step 1: Implement the login window module**

```typescript
import { BrowserWindow, session } from "electron"
import { createMainLogger } from "../../log-store"

const logger = createMainLogger("cursor-login-window")

const CURSOR_LOGIN_URL = "https://cursor.com/login"
const CURSOR_COOKIE_NAME = "WorkosCursorSessionToken"
const CURSOR_DOMAIN = "cursor.com"

export interface CursorLoginResult {
  sessionToken: string | null
  cancelled: boolean
}

export function openCursorLoginWindow(parentWindow?: BrowserWindow | null): Promise<CursorLoginResult> {
  return new Promise((resolve) => {
    const partition = `cursor-login-${Date.now()}`
    const ses = session.fromPartition(partition, { cache: false })

    const win = new BrowserWindow({
      width: 800,
      height: 640,
      title: "连接 Cursor",
      parent: parentWindow ?? undefined,
      modal: false,
      show: false,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    win.setMenuBarVisibility(false)
    let resolved = false

    function finish(token: string | null, cancelled: boolean) {
      if (resolved) return
      resolved = true
      resolve({ sessionToken: token, cancelled })
      if (!win.isDestroyed()) win.close()
    }

    ses.cookies.on("changed", (_event, cookie, _cause, removed) => {
      if (removed) return
      if (cookie.name !== CURSOR_COOKIE_NAME) return
      if (!cookie.domain?.includes(CURSOR_DOMAIN)) return
      logger.info("Cursor session cookie detected")
      finish(cookie.value, false)
    })

    win.on("closed", () => {
      finish(null, true)
    })

    win.once("ready-to-show", () => win.show())
    void win.loadURL(CURSOR_LOGIN_URL)
  })
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/token-usage/cursor-sync/login-window.ts
git commit -m "feat(token-usage): add cursor login window"
```

---

## Task 3: Wire Login Window to IPC

**Files:**
- Modify: `desktop/electron/token-usage/channels.ts`
- Modify: `desktop/electron/token-usage/ipc-handlers.ts`
- Modify: `desktop/electron/preload.ts`

- [ ] **Step 1: Add cursorLogin channel**

In `desktop/electron/token-usage/channels.ts`, add before the closing `} as const`:

```typescript
  cursorLogin: "synapse:token-usage:cursor:login",
```

- [ ] **Step 2: Add cursorLogin IPC handler**

In `desktop/electron/token-usage/ipc-handlers.ts`, add the import at the top:

```typescript
import { openCursorLoginWindow } from "../services/token-usage/cursor-sync/login-window"
import { BrowserWindow } from "electron"
```

Add the handler before `handlersRegistered = true`:

```typescript
  handleValidatedIpc(TOKEN_USAGE_CHANNELS.cursorLogin, async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    return openCursorLoginWindow(parentWindow)
  })
```

- [ ] **Step 3: Add cursorLogin to preload bridge**

In `desktop/electron/preload.ts`, in the `tokenUsage` section after `cursorValidate`, add:

```typescript
    cursorLogin: invoke(IPC_CHANNELS["token-usage"].cursorLogin),
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/token-usage/channels.ts desktop/electron/token-usage/ipc-handlers.ts desktop/electron/preload.ts
git commit -m "feat(token-usage): wire cursor login window to IPC"
```

---

## Task 4: Create useCursorAccounts Hook

**Files:**
- Create: `desktop/src/modules/token-usage/hooks/use-cursor-accounts.ts`

- [ ] **Step 1: Implement the hook**

```typescript
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

interface CursorAccount {
  id: string
  label?: string
  userId?: string
  active: boolean
  createdAt: string
  lastSyncAt?: string
}

interface UseCursorAccountsReturn {
  accounts: CursorAccount[]
  loading: boolean
  syncing: boolean
  refresh: () => Promise<void>
  login: () => Promise<{ success: boolean; error?: string }>
  remove: (accountId: string) => Promise<void>
  setActive: (accountId: string) => Promise<void>
  sync: () => Promise<{ synced: boolean; rows: number; error?: string }>
}

export function useCursorAccounts(): UseCursorAccountsReturn {
  const [accounts, setAccounts] = useState<CursorAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().tokenUsage.cursorListAccounts()
      setAccounts(result)
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async () => {
    const bridge = requireSynapseBridge().tokenUsage
    const loginResult = await bridge.cursorLogin()
    if (loginResult.cancelled || !loginResult.sessionToken) {
      return { success: false }
    }
    const validation = await bridge.cursorValidate({ sessionToken: loginResult.sessionToken })
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }
    const addResult = await bridge.cursorAddAccount({
      sessionToken: loginResult.sessionToken,
      label: validation.membershipType,
    })
    if (addResult.error) {
      return { success: false, error: addResult.error }
    }
    await refresh()
    return { success: true }
  }, [refresh])

  const remove = useCallback(async (accountId: string) => {
    await requireSynapseBridge().tokenUsage.cursorRemoveAccount({ accountId })
    await refresh()
  }, [refresh])

  const setActive = useCallback(async (accountId: string) => {
    await requireSynapseBridge().tokenUsage.cursorSetActive({ accountId })
    await refresh()
  }, [refresh])

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.cursorSync()
      await refresh()
      return result
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  return { accounts, loading, syncing, refresh, login, remove, setActive, sync }
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/token-usage/hooks/use-cursor-accounts.ts
git commit -m "feat(token-usage): add useCursorAccounts hook"
```

---

## Task 5: Create CursorConnectBadge Component

**Files:**
- Create: `desktop/src/modules/token-usage/components/cursor-connect-badge.tsx`

- [ ] **Step 1: Implement the badge component**

This component shows in the toolbar area. When no accounts are connected, it shows a dashed "Cursor · 未连接" badge. When connected, it shows "Cursor · {info}" and clicking opens a Popover with account management.

```typescript
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { RefreshCw, Plus, Unlink } from "lucide-react"
import { useCursorAccounts } from "../hooks/use-cursor-accounts"

export function CursorConnectBadge({ onConnected }: { onConnected?: () => void }) {
  const { accounts, loading, syncing, login, remove, setActive, sync } = useCursorAccounts()
  const [loginInProgress, setLoginInProgress] = useState(false)
  const [open, setOpen] = useState(false)

  const connected = accounts.length > 0

  async function handleLogin() {
    setLoginInProgress(true)
    try {
      const result = await login()
      if (result.success) onConnected?.()
    } finally {
      setLoginInProgress(false)
    }
  }

  if (loading) return null

  if (!connected) {
    return (
      <button
        type="button"
        onClick={handleLogin}
        disabled={loginInProgress}
        className="border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/50 inline-flex items-center rounded-md border px-2 py-0.5 text-xs transition-colors"
      >
        {loginInProgress ? "连接中…" : "Cursor · 未连接"}
      </button>
    )
  }

  const activeAccount = accounts.find((a) => a.active) ?? accounts[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge variant="secondary" className="cursor-pointer gap-1">
          Cursor
          {activeAccount?.userId && (
            <span className="text-muted-foreground font-normal">· {activeAccount.userId}</span>
          )}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between text-sm">
              <span className={account.active ? "font-medium" : "text-muted-foreground"}>
                {account.userId ?? account.label ?? account.id.slice(0, 8)}
              </span>
              <div className="flex items-center gap-1">
                {!account.active && accounts.length > 1 && (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setActive(account.id)}>
                    激活
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-destructive h-6 w-6 p-0" onClick={() => remove(account.id)}>
                  <Unlink className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Separator className="my-2" />
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={sync} disabled={syncing}>
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            同步
          </Button>
          <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={handleLogin} disabled={loginInProgress}>
            <Plus className="h-3 w-3" />
            添加账号
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/token-usage/components/cursor-connect-badge.tsx
git commit -m "feat(token-usage): add CursorConnectBadge component"
```

---

## Task 6: Integrate Badge into Token Usage Module

**Files:**
- Modify: `desktop/src/modules/token-usage/index.tsx`

- [ ] **Step 1: Add import**

At the top of `desktop/src/modules/token-usage/index.tsx`, add:

```typescript
import { CursorConnectBadge } from "./components/cursor-connect-badge"
```

- [ ] **Step 2: Insert badge in toolbar**

In the toolbar `<div>` (line 108), insert the `CursorConnectBadge` before the `<div className="flex-1" />` spacer. The toolbar section should become:

```tsx
      <div className="flex items-center gap-2 px-4 py-2">
        {activeSubTab === "models" && (
          <GroupByPicker value={groupBy} onChange={handleGroupByChange} />
        )}
        <CursorConnectBadge onConnected={handleScan} />
        <div className="flex-1" />
        <SourcePicker clients={allClients} selected={selectedSources} onChange={setSelectedSources} />
        <DateRangeFilter value={range} onChange={handleRangeChange} />
        <ExportButton models={filteredModels} agents={filteredAgentRows} dailyRows={dailyRows} graphResult={graphResult} />
        <ScanButton scanning={scanning} onScan={handleScan} lastScanInfo={lastScanInfo} error={scanError} />
      </div>
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/token-usage/index.tsx
git commit -m "feat(token-usage): integrate CursorConnectBadge into toolbar"
```

---

## Task 7: Manual Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

- [ ] **Step 2: Verify unconnected state**

Open the token-usage module. Confirm:
- A dashed "Cursor · 未连接" badge appears in the toolbar area
- Other tabs and features still work normally

- [ ] **Step 3: Test login flow**

Click the "Cursor · 未连接" badge. Confirm:
- An Electron popup window opens to cursor.com/login
- After logging in, the popup closes automatically
- The badge changes to show "Cursor" with account info
- A scan is triggered automatically

- [ ] **Step 4: Test manage panel**

Click the connected Cursor badge. Confirm:
- A popover opens showing the account
- "同步" button triggers a sync (spinner shows)
- "添加账号" opens the login window again
- The disconnect button (unlink icon) removes the account

- [ ] **Step 5: Verify data appears in reports**

After connecting and scanning:
- Overview tab shows Cursor data in the contribution graph
- Models tab shows Cursor models
- Agents tab shows Cursor as an agent
- Source picker includes "cursor" as a filterable source

---

## Task 8: Handle Edge Cases

**Files:**
- Modify: `desktop/src/modules/token-usage/components/cursor-connect-badge.tsx`
- Modify: `desktop/electron/services/token-usage/cursor-sync/login-window.ts`

- [ ] **Step 1: Add error toast for failed login**

In `cursor-connect-badge.tsx`, update `handleLogin` to show feedback on failure. Import `toast` from sonner:

```typescript
import { toast } from "sonner"
```

Update the handler:

```typescript
  async function handleLogin() {
    setLoginInProgress(true)
    try {
      const result = await login()
      if (result.success) {
        onConnected?.()
      } else if (result.error) {
        toast.error(result.error)
      }
    } catch {
      toast.error("连接失败，请重试")
    } finally {
      setLoginInProgress(false)
    }
  }
```

- [ ] **Step 2: Add timeout to login window**

In `login-window.ts`, add a 5-minute timeout so the window doesn't hang forever if the user walks away:

After `void win.loadURL(CURSOR_LOGIN_URL)`, add:

```typescript
    const timeout = setTimeout(() => {
      logger.info("Cursor login window timed out")
      finish(null, true)
    }, 5 * 60 * 1000)

    const originalFinish = finish
    finish = (token, cancelled) => {
      clearTimeout(timeout)
      originalFinish(token, cancelled)
    }
```

Note: This requires restructuring `finish` slightly. The full updated function body should use a `let` for `finish` instead of `function`:

```typescript
    let finish = (token: string | null, cancelled: boolean) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      resolve({ sessionToken: token, cancelled })
      if (!win.isDestroyed()) win.close()
    }

    const timeout = setTimeout(() => {
      logger.info("Cursor login window timed out")
      finish(null, true)
    }, 5 * 60 * 1000)
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/token-usage/components/cursor-connect-badge.tsx desktop/electron/services/token-usage/cursor-sync/login-window.ts
git commit -m "feat(token-usage): add error handling and timeout to cursor login"
```
