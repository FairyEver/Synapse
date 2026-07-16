import { describe, expect, it, vi } from "vitest"
import { SYNAPSE_SKILL_SERVICE_ID } from "../../shared/capability"
import { synapseSkillIpcModule } from "../ipc"

describe("synapseSkillIpcModule", () => {
  it("exposes prepare install source through the registered service", async () => {
    const service = {
      prepareInstallSource: vi.fn(async () => ({
        kind: "skill",
        origin: "prepared",
        sourceIdentity: "synapse-skill",
        name: "synapse-skill",
        title: "Synapse Skill",
        description: "",
        preparedSourceId: "synapse-skill:test",
        mainContent: "# Synapse Skill",
        sourceFingerprint: "sha256:test",
      })),
    }
    const resolve = vi.fn(() => service)
    expect(synapseSkillIpcModule.id).toBe("synapseSkill")
    expect(synapseSkillIpcModule.methods.prepareInstallSource.channel).toBe(
      "synapse:synapse-skill:install-source:prepare",
    )

    const result = await synapseSkillIpcModule.methods.prepareInstallSource.handler({ resolve } as never, undefined)

    expect(resolve).toHaveBeenCalledWith(SYNAPSE_SKILL_SERVICE_ID)
    expect(service.prepareInstallSource).toHaveBeenCalledOnce()
    expect(result.sourceIdentity).toBe("synapse-skill")
    expect(synapseSkillIpcModule.methods.prepareInstallSource.response?.parse(result)).toEqual(result)
  })
})
