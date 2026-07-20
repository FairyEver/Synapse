import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  IpcChannelNotFoundError,
  IpcModuleAlreadyRegisteredError,
  IpcProtocolVersionMismatchError,
  IpcRuntimeError,
  IpcValidationError,
  type IpcMethodDescriptor,
  type IpcModule,
} from "../index"

describe("IPC runtime types + errors (T3.1)", () => {
  it("error hierarchy carries codes and retriable flags", () => {
    const validation = new IpcValidationError("synapse:app:test:operation:noop", [
      { path: ["foo"], message: "Required" },
    ])
    expect(validation.code).toBe("ipc/validation")
    expect(validation.retriable).toBe(false)
    expect(validation.details?.channel).toBe("synapse:app:test:operation:noop")

    const notFound = new IpcChannelNotFoundError("synapse:app:ghost:operation:method")
    expect(notFound.code).toBe("ipc/channel-not-found")

    const dupe = new IpcModuleAlreadyRegisteredError("content")
    expect(dupe.code).toBe("ipc/module-already-registered")

    const mismatch = new IpcProtocolVersionMismatchError(2, 1)
    expect(mismatch.code).toBe("ipc/protocol-version-mismatch")
    expect(mismatch.details?.serverVersion).toBe(2)
    expect(mismatch.details?.clientVersion).toBe(1)
  })

  it("toJSON() exposes the structured payload that crosses the bridge", () => {
    const err = new IpcValidationError("synapse:app:x:operation:y", [{ path: ["a"], message: "missing" }])
    const json = err.toJSON()
    expect(json.code).toBe("ipc/validation")
    expect(json.retriable).toBe(false)
    expect(json.details).toBeDefined()
  })

  it("IpcMethodDescriptor type accepts a minimal invoke method", () => {
    const method: IpcMethodDescriptor<{ name: string }, string> = {
      kind: "invoke",
      operationId: "app.demo.operation.greet",
      request: z.object({ name: z.string() }),
      response: z.string(),
      handler: (_ctx, req) => `hello, ${req.name}`,
    }
    expect(method.kind).toBe("invoke")
    expect(method.operationId).toBe("app.demo.operation.greet")
  })

  it("IpcModule type accepts a module with methods + events", () => {
    const module: IpcModule = {
      id: "demo",
      methods: {},
      events: {
        ping: {
          kind: "event",
          operationId: "app.demo.operation.ping",
          payload: z.object({ ts: z.string() }),
        },
      },
    }
    expect(module.id).toBe("demo")
    expect(Object.keys(module.events)).toEqual(["ping"])
  })

  it("IpcRuntimeError without options defaults retriable to false", () => {
    const e = new IpcRuntimeError("custom/code", "boom")
    expect(e.retriable).toBe(false)
    expect(e.code).toBe("custom/code")
  })
})
