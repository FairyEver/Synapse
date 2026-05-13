# Renderer Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete renderer process observability layer that captures heartbeat failures, console errors, network failures, resource load errors, and performance degradation — all written to log files via the existing logStore.

**Architecture:** Split by Electron process boundary. Main process owns heartbeat ping/crash detection (works even when renderer is frozen). Renderer process owns console/network/resource/performance interception, forwarding via existing `createRendererLogger` → IPC → logStore pipeline. A shared `guardedLog` prevents recursive logging.

**Tech Stack:** Electron IPC (webContents.send + ipcMain.on), Vitest, PerformanceObserver API, fetch wrapper

---

### Task 1: Renderer-side guard module

**Files:**
- Create: `desktop/src/app-shell/diagnostics/guard.ts`
- Test: `desktop/src/app-shell/diagnostics/__tests__/guard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/app-shell/diagnostics/__tests__/guard.test.ts
import { describe, it, expect, vi } from "vitest"
import { guardedLog } from "../guard"

describe("guardedLog", () => {
  it("forwards log call to logger", () => {
    const logger = { warn: vi.fn(), error: vi.fn() }
    guardedLog(logger, "warn", "test message", { key: "value" })
    expect(logger.warn).toHaveBeenCalledWith("test message", { key: "value" })
  })

  it("prevents recursive calls", () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn().mockImplementation(() => {
        // Simulate a recursive call triggered during logging
        guardedLog(logger, "warn", "recursive call")
      }),
    }
    guardedLog(logger, "error", "original")
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("resets guard after error in logger", () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn().mockImplementation(() => {
        throw new Error("logger broke")
      }),
    }
    expect(() => guardedLog(logger, "error", "boom")).not.toThrow()
    // Guard should be reset, next call works
    guardedLog(logger, "warn", "after reset")
    expect(logger.warn).toHaveBeenCalledWith("after reset", undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/guard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// desktop/src/app-shell/diagnostics/guard.ts
import type { RendererLogger } from "./types"

let _writing = false

export function guardedLog(
  logger: RendererLogger,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: unknown,
): void {
  if (_writing) return
  _writing = true
  try {
    logger[level](message, meta)
  } catch {
    // Logging must never break the app
  } finally {
    _writing = false
  }
}
```

```typescript
// desktop/src/app-shell/diagnostics/types.ts
export interface RendererLogger {
  debug: (message: string, details?: unknown) => void
  info: (message: string, details?: unknown) => void
  warn: (message: string, details?: unknown) => void
  error: (message: string, details?: unknown) => void
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/diagnostics/guard.ts desktop/src/app-shell/diagnostics/types.ts desktop/src/app-shell/diagnostics/__tests__/guard.test.ts
git commit -m "feat(diagnostics): add guardedLog anti-recursion module"
```

---

### Task 2: Console interceptor

