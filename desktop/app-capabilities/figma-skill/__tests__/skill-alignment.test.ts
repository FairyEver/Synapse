import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const skillRoot = path.join(__dirname, "..", "skill-package", "skills")
const desktopTools = [
  "get_design_context",
  "get_variable_defs",
  "get_screenshot",
  "get_motion_context",
  "get_metadata",
  "get_figjam",
] as const
const desktopPrompts = [
  "get_code_for_selection",
  "create_design_system_rules",
  "map_selection_to_code_connect",
] as const
const unsupportedToolNames = [
  "create_new_file",
  "generate_figma_design",
  "generate_diagram",
  "upload_assets",
  "use_figma",
  "get_libraries",
  "search_design_system",
  "get_context_for_code_connect",
  "get_code_connect_map",
  "get_code_connect_suggestions",
  "send_code_connect_mappings",
] as const
function readSkills(): string {
  return readdirSync(skillRoot)
    .map((name) => readFileSync(path.join(skillRoot, name, "SKILL.md"), "utf8"))
    .join("\n")
}

describe("Figma Desktop Skill alignment", () => {
  it("references only the tools exposed by the local Desktop MCP", () => {
    const content = readSkills()
    for (const name of unsupportedToolNames) {
      expect(content, name).not.toContain(`\`${name}\``)
    }
    for (const name of desktopTools) {
      expect(content, name).toContain(`\`${name}\``)
    }
  })

  it("documents the prompts exposed by the local Desktop MCP", () => {
    const content = readSkills()
    for (const name of desktopPrompts) {
      expect(content, name).toContain(`\`${name}\``)
    }
  })
})
