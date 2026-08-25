import { describe, expect, it } from "vitest"

import { agentDefinitions } from "../generated/renderer-registry"

describe("agent definition registry", () => {
  it("exports sorted renderer-safe Agent runtime metadata", () => {
    expect(agentDefinitions.map((definition) => definition.id)).toEqual([
      "claude-code",
    ])
  })

  it("declares local CLI dependencies and mode lists", () => {
    const claude = agentDefinitions.find((definition) => definition.id === "claude-code")

    expect(claude?.icon).toEqual(expect.any(String))
    expect(claude?.runtime).toEqual({ kind: "local-cli", binaries: ["claude"] })
    expect(claude?.modes.map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "bypassPermissions",
      "dontAsk",
    ])
    expect(claude?.commands.find((command) => command.name === "mode")?.description).toBe("List modes")
  })

  it("publishes /compact without the removed /compress command", () => {
    const claude = agentDefinitions.find((definition) => definition.id === "claude-code")
    const commandNames = claude?.commands.map((command) => command.name) ?? []

    expect(commandNames).toContain("compact")
    expect(commandNames).not.toContain("compress")
  })
})
