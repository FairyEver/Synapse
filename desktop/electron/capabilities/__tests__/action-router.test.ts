import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../action-router"

describe("createSynapseActionRouter", () => {
  it("routes Data Store actions to the Data Store dispatcher", async () => {
    const dataStoreDispatch = vi.fn(() => ({ ok: true as const, data: ["tables"] }))
    const schedulerDispatch = vi.fn()
    const router = createSynapseActionRouter({
      dataStoreDispatch,
      schedulerDispatch,
    })

    await expect(router.dispatch("listTables", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: ["tables"],
    })
    expect(dataStoreDispatch).toHaveBeenCalledWith("listTables", {}, { source: "api" })
    expect(schedulerDispatch).not.toHaveBeenCalled()
  })

  it("routes Scheduler actions to the Scheduler dispatcher", async () => {
    const dataStoreDispatch = vi.fn()
    const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const router = createSynapseActionRouter({
      dataStoreDispatch,
      schedulerDispatch,
    })

    await expect(router.dispatch("schedulerTaskList", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(schedulerDispatch).toHaveBeenCalledWith("schedulerTaskList", {}, { source: "api" })
    expect(dataStoreDispatch).not.toHaveBeenCalled()
  })

  it("routes second-phase Scheduler actions to the Scheduler dispatcher", async () => {
    const dataStoreDispatch = vi.fn()
    const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const router = createSynapseActionRouter({
      dataStoreDispatch,
      schedulerDispatch,
    })

    await expect(router.dispatch("schedulerTaskRunsList", { taskId: "task:1" }, { source: "api" }))
      .resolves.toEqual({ ok: true, data: [] })
    expect(schedulerDispatch).toHaveBeenCalledWith("schedulerTaskRunsList", { taskId: "task:1" }, { source: "api" })
    expect(dataStoreDispatch).not.toHaveBeenCalled()
  })

  it("keeps schedulerTaskDelete unknown on the external router", async () => {
    const router = createSynapseActionRouter({
      dataStoreDispatch: vi.fn(),
      schedulerDispatch: vi.fn(),
    })

    await expect(router.dispatch("schedulerTaskDelete", { taskId: "task:1" }, { source: "api" }))
      .rejects.toThrow(/Unknown action/)
  })

  it("rejects unknown actions", async () => {
    const router = createSynapseActionRouter({
      dataStoreDispatch: vi.fn(),
      schedulerDispatch: vi.fn(),
    })

    await expect(router.dispatch("missingAction", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })
})