**Files:**
- Create: `desktop/src/app-shell/diagnostics/console-interceptor.ts`
- Test: `desktop/src/app-shell/diagnostics/__tests__/console-interceptor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/app-shell/diagnostics/__tests__/console-interceptor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installConsoleInterceptor } from "../console-interceptor"

describe("installConsoleInterceptor", () => {
  const originalError = console.error
  const originalWarn = console.warn

  afterEach(() => {
    console.error = originalError
    console.warn = originalWarn
  })

  it("forwards console.error to logger and preserves original", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    const origErrorSpy = vi.fn()
    // The interceptor saved the original before we can spy, so test via output
    console.error("test error", { foo: 1 })

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toContain("test error")
    cleanup()
  })

  it("forwards console.warn to logger", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    console.warn("test warning")

    expect(logger.warn).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("restores original console methods on cleanup", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const before = console.error
    const cleanup = installConsoleInterceptor(logger)
    expect(console.error).not.toBe(before)
    cleanup()
    // After cleanup, logger should not receive new calls
    console.error("after cleanup")
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("truncates large objects to 2KB", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    const largeObj = { data: "x".repeat(5000) }
    console.error("big", largeObj)

    const [, meta] = logger.error.mock.calls[0]
    const serialized = JSON.stringify(meta)
    expect(serialized.length).toBeLessThanOrEqual(2200) // 2KB + some overhead
    cleanup()
  })

  it("extracts message and stack from Error instances", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    const err = new Error("something broke")
    console.error(err)

    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toContain("something broke")
    expect(meta).toHaveProperty("stack")
    cleanup()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/console-interceptor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// desktop/src/app-shell/diagnostics/console-interceptor.ts
import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const MAX_SERIALIZED_LENGTH = 2048

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { message: arg.message, stack: arg.stack }
  }
  if (typeof arg === "string") return arg
  if (arg === null || arg === undefined) return arg
  try {
    const json = JSON.stringify(arg)
    if (json.length > MAX_SERIALIZED_LENGTH) {
      return JSON.parse(json.slice(0, MAX_SERIALIZED_LENGTH) + '..."')
    }
    return JSON.parse(json)
  } catch {
    return String(arg)
  }
}

function formatArgs(args: unknown[]): { message: string; meta?: unknown } {
  if (args.length === 0) return { message: "(empty)" }

  const first = args[0]
  if (first instanceof Error) {
    return {
      message: first.message || "Error",
      meta: { stack: first.stack, args: args.slice(1).map(serializeArg) },
    }
  }

  const message = typeof first === "string" ? first : String(first)
  if (args.length === 1) return { message }

  const rest = args.slice(1).map(serializeArg)
  return { message, meta: rest.length === 1 ? rest[0] : rest }
}

export function installConsoleInterceptor(logger: RendererLogger): () => void {
  const originalError = console.error
  const originalWarn = console.warn

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    const { message, meta } = formatArgs(args)
    guardedLog(logger, "error", message, meta)
  }

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    const { message, meta } = formatArgs(args)
    guardedLog(logger, "warn", message, meta)
  }

  return () => {
    console.error = originalError
    console.warn = originalWarn
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/console-interceptor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/diagnostics/console-interceptor.ts desktop/src/app-shell/diagnostics/__tests__/console-interceptor.test.ts
git commit -m "feat(diagnostics): add console.error/warn interceptor"
```

---

### Task 3: Network interceptor

**Files:**
- Create: `desktop/src/app-shell/diagnostics/network-interceptor.ts`
- Test: `desktop/src/app-shell/diagnostics/__tests__/network-interceptor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/app-shell/diagnostics/__tests__/network-interceptor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installNetworkInterceptor } from "../network-interceptor"

describe("installNetworkInterceptor", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("logs non-ok responses", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      url: "https://api.example.com/license/validate",
    })

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/license/validate", { method: "POST" })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.warn.mock.calls[0]
    expect(msg).toContain("POST")
    expect(msg).toContain("429")
    expect(meta).toHaveProperty("url")
    cleanup()
  })

  it("logs network errors", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/data").catch(() => {})

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg] = logger.error.mock.calls[0]
    expect(msg).toContain("Failed to fetch")
    cleanup()
  })

  it("does not log successful responses", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/ok")

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })

  it("skips file:// protocol requests", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"))

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("file:///local/resource.json").catch(() => {})

    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })

  it("sanitizes sensitive query params", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized", url: "https://api.example.com/auth?token=secret123&key=abc" })

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/auth?token=secret123&key=abc")

    const [, meta] = logger.warn.mock.calls[0]
    expect((meta as { url: string }).url).not.toContain("secret123")
    expect((meta as { url: string }).url).not.toContain("abc")
    cleanup()
  })

  it("restores original fetch on cleanup", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error", url: "http://x" })
    globalThis.fetch = mockFetch

    const cleanup = installNetworkInterceptor(logger)
    cleanup()

    await globalThis.fetch("http://x")
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/network-interceptor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// desktop/src/app-shell/diagnostics/network-interceptor.ts
import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const SENSITIVE_PARAMS = new Set(["token", "key", "secret", "password", "auth", "api_key", "apikey", "access_token"])

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const param of url.searchParams.keys()) {
      if (SENSITIVE_PARAMS.has(param.toLowerCase())) {
        url.searchParams.set(param, "[REDACTED]")
      }
    }
    return url.toString()
  } catch {
    return raw
  }
}

function extractMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return "GET"
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return String(input)
}

export function installNetworkInterceptor(logger: RendererLogger): () => void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = extractUrl(input)

    if (url.startsWith("file://")) {
      return originalFetch(input, init)
    }

    const method = extractMethod(input, init)
    const start = performance.now()

    try {
      const response = await originalFetch(input, init)
      if (!response.ok) {
        const elapsed = Math.round(performance.now() - start)
        const safeUrl = sanitizeUrl(response.url || url)
        guardedLog(logger, "warn", `请求失败 ${method} → ${response.status} (${elapsed}ms)`, {
          url: safeUrl,
          status: response.status,
          elapsed,
        })
      }
      return response
    } catch (error) {
      const elapsed = Math.round(performance.now() - start)
      const safeUrl = sanitizeUrl(url)
      const message = error instanceof Error ? error.message : String(error)
      guardedLog(logger, "error", `网络错误 ${method} ${message}`, {
        url: safeUrl,
        error: message,
        elapsed,
      })
      throw error
    }
  }

  return () => {
    globalThis.fetch = originalFetch
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/network-interceptor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/diagnostics/network-interceptor.ts desktop/src/app-shell/diagnostics/__tests__/network-interceptor.test.ts
git commit -m "feat(diagnostics): add fetch network interceptor"
```

