import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../action-router"

function createRouterDeps(overrides: Partial<Parameters<typeof createSynapseActionRouter>[0]> = {}) {
  return {
    contentDispatch: vi.fn(),
    databaseDispatch: vi.fn(),
    modelPriceDispatch: vi.fn(),
    repositoryDispatch: vi.fn(),
    schedulerDispatch: vi.fn(),
    variableDispatch: vi.fn(),
    workflowDispatch: vi.fn(),
    ...overrides,
  }
}

describe("createSynapseActionRouter", () => {
  it("routes Database actions to the Database dispatcher", async () => {
    const databaseDispatch = vi.fn(() => ({ ok: true as const, data: ["tables"] }))
    const deps = createRouterDeps({
      databaseDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("database.table.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: ["tables"],
    })
    expect(databaseDispatch).toHaveBeenCalledWith("database.table.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Model Price actions to the Model Price dispatcher", async () => {
    const modelPriceDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      modelPriceDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("model_price.rule.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(modelPriceDispatch).toHaveBeenCalledWith("model_price.rule.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Repository actions to the Repository dispatcher", async () => {
    const repositoryDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      repositoryDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("repository.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(repositoryDispatch).toHaveBeenCalledWith("repository.item.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Scheduler actions to the Scheduler dispatcher", async () => {
    const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      schedulerDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("scheduler.task.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(schedulerDispatch).toHaveBeenCalledWith("scheduler.task.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes second-phase Scheduler actions to the Scheduler dispatcher", async () => {
    const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      schedulerDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("scheduler.run.list", { taskId: "task:1" }, { source: "api" }))
      .resolves.toEqual({ ok: true, data: [] })
    expect(schedulerDispatch).toHaveBeenCalledWith("scheduler.run.list", { taskId: "task:1" }, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Variable actions to the Variable dispatcher", async () => {
    const variableDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      variableDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("variable.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(variableDispatch).toHaveBeenCalledWith("variable.item.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Workflow actions to the Workflow dispatcher", async () => {
    const workflowDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      workflowDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("workflow.definition.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(workflowDispatch).toHaveBeenCalledWith("workflow.definition.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
  })

  it("routes Content actions to the Content dispatcher", async () => {
    const contentDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      contentDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("content.skill.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(contentDispatch).toHaveBeenCalledWith("content.skill.list", {}, { source: "api" })
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("keeps scheduler.task.delete unknown on the external router", async () => {
    const router = createSynapseActionRouter(createRouterDeps())

    await expect(router.dispatch("scheduler.task.delete", { taskId: "task:1" }, { source: "api" }))
      .rejects.toThrow(/Unknown action/)
  })

  it("rejects unknown actions", async () => {
    const router = createSynapseActionRouter(createRouterDeps())

    await expect(router.dispatch("missingAction", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })
})
