import { describe, expect, it } from "vitest"

import {
  agentDefinitions,
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
      "workbuddy",
    ])
  })

  it("registers WorkBuddy as a Skill-only editor with MCP metadata", () => {
    expect(editorDefinitions.find((definition) => definition.id === "workbuddy")).toMatchObject({
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["skill"],
    })
    expect(mcpDefinitions.find((definition) => definition.target === "workbuddy")).toMatchObject({
      label: "WorkBuddy",
      order: 70,
      settingsPathSegments: [".workbuddy", "mcp.json"],
      settingsFormat: "json-mcp-servers",
    })
    expect(installFormDefinitionByEditorId.has("workbuddy")).toBe(false)
    expect(agentDefinitions.map((definition) => String(definition.relatedEditorId))).not.toContain("workbuddy")
  })

  it("keeps MCP and install form metadata renderer-safe", () => {
    expect(mcpDefinitions.map((definition) => definition.target)).toEqual([
      "claude",
      "cursor",
      "codex",
      "windsurf",
      "antigravity",
      "hermes",
      "workbuddy",
    ])
    expect(installFormDefinitionByEditorId.has("cursor")).toBe(true)
    expect(installFormDefinitionByEditorId.has("windsurf")).toBe(true)
    expect(installFormDefinitionByEditorId.has("claude-code")).toBe(true)
  })
})
