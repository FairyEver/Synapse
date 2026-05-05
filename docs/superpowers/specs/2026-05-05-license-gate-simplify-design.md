# 激活界面简化 + 公钥 Pinning

## 背景

激活界面暴露了「服务器 URL」输入框，普通用户无用且存在安全风险：用户可自建假服务器，返回自签公钥和 lease token，完全绕过授权验证。当前信任链的漏洞在于公钥从 server 动态获取，没有任何 pinning。

## 目标

1. 激活界面只保留「邮箱」+「激活码」，移除服务器 URL 输入
2. 客户端内嵌生产公钥，验证 lease token 时只信任 pinned key
3. 开发环境通过环境变量自动连接本地 server，无需手动配置

## 设计

### 1. 渲染进程 — 激活界面

**文件：** `desktop/src/app-shell/components/license-gate.tsx`

- 删除 `DEFAULT_LICENSE_SERVER_URL` 常量
- 删除 `serverUrl` state 和对应的 `<Input>`
- `handleSubmit` 中 `activate()` 只传 `{ email, activationCode }`
- 删除 `useEffect` 中对 `status.serverUrl` 的回填

**文件：** `desktop/src/types/license.ts`

- `SynapseLicenseActivationRequest` 移除 `serverUrl` 字段

### 2. 主进程 — 公钥 Pinning

**新增文件：** `desktop/electron/services/license/pinned-keys.ts`

```typescript
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

**密钥轮换流程：** 在 `PINNED_KEYS` 数组中追加新 key，发版后旧 key 保留至存量 lease 过期。

### 3. 主进程 — Server URL 常量化

**新增文件：** `desktop/electron/services/license/constants.ts`

```typescript
const PRODUCTION_LICENSE_SERVER_URL = "https://synapse.d2.pub"

export function getLicenseServerUrl(): string {
  return process.env.SYNAPSE_LICENSE_SERVER_URL || PRODUCTION_LICENSE_SERVER_URL
}

export function isDevLicenseServer(): boolean {
  return !!process.env.SYNAPSE_LICENSE_SERVER_URL
}
```

### 4. 主进程 — LicenseService 改造

**文件：** `desktop/electron/services/license/license-service.ts`

`activate()` 方法改动：

```typescript
async activate(input: { email: string; activationCode: string }): Promise<DesktopLicenseStatus> {
  const state = await this.ensureState()
  const serverUrl = normalizeLicenseServerUrl(getLicenseServerUrl())
  const config = await this.deps.client.getConfig(serverUrl)

  // 公钥 pinning：生产模式下必须匹配 pinned key
  const publicKey = this.resolvePublicKey(config.keyId, config.publicKey)

  const device = createDeviceMetadata(state.deviceId, this.deps.appVersion)
  const response = await this.deps.client.redeem(serverUrl, { ... })
  const payload = verifyLeaseForDevice(response.leaseToken, publicKey, state.deviceId)

  // 存储时写入 pinned key（非 server 返回的 key）
  const nextState: CoreLicenseV1 = {
    ...state,
    serverUrl,
    publicKey,
    keyId: config.keyId,
    ...
  }
}
```

新增 `resolvePublicKey` 私有方法：

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

`renewState()` 同理：验证签名时使用 `resolvePublicKey`。

`statusFromState()` 中对存量用户的验证：

- 如果 `state.keyId` 能匹配到 pinned key，用 pinned key 验证
- 如果匹配不到（过渡期），回退到 `state.publicKey`（已存储的值）

### 5. IPC 层

**文件：** `desktop/electron/modules/license/ipc.ts`

```typescript
const activationRequestSchema = z.object({
  email: z.string().email(),
  activationCode: z.string().min(1),
})
```

移除 `serverUrl` 字段。

### 6. 开发环境自动配置

**文件：** `desktop/scripts/dev-electron-app.mjs`

在 nodemon 启动时注入环境变量：

```javascript
const nodemon = spawn(pnpmCommand, ["exec", "nodemon"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
    SYNAPSE_LICENSE_SERVER_URL: "http://localhost:3000",
  },
})
```

效果：`pnpm dev` 时自动连本地 server，使用 server 返回的公钥（开发密钥对），无需任何手动配置。

### 7. 类型清理

**文件：** `desktop/electron/services/license/types.ts`

```typescript
export interface DesktopLicenseActivationRequest {
  readonly email: string
  readonly activationCode: string
}
```

移除 `serverUrl`。

## 存量用户兼容

- 已激活用户的 `CoreLicenseV1` 中存有 `serverUrl`、`publicKey`、`keyId`
- 续租和 validate 请求继续使用存储的 `serverUrl` 作为网络目标
- 签名验证优先用 pinned key（按 keyId 查找），找不到时回退存储的 publicKey
- 无需数据迁移，无需用户重新激活

## 安全模型

| 场景 | 行为 |
|------|------|
| 正常用户激活 | 连生产 server，用 pinned key 验证签名 |
| 用户试图自建 server | 无 UI 入口设置 URL；即使修改二进制，server 返回的 keyId 不在 pinned list 中，拒绝 |
| 开发者本地调试 | 环境变量覆盖 URL，跳过 pinning，使用 server 返回的公钥 |
| 密钥轮换 | 新 key 加入 pinned list，发版，旧 key 保留过渡期 |

## 测试

- 更新 `license-service.test.ts`：activate 不再传 serverUrl
- 新增测试：pinned key 匹配/不匹配场景
- 新增测试：开发模式跳过 pinning
- 新增测试：存量用户 keyId 回退逻辑
