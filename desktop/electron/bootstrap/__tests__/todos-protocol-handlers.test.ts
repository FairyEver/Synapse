import { describe, expect, it, vi } from "vitest"
import { TODOS_OPEN_HANDLER, todosCapabilityManifest } from "../../../app-capabilities/todos/shared/manifest"
import { createTodosProtocolHandlers } from "../todos-protocol-handlers"
describe("Todo protocol", () => {
  it("accepts only the exact Todo reference and opens its owned read target", async () => {
    const schema = todosCapabilityManifest.protocolRoutes[0].paramsSchema
    for (const url of ["synapse://todos/a?delete=1", "synapse://todos/a#x", "synapse://todos/a/b", "synapse://todos/a%2Fb", "synapse://todos//a"]) expect(schema.safeParse({ deepLink: url }).success).toBe(false)
    const open = vi.fn(async () => {})
    const handlers = createTodosProtocolHandlers({ get: <T,>() => ({ open }) as T })
    await handlers[TODOS_OPEN_HANDLER]({ deepLink: "synapse://todos/a" })
    expect(open).toHaveBeenCalledWith("todos", { todoOpenRequest: { id: "a", requestId: expect.any(String) } })
  })
})
