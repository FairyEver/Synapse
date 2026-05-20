# License Gate Simplification + Public Key Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the server URL input from the activation UI, pin the production public key in the client, and automate key sync during builds.

**Architecture:** The license server URL becomes a hardcoded constant (overridable via env var for dev). Lease token verification uses a pinned public key instead of trusting the server's dynamic response. A build-time script fetches the current production key to keep the pinned value in sync.

**Tech Stack:** TypeScript, Node.js crypto, Vitest, shell scripts (bash)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `desktop/electron/services/license/pinned-keys.ts` | Pinned public key registry |
| Create | `desktop/electron/services/license/constants.ts` | Server URL constant + env override |
| Create | `desktop/scripts/sync-license-keys.mjs` | Build-time key sync from production |
| Modify | `desktop/electron/services/license/license-service.ts` | Use pinned keys + constant URL |
| Modify | `desktop/electron/services/license/types.ts` | Remove serverUrl from activation request |
| Modify | `desktop/electron/modules/license/ipc.ts` | Remove serverUrl from schema |
| Modify | `desktop/src/app-shell/components/license-gate.tsx` | Remove URL input field |
| Modify | `desktop/src/types/license.ts` | Remove serverUrl from frontend type |
| Modify | `desktop/scripts/dev-electron-app.mjs` | Inject SYNAPSE_LICENSE_SERVER_URL |
| Modify | `desktop/electron/services/__tests__/license-service.test.ts` | Update tests |
| Modify | `desktop/package.json` | Add sync-license-keys to build script |
| Modify | `setup.sh` | Split reset options |

---

### Task 1: Create pinned-keys module

**Files:**
- Create: `desktop/electron/services/license/pinned-keys.ts`
- Create: `desktop/electron/services/license/__tests__/pinned-keys.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// desktop/electron/services/license/__tests__/pinned-keys.test.ts
import { describe, expect, it } from "vitest"
import { findPinnedKey, hasPinnedKeys } from "../pinned-keys"

describe("pinned-keys", () => {
  it("finds the production key by keyId", () => {
    const key = findPinnedKey("prod-key-001")
    expect(key).not.toBeNull()
    expect(key!.keyId).toBe("prod-key-001")
    expect(key!.publicKey).toContain("-----BEGIN PUBLIC KEY-----")
  })

  it("returns null for unknown keyId", () => {
    expect(findPinnedKey("unknown-key")).toBeNull()
  })

  it("reports pinned keys exist", () => {
    expect(hasPinnedKeys()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm test -- --run electron/services/license/__tests__/pinned-keys.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// desktop/electron/services/license/pinned-keys.ts
export interface PinnedKey {
  readonly keyId: string
  readonly publicKey: string
}

const PINNED_KEYS: readonly PinnedKey[] = [
  {
    keyId: "prod-key-001",
    publicKey: [
      "-----BEGIN PUBLIC KEY-----",
      "MCowBQYDK2VwAyEAxRC/kjqBTMQe19knP5l1byx/jh8xTFLkXQjTbj5NOQw=",
      "-----END PUBLIC KEY-----",
    ].join("\n"),
  },
]

export function findPinnedKey(keyId: string): PinnedKey | null {
  return PINNED_KEYS.find((key) => key.keyId === keyId) ?? null
}

export function hasPinnedKeys(): boolean {
  return PINNED_KEYS.length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm test -- --run electron/services/license/__tests__/pinned-keys.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/license/pinned-keys.ts desktop/electron/services/license/__tests__/pinned-keys.test.ts
git commit -m "feat(license): add pinned public key registry"
```

---

### Task 2: Create constants module