---

### Task 4: Resource error listener

**Files:**
- Create: `desktop/src/app-shell/diagnostics/resource-error-listener.ts`
- Test: `desktop/src/app-shell/diagnostics/__tests__/resource-error-listener.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/app-shell/diagnostics/__tests__/resource-error-listener.test.ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { installResourceErrorListener } from "../resource-error-listener"

describe("installResourceErrorListener", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("logs script load failures", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const script = document.createElement("script")
    script.src = "/assets/chunk-abc.js"
    document.body.appendChild(script)
    script.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toContain("script")
    expect(meta).toHaveProperty("src", "/assets/chunk-abc.js")
    cleanup()
  })

  it("logs image load failures", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const img = document.createElement("img")
    img.src = "/images/avatar.png"
    document.body.appendChild(img)
    img.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg] = logger.error.mock.calls[0]
    expect(msg).toContain("img")
    cleanup()
  })

  it("logs link/stylesheet load failures", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const link = document.createElement("link")
    link.href = "/styles/main.css"
    link.rel = "stylesheet"
    document.body.appendChild(link)
    link.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("ignores non-resource error events", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const div = document.createElement("div")
    document.body.appendChild(div)
    div.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })

  it("removes listener on cleanup", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)
    cleanup()

    const script = document.createElement("script")
    script.src = "/fail.js"
    document.body.appendChild(script)
    script.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/resource-error-listener.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// desktop/src/app-shell/diagnostics/resource-error-listener.ts
import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const RESOURCE_TAGS = new Set(["IMG", "SCRIPT", "LINK"])

export function installResourceErrorListener(logger: RendererLogger): () => void {
  const handler = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!RESOURCE_TAGS.has(target.tagName)) return

    const tag = target.tagName.toLowerCase()
    const src =
      (target as HTMLImageElement | HTMLScriptElement).src ||
      (target as HTMLLinkElement).href ||
      "(unknown)"

    guardedLog(logger, "error", `资源加载失败 <${tag} src="${src}">`, {
      tag,
      src,
      timestamp: new Date().toISOString(),
    })
  }

  document.addEventListener("error", handler, true)

  return () => {
    document.removeEventListener("error", handler, true)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/resource-error-listener.test.ts`
Expected: PASS (requires `environment: "jsdom"` — see note below)

Note: This test needs DOM APIs. Add a vitest docblock at the top of the test file:
```typescript
/**
 * @vitest-environment jsdom
 */
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/diagnostics/resource-error-listener.ts desktop/src/app-shell/diagnostics/__tests__/resource-error-listener.test.ts
git commit -m "feat(diagnostics): add resource load error listener"
```

---

### Task 5: Performance observer

