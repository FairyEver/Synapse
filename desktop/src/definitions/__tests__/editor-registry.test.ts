import { describe, expect, it } from "vitest"

import {
  editorDefinitions,
  installFormDefinitionByEditorId,
  mcpDefinitions,
} from "../generated/renderer-registry"

describe("editor definition registry", () => {
  it("exports sorted editor metadata for all supported editors", () => {
    expect(editorDefinitions.map((definition) => definition.id)).toEqual([
      "cursor",
      "codex",
      "claude-code",
      "windsurf",
      "antigravity",
      "hermes",
    ])
  })

  it("keeps MCP and install form metadata renderer-safe", () => {
    expect(mcpDefinitions.map((definition) => definition.target)).toEqual([
      "claude",
      "cursor",
      "codex",
      "windsurf",
      "antigravity",
      "hermes",
    ])
    expect(installFormDefinitionByEditorId.has("cursor")).toBe(true)
    expect(installFormDefinitionByEditorId.has("windsurf")).toBe(true)
    expect(installFormDefinitionByEditorId.has("claude-code")).toBe(true)
  })
})
