# HTTP 请求编辑器升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 升级 `HttpRequestConfigForm` 共享组件——自建 KV 表格编辑器、集成 CodeMirror JSON 编辑器、增加认证支持和请求测试功能

**Architecture:** 在 `action-packages/builtin/http-request/` 下新增 4 个组件文件 + 更新主表单壳层；添加简单 IPC handler 支持请求测试；更新两个 executor 以处理 auth 配置；调整 workflow panel 移除冗余外层包裹

**Tech Stack:** React 19, shadcn/ui, @uiw/react-codemirror, @codemirror/lang-json, Zod, Electron IPC

---

### Task 1: 安装新依赖

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: 安装 CodeMirror 依赖**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm add @uiw/react-codemirror@^4.23.0 @codemirror/lang-json@^6.0.1 @codemirror/theme-one-dark@^6.1.0
```

- [ ] **Step 2: 验证安装成功**

```bash
pnpm ls -r --depth 0 | grep codemirror
```
Expected: 显示三个包已安装

---

### Task 2: Schema 更新 — 添加 auth 字段

**Files:**
- Modify: `action-packages/builtin/http-request/schema.ts`
- Modify: `action-packages/builtin/http-request/manifest.ts`

- [ ] **Step 1: 更新 schema.ts**

```typescript
// action-packages/builtin/http-request/schema.ts
import { z } from "zod"

export const httpRequestActionConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  bodyType: z.enum(["none", "json", "text"]),
  body: z.string().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
  auth: z.object({
    type: z.enum(["none", "bearer", "basic"]),
    bearerToken: z.string().optional(),
    basicUsername: z.string().optional(),
    basicPassword: z.string().optional(),
  }).optional(),
})

export type HttpRequestActionConfig = z.infer<typeof httpRequestActionConfigSchema>
```

- [ ] **Step 2: 更新 manifest.ts — 添加 auth 字段描述**

```typescript
// action-packages/builtin/http-request/manifest.ts
// 在 configFields 数组末尾追加
{ name: "auth", kind: "json", required: false, description: "Auth configuration (bearer token or basic auth)." },
```

- [ ] **Step 3: 类型检查**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add action-packages/builtin/http-request/schema.ts action-packages/builtin/http-request/manifest.ts
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): add auth field to schema and manifest"
```

---

### Task 3: 创建 KV Editor 组件

**Files:**
- Create: `action-packages/builtin/http-request/kv-editor.tsx`
- Test: (tested via integration in config.renderer.tsx)

- [ ] **Step 1: 创建 kv-editor.tsx**

```tsx
// action-packages/builtin/http-request/kv-editor.tsx

import { Button } from "../../../src/components/ui/button"
import { Input } from "../../../src/components/ui/input"
import { X } from "lucide-react"

interface KvEditorProps {
  readonly value: Record<string, string>
  readonly onChange: (value: Record<string, string>) => void
  readonly keyPlaceholder?: string
  readonly valuePlaceholder?: string
  readonly addButtonLabel?: string
  readonly emptyMessage?: string
}

export function KvEditor({
  value,
  onChange,
  keyPlaceholder = "键",
  valuePlaceholder = "值",
  addButtonLabel = "+ 添加",
  emptyMessage = "暂无数据",
}: KvEditorProps) {
  const entries = Object.entries(value)

  const upsert = (index: number, key: string, val: string) => {
    const next = { ...value }
    // If key changed and old key exists, remove old key
    const oldKey = entries[index]?.[0]
    if (oldKey !== undefined && oldKey !== key) {
      delete next[oldKey]
    }
    if (key) {
      next[key] = val
    }
    onChange(next)
  }

  const remove = (key: string) => {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  const add = () => {
    onChange({ ...value, "": "" })
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs justify-start" onClick={add}>
          {addButtonLabel}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {entries.map(([key, val], index) => (
        <div key={index} className="flex items-center gap-1">
          <code className="min-w-[80px] max-w-[120px] truncate text-xs text-muted-foreground shrink-0">
            {key}
          </code>
          <Input
            className="h-7 text-xs flex-1 min-w-0"
            value={val}
            placeholder={valuePlaceholder}
            onChange={(e) => upsert(index, key, e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={() => remove(key)}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs justify-start" onClick={add}>
        {addButtonLabel}
      </Button>
    </div>
  )
}
```

