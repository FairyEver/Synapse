import { describe, expect, it, vi } from "vitest"
import { createJavascriptRunAction } from "../../../javascript-run/automation-action/executor.main"
import { javascriptRunNodeExecutor } from "../../../javascript-run/workflow-node/executor.main"
import { createNodejsRunAction } from "../../../nodejs-run/automation-action/executor.main"
import type { ScriptRuntimeService } from "../service"

const context = {
  taskId: "automation",
  runId: "run",
  triggeredBy: "manual" as const,
  cwd: "/workspace",
  actor: { kind: "user" as const, id: "user" },
  abortSignal: new AbortController().signal,
  triggerInput: { payload: { id: 7 } },
}

describe("script Automation Actions", () => {
  it("uses no permission or previous-output contract and returns outputs.result", async () => {
    const runJavascript = vi.fn(async (request: { input: unknown }) => ({
      status: "success" as const,
      result: request.input,
      logs: [],
      durationMs: 2,
    }))
    const action = createJavascriptRunAction({
      runtime: { runJavascript } as unknown as ScriptRuntimeService,
      secrets: { get: vi.fn() },
    })

    expect(action.manifest.authorization).toBe("none")
    expect(action.manifest.previousOutputs).toBe("none")
    const result = await action.execute({
      config: {
        source: "postMessage(event.data)",
        inputs: [{
          name: "id",
          source: { type: "trigger", path: ["payload", "id"] },
        }],
        timeoutSeconds: 60,
        saveRunContent: true,
      },
      context,
      previousOutputs: { stale: true },
    })

    expect(runJavascript).toHaveBeenCalledWith(expect.objectContaining({ input: { id: 7 } }))
    expect(result.outputs).toEqual({ result: { id: 7 } })
  })

  it.each([
    {
      name: "root trigger",
      triggerInput: (proxy: object) => proxy,
      source: { type: "trigger" as const, path: [] },
    },
    {
      name: "nested trigger",
      triggerInput: (proxy: object) => ({ nested: proxy }),
      source: { type: "trigger" as const, path: [] },
    },
    {
      name: "path intermediate",
      triggerInput: (proxy: object) => ({ nested: proxy }),
      source: { type: "trigger" as const, path: ["nested", "id"] },
    },
    {
      name: "final binding",
      triggerInput: () => ({}),
      source: undefined,
    },
  ])("rejects a $name Proxy without invoking traps or the runner", async (testCase) => {
    const tracked = trackedProxy()
    const runJavascript = vi.fn()
    const action = createJavascriptRunAction({
      runtime: { runJavascript } as unknown as ScriptRuntimeService,
      secrets: { get: vi.fn() },
    })
    const source = testCase.source ?? {
      type: "static" as const,
      value: tracked.proxy as never,
    }

    const result = await action.execute({
      config: {
        source: "postMessage(event.data)",
        inputs: [{ name: "value", source }],
        timeoutSeconds: 60,
        saveRunContent: true,
      },
      context: {
        ...context,
        triggerInput: testCase.triggerInput(tracked.proxy),
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      error: "INVALID_INPUT: Script input could not be resolved.",
    })
    expect(JSON.stringify(result)).not.toContain(TRAP_SECRET)
    expect(tracked.trapCalls()).toBe(0)
    expect(runJavascript).not.toHaveBeenCalled()
  })

  it("preserves null-prototype objects, dense arrays, shared references, and paths", async () => {
    const shared = Object.assign(Object.create(null) as Record<string, unknown>, { id: 7 })
    const triggerInput = Object.assign(Object.create(null) as Record<string, unknown>, {
      payload: { items: [shared], alias: shared },
    })
    const runJavascript = vi.fn(async (request: { input: unknown }) => ({
      status: "success" as const,
      result: request.input,
      logs: [],
      durationMs: 1,
    }))
    const action = createJavascriptRunAction({
      runtime: { runJavascript } as unknown as ScriptRuntimeService,
      secrets: { get: vi.fn() },
    })

    const result = await action.execute({
      config: {
        source: "postMessage(event.data)",
        inputs: [
          {
            name: "selected",
            source: { type: "trigger", path: ["payload", "items", 0] },
          },
          {
            name: "payload",
            source: { type: "trigger", path: ["payload"] },
          },
        ],
        timeoutSeconds: 60,
        saveRunContent: true,
      },
      context: { ...context, triggerInput },
    })

    expect(result).toMatchObject({
      status: "success",
      outputs: {
        result: {
          selected: { id: 7 },
          payload: { items: [{ id: 7 }], alias: { id: 7 } },
        },
      },
    })
    expect(runJavascript).toHaveBeenCalledOnce()
  })

  it("runs Node.js in the Automation cwd and selected module mode", async () => {
    const runNodejs = vi.fn(async () => ({
      status: "success" as const,
      result: null,
      logs: [],
      durationMs: 1,
      exitCode: 0,
    }))
    const action = createNodejsRunAction({
      runtime: { runNodejs } as unknown as ScriptRuntimeService,
      secrets: { get: vi.fn() },
    })
    await action.execute({
      config: {
        source: "process.stdout.write('null')",
        inputs: [],
        timeoutSeconds: 60,
        saveRunContent: true,
        moduleMode: "esm",
      },
      context,
    })

    expect(runNodejs).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/workspace",
      moduleMode: "esm",
    }))
  })

  it("preserves INVALID_RESULT reason in Automation and Workflow failures", async () => {
    const failure = {
      status: "failed" as const,
      code: "INVALID_RESULT" as const,
      reason: "multiple_json_values" as const,
      error: "Node.js stdout must be exactly one strict JSON value.",
      logs: [],
      durationMs: 1,
    }
    const runtime = {
      runJavascript: vi.fn(async () => failure),
    } as unknown as ScriptRuntimeService
    const action = createJavascriptRunAction({
      runtime,
      secrets: { get: vi.fn() },
    })

    const actionResult = await action.execute({
      config: {
        source: "postMessage(null)",
        inputs: [],
        timeoutSeconds: 60,
        saveRunContent: true,
      },
      context,
    })
    const workflowResult = await javascriptRunNodeExecutor.execute({
      config: {
        source: "postMessage(null)",
        inputs: [],
        timeoutSeconds: 60,
        saveRunContent: true,
      },
      resolvedInputs: {},
      context: { abortSignal: new AbortController().signal },
      runtimeDeps: {
        resolveService: () => runtime,
      },
    } as never)

    expect(actionResult).toMatchObject({
      status: "failed",
      errorCode: "INVALID_RESULT",
      errorReason: "multiple_json_values",
    })
    expect(workflowResult).toMatchObject({
      status: "failed",
      errorCode: "INVALID_RESULT",
      errorReason: "multiple_json_values",
    })
  })
})

const TRAP_SECRET = "proxy-trap-secret"

function trackedProxy(): {
  readonly proxy: object
  readonly trapCalls: () => number
} {
  let calls = 0
  const trap = () => {
    calls += 1
    throw new Error(TRAP_SECRET)
  }
  return {
    proxy: new Proxy({ id: 7 }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    }),
    trapCalls: () => calls,
  }
}