**Files:**
- Create: `desktop/electron/services/license/constants.ts`
- Create: `desktop/electron/services/license/__tests__/constants.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// desktop/electron/services/license/__tests__/constants.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { getLicenseServerUrl, isDevLicenseServer } from "../constants"

describe("license constants", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns production URL by default", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "")
    expect(getLicenseServerUrl()).toBe("https://synapse.d2.pub")
  })

  it("returns env override when set", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "http://localhost:3000")
    expect(getLicenseServerUrl()).toBe("http://localhost:3000")
  })

  it("reports dev mode when env is set", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "http://localhost:3000")
    expect(isDevLicenseServer()).toBe(true)
  })

  it("reports production mode when env is empty", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "")
    expect(isDevLicenseServer()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm test -- --run electron/services/license/__tests__/constants.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// desktop/electron/services/license/constants.ts
const PRODUCTION_LICENSE_SERVER_URL = "https://synapse.d2.pub"

export function getLicenseServerUrl(): string {
  return process.env.SYNAPSE_LICENSE_SERVER_URL || PRODUCTION_LICENSE_SERVER_URL
}

export function isDevLicenseServer(): boolean {
  return !!process.env.SYNAPSE_LICENSE_SERVER_URL
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm test -- --run electron/services/license/__tests__/constants.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/license/constants.ts desktop/electron/services/license/__tests__/constants.test.ts
git commit -m "feat(license): add server URL constants with env override"
```

---

### Task 3: Modify LicenseService to use pinned keys and constant URL

**Files:**
- Modify: `desktop/electron/services/license/license-service.ts`
- Modify: `desktop/electron/services/license/types.ts`
- Modify: `desktop/electron/services/__tests__/license-service.test.ts`

- [ ] **Step 1: Update `DesktopLicenseActivationRequest` type**

In `desktop/electron/services/license/types.ts`, change:

```typescript
export interface DesktopLicenseActivationRequest {
  readonly email: string
  readonly activationCode: string
}
```

Remove the `serverUrl` field.

- [ ] **Step 2: Update LicenseService.activate() signature and implementation**

In `desktop/electron/services/license/license-service.ts`, add imports at the top:

```typescript
import { getLicenseServerUrl, isDevLicenseServer } from "./constants"
import { findPinnedKey } from "./pinned-keys"
```

Replace the `activate` method:

```typescript
async activate(input: DesktopLicenseActivationRequest): Promise<DesktopLicenseStatus> {
  const state = await this.ensureState()
  const serverUrl = normalizeLicenseServerUrl(getLicenseServerUrl())
  const config = await this.deps.client.getConfig(serverUrl)
  const publicKey = this.resolvePublicKey(config.keyId, config.publicKey)
  const device = createDeviceMetadata(state.deviceId, this.deps.appVersion)
  const response = await this.deps.client.redeem(serverUrl, {
    email: input.email.trim().toLowerCase(),
    activationCode: input.activationCode,
    device,
  })
  const payload = verifyLeaseForDevice(response.leaseToken, publicKey, state.deviceId)
  const nextState: CoreLicenseV1 = {
    ...state,
    serverUrl,
    email: response.email,
    publicKey,
    keyId: config.keyId,
    leaseToken: response.leaseToken,
    leaseExpiresAt: payload.expiresAt,
    deviceIdHash: response.deviceIdHash,
    activatedAt: state.activatedAt ?? this.now().toISOString(),
    lastRenewedAt: this.now().toISOString(),
  }
  await this.deps.store.setSingleton(nextState)
  return this.statusFromState(nextState)
}
```

- [ ] **Step 3: Update renewState() to use resolvePublicKey**

```typescript
private async renewState(state: CoreLicenseV1): Promise<CoreLicenseV1> {
  if (!state.serverUrl || !state.leaseToken) return state
  const config = await this.deps.client.getConfig(state.serverUrl)
  const publicKey = this.resolvePublicKey(config.keyId, config.publicKey)
  const response = await this.deps.client.renew(state.serverUrl, {
    leaseToken: state.leaseToken,
    device: createDeviceMetadata(state.deviceId, this.deps.appVersion),
  })
  const payload = verifyLeaseForDevice(response.leaseToken, publicKey, state.deviceId)
  const nextState: CoreLicenseV1 = {
    ...state,
    email: response.email,
    publicKey,
    keyId: config.keyId,
    leaseToken: response.leaseToken,
    leaseExpiresAt: payload.expiresAt,
    deviceIdHash: response.deviceIdHash,
    lastRenewedAt: this.now().toISOString(),
  }
  await this.deps.store.setSingleton(nextState)
  return nextState
}
```

