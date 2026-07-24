import { describe, expect, it, vi } from "vitest"
import {
  CHROMIUM_WORKER_WEB_PREFERENCES,
  runChromiumWorkerScript,
} from "../chromium-worker-runner"

describe("runChromiumWorkerScript", () => {
  it("does not expose Node or a preload bridge to the Worker host", () => {
    expect(CHROMIUM_WORKER_WEB_PREFERENCES).toEqual({
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    })
    expect(CHROMIUM_WORKER_WEB_PREFERENCES).not.toHaveProperty("preload")
  })

  it("accepts the first strict JSON result and destroys the one-shot window", async () => {
    const destroy = vi.fn()
    const executeJavaScript = vi.fn(async () => ({ kind: "result", json: "{\"ok\":true}" }))
    const outcome = await runChromiumWorkerScript({
      source: "self.onmessage = event => postMessage({ ok: event.data.enabled })",
      input: { enabled: true },
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
    }, {
      createWindow: async () => ({
        webContents: { executeJavaScript, on: vi.fn() },
        loadURL: vi.fn(async () => undefined),
        destroy,
        isDestroyed: () => false,
      }),
    })

    expect(outcome).toMatchObject({ status: "success", result: { ok: true } })
    expect(destroy).toHaveBeenCalledOnce()
    expect(executeJavaScript).toHaveBeenCalledOnce()
  })

  it("rejects non-strict input without invoking toJSON or creating a window", async () => {
    let toJsonCalls = 0
    const input = { retained: true }
    Object.defineProperty(input, "toJSON", {
      enumerable: false,
      value() {
        toJsonCalls += 1
        return { rewritten: true }
      },
    })
    const createWindow = vi.fn()

    const outcome = await runChromiumWorkerScript({
      source: "self.onmessage = event => postMessage(event.data)",
      input,
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
    }, { createWindow })

    expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
    expect(toJsonCalls).toBe(0)
    expect(createWindow).not.toHaveBeenCalled()
  })

  it("rejects an accessor without invoking its getter or creating a window", async () => {
    let getterCalls = 0
    const input = {}
    Object.defineProperty(input, "value", {
      enumerable: true,
      get() {
        getterCalls += 1
        return 1
      },
    })
    const createWindow = vi.fn()

    const outcome = await runChromiumWorkerScript({
      source: "self.onmessage = event => postMessage(event.data)",
      input,
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
    }, { createWindow })

    expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
    expect(getterCalls).toBe(0)
    expect(createWindow).not.toHaveBeenCalled()
  })

  it.each([null, "text", 7, [1]])(
    "rejects a non-object top-level input before creating a window",
    async (input) => {
      const createWindow = vi.fn()
      const outcome = await runChromiumWorkerScript({
        source: "self.onmessage = event => postMessage(event.data)",
        input: input as never,
        timeoutSeconds: 5,
        abortSignal: new AbortController().signal,
      }, { createWindow })

      expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
      expect(createWindow).not.toHaveBeenCalled()
    },
  )

  it.each(["root", "nested"] as const)(
    "rejects a %s Proxy without invoking any trap or creating a window",
    async (placement) => {
      const tracked = trackedProxy()
      const createWindow = vi.fn()
      const outcome = await runChromiumWorkerScript({
        source: "self.onmessage = event => postMessage(event.data)",
        input: (placement === "root" ? tracked.proxy : { nested: tracked.proxy }) as never,
        timeoutSeconds: 5,
        abortSignal: new AbortController().signal,
      }, { createWindow })

      expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
      expect(tracked.trapCalls()).toBe(0)
      expect(createWindow).not.toHaveBeenCalled()
    },
  )

  it("sends descriptor values without inherited toJSON hooks", async () => {
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON")
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON")
    let objectToJsonCalls = 0
    let arrayToJsonCalls = 0
    const executeJavaScript = vi.fn(async () => ({ kind: "result", json: "null" }))
    const shared = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 })
    const input = Object.assign(Object.create(null) as Record<string, unknown>, {
      object: { retained: true },
      array: [1, null],
      shared,
      alias: shared,
    })
    const expected = '{"object":{"retained":true},"array":[1,null],"shared":{"value":1},"alias":{"value":1}}'

    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          objectToJsonCalls += 1
          return { rewritten: "object" }
        },
      })
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          arrayToJsonCalls += 1
          return ["rewritten"]
        },
      })

      const outcome = await runChromiumWorkerScript({
        source: "self.onmessage = event => postMessage(event.data)",
        input,
        timeoutSeconds: 5,
        abortSignal: new AbortController().signal,
      }, {
        createWindow: async () => windowStub({ executeJavaScript }),
      })

      expect(outcome).toMatchObject({ status: "success", result: null })
      expect(executeJavaScript.mock.calls[0]?.[0])
        .toContain(`worker.postMessage(JSON.parse(${JSON.stringify(expected)}));`)
      expect(objectToJsonCalls).toBe(0)
      expect(arrayToJsonCalls).toBe(0)
    } finally {
      restoreProperty(Object.prototype, "toJSON", objectToJson)
      restoreProperty(Array.prototype, "toJSON", arrayToJson)
    }
  })

  it("classifies a guest failure before any result", async () => {
    const outcome = await runChromiumWorkerScript({
      source: "throw new Error('boom')",
      input: {},
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
    }, {
      createWindow: async () => ({
        webContents: {
          executeJavaScript: async () => ({ kind: "error", error: "script_failed" }),
          on: vi.fn(),
        },
        loadURL: vi.fn(async () => undefined),
        destroy: vi.fn(),
        isDestroyed: () => false,
      }),
    })

    expect(outcome).toMatchObject({ status: "failed", code: "SCRIPT_FAILED" })
  })

  it.each([
    [{ kind: "result" }, "missing"],
    [{ kind: "error", error: "unsupported_value" }, "unsupported_value"],
  ])("preserves the INVALID_RESULT reason", async (completed, reason) => {
    const outcome = await runChromiumWorkerScript({
      source: "self.onmessage = () => postMessage(undefined)",
      input: {},
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
    }, {
      createWindow: async () => windowStub({
        executeJavaScript: vi.fn(async () => completed),
      }),
    })

    expect(outcome).toMatchObject({
      status: "failed",
      code: "INVALID_RESULT",
      reason,
    })
  })

  it("cancels while window creation is pending and destroys the created window", async () => {
    const controller = new AbortController()
    const destroy = vi.fn()
    let resolveWindow!: (window: ReturnType<typeof windowStub>) => void
    const createWindow = vi.fn(() => new Promise<ReturnType<typeof windowStub>>((resolve) => {
      resolveWindow = resolve
    }))
    const run = runChromiumWorkerScript({
      source: "self.onmessage = () => postMessage(null)",
      input: {},
      timeoutSeconds: 5,
      abortSignal: controller.signal,
    }, { createWindow })

    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce())
    controller.abort()

    await expect(Promise.race([run, rejectAfter(500)]))
      .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })
    resolveWindow(windowStub({ destroy }))
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce())
  })

  it("cancels while loadURL never resolves and destroys the window", async () => {
    const controller = new AbortController()
    const destroy = vi.fn()
    const loadURL = vi.fn(() => new Promise<void>(() => {}))
    const run = runChromiumWorkerScript({
      source: "self.onmessage = () => postMessage(null)",
      input: {},
      timeoutSeconds: 5,
      abortSignal: controller.signal,
    }, {
      createWindow: async () => windowStub({ destroy, loadURL }),
    })

    await vi.waitFor(() => expect(loadURL).toHaveBeenCalledOnce())
    controller.abort()

    await expect(Promise.race([run, rejectAfter(500)]))
      .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it("cancels after execution starts without waiting for the guest promise", async () => {
    const controller = new AbortController()
    const destroy = vi.fn()
    const executeJavaScript = vi.fn(() => new Promise<unknown>(() => {}))
    const run = runChromiumWorkerScript({
      source: "self.onmessage = () => {}",
      input: {},
      timeoutSeconds: 5,
      abortSignal: controller.signal,
    }, {
      createWindow: async () => windowStub({ destroy, executeJavaScript }),
    })

    await vi.waitFor(() => expect(executeJavaScript).toHaveBeenCalledOnce())
    controller.abort()

    await expect(run).resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it.each([
    ["window creation", "window_create"],
    ["page loading", "window_load"],
    ["worker execution", "worker_execute"],
  ] as const)("returns a stable error for %s failures", async (failurePoint, stage) => {
    const logger = { warn: vi.fn() }
    const secret = new Error("/private/electron/internal/detail")
    const outcome = await runChromiumWorkerScript({
      source: "self.onmessage = () => postMessage(null)",
      input: {},
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
    }, {
      createWindow: failurePoint === "window creation"
        ? async () => { throw secret }
        : async () => windowStub({
            loadURL: failurePoint === "page loading"
              ? vi.fn(async () => { throw secret })
              : undefined,
            executeJavaScript: failurePoint === "worker execution"
              ? vi.fn(async () => { throw secret })
              : undefined,
          }),
      logger,
    })

    expect(outcome).toMatchObject({
      status: "failed",
      code: "RUNNER_START_FAILED",
      error: "Unable to start JavaScript execution.",
    })
    expect(JSON.stringify(outcome)).not.toContain("/private/electron")
    expect(logger.warn).toHaveBeenCalledWith("script runner infrastructure failure", {
      runner: "chromium",
      stage,
      reason: "electron_error",
    })
  })
})

function windowStub(overrides: {
  destroy?: ReturnType<typeof vi.fn>
  loadURL?: ReturnType<typeof vi.fn>
  executeJavaScript?: ReturnType<typeof vi.fn>
} = {}) {
  return {
    webContents: {
      executeJavaScript: overrides.executeJavaScript
        ?? vi.fn(async () => ({ kind: "result", json: "null" })),
      on: vi.fn(),
    },
    loadURL: overrides.loadURL ?? vi.fn(async () => undefined),
    destroy: overrides.destroy ?? vi.fn(),
    isDestroyed: () => false,
  }
}

function rejectAfter(milliseconds: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("operation did not stop")), milliseconds)
  })
}

function trackedProxy(): {
  readonly proxy: Record<string, unknown>
  readonly trapCalls: () => number
} {
  let trapCalls = 0
  const trap = (): never => {
    trapCalls += 1
    throw new Error("Proxy trap must not run")
  }
  const handler = {
    apply: trap,
    construct: trap,
    defineProperty: trap,
    deleteProperty: trap,
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    isExtensible: trap,
    ownKeys: trap,
    preventExtensions: trap,
    set: trap,
    setPrototypeOf: trap,
  } as ProxyHandler<Record<string, unknown>>
  return {
    proxy: new Proxy({ retained: true }, handler),
    trapCalls: () => trapCalls,
  }
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    Reflect.deleteProperty(target, key)
  }
}
