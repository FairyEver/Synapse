import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  prepareInlineRuleSource: vi.fn(),
  prepareLocalSkillSource: vi.fn(),
}))

vi.mock("../../../services/installer-source-service", () => ({
  installerSourceService: {
    prepareInlineRuleSource: mocks.prepareInlineRuleSource,
    prepareLocalSkillSource: mocks.prepareLocalSkillSource,
  },
}))

import { installersIpcModule } from "../ipc"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareInlineRuleSource.mockResolvedValue({
    kind: "rule",
    origin: "inline",
    sourceIdentity: "inline-rule:abc",
    inlineSourceId: "source-1",
    name: "team.rule",
    body: "# Rule",
  })
  mocks.prepareLocalSkillSource.mockResolvedValue({
    kind: "skill",
    origin: "local-directory",
    sourceIdentity: "local-skill:abc",
    localSourceId: "source-2",
    name: "team-skill",
    description: "",
    mainContent: "# Skill",
  })
})

describe("installersIpcModule", () => {
  it("prepares inline Rule sources through the service", async () => {
    const harness = createHarness()

    const result = await harness.invoke("synapse:installers:prepare-inline-rule-source", {
      name: "team.rule",
      body: "# Rule",
    })

    expect(result).toMatchObject({ name: "team.rule" })
    expect(mocks.prepareInlineRuleSource).toHaveBeenCalledWith({
      name: "team.rule",
      body: "# Rule",
    })
  })

  it("prepares local Skill sources through the service", async () => {
    const harness = createHarness()

    const result = await harness.invoke("synapse:installers:prepare-local-skill-source", {
      sourceDirectoryPath: "/tmp/skill",
    })

    expect(result).toMatchObject({ name: "team-skill" })
    expect(mocks.prepareLocalSkillSource).toHaveBeenCalledWith({
      sourceDirectoryPath: "/tmp/skill",
    })
  })

  it("rejects empty and extra fields", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:installers:prepare-local-skill-source", {
      sourceDirectoryPath: "",
    })).rejects.toThrow()
    await expect(harness.invoke("synapse:installers:prepare-inline-rule-source", {
      name: "team.rule",
      body: "# Rule",
      rawPath: "/tmp/secret",
    })).rejects.toThrow()

    expect(mocks.prepareLocalSkillSource).not.toHaveBeenCalled()
    expect(mocks.prepareInlineRuleSource).not.toHaveBeenCalled()
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  harness.registry.register(installersIpcModule, {
    moduleId: "installers",
    resolve: <T,>(_serviceId: string): T => {
      throw new Error("installer source IPC should not resolve broad services")
    },
  })
  return harness
}
