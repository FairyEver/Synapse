import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  SkillRegistry,
  buildSkillInvocationPrompt,
} from "../skill-registry"

describe("SkillRegistry", () => {
  it("discovers SKILL.md files and builds invocation prompts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-skill-"))
    const skillDir = path.join(workspace, ".agents", "skills", "reviewer")
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: Reviewer",
      "description: Review code",
      "---",
      "Inspect the diff.",
    ].join("\n"))

    const registry = new SkillRegistry({ workspacePath: workspace })
    const skill = await registry.resolve("reviewer")

    expect(skill).toEqual(expect.objectContaining({
      name: "reviewer",
      displayName: "Reviewer",
      description: "Review code",
    }))
    expect(buildSkillInvocationPrompt(skill!, ["src/app.ts"]))
      .toContain("## User Arguments:\nsrc/app.ts")
  })
})

