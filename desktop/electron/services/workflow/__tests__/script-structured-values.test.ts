import { describe, expect, it, vi } from "vitest"

import "../../../../workflow-nodes/register.main"
import type { ScriptRuntimeService } from "../../../../app-capabilities/script-runtime/main/service"
import { SCRIPT_RUNTIME_SERVICE_ID } from "../../../../app-capabilities/script-runtime/main/service"
import {
  collectPublicNodeValues,
  resolveWorkflowScriptInputs,
} from "../script-input-resolver"
import { WorkflowEngine } from "../workflow-engine"
import type { WorkflowDefinition } from "../../../../src/types/workflow"

describe("Workflow script structured values", () => {
  it("passes node_value without stringification or JSON re-encoding", async () => {
    const runJavascript = vi.fn()
      .mockResolvedValueOnce({
        status: "success",
        result: { user: { id: 42 }, active: true },
        logs: [],
        durationMs: 1,
      })
      .mockImplementationOnce(async (request: { input: unknown }) => ({
        status: "success",
        result: request.input,
        logs: [],
        durationMs: 1,
      }))
    const runtime = { runJavascript } as unknown as ScriptRuntimeService
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    }, undefined, {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn(),
      resolveService: <T>(serviceId: string) => {
        if (serviceId === SCRIPT_RUNTIME_SERVICE_ID) return runtime as T
        throw new Error(`Unexpected service: ${serviceId}`)
      },
    })
    const result = await engine.run(definition(), {}, "run-1", vi.fn())

    expect(result.status).toBe("completed")
    expect(runJavascript).toHaveBeenNthCalledWith(2, expect.objectContaining({
      input: { userId: 42, entire: { user: { id: 42 }, active: true } },
    }))
    expect(result.nodeResults.consumer?.outputs).toEqual({
      result: { userId: 42, entire: { user: { id: 42 }, active: true } },
    })
    expect(result.nodeResults.producer?.output).toBeUndefined()
  })

  it("rejects a param Proxy without invoking traps", async () => {
    const tracked = trackedProxy()
    const runJavascript = vi.fn()
    const runtime = { runJavascript } as unknown as ScriptRuntimeService
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    }, undefined, {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn(),
      resolveService: <T>(serviceId: string) => {
        if (serviceId === SCRIPT_RUNTIME_SERVICE_ID) return runtime as T
        throw new Error(`Unexpected service: ${serviceId}`)
      },
    })

    const result = await engine.run(singleInputDefinition({
      name: "payload",
      source: { type: "param", param: "payload" },
    }), { payload: tracked.proxy }, "param-proxy", vi.fn())

    expect(result.nodeResults.script).toMatchObject({
      status: "failed",
      error: "INVALID_INPUT: Script input could not be resolved.",
    })
    expect(JSON.stringify(result)).not.toContain(TRAP_SECRET)
    expect(tracked.trapCalls()).toBe(0)
    expect(runJavascript).not.toHaveBeenCalled()
  })

  it("rejects a direct resolver param Proxy without invoking traps", async () => {
    const tracked = trackedProxy()

    await expect(resolveWorkflowScriptInputs({
      bindings: [{
        name: "payload",
        source: { type: "param", param: "payload" },
      }],
      definition: definition(),
      paramValues: { payload: tracked.proxy },
      legacyNodeOutputs: {},
      publicNodeValues: {},
    })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Script input could not be resolved.",
    })

    expect(tracked.trapCalls()).toBe(0)
  })

  it("rejects a paramValues container Proxy without invoking traps", async () => {
    const tracked = trackedProxy({ payload: { id: 42 } })

    const error = await captureError(resolveWorkflowScriptInputs({
      bindings: [{
        name: "payload",
        source: { type: "param", param: "payload" },
      }],
      definition: definition(),
      paramValues: tracked.proxy as Record<string, unknown>,
      legacyNodeOutputs: {},
      publicNodeValues: {},
    }))

    expect(error).toMatchObject({
      code: "INVALID_INPUT",
      message: "Script input could not be resolved.",
    })
    expect(String(error)).not.toContain(TRAP_SECRET)
    expect(tracked.trapCalls()).toBe(0)
  })

  it.each(["proxy", "accessor"] as const)(
    "rejects a paramValues container %s without invoking it or the runner",
    async (kind) => {
      const tracked = trackedContainer(kind, "payload", { id: 42 })
      const runJavascript = vi.fn()
      const runtime = { runJavascript } as unknown as ScriptRuntimeService
      const engine = new WorkflowEngine({
        sendToAgent: vi.fn(),
      }, undefined, {
        processRunner: { run: vi.fn() },
        sendHttpRequest: vi.fn(),
        resolveService: <T>(serviceId: string) => {
          if (serviceId === SCRIPT_RUNTIME_SERVICE_ID) return runtime as T
          throw new Error(`Unexpected service: ${serviceId}`)
        },
      })

      const result = await engine.run(singleInputDefinition({
        name: "payload",
        source: { type: "param", param: "payload" },
      }), tracked.container, `param-${kind}`, vi.fn())

      expect(result.nodeResults.script).toMatchObject({
        status: "failed",
        error: "INVALID_INPUT: Script input could not be resolved.",
      })
      expect(JSON.stringify(result)).not.toContain(TRAP_SECRET)
      expect(tracked.accessCalls()).toBe(0)
      expect(runJavascript).not.toHaveBeenCalled()
    },
  )

  it("rejects a Proxy in a node_value path before reading the path", async () => {
    const tracked = trackedProxy()

    await expect(resolveWorkflowScriptInputs({
      bindings: [{
        name: "id",
        source: {
          type: "node_value",
          node: "producer",
          output: "result",
          path: ["payload", "id"],
        },
      }],
      definition: definition(),
      paramValues: {},
      legacyNodeOutputs: {},
      publicNodeValues: {
        producer: {
          result: { payload: tracked.proxy } as never,
        },
      },
    })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Script input could not be resolved.",
    })

    expect(tracked.trapCalls()).toBe(0)
  })

  it("rejects a publicNodeValues outer Proxy without invoking traps", async () => {
    const tracked = trackedProxy({
      producer: { result: { id: 42 } },
    })

    const error = await captureError(resolveWorkflowScriptInputs({
      bindings: [{
        name: "result",
        source: {
          type: "node_value",
          node: "producer",
          output: "result",
          path: [],
        },
      }],
      definition: definition(),
      paramValues: {},
      legacyNodeOutputs: {},
      publicNodeValues: tracked.proxy as never,
    }))

    expect(error).toMatchObject({
      code: "INVALID_INPUT",
      message: "Script input could not be resolved.",
    })
    expect(String(error)).not.toContain(TRAP_SECRET)
    expect(tracked.trapCalls()).toBe(0)
  })

  it.each(["proxy", "accessor"] as const)(
    "rejects a per-node outputs container %s without invoking it",
    async (kind) => {
      const tracked = trackedContainer(kind, "result", { id: 42 })

      const error = await captureError(resolveWorkflowScriptInputs({
        bindings: [{
          name: "result",
          source: {
            type: "node_value",
            node: "producer",
            output: "result",
            path: [],
          },
        }],
        definition: definition(),
        paramValues: {},
        legacyNodeOutputs: {},
        publicNodeValues: {
          producer: tracked.container,
        } as never,
      }))

      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        message: "Script input could not be resolved.",
      })
      expect(String(error)).not.toContain(TRAP_SECRET)
      expect(tracked.accessCalls()).toBe(0)
    },
  )

  it.each(["root", "nested"] as const)(
    "rejects a %s public output Proxy without invoking traps",
    (placement) => {
      const tracked = trackedProxy()
      const value = placement === "root"
        ? tracked.proxy
        : { nested: tracked.proxy }

      expect(() => collectPublicNodeValues({
        nodeType: "javascript_run",
        outputs: { result: value },
      })).toThrow("Script input could not be resolved.")
      expect(tracked.trapCalls()).toBe(0)
    },
  )

  it.each(["proxy", "accessor"] as const)(
    "rejects a collectPublicNodeValues outputs container %s without invoking it",
    (kind) => {
      const tracked = trackedContainer(kind, "result", { id: 42 })

      let error: unknown
      try {
        collectPublicNodeValues({
          nodeType: "javascript_run",
          outputs: tracked.container,
        })
      } catch (caught) {
        error = caught
      }

      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        message: "Script input could not be resolved.",
      })
      expect(String(error)).not.toContain(TRAP_SECRET)
      expect(tracked.accessCalls()).toBe(0)
    },
  )

  it.each(["proxy", "accessor"] as const)(
    "rejects a legacyNodeOutputs container %s without invoking it",
    async (kind) => {
      const tracked = trackedContainer(kind, "producer", "value")

      const error = await captureError(resolveWorkflowScriptInputs({
        bindings: [{
          name: "value",
          source: { type: "node_output", node: "producer" },
        }],
        definition: definition(),
        paramValues: {},
        legacyNodeOutputs: tracked.container,
        publicNodeValues: {},
      }))

      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        message: "Script input could not be resolved.",
      })
      expect(String(error)).not.toContain(TRAP_SECRET)
      expect(tracked.accessCalls()).toBe(0)
    },
  )

  it("preserves missing field errors after container snapshots", async () => {
    await expect(resolveWorkflowScriptInputs({
      bindings: [{
        name: "payload",
        source: { type: "param", param: "missing" },
      }],
      definition: definition(),
      paramValues: Object.create(null) as Record<string, unknown>,
      legacyNodeOutputs: Object.create(null) as Record<string, string>,
      publicNodeValues: Object.create(null) as never,
    })).rejects.toThrow("输入「payload」引用的参数不存在：missing")

    await expect(resolveWorkflowScriptInputs({
      bindings: [{
        name: "result",
        source: {
          type: "node_value",
          node: "producer",
          output: "result",
          path: [],
        },
      }],
      definition: definition(),
      paramValues: Object.create(null) as Record<string, unknown>,
      legacyNodeOutputs: Object.create(null) as Record<string, string>,
      publicNodeValues: {
        producer: Object.create(null) as Record<string, never>,
      },
    })).rejects.toThrow("节点「Producer」的公共输出「result」不可用")

    expect(() => collectPublicNodeValues({
      nodeType: "javascript_run",
      outputs: Object.create(null) as Record<string, unknown>,
    })).toThrow("节点未产生声明的公共输出「result」")
  })

  it.each(["static", "secret"] as const)(
    "rejects a Proxy from a %s final value without invoking traps",
    async (sourceType) => {
      const tracked = trackedProxy()

      await expect(resolveWorkflowScriptInputs({
        bindings: [{
          name: "payload",
          source: sourceType === "static"
            ? { type: "static_json", value: tracked.proxy as never }
            : { type: "secret", name: "token" },
        }],
        definition: definition(),
        paramValues: {},
        legacyNodeOutputs: {},
        publicNodeValues: {},
        runtimeDeps: sourceType === "secret"
          ? {
              resolveService: () => ({
                get: vi.fn(async () => ({ value: tracked.proxy })),
              }),
            } as never
          : undefined,
      })).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: "Script input could not be resolved.",
      })

      expect(tracked.trapCalls()).toBe(0)
    },
  )

  it("preserves null-prototype objects, dense arrays, shared references, and paths", async () => {
    const shared = Object.assign(Object.create(null) as Record<string, unknown>, { id: 42 })
    const value = Object.assign(Object.create(null) as Record<string, unknown>, {
      items: [shared],
      alias: shared,
    })
    const publicNodeValues = {
      producer: collectPublicNodeValues({
        nodeType: "javascript_run",
        outputs: { result: value },
      }),
    }

    const resolved = await resolveWorkflowScriptInputs({
      bindings: [
        {
          name: "selected",
          source: {
            type: "node_value",
            node: "producer",
            output: "result",
            path: ["items", 0],
          },
        },
        {
          name: "entire",
          source: {
            type: "node_value",
            node: "producer",
            output: "result",
            path: [],
          },
        },
      ],
      definition: definition(),
      paramValues: {},
      legacyNodeOutputs: {},
      publicNodeValues,
    })

    expect(resolved).toEqual({
      selected: { id: 42 },
      entire: { items: [{ id: 42 }], alias: { id: 42 } },
    })
    expect(Object.getPrototypeOf(resolved)).toBeNull()
  })
})