- [ ] **Step 4: Add resolvePublicKey private method**

Add to the `LicenseService` class:

```typescript
private resolvePublicKey(keyId: string, serverPublicKey: string): string {
  if (isDevLicenseServer()) {
    return serverPublicKey
  }
  const pinned = findPinnedKey(keyId)
  if (!pinned) {
    throw new Error("不受信任的授权密钥。")
  }
  return pinned.publicKey
}
```

- [ ] **Step 5: Update statusFromState() for pinned key fallback**

In `statusFromState()`, replace the lease verification block:

```typescript
let payload: LicenseLeasePayload
try {
  const pinnedKey = state.keyId ? findPinnedKey(state.keyId) : null
  const verifyKey = pinnedKey ? pinnedKey.publicKey : state.publicKey
  payload = verifyLeaseForDevice(state.leaseToken, verifyKey, state.deviceId)
} catch {
  return {
    status: "invalid",
    email: state.email,
    serverUrl: state.serverUrl,
    deviceIdHash: state.deviceIdHash,
    expiresAt: state.leaseExpiresAt,
    lastRenewedAt: state.lastRenewedAt,
    message: "授权签名无效。",
  }
}
```

- [ ] **Step 6: Update existing tests — remove serverUrl from activate calls**

In `desktop/electron/services/__tests__/license-service.test.ts`:

1. Add `vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "http://localhost:3000")` in a `beforeEach` or at the top of each test that calls `activate`.

2. Change all `service.activate(...)` calls from:
```typescript
await service.activate({
  serverUrl: "http://localhost:3000",
  email: "USER@EXAMPLE.COM",
  activationCode: "ABCD-1234",
})
```
to:
```typescript
await service.activate({
  email: "USER@EXAMPLE.COM",
  activationCode: "ABCD-1234",
})
```

- [ ] **Step 7: Add test for pinned key rejection**

```typescript
it("rejects activation when keyId is not in pinned keys (production mode)", async () => {
  vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "")
  const keys = createKeys()
  const store = new MemoryNamespace<CoreLicenseV1>(null)
  const client = {
    getConfig: vi.fn().mockResolvedValue({
      keyId: "unknown-key-999",
      leaseDays: 30,
      serverTime: "2026-04-29T00:00:00.000Z",
      publicKey: keys.publicKey,
    }),
    redeem: vi.fn(),
    renew: vi.fn(),
  } as unknown as LicenseClient

  const service = new LicenseService({
    store,
    client,
    appVersion: "0.0.0",
    idFactory: () => "device-1",
    now: () => new Date("2026-04-29T00:00:00.000Z"),
  })

  await expect(service.activate({
    email: "user@example.com",
    activationCode: "ABCD-1234",
  })).rejects.toThrow("不受信任的授权密钥。")
})
```

- [ ] **Step 8: Add test for dev mode bypassing pinning**

