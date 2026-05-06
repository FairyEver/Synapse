import { describe, expect, it, vi } from "vitest"
import { AgentAvailabilityService, type AgentAvailability } from "../agent-availability-service"

describe("AgentAvailabilityService", () => {
  it("returns available: true when binary is found", async () => {
    const service = new AgentAvailabilityService({
      whichBin: vi.fn().mockResolvedValue("/usr/local/bin/claude"),
      definitions: [
        { id: "claude-code", label: "Claude Code", runtime: { kind: "local-cli", binaries: ["claude"] } },
      ],
    })

    const results = await service.detectAll()

    expect(results).toEqual([
      { agentType: "claude-code", label: "Claude Code", available: true, binaryPath: "/usr/local/bin/claude" },
    ])
  })

  it("returns available: false when binary is not found", async () => {
    const service = new AgentAvailabilityService({
      whichBin: vi.fn().mockResolvedValue(null),
      definitions: [
        { id: "codex", label: "Codex", runtime: { kind: "local-cli", binaries: ["codex"] } },
      ],
    })

    const results = await service.detectAll()

    expect(results).toEqual([
      { agentType: "codex", label: "Codex", available: false, binaryPath: undefined },
    ])
  })

  it("caches results after first detection", async () => {
    const whichBin = vi.fn().mockResolvedValue("/usr/local/bin/claude")
    const service = new AgentAvailabilityService({
      whichBin,
      definitions: [
        { id: "claude-code", label: "Claude Code", runtime: { kind: "local-cli", binaries: ["claude"] } },
      ],
    })

    await service.detectAll()
    await service.detectAll()

    expect(whichBin).toHaveBeenCalledTimes(1)
  })

  it("refresh bypasses cache", async () => {
    const whichBin = vi.fn().mockResolvedValue("/usr/local/bin/claude")
    const service = new AgentAvailabilityService({
      whichBin,
      definitions: [
        { id: "claude-code", label: "Claude Code", runtime: { kind: "local-cli", binaries: ["claude"] } },
      ],
    })

    await service.detectAll()
    await service.refresh()

    expect(whichBin).toHaveBeenCalledTimes(2)
  })
})
