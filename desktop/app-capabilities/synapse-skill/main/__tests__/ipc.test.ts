import { describe, expect, it, vi } from "vitest"
import { synapseSkillIpcModule } from "../ipc"

vi.mock("../service", () => ({
  synapseSkillService: {
    prepareInstallSource: vi.fn(async () => ({
      kind: "skill",
      origin: "prepared",
      sourceIdentity: "synapse-skill",
      name: "synapse-skill",
      title: "Synapse Skill",
      description: "",
      preparedSourceId: "synapse-skill:test",
      mainContent: "# Synapse Skill",
    })),
  },
}))

describe("synapseSkillIpcModule", () => {
  it("exposes prepare install source", async () => {
    expect(synapseSkillIpcModule.id).toBe("synapseSkill")
    expect(synapseSkillIpcModule.methods.prepareInstallSource.channel).toBe(
      "synapse:synapse-skill:install-source:prepare",
    )

    const result = await synapseSkillIpcModule.methods.prepareInstallSource.handler({} as never, undefined)

    expect(result.sourceIdentity).toBe("synapse-skill")
    expect(synapseSkillIpcModule.methods.prepareInstallSource.response?.parse(result)).toEqual(result)
  })
})