**Files:**
- Create: `desktop/src/app-shell/diagnostics/performance-observer.ts`
- Test: `desktop/src/app-shell/diagnostics/__tests__/performance-observer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/app-shell/diagnostics/__tests__/performance-observer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPerformanceObserver } from "../performance-observer"

describe("installPerformanceObserver", () => {
  let mockObserverInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
  let capturedCallback: ((list: { getEntries: () => unknown[] }) => void) | null = null

  beforeEach(() => {
    mockObserverInstance = { observe: vi.fn(), disconnect: vi.fn() }
    capturedCallback = null
    vi.stubGlobal("PerformanceObserver", class {
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        capturedCallback = cb
      }
      observe = mockObserverInstance.observe
      disconnect = mockObserverInstance.disconnect
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("logs long tasks exceeding 100ms", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installPerformanceObserver(logger)

    capturedCallback!({
      getEntries: () => [
        { entryType: "longtask", duration: 230, startTime: 14523, attribution: [] },
      ],
    })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.warn.mock.calls[0]
    expect(msg).toContain("230")
    expect(meta).toHaveProperty("duration", 230)
    cleanup()
  })

  it("does not log tasks under 100ms", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installPerformanceObserver(logger)

    capturedCallback!({
      getEntries: () => [
        { entryType: "longtask", duration: 80, startTime: 1000, attribution: [] },
      ],
    })

    expect(logger.warn).not.toHaveBeenCalled()
    cleanup()
  })

  it("disconnects observer on cleanup", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installPerformanceObserver(logger)
    cleanup()
    expect(mockObserverInstance.disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/performance-observer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// desktop/src/app-shell/diagnostics/performance-observer.ts
import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const LONG_TASK_THRESHOLD_MS = 100
const MEMORY_CHECK_INTERVAL_MS = 60_000
const MEMORY_WARN_RATIO = 0.85

interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

export function installPerformanceObserver(logger: RendererLogger): () => void {
  let observer: PerformanceObserver | null = null
  let memoryTimer: ReturnType<typeof setInterval> | null = null

  // Long task observer
  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > LONG_TASK_THRESHOLD_MS) {
            guardedLog(logger, "warn", `长任务 duration=${Math.round(entry.duration)}ms startTime=${Math.round(entry.startTime)}ms`, {
              duration: entry.duration,
              startTime: entry.startTime,
              attribution: (entry as unknown as { attribution?: unknown[] }).attribution,
            })
          }
        }
      })
      observer.observe({ type: "longtask", buffered: false })
    } catch {
      // longtask type not supported in this environment
    }
  }

  // Memory sampling
  const perfWithMemory = performance as unknown as { memory?: PerformanceMemory }
  if (perfWithMemory.memory) {
    memoryTimer = setInterval(() => {
      const mem = perfWithMemory.memory
      if (!mem) return
      const ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit
      if (ratio > MEMORY_WARN_RATIO) {
        guardedLog(logger, "warn", `内存水位过高 ${Math.round(ratio * 100)}%`, {
          usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
          limitMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
          ratio: Math.round(ratio * 100),
        })
      }
    }, MEMORY_CHECK_INTERVAL_MS)
  }

  return () => {
    observer?.disconnect()
    if (memoryTimer !== null) clearInterval(memoryTimer)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/performance-observer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/diagnostics/performance-observer.ts desktop/src/app-shell/diagnostics/__tests__/performance-observer.test.ts
git commit -m "feat(diagnostics): add longtask + memory performance observer"
```

---

### Task 6: Heartbeat responder (renderer side)

**Files:**
- Create: `desktop/src/app-shell/diagnostics/heartbeat-responder.ts`
- Test: `desktop/src/app-shell/diagnostics/__tests__/heartbeat-responder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/app-shell/diagnostics/__tests__/heartbeat-responder.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installHeartbeatResponder } from "../heartbeat-responder"

describe("installHeartbeatResponder", () => {
  let listeners: Map<string, ((...args: unknown[]) => void)[]>
  let sendFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listeners = new Map()
    sendFn = vi.fn()
    vi.stubGlobal("synapse", {
      diagnostics: {
        onPing: (listener: () => void) => {
          const arr = listeners.get("ping") ?? []
          arr.push(listener)
          listeners.set("ping", arr)
          return () => {
            const idx = arr.indexOf(listener)
            if (idx >= 0) arr.splice(idx, 1)
          }
        },
        pong: sendFn,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("responds to ping with pong", () => {
    const cleanup = installHeartbeatResponder()

    // Simulate ping from main process
    const pingListeners = listeners.get("ping") ?? []
    for (const l of pingListeners) l()

    expect(sendFn).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("stops responding after cleanup", () => {
    const cleanup = installHeartbeatResponder()
    cleanup()

    const pingListeners = listeners.get("ping") ?? []
    for (const l of pingListeners) l()

    expect(sendFn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/heartbeat-responder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// desktop/src/app-shell/diagnostics/heartbeat-responder.ts
import { getSynapseBridge } from "@/lib/electron-bridge"

export function installHeartbeatResponder(): () => void {
  const bridge = getSynapseBridge()
  if (!bridge?.diagnostics) {
    return () => {}
  }

  const unsubscribe = bridge.diagnostics.onPing(() => {
    bridge.diagnostics!.pong()
  })

  return unsubscribe
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/heartbeat-responder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app-shell/diagnostics/heartbeat-responder.ts desktop/src/app-shell/diagnostics/__tests__/heartbeat-responder.test.ts
git commit -m "feat(diagnostics): add heartbeat responder (renderer side)"
```