```typescript
it("allows any server key in dev mode", async () => {
  vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "http://localhost:3000")
  const keys = createKeys()
  const deviceId = "device-1"
  const leaseToken = signLease({
    tokenId: "token-1",
    accountId: "account-1",
    email: "user@example.com",
    licenseId: "license-1",
    deviceIdHash: hashDeviceId(deviceId),
    issuedAt: "2026-04-29T00:00:00.000Z",
    expiresAt: "2026-05-29T00:00:00.000Z",
    maxDevices: 1,
    licenseStatus: "active",
    keyId: "dev-local-key",
  }, keys.privateKey)
  const store = new MemoryNamespace<CoreLicenseV1>(null)
  const client = {
    getConfig: vi.fn().mockResolvedValue({
      keyId: "dev-local-key",
      leaseDays: 7,
      serverTime: "2026-04-29T00:00:00.000Z",
      publicKey: keys.publicKey,
    }),
    redeem: vi.fn().mockResolvedValue({
      email: "user@example.com",
      deviceIdHash: hashDeviceId(deviceId),
      leaseToken,
    }),
    renew: vi.fn(),
  } as unknown as LicenseClient

  const service = new LicenseService({
    store,
    client,
    appVersion: "0.0.0",
    idFactory: () => deviceId,
    now: () => new Date("2026-04-29T00:00:00.000Z"),
  })

  await expect(service.activate({
    email: "user@example.com",
    activationCode: "ABCD-1234",
  })).resolves.toMatchObject({ status: "active" })
})
```

- [ ] **Step 9: Run all license tests**

Run: `cd desktop && pnpm test -- --run electron/services/__tests__/license-service.test.ts electron/services/license/__tests__/pinned-keys.test.ts electron/services/license/__tests__/constants.test.ts`
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/services/license/license-service.ts desktop/electron/services/license/types.ts desktop/electron/services/__tests__/license-service.test.ts
git commit -m "feat(license): use pinned keys and constant server URL"
```

---

### Task 4: Update IPC layer

**Files:**
- Modify: `desktop/electron/modules/license/ipc.ts`

- [ ] **Step 1: Remove serverUrl from activationRequestSchema**

In `desktop/electron/modules/license/ipc.ts`, change:

```typescript
const activationRequestSchema = z.object({
  email: z.string().email(),
  activationCode: z.string().min(1),
})
```

Remove the `serverUrl: z.string().min(1)` line.

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS (or errors only in license-gate.tsx which we fix in Task 5)

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/modules/license/ipc.ts
git commit -m "feat(license): remove serverUrl from IPC activation schema"
```

---

### Task 5: Simplify activation UI

**Files:**
- Modify: `desktop/src/app-shell/components/license-gate.tsx`
- Modify: `desktop/src/types/license.ts`

- [ ] **Step 1: Update frontend type**

In `desktop/src/types/license.ts`, change `SynapseLicenseActivationRequest`:

```typescript
export interface SynapseLicenseActivationRequest {
  readonly email: string
  readonly activationCode: string
}
```

Remove the `serverUrl` field.

- [ ] **Step 2: Simplify license-gate.tsx**

Replace the full content of `desktop/src/app-shell/components/license-gate.tsx`:

```tsx
import { type FormEvent, type ReactNode, useState } from "react"
import { KeyRound, LoaderCircle } from "lucide-react"
import { formatLicenseErrorMessage, useLicense } from "@/app-shell/license"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function LicenseScreenShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        {children}
      </Card>
    </main>
  )
}

export function LicenseGate({ children }: { readonly children: ReactNode }) {
  const { activate, error, isReady, renew, status } = useLicense()
  const [email, setEmail] = useState("")
  const [activationCode, setActivationCode] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRenewing, setIsRenewing] = useState(false)

  if (!isReady) {
    return (
      <LicenseScreenShell>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          正在读取授权
        </CardContent>
      </LicenseScreenShell>
    )
  }

  if (status?.status === "active") {
    return <>{children}</>
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setFormError(null)
    try {
      const result = await activate({ email, activationCode })
      if (result.status !== "active") {
        setFormError(result.message ?? "授权未生效。")
      }
    } catch (caught) {
      setFormError(formatLicenseErrorMessage(caught, "激活失败。"))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRenew() {
    setIsRenewing(true)
    setFormError(null)
    try {
      const result = await renew()
      if (result.status !== "active") {
        setFormError(result.message ?? "续租失败。")
      }
    } catch (caught) {
      setFormError(formatLicenseErrorMessage(caught, "续租失败。"))
    } finally {
      setIsRenewing(false)
    }
  }

  return (
    <LicenseScreenShell>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound />
          授权激活
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-2" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="license-email">邮箱</Label>
            <Input
              id="license-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="license-code">激活码</Label>
            <Input
              id="license-code"
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value)}
              required
            />
          </div>
          {status?.message ? <p className="text-sm text-muted-foreground">{status.message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {status?.serverUrl && status.status !== "not_activated" ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting || isRenewing}
                onClick={handleRenew}
              >
                续租
              </Button>
            ) : null}
            <Button type="submit" disabled={isSubmitting || isRenewing}>
              激活
            </Button>
          </div>
          {status?.expiresAt ? (
            <p className="text-sm text-muted-foreground">到期：{formatDate(status.expiresAt)}</p>
          ) : null}
        </form>
      </CardContent>
    </LicenseScreenShell>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/src/app-shell/components/license-gate.tsx desktop/src/types/license.ts
git commit -m "feat(license): remove server URL from activation UI"
```

