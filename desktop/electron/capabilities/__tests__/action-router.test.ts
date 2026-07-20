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
    skillRepositoryDispatch: vi.fn(),
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
    expect(databaseDispatch).toHaveBeenCalledWith("app.database.table.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
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
    expect(modelPriceDispatch).toHaveBeenCalledWith("app.model_price.rule.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
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
    expect(repositoryDispatch).toHaveBeenCalledWith("app.settings.repository.item.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Skill Repository actions unchanged to the Skill Repository dispatcher", async () => {
    const skillRepositoryDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({
      skillRepositoryDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.skill_repository.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(skillRepositoryDispatch).toHaveBeenCalledWith("app.skill_repository.item.list", {}, { source: "api" })
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
  })

  it("routes Automation actions to the Automation dispatcher", async () => {
    const automationDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const deps = createRouterDeps({ automationDispatch })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.automation.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(automationDispatch).toHaveBeenCalledWith("app.automation.item.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("routes Secrets actions through the App dispatcher", async () => {
    const appDispatch = vi.fn(async () => ({ ok: true as const, data: { secrets: [], total: 0 } }))
    const deps = createRouterDeps({ appDispatch })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("app.secrets.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: { secrets: [], total: 0 },
    })
    expect(appDispatch).toHaveBeenCalledWith("app.secrets.item.list", {}, { source: "api" })
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
    expect(workflowDispatch).toHaveBeenCalledWith("app.workflow.definition.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
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
    expect(contentDispatch).toHaveBeenCalledWith("app.resource_repository.skill.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
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
    expect(driveDispatch).toHaveBeenCalledWith("app.drive.item.list", {}, { source: "api" })
    expect(deps.automationDispatch).not.toHaveBeenCalled()
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.modelPriceDispatch).not.toHaveBeenCalled()
    expect(deps.repositoryDispatch).not.toHaveBeenCalled()
    expect(deps.skillRepositoryDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })

  it("rejects all retired API action prefixes", async () => {
    const deps = createRouterDeps()
    const router = createSynapseActionRouter(deps)
    const retiredActions = [
      "automation.item.list",
      "database.table.list",
      "drive.item.list",
      "content.skill.list",
      "model_price.rule.list",
      "repository.item.list",
      "workflow.definition.list",
    ]

    for (const action of retiredActions) {
      await expect(router.dispatch(action, {}, { source: "api" })).rejects.toThrow(/Unknown action/)
    }

    for (const dispatch of Object.values(deps)) {
      expect(dispatch).not.toHaveBeenCalled()
    }
  })

  it("rejects retired Variable actions", async () => {
    const router = createSynapseActionRouter(createRouterDeps())
    const retiredCanonicalAction = ["app", "settings", "variable", "item", "list"].join(".")
    const retiredLegacyAction = ["variable", "item", "list"].join(".")

    await expect(router.dispatch(retiredCanonicalAction, {}, { source: "api" })).rejects.toThrow(
      /Unknown action/,
    )
    await expect(router.dispatch(retiredLegacyAction, {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })

  it("rejects unknown actions", async () => {
    const router = createSynapseActionRouter(createRouterDeps())

    await expect(router.dispatch("missingAction", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })

  it("does not map legacy skill_repository action ids", async () => {
    const router = createSynapseActionRouter(createRouterDeps())

    await expect(router.dispatch("skill_repository.item.list", {}, { source: "api" })).rejects.toThrow(
      /Unknown action/,
    )
  })
})
