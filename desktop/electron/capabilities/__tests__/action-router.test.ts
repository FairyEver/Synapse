import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../action-router"

function createRouterDeps(overrides: Partial<Parameters<typeof createSynapseActionRouter>[0]> = {}) {
  return {
    appDispatch: vi.fn(),
    automationDispatch: vi.fn(),
    contentDispatch: vi.fn(),
    databaseDispatch: vi.fn(),
    driveDispatch: vi.fn(),
    modelPriceDispatch: vi.fn(),
    repositoryDispatch: vi.fn(),
    variableDispatch: vi.fn(),
    workflowDispatch: vi.fn(),
    ...overrides,
  }
}

describe("createSynapseActionRouter", () => {
  it("routes App actions to the App dispatcher", async () => {
    const appDispatch = vi.fn(async () => ({ ok: true as const, data: { outputPath: "/tmp/output.docx" } }))
    const deps = createRouterDeps({ appDispatch })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.document_template.docx.generate", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: { outputPath: "/tmp/output.docx" },
    })
    expect(appDispatch).toHaveBeenCalledWith("app.document_template.docx.generate", {}, { source: "api" })
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Database actions to the Database dispatcher", async () => {
    const databaseDispatch = vi.fn(() => ({ ok: true as const, data: ["tables"] }))
    const deps = createRouterDeps({
      databaseDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.database.table.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: ["tables"],
    })
    expect(databaseDispatch).toHaveBeenCalledWith("database.table.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Model Price actions to the Model Price dispatcher", async () => {
    const modelPriceDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      modelPriceDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.model_price.rule.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(modelPriceDispatch).toHaveBeenCalledWith("model_price.rule.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Repository actions to the Repository dispatcher", async () => {
    const repositoryDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      repositoryDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.settings.repository.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(repositoryDispatch).toHaveBeenCalledWith("repository.item.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Automation actions to the Automation dispatcher", async () => {
    const automationDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({ automationDispatch })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.automation.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(automationDispatch).toHaveBeenCalledWith("automation.item.list", {}, { source: "api" })
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

    await expect(router.dispatch("app.settings.variable.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(variableDispatch).toHaveBeenCalledWith("variable.item.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Workflow actions to the Workflow dispatcher", async () => {
    const workflowDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      workflowDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.workflow.definition.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(workflowDispatch).toHaveBeenCalledWith("workflow.definition.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
  })

  it("routes Content actions to the Content dispatcher", async () => {
    const contentDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      contentDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.resource_repository.skill.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(contentDispatch).toHaveBeenCalledWith("content.skill.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Drive actions to the Drive dispatcher", async () => {
    const driveDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      driveDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.drive.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(driveDispatch).toHaveBeenCalledWith("drive.item.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.modelPriceDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.variableDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes legacy API action ids to their existing dispatchers", async () => {
    const automationDispatch = vi.fn(async () => ({ ok: true as const }))
    const databaseDispatch = vi.fn(async () => ({ ok: true as const }))
    const driveDispatch = vi.fn(async () => ({ ok: true as const }))
    const contentDispatch = vi.fn(async () => ({ ok: true as const }))
    const modelPriceDispatch = vi.fn(async () => ({ ok: true as const }))
    const repositoryDispatch = vi.fn(async () => ({ ok: true as const }))
    const variableDispatch = vi.fn(async () => ({ ok: true as const }))
    const workflowDispatch = vi.fn(async () => ({ ok: true as const }))
    const deps = createRouterDeps({
      automationDispatch,
      contentDispatch,
      databaseDispatch,
      driveDispatch,
      modelPriceDispatch,
      repositoryDispatch,
      variableDispatch,
      workflowDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("automation.item.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("database.table.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("drive.item.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("content.skill.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("model_price.rule.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("repository.item.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("variable.item.list", {}, { source: "api" })).resolves.toEqual({ ok: true })
    await expect(router.dispatch("workflow.definition.list", {}, { source: "api" })).resolves.toEqual({ ok: true })

    expect(automationDispatch).toHaveBeenCalledWith("automation.item.list", {}, { source: "api" })
    expect(databaseDispatch).toHaveBeenCalledWith("database.table.list", {}, { source: "api" })
    expect(driveDispatch).toHaveBeenCalledWith("drive.item.list", {}, { source: "api" })
    expect(contentDispatch).toHaveBeenCalledWith("content.skill.list", {}, { source: "api" })
    expect(modelPriceDispatch).toHaveBeenCalledWith("model_price.rule.list", {}, { source: "api" })
    expect(repositoryDispatch).toHaveBeenCalledWith("repository.item.list", {}, { source: "api" })
    expect(variableDispatch).toHaveBeenCalledWith("variable.item.list", {}, { source: "api" })
    expect(workflowDispatch).toHaveBeenCalledWith("workflow.definition.list", {}, { source: "api" })
  })

  it("rejects unknown actions", async () => {
    const router = createSynapseActionRouter(createRouterDeps())

    await expect(router.dispatch("missingAction", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })
})