---

### Task 6: Inject env var in dev script

**Files:**
- Modify: `desktop/scripts/dev-electron-app.mjs`

- [ ] **Step 1: Add SYNAPSE_LICENSE_SERVER_URL to nodemon env**

In `desktop/scripts/dev-electron-app.mjs`, find the nodemon spawn (line 91-97) and add the env var:

```javascript
const nodemon = spawn(pnpmCommand, ["exec", "nodemon"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
    SYNAPSE_LICENSE_SERVER_URL: process.env.SYNAPSE_LICENSE_SERVER_URL ?? "http://localhost:3000",
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add desktop/scripts/dev-electron-app.mjs
git commit -m "feat(license): auto-inject local server URL in dev mode"
```

---

### Task 7: Create build-time key sync script

**Files:**
- Create: `desktop/scripts/sync-license-keys.mjs`
- Modify: `desktop/package.json`

- [ ] **Step 1: Write the sync script**

```javascript
// desktop/scripts/sync-license-keys.mjs
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const PRODUCTION_URL = "https://synapse.d2.pub/v1/license/config"
const PINNED_KEYS_PATH = path.resolve("electron/services/license/pinned-keys.ts")

async function main() {
  console.log(">>> 同步生产环境公钥...")

  const response = await fetch(PRODUCTION_URL, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`)
  }

  const config = await response.json()
  const { keyId, publicKey } = config

  if (!keyId || !publicKey) {
    throw new Error("服务器返回的配置缺少 keyId 或 publicKey")
  }

  const normalizedKey = normalizePublicKey(publicKey)
  console.log(`  keyId: ${keyId}`)
  console.log(`  publicKey: ${normalizedKey.split("\n")[1]}...`)

  const source = readFileSync(PINNED_KEYS_PATH, "utf8")

  if (source.includes(`keyId: "${keyId}"`)) {
    const keyLineMatch = source.match(
      new RegExp(`keyId: "${keyId}"[\\s\\S]*?publicKey: \\[([\\s\\S]*?)\\]\\.join`)
    )
    if (keyLineMatch) {
      const existingBase64 = keyLineMatch[1].match(/"([A-Za-z0-9+/=]+)"/)?.[1]
      const newBase64 = normalizedKey.split("\n")[1]
      if (existingBase64 && existingBase64 !== newBase64) {
        throw new Error(
          `keyId "${keyId}" 已存在但公钥不一致！\n` +
          `  已有: ${existingBase64}\n` +
          `  服务器: ${newBase64}\n` +
          `请确认服务器配置是否正确。`
        )
      }
    }
    console.log(`  keyId "${keyId}" 已存在且一致，跳过。`)
    return
  }

  const newEntry = [
    `  {`,
    `    keyId: "${keyId}",`,
    `    publicKey: [`,
    `      "-----BEGIN PUBLIC KEY-----",`,
    `      "${normalizedKey.split("\n")[1]}",`,
    `      "-----END PUBLIC KEY-----",`,
    `    ].join("\\n"),`,
    `  },`,
  ].join("\n")

  const updated = source.replace(
    /const PINNED_KEYS: readonly PinnedKey\[\] = \[/,
    `const PINNED_KEYS: readonly PinnedKey[] = [\n${newEntry}`
  )

  writeFileSync(PINNED_KEYS_PATH, updated, "utf8")
  console.log(`  已追加 keyId "${keyId}" 到 pinned-keys.ts`)
}