const TRAP_SECRET = "workflow-proxy-trap-secret"

function trackedProxy(target: object = { id: 42 }): {
  readonly proxy: object
  readonly trapCalls: () => number
} {
  let calls = 0
  const trap = () => {
    calls += 1
    throw new Error(TRAP_SECRET)
  }
  return {
    proxy: new Proxy(target, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    }),
    trapCalls: () => calls,
  }
}

function trackedAccessor<T>(key: string, value: T): {
  readonly container: Record<string, T>
  readonly getterCalls: () => number
} {
  let calls = 0
  const container = Object.create(null) as Record<string, T>
  Object.defineProperty(container, key, {
    enumerable: true,
    configurable: true,
    get() {
      calls += 1
      throw new Error(`${TRAP_SECRET}:${String(value)}`)
    },
  })
  return {
    container,
    getterCalls: () => calls,
  }
}

function trackedContainer<T>(
  kind: "proxy" | "accessor",
  key: string,
  value: T,
): {
  readonly container: Record<string, T>
  readonly accessCalls: () => number
} {
  if (kind === "proxy") {
    const tracked = trackedProxy({ [key]: value })
    return {
      container: tracked.proxy as Record<string, T>,
      accessCalls: tracked.trapCalls,
    }
  }
  const tracked = trackedAccessor(key, value)
  return {
    container: tracked.container,
    accessCalls: tracked.getterCalls,
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected promise to reject")
}

function definition(): WorkflowDefinition {
  return {
    id: "script-values",
    name: "Script values",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    meta: { schemaVersion: "2.7.0" },
    params: [],
    nodes: [
      {
        id: "producer",
        name: "Producer",
        type: "javascript_run",
        position: { x: 0, y: 0 },
        config: {
          source: "postMessage({ user: { id: 42 }, active: true })",
          inputs: [],
          timeoutSeconds: 60,
          saveRunContent: true,
        },
      },
      {
        id: "consumer",
        name: "Consumer",
        type: "javascript_run",
        position: { x: 200, y: 0 },
        config: {
          source: "postMessage(event.data)",
          inputs: [
            {
              name: "userId",
              source: { type: "node_value", node: "producer", output: "result", path: ["user", "id"] },
            },
            {
              name: "entire",
              source: { type: "node_value", node: "producer", output: "result", path: [] },
            },
          ],
          timeoutSeconds: 60,
          saveRunContent: true,
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 400, y: 0 },
        config: { outputType: "text", template: "", variables: [] },
      },
    ],
    edges: [
      { id: "producer-consumer", from: "producer", to: "consumer" },
      { id: "consumer-end", from: "consumer", to: "end" },
    ],
  }
}

function singleInputDefinition(
  binding: {
    readonly name: string
    readonly source: { readonly type: "param"; readonly param: string }
  },
): WorkflowDefinition {
  return {
    id: "single-script-input",
    name: "Single script input",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    meta: { schemaVersion: "2.7.0" },
    params: [],
    nodes: [
      {
        id: "script",
        name: "Script",
        type: "javascript_run",
        position: { x: 0, y: 0 },
        config: {
          source: "postMessage(event.data)",
          inputs: [binding],
          timeoutSeconds: 60,
          saveRunContent: true,
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "", variables: [] },
      },
    ],
    edges: [{ id: "script-end", from: "script", to: "end" }],
  }
}