---

### Task 7: Diagnostics entry point (renderer)

**Files:**
- Create: `desktop/src/app-shell/diagnostics/index.ts`
- Modify: `desktop/src/main.tsx`

- [ ] **Step 1: Write the entry module**

```typescript
// desktop/src/app-shell/diagnostics/index.ts
import { createRendererLogger } from "@/app-shell/logging"
import { installConsoleInterceptor } from "./console-interceptor"
import { installNetworkInterceptor } from "./network-interceptor"
import { installResourceErrorListener } from "./resource-error-listener"
import { installPerformanceObserver } from "./performance-observer"
import { installHeartbeatResponder } from "./heartbeat-responder"

export function installDiagnostics(): () => void {
  const consoleLogger = createRendererLogger("diagnostics.console")
  const networkLogger = createRendererLogger("diagnostics.network")
  const resourceLogger = createRendererLogger("diagnostics.resource")
  const performanceLogger = createRendererLogger("diagnostics.performance")

  const cleanups = [
    installConsoleInterceptor(consoleLogger),
    installNetworkInterceptor(networkLogger),
    installResourceErrorListener(resourceLogger),
    installPerformanceObserver(performanceLogger),
    installHeartbeatResponder(),
  ]

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
```

- [ ] **Step 2: Integrate into main.tsx**

In `desktop/src/main.tsx`, add after `installRendererLogForwarding()`:

```typescript
import { installDiagnostics } from "@/app-shell/diagnostics"

// After line: installRendererLogForwarding()
installDiagnostics()
```

- [ ] **Step 3: Verify build compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add desktop/src/app-shell/diagnostics/index.ts desktop/src/main.tsx
git commit -m "feat(diagnostics): wire up renderer diagnostics entry point"
```

---

### Task 8: Preload bridge — diagnostics channel

**Files:**
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Add diagnostics IPC channels to preload**

In `desktop/electron/preload.ts`, add to `EVENT_CHANNELS`:

```typescript
diagnostics: {
  ping: "synapse:diagnostics:ping",
  pong: "synapse:diagnostics:pong",
},
```

Add to the `synapseBridge` object:

```typescript
diagnostics: {
  onPing: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on(EVENT_CHANNELS.diagnostics.ping, wrapped)
    return () => { ipcRenderer.removeListener(EVENT_CHANNELS.diagnostics.ping, wrapped) }
  },
  pong: () => {
    ipcRenderer.send(EVENT_CHANNELS.diagnostics.pong)
  },
},
```

- [ ] **Step 2: Update SynapseBridge type**

In `desktop/src/types/bridge.ts`, add to the `SynapseBridge` interface:

```typescript
diagnostics?: {
  onPing: (listener: () => void) => () => void
  pong: () => void
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat(diagnostics): add heartbeat IPC channels to preload bridge"
```

---

### Task 9: Main process — renderer health service

**Files:**
- Create: `desktop/electron/services/renderer-health/constants.ts`
- Create: `desktop/electron/services/renderer-health/renderer-health-service.ts`
- Create: `desktop/electron/services/renderer-health/index.ts`
- Test: `desktop/electron/services/renderer-health/__tests__/renderer-health-service.test.ts`

- [ ] **Step 1: Write constants**

```typescript
// desktop/electron/services/renderer-health/constants.ts
export const HEARTBEAT_INTERVAL_MS = 30_000
export const HEARTBEAT_TIMEOUT_MS = 5_000
export const FREEZE_THRESHOLD_MISSES = 3
export const DIAGNOSTICS_PING_CHANNEL = "synapse:diagnostics:ping"
export const DIAGNOSTICS_PONG_CHANNEL = "synapse:diagnostics:pong"
```

- [ ] **Step 2: Write the failing test**

```typescript
// desktop/electron/services/renderer-health/__tests__/renderer-health-service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RendererHealthService } from "../renderer-health-service"
import { DIAGNOSTICS_PING_CHANNEL, DIAGNOSTICS_PONG_CHANNEL } from "../constants"

function createMockWebContents() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(handler)
      listeners.set(event, arr)
    }),
    removeListener: vi.fn(),
    _listeners: listeners,
  }
}