function normalizePublicKey(raw) {
  const cleaned = raw
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "")
  return `-----BEGIN PUBLIC KEY-----\n${cleaned}\n-----END PUBLIC KEY-----`
}

main().catch((error) => {
  console.error("❌ 公钥同步失败:", error.message)
  process.exit(1)
})
```

- [ ] **Step 2: Add to build script in package.json**

In `desktop/package.json`, change the `build` script:

```json
"build": "node scripts/sync-license-keys.mjs && pnpm generate:definitions-registry && pnpm build:renderer && pnpm build:electron && pnpm build:database"
```

- [ ] **Step 3: Test the script manually**

Run: `cd desktop && node scripts/sync-license-keys.mjs`
Expected: prints "keyId "prod-key-001" 已存在且一致，跳过。"

- [ ] **Step 4: Commit**

```bash
git add desktop/scripts/sync-license-keys.mjs desktop/package.json
git commit -m "feat(license): add build-time public key sync script"
```

---

### Task 8: Optimize setup.sh — split reset options

**Files:**
- Modify: `setup.sh`

- [ ] **Step 1: Replace the reset menu section**

Replace lines 13-37 of `setup.sh` (the existing menu) with:

```bash
if [ -f .env ]; then
  echo "检测到已有配置，请选择操作："
  echo "  1) 重置数据库（保留密钥和配置）"
  echo "  2) 完全重置（清除所有数据，重新生成密钥）"
  echo "  3) 退出"
  read -p "输入选项 [1/2/3]: " CHOICE

  case $CHOICE in
    1)
      echo ""
      echo "⚠️  这将删除数据库所有数据，但保留密钥和管理员配置"
      read -p "确认重置数据库？[y/N]: " CONFIRM
      if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "已取消"
        exit 0
      fi
      echo ""
      echo ">>> 重建数据库容器..."
      docker compose down -v 2>/dev/null || true
      docker compose --env-file .env up -d --build
      echo ""
      echo ">>> 等待服务启动..."
      sleep 8
      curl -sf http://127.0.0.1:3000/healthz && echo " ✅ 服务正常" || echo " ❌ 服务未就绪，查看日志: docker compose logs server"
      exit 0
      ;;
    2)
      echo ""
      echo "⚠️  这将删除数据库所有数据并重新生成密钥"
      read -p "确认完全重置？[y/N]: " CONFIRM
      if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "已取消"
        exit 0
      fi
      echo ""
      echo ">>> 停止服务并清除数据..."
      docker compose down -v 2>/dev/null || true
      rm -f .env
      echo ""
      ;;
    *)
      exit 0
      ;;
  esac
fi
```

- [ ] **Step 2: Commit**

```bash
git add setup.sh
git commit -m "feat(server): split reset into db-only and full-reset options"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd desktop && pnpm test -- --run`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `cd desktop && pnpm build`
Expected: PASS (sync-license-keys fetches prod key, build completes)

- [ ] **Step 4: Manual smoke test**

Run: `cd desktop && pnpm dev`
- Verify the activation screen shows only email + activation code fields
- Verify no server URL input is visible
- Verify the app connects to localhost:3000 for license validation in dev mode

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(license): address verification issues"
```
