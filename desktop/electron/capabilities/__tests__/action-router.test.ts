import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../action-router"

describe("createSynapseActionRouter", () => {
  it("routes Database actions to the Database dispatcher", async () => {
    const databaseDispatch = vi.fn(() => ({ ok: true as const, data: ["tables"] }))
    const schedulerDispatch = vi.fn()
    const workflowDispatch = vi.fn()
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
      workflowDispatch,
    })

    await expect(router.dispatch("database.table.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: ["tables"],
    })
    expect(databaseDispatch).toHaveBeenCalledWith("database.table.list", {}, { source: "api" })
    expect(schedulerDispatch).not.toHaveBeenCalled()
    expect(workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Scheduler actions to the Scheduler dispatcher", async () => {
    const databaseDispatch = vi.fn()
    const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const workflowDispatch = vi.fn()
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
      workflowDispatch,
    })

    await expect(router.dispatch("scheduler.task.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(schedulerDispatch).toHaveBeenCalledWith("scheduler.task.list", {}, { source: "api" })
    expect(databaseDispatch).not.toHaveBeenCalled()
    expect(workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes second-phase Scheduler actions to the Scheduler dispatcher", async () => {
    const databaseDispatch = vi.fn()
    const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const workflowDispatch = vi.fn()
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
      workflowDispatch,
    })

    await expect(router.dispatch("scheduler.run.list", { taskId: "task:1" }, { source: "api" }))
      .resolves.toEqual({ ok: true, data: [] })
    expect(schedulerDispatch).toHaveBeenCalledWith("scheduler.run.list", { taskId: "task:1" }, { source: "api" })
    expect(databaseDispatch).not.toHaveBeenCalled()
    expect(workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Workflow actions to the Workflow dispatcher", async () => {
    const databaseDispatch = vi.fn()
    const schedulerDispatch = vi.fn()
    const workflowDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
      workflowDispatch,
    })

    await expect(router.dispatch("workflow.definition.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(workflowDispatch).toHaveBeenCalledWith("workflow.definition.list", {}, { source: "api" })
    expect(databaseDispatch).not.toHaveBeenCalled()
    expect(schedulerDispatch).not.toHaveBeenCalled()
  })

  it("keeps scheduler.task.delete unknown on the external router", async () => {
    const router = createSynapseActionRouter({
      databaseDispatch: vi.fn(),
      schedulerDispatch: vi.fn(),
      workflowDispatch: vi.fn(),
    })

    await expect(router.dispatch("scheduler.task.delete", { taskId: "task:1" }, { source: "api" }))
      .rejects.toThrow(/Unknown action/)
  })

  it("rejects unknown actions", async () => {
    const router = createSynapseActionRouter({
      databaseDispatch: vi.fn(),
      schedulerDispatch: vi.fn(),
      workflowDispatch: vi.fn(),
    })

    await expect(router.dispatch("missingAction", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })
})