Note: The `key` is displayed as read-only `<code>` since we're using `Record<string, string>` which maps unique keys. If the user needs to edit keys, the data structure would need to change to `Array<{ key: string; value: string }>`. For now, display-only keys match the UX goal of editing values (most common case). Users delete and re-add if they need to change a key.

- [ ] **Step 2: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add action-packages/builtin/http-request/kv-editor.tsx
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): create KV editor component for query/headers"
```

---

### Task 4: 创建 JSON Editor 组件

**Files:**
- Create: `action-packages/builtin/http-request/code-json-editor.tsx`

- [ ] **Step 1: 创建 code-json-editor.tsx**

```tsx
// action-packages/builtin/http-request/code-json-editor.tsx

import { useCallback } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { oneDark } from "@codemirror/theme-one-dark"
import { Button } from "../../../src/components/ui/button"
import { useTheme } from "../../../src/app-shell/theme-provider"

interface CodeJsonEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly minHeight?: string
  readonly maxHeight?: string
}

export function CodeJsonEditor({
  value,
  onChange,
  minHeight = "120px",
  maxHeight = "360px",
}: CodeJsonEditorProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(value)
      onChange(JSON.stringify(parsed, null, 2))
    } catch {
      // ignore — invalid JSON, don't format
    }
  }, [value, onChange])

  const isValidJson = useCallback(() => {
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }, [value])

  return (
    <div className="relative group">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[json()]}
        theme={isDark ? oneDark : undefined}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          syntaxHighlighting: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          highlightActiveLine: false,
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-1 right-1 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleFormat}
        disabled={!isValidJson()}
      >
        格式化
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add action-packages/builtin/http-request/code-json-editor.tsx
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): create CodeMirror JSON editor component"
```

---

### Task 5: 创建 Auth Fields 组件

**Files:**
- Create: `action-packages/builtin/http-request/auth-fields.tsx`

- [ ] **Step 1: 创建 auth-fields.tsx**

```tsx
// action-packages/builtin/http-request/auth-fields.tsx

import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"

interface AuthConfig {
  readonly type: "none" | "bearer" | "basic"
  readonly bearerToken?: string
  readonly basicUsername?: string
  readonly basicPassword?: string
}

interface AuthFieldsProps {
  readonly value: AuthConfig | undefined
  readonly onChange: (value: AuthConfig | undefined) => void
  readonly idPrefix?: string
}

const AUTH_TYPE_OPTIONS: Array<{ label: string; value: AuthConfig["type"] }> = [
  { label: "无", value: "none" },
  { label: "Bearer Token", value: "bearer" },
  { label: "Basic Auth", value: "basic" },
]