function createMockIpcMain() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const arr = handlers.get(channel) ?? []
      arr.push(handler)
      handlers.set(channel, arr)
    }),
    removeListener: vi.fn(),
    _handlers: handlers,
    simulatePong: () => {
      const pongHandlers = handlers.get(DIAGNOSTICS_PONG_CHANNEL) ?? []
      for (const h of pongHandlers) h({})
    },
  }
}

describe("RendererHealthService", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("sends ping at configured interval", () => {
    const wc = createMockWebContents()
    const ipcMain = createMockIpcMain()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger, ipcMain: ipcMain as never })
    service.attach(wc as never)

    vi.advanceTimersByTime(30_000)
    expect(wc.send).toHaveBeenCalledWith(DIAGNOSTICS_PING_CHANNEL)
  })

  it("logs warning when pong not received within timeout", () => {
    const wc = createMockWebContents()
    const ipcMain = createMockIpcMain()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger, ipcMain: ipcMain as never })
    service.attach(wc as never)

    vi.advanceTimersByTime(30_000) // ping sent
    vi.advanceTimersByTime(5_000)  // timeout expires

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain("无响应")
  })

  it("does not warn when pong received in time", () => {
    const wc = createMockWebContents()
    const ipcMain = createMockIpcMain()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger, ipcMain: ipcMain as never })
    service.attach(wc as never)

    vi.advanceTimersByTime(30_000) // ping sent
    ipcMain.simulatePong()         // pong received
    vi.advanceTimersByTime(5_000)  // timeout expires

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("logs error after 3 consecutive misses", () => {
    const wc = createMockWebContents()
    const ipcMain = createMockIpcMain()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger, ipcMain: ipcMain as never })
    service.attach(wc as never)

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30_000) // ping
      vi.advanceTimersByTime(5_000)  // timeout
    }

    expect(logger.error).toHaveBeenCalled()
    expect(logger.error.mock.calls[0][0]).toContain("冻结")
  })

  it("logs recovery after freeze then pong", () => {
    const wc = createMockWebContents()
    const ipcMain = createMockIpcMain()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger, ipcMain: ipcMain as never })
    service.attach(wc as never)

    // 3 misses → freeze
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30_000)
      vi.advanceTimersByTime(5_000)
    }

    // Next ping + pong → recovery
    vi.advanceTimersByTime(30_000)
    ipcMain.simulatePong()

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("恢复"),
      expect.anything(),
    )
  })

  it("stops on detach", () => {
    const wc = createMockWebContents()
    const ipcMain = createMockIpcMain()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger, ipcMain: ipcMain as never })
    service.attach(wc as never)
    service.detach()

    vi.advanceTimersByTime(60_000)
    expect(wc.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd desktop && npx vitest run electron/services/renderer-health/__tests__/renderer-health-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write implementation**

```typescript
// desktop/electron/services/renderer-health/renderer-health-service.ts
import type { WebContents, IpcMain } from "electron"
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  FREEZE_THRESHOLD_MISSES,
  DIAGNOSTICS_PING_CHANNEL,
  DIAGNOSTICS_PONG_CHANNEL,
} from "./constants"

interface RendererHealthLogger {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

export interface RendererHealthServiceDeps {
  readonly logger: RendererHealthLogger
  readonly ipcMain: IpcMain
}

export class RendererHealthService {
  private readonly logger: RendererHealthLogger
  private readonly ipcMain: IpcMain
  private webContents: WebContents | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private consecutiveMisses = 0
  private lastPongAt: string | null = null
  private frozen = false
  private pongHandler: (() => void) | null = null
  private crashHandler: ((event: unknown, details: { reason: string; exitCode: number }) => void) | null = null

  constructor(deps: RendererHealthServiceDeps) {
    this.logger = deps.logger
    this.ipcMain = deps.ipcMain
  }

  attach(webContents: WebContents): void {
    this.detach()
    this.webContents = webContents
    this.consecutiveMisses = 0
    this.frozen = false
    this.lastPongAt = new Date().toISOString()

    this.pongHandler = () => {
      this.handlePong()
    }
    this.ipcMain.on(DIAGNOSTICS_PONG_CHANNEL, this.pongHandler)

    this.crashHandler = (_event, details) => {
      this.logger.error("渲染进程崩溃", {
        reason: details.reason,
        exitCode: details.exitCode,
      })
    }
    webContents.on("render-process-gone" as never, this.crashHandler as never)

    this.intervalTimer = setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL_MS)
  }

  detach(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
    if (this.pongHandler) {
      this.ipcMain.removeListener(DIAGNOSTICS_PONG_CHANNEL, this.pongHandler)
      this.pongHandler = null
    }
    if (this.webContents && this.crashHandler) {
      this.webContents.removeListener("render-process-gone" as never, this.crashHandler as never)
      this.crashHandler = null
    }
    this.webContents = null
  }

  private sendPing(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return

    this.webContents.send(DIAGNOSTICS_PING_CHANNEL)

    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private handlePong(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }

    const wasFrozen = this.frozen
    this.consecutiveMisses = 0
    this.frozen = false
    this.lastPongAt = new Date().toISOString()

    if (wasFrozen) {
      this.logger.info("渲染进程恢复响应", { lastPongAt: this.lastPongAt })
    }
  }

  private handleTimeout(): void {
    this.timeoutTimer = null
    this.consecutiveMisses++

    if (this.consecutiveMisses >= FREEZE_THRESHOLD_MISSES) {
      if (!this.frozen) {
        this.frozen = true
        this.logger.error("渲染进程疑似冻结", {
          consecutiveMisses: this.consecutiveMisses,
          lastPongAt: this.lastPongAt,
        })
      }
    } else {
      this.logger.warn("渲染进程无响应", {
        lastPongAt: this.lastPongAt,
        elapsed: `${this.consecutiveMisses * HEARTBEAT_INTERVAL_MS / 1000}s`,
      })
    }
  }
}
```

```typescript
// desktop/electron/services/renderer-health/index.ts
export { RendererHealthService } from "./renderer-health-service"
export type { RendererHealthServiceDeps } from "./renderer-health-service"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd desktop && npx vitest run electron/services/renderer-health/__tests__/renderer-health-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/renderer-health/
git commit -m "feat(diagnostics): add renderer health service (heartbeat + crash detection)"
```

---

### Task 10: Integrate renderer-health-service into main process

**Files:**
- Modify: `desktop/electron/bootstrap/main-window.ts`
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Attach health service after window creation**

In `desktop/electron/bootstrap/main-window.ts`, add after the window is created:

```typescript
import { ipcMain } from "electron"
import { RendererHealthService } from "../services/renderer-health"
import { createMainLogger } from "../services/log-store"

const healthLogger = createMainLogger("renderer-health")
const rendererHealthService = new RendererHealthService({
  logger: healthLogger,
  ipcMain,
})
```

In `createMainWindow`, after `deps.state.current = window`:

```typescript
rendererHealthService.attach(window.webContents)

window.on("closed", () => {
  rendererHealthService.detach()
  // ... existing cleanup
})
```

- [ ] **Step 2: Verify build compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/bootstrap/main-window.ts
git commit -m "feat(diagnostics): integrate renderer-health-service into window lifecycle"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Run all diagnostics tests**

Run: `cd desktop && npx vitest run src/app-shell/diagnostics/__tests__/ electron/services/renderer-health/__tests__/`
Expected: All tests PASS

- [ ] **Step 2: Run full test suite to check for regressions**

Run: `cd desktop && npx vitest run`
Expected: No new failures

- [ ] **Step 3: Run type check**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`
- Open DevTools console, trigger `console.error("test diagnostics")`
- Check log file for `[renderer:diagnostics.console]` entry
- Verify heartbeat pings appear in main process log as INFO (not WARN — meaning pongs are received)

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(diagnostics): address integration issues from smoke test"
```
