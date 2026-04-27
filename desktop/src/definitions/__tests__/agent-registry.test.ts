import { describe, expect, it } from "vitest"

import { agentDefinitions } from "../generated/renderer-registry"

describe("agent definition registry", () => {
  it("exports sorted renderer-safe Agent runtime metadata", () => {
    expect(agentDefinitions.map((definition) => definition.id)).toEqual([
      "claude-code",
      "codex",
    ])
  })

  it("declares local CLI dependencies and mode lists", () => {
    const claude = agentDefinitions.find((definition) => definition.id === "claude-code")
    const codex = agentDefinitions.find((definition) => definition.id === "codex")

    expect(claude?.runtime).toEqual({ kind: "local-cli", binaries: ["claude"] })
    expect(claude?.modes.map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "bypassPermissions",
      "dontAsk",
    ])
    expect(codex?.runtime).toEqual({ kind: "local-cli", binaries: ["codex"] })
    expect(codex?.modes.map((mode) => mode.key)).toEqual([
      "suggest",
      "auto-edit",
      "full-auto",
      "yolo",
    ])
  })
})