export function AuthFields({ value, onChange, idPrefix = "auth" }: AuthFieldsProps) {
  const auth = value ?? { type: "none" as const }

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        aria-label="认证类型"
        className="w-full"
        type="single"
        value={auth.type}
        variant="outline"
        onValueChange={(type) => {
          if (type) onChange({ type: type as AuthConfig["type"] })
        }}
      >
        {AUTH_TYPE_OPTIONS.map((opt) => (
          <ToggleGroupItem key={opt.value} className="flex-1" value={opt.value} id={`${idPrefix}-type-${opt.value}`}>
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {auth.type === "bearer" && (
        <Input
          id={`${idPrefix}-bearer-token`}
          type="password"
          placeholder="Bearer Token"
          className="h-8 text-xs"
          value={auth.bearerToken ?? ""}
          onChange={(e) => onChange({ ...auth, bearerToken: e.target.value })}
        />
      )}

      {auth.type === "basic" && (
        <div className="flex flex-col gap-2">
          <Input
            id={`${idPrefix}-basic-username`}
            placeholder="Username"
            className="h-8 text-xs"
            value={auth.basicUsername ?? ""}
            onChange={(e) => onChange({ ...auth, basicUsername: e.target.value })}
          />
          <Input
            id={`${idPrefix}-basic-password`}
            type="password"
            placeholder="Password"
            className="h-8 text-xs"
            value={auth.basicPassword ?? ""}
            onChange={(e) => onChange({ ...auth, basicPassword: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add action-packages/builtin/http-request/auth-fields.tsx
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): create auth fields component"
```

---

### Task 6: 创建 HTTP 测试请求 IPC + Request Tester 组件

**Files:**
- Create: `electron/modules/http-test/ipc.ts`
- Modify: `electron/bootstrap/descriptors.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/bridge.ts`
- Create: `action-packages/builtin/http-request/request-tester.tsx`

- [ ] **Step 1: 创建 IPC handler**

```typescript
// electron/modules/http-test/ipc.ts

import { handleValidatedIpc } from "../../ipc/validated-ipc"
import { sendOutboundHttpRequest } from "../../runtime/network"
import type { HttpRequestActionConfig } from "../../../action-packages/builtin/http-request/schema"

export const HTTP_TEST_CHANNEL = "synapse:http:test-request"

export interface HttpTestResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly durationMs: number
}

function buildUrl(config: HttpRequestActionConfig): string {
  const url = new URL(config.url)
  if (config.query) {
    for (const [key, value] of Object.entries(config.query)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function buildBody(config: HttpRequestActionConfig): string | undefined {
  if (config.bodyType === "none") return undefined
  return config.body
}

function buildHeaders(config: HttpRequestActionConfig): Record<string, string> | undefined {
  let headers = config.headers ? { ...config.headers } : {}

  // Merge auth into headers
  if (config.auth?.type === "bearer" && config.auth.bearerToken) {
    headers["Authorization"] = `Bearer ${config.auth.bearerToken}`
  } else if (config.auth?.type === "basic" && config.auth.basicUsername) {
    const encoded = Buffer.from(`${config.auth.basicUsername}:${config.auth.basicPassword ?? ""}`).toString("base64")
    headers["Authorization"] = `Basic ${encoded}`
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

export function registerHttpTestHandlers(): void {
  handleValidatedIpc(HTTP_TEST_CHANNEL, async (_event, config: HttpRequestActionConfig): Promise<HttpTestResponse> => {
    const startedAt = performance.now()
    const response = await sendOutboundHttpRequest({
      method: config.method,
      url: buildUrl(config),
      headers: buildHeaders(config),
      body: buildBody(config),
      timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers ?? {},
      body: response.body ?? "",
      durationMs: Math.round(performance.now() - startedAt),
    }
  })
}
```

- [ ] **Step 2: 在 bootstrap 中注册 handler**

修改 `electron/bootstrap/descriptors.ts`：

```typescript
// 文件顶部添加导入（在现有 database 导入附近）
import { registerHttpTestHandlers } from "../modules/http-test/ipc"

// 在 initDatabase 调用之后添加：
// (在 initDatabase(eventBus, actionRouter) 后)
registerHttpTestHandlers()
```

具体位置：`electron/bootstrap/descriptors.ts` 中 `await initDatabase(eventBus, actionRouter)` 之后（约第 342 行）。注意 `registerHttpTestHandlers()` 不需要 await 且不依赖 eventBus 或 actionRouter。

- [ ] **Step 3: 更新 preload.ts — 添加通道 + bridge 方法**

在 `electron/preload.ts` 中：

```typescript
// 在 DATABASE_CHANNELS 声明块附近添加
const HTTP_CHANNELS = {
  testRequest: "synapse:http:test-request",
} as const

// 在 synapseBridge 对象中添加:
http: {
  testRequest: invoke(HTTP_CHANNELS.testRequest),
},
```

- [ ] **Step 4: 更新 SynapseBridge 类型**

在 `src/types/bridge.ts` 的 `SynapseBridge` 类型中添加 `http` 域：

```typescript
http: {
  testRequest: (config: Record<string, unknown>) => Promise<{
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
    durationMs: number
  }>
}
```

- [ ] **Step 5: 创建 Request Tester UI 组件**

```tsx
// action-packages/builtin/http-request/request-tester.tsx

import { useState } from "react"
import { Button } from "../../../src/components/ui/button"
import { Loader2, Play } from "lucide-react"
import type { HttpRequestActionConfig } from "./schema"

interface HttpTestResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly durationMs: number
}

export function RequestTester({ config }: { readonly config: HttpRequestActionConfig }) {
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<HttpTestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const handleTest = async () => {
    setLoading(true)
    setError(null)
    setResponse(null)
    setExpanded(true)
    try {
      const bridge = (window as unknown as { synapse: { http: { testRequest: (c: HttpRequestActionConfig) => Promise<HttpTestResponse> } } }).synapse
      const res = await bridge.http.testRequest(config)
      setResponse(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // ... rest stays the same
```

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs gap-1"
        onClick={handleTest}
        disabled={loading}
      >
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
        {loading ? "发送中…" : "发送测试"}
      </Button>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-xs text-destructive font-medium">请求失败</p>
          <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
        </div>
      )}

      {response && (
        <div className="rounded border p-2">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left"
            onClick={() => setExpanded(!expanded)}
          >
            <span className={`text-xs font-mono font-medium ${response.status >= 400 ? "text-destructive" : response.status >= 300 ? "text-yellow-600" : "text-green-600"}`}>
              {response.status} {response.statusText}
            </span>
            <span className="text-xs text-muted-foreground">· {response.durationMs}ms</span>
          </button>
          {expanded && response.body && (
            <pre className="mt-1 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {formatResponseBody(response.body)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function formatResponseBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
```

- [ ] **Step 6: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add electron/modules/http-test/ipc.ts electron/bootstrap/descriptors.ts electron/preload.ts src/types/bridge.ts action-packages/builtin/http-request/request-tester.tsx
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): add request tester IPC and UI component"
```

---

### Task 7: 更新 config.renderer.tsx — 表单壳层

**Files:**
- Modify: `action-packages/builtin/http-request/config.renderer.tsx`

- [ ] **Step 1: 重写 config.renderer.tsx**

```tsx
// action-packages/builtin/http-request/config.renderer.tsx

import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { Separator } from "../../../src/components/ui/separator"
import type { HttpRequestActionConfig } from "./schema"
import { KvEditor } from "./kv-editor"
import { CodeJsonEditor } from "./code-json-editor"
import { AuthFields } from "./auth-fields"
import { RequestTester } from "./request-tester"

const HTTP_METHOD_OPTIONS: Array<{ label: string; value: HttpRequestActionConfig["method"] }> = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
  { label: "PUT", value: "PUT" },
  { label: "PATCH", value: "PATCH" },
  { label: "DELETE", value: "DELETE" },
]

const BODY_TYPE_OPTIONS: Array<{ label: string; value: HttpRequestActionConfig["bodyType"] }> = [
  { label: "无", value: "none" },
  { label: "JSON", value: "json" },
  { label: "Text", value: "text" },
]

export function HttpRequestConfigForm({
  value,
  onChange,
  idPrefix = "task-action-http",
}: {
  readonly value: HttpRequestActionConfig
  readonly onChange: (value: HttpRequestActionConfig) => void
  readonly idPrefix?: string
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Method + URL */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup
            aria-label="方法"
            className="shrink-0"
            type="single"
            value={value.method}
            variant="outline"
            onValueChange={(method) => {
              if (method) onChange({ ...value, method: method as HttpRequestActionConfig["method"] })
            }}
          >
            {HTTP_METHOD_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                id={`${idPrefix}-method-${opt.value}`}
                className="px-2 py-1 text-xs h-7"
                value={opt.value}
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Input
          id={`${idPrefix}-url`}
          placeholder="https://api.example.com/v1/endpoint"
          className="h-8 text-xs"
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
        />
      </div>

      <Separator />

      {/* Auth */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">认证</p>
        <AuthFields
          value={value.auth}
          onChange={(auth) => onChange({ ...value, auth })}
          idPrefix={idPrefix}
        />
      </div>

      <Separator />

      {/* Query */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Query</p>
        <KvEditor
          value={value.query ?? {}}
          onChange={(query) => onChange({ ...value, query: Object.keys(query).length > 0 ? query : undefined })}
          keyPlaceholder="参数名"
          valuePlaceholder="参数值"
          addButtonLabel="+ 添加参数"
          emptyMessage="无查询参数"
        />
      </div>

      <Separator />

      {/* Headers */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Headers</p>
        <KvEditor
          value={value.headers ?? {}}
          onChange={(headers) => onChange({ ...value, headers: Object.keys(headers).length > 0 ? headers : undefined })}
          keyPlaceholder="Header 名"
          valuePlaceholder="Header 值"
          addButtonLabel="+ 添加 Header"
          emptyMessage="无自定义 Header"
        />
      </div>

      <Separator />

      {/* Body */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">Body</p>
          <ToggleGroup
            aria-label="Body"
            className="ml-auto"
            type="single"
            value={value.bodyType}
            variant="outline"
            onValueChange={(bodyType) => {
              if (bodyType) onChange({ ...value, bodyType: bodyType as HttpRequestActionConfig["bodyType"] })
            }}
          >
            {BODY_TYPE_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                id={`${idPrefix}-body-type-${opt.value}`}
                className="px-2 py-1 text-xs h-7"
                value={opt.value}
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {value.bodyType === "json" ? (
          <CodeJsonEditor
            value={value.body ?? ""}
            onChange={(body) => onChange({ ...value, body })}
          />
        ) : value.bodyType === "text" ? (
          <Textarea
            id={`${idPrefix}-body`}
            rows={4}
            className="text-xs"
            value={value.body ?? ""}
            onChange={(e) => onChange({ ...value, body: e.target.value })}
          />
        ) : null}
      </div>

      <Separator />

      {/* Timeout */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground shrink-0">超时分钟</p>
        <Input
          id={`${idPrefix}-timeout`}
          type="number"
          min={1}
          className="h-8 w-20 text-xs"
          value={value.timeoutMins ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              timeoutMins: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </div>

      <Separator />

      {/* Request Tester */}
      <RequestTester config={value} />
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add action-packages/builtin/http-request/config.renderer.tsx
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): upgrade config form with KV editor, JSON editor, auth, and tester"
```

---

### Task 8: 更新两个执行器 — 添加 auth→headers 合并

**Files:**
- Modify: `action-packages/builtin/http-request/executor.main.ts`
- Modify: `workflow-nodes/http-request/executor.main.ts`

- [ ] **Step 1: 更新 action executor**

在 `action-packages/builtin/http-request/executor.main.ts` 中，`buildUrl` 和 `buildBody` 保持不动，`buildHeaders` 函数需要添加 auth 合并逻辑。

在文件顶部附近添加辅助函数：

```typescript
function buildHeaders(config: HttpRequestActionConfig): Record<string, string> | undefined {
  let headers = config.headers ? { ...config.headers } : {}

  if (config.auth?.type === "bearer" && config.auth.bearerToken) {
    headers["Authorization"] = `Bearer ${config.auth.bearerToken}`
  } else if (config.auth?.type === "basic" && config.auth.basicUsername) {
    const encoded = Buffer.from(`${config.auth.basicUsername}:${config.auth.basicPassword ?? ""}`).toString("base64")
    headers["Authorization"] = `Basic ${encoded}`
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}
```

将 `execute` 方法中的 `headers: config.headers` 替换为 `headers: buildHeaders(config)`。

- [ ] **Step 2: 更新 workflow node executor**

同样操作在 `workflow-nodes/http-request/executor.main.ts` 中。

找到 `runtimeDeps.sendHttpRequest({` 调用，将 `headers: config.headers` 替换为 `headers: buildHeaders(config)`，添加与上面相同的 `buildHeaders` 辅助函数。

- [ ] **Step 3: 运行现有测试确保没破坏**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
npx vitest run action-packages/builtin/http-request/__tests__/executor.test.ts 2>&1 | tail -10
npx vitest run workflow-nodes/http-request/__tests__/executor.test.ts 2>&1 | tail -10
```
Expected: 测试全部通过

- [ ] **Step 4: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add action-packages/builtin/http-request/executor.main.ts workflow-nodes/http-request/executor.main.ts
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): add auth header merging to executors"
```

---

### Task 9: 更新 Workflow Panel — 移除外层 CollapsibleSection

**Files:**
- Modify: `workflow-nodes/http-request/panel.tsx`

- [ ] **Step 1: 更新 panel.tsx**

```tsx
// workflow-nodes/http-request/panel.tsx

import { useRef } from "react"
import type { WorkflowParam } from "@/types/workflow"
import type { HttpRequestNodeConfig } from "./schema"
import type { HttpRequestActionConfig } from "../../action-packages/builtin/http-request/schema"
import { HttpRequestConfigForm } from "../../action-packages/builtin/http-request/config.renderer"
import { VariableBindingEditor } from "../variable-binding-editor"
import { CollapsibleSection } from "../collapsible-section"

export interface HttpRequestNodePanelProps {
  config: HttpRequestNodeConfig
  onChange: (config: HttpRequestNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function HttpRequestNodePanel({ config, onChange, upstreamNodes, workflowParams }: HttpRequestNodePanelProps) {
  const lastCommittedRef = useRef<HttpRequestNodeConfig>(config)

  const commit = (overrides?: Partial<HttpRequestNodeConfig>) => {
    const next: HttpRequestNodeConfig = { ...lastCommittedRef.current, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const handleActionConfigChange = (actionConfig: HttpRequestActionConfig) => {
    commit({ ...actionConfig })
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      {/* HttpRequestConfigForm is now self-contained with its own layout */}
      <HttpRequestConfigForm
        value={config}
        onChange={handleActionConfigChange}
        idPrefix="wf-node-http"
      />

      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>
    </div>
  )
}
```

关键变化：移除了包裹 `HttpRequestConfigForm` 的外层 `<CollapsibleSection title="请求配置">`。

- [ ] **Step 2: 类型检查**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git -C /Users/liyang/Documents/code/github/Synapse/desktop add workflow-nodes/http-request/panel.tsx
git -C /Users/liyang/Documents/code/github/Synapse/desktop commit -m "feat(http-request): remove redundant CollapsibleSection wrapper in workflow panel"
```

---

### Task 10: 清理 — 移除未使用的 records.ts 导入

**Files:**
- Modify: `action-packages/builtin/http-request/config.renderer.tsx` (done in Task 7, records imports already removed)

验证：确认 `parseRecordText` 和 `stringifyRecordText` 不再在 config.renderer.tsx 中使用。如果 `records.ts` 没有其他消费者，可以清理但建议保留——可能其他 action 将来会用到。

- [ ] **Step 1: 确认无额外引用**

```bash
grep -rn "parseRecordText\|stringifyRecordText" /Users/liyang/Documents/code/github/Synapse/desktop/action-packages/builtin/http-request/ --include="*.ts" --include="*.tsx"
```
Expected: 无匹配（已移除）

- [ ] **Step 2: 运行完整类型检查**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
npx tsc --noEmit --pretty 2>&1 | tail -20
```
Expected: 无错误

---

## 最终确认清单

完成后逐一验证：

- [ ] Schema 含 `auth` 字段，类型正确
- [ ] KV Editor 渲染空状态时只显示 emptyMessage + 添加按钮
- [ ] KV Editor 有数据时显示可编辑行，每行可删除
- [ ] KV Editor 每行 key 只读展示，value 可编辑
- [ ] JSON Editor 可以编辑 JSON，格式化按钮正常工作
- [ ] JSON Editor bodyType 为 `json` 时渲染，`none` 时消失，`text` 时用普通 Textarea
- [ ] Auth Fields 三种类型切换正确
- [ ] Auth Fields Bearer Token 字段 type=password
- [ ] Request Tester 发送请求并展示响应
- [ ] Request Tester 网络错误友好展示
- [ ] config.renderer.tsx 使用新组件，无 records.ts 导入
- [ ] Action executor 合并 auth→headers 正确
- [ ] Workflow executor 合并 auth→headers 正确
- [ ] 两个 executor 现有测试全部通过
- [ ] Workflow panel 无外层 CollapsibleSection
- [ ] Tsc 类型检查全部通过
