import { describe, expect, it } from "vitest"
import { normalizeRuleBody, normalizeSkillFiles } from "./content-store-file-rules"
import { buildContentStorePackage } from "./content-store-package"

describe("buildContentStorePackage", () => {
  it("creates a skill package manifest with stable content paths", async () => {
    const files = normalizeSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("# Skill") }])
    const result = await buildContentStorePackage({
      contentId: "content-1",
      versionId: "version-1",
      type: "skill",
      title: "Skill",
      files,
    })

    expect(result.bytes.length).toBeGreaterThan(0)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      contentId: "content-1",
      versionId: "version-1",
      type: "skill",
      title: "Skill",
      mainFile: "content/SKILL.md",
    })
    expect(result.manifest.files[0]).toMatchObject({
      path: "content/SKILL.md",
      kind: "text",
      size: Buffer.byteLength("# Skill"),
    })
  })

  it("creates a rule package with RULE.md as the main file", async () => {
    const file = normalizeRuleBody("Use concise language.")
    const result = await buildContentStorePackage({
      contentId: "content-2",
      versionId: "version-2",
      type: "rule",
      title: "Rule",
      files: [file],
    })

    expect(result.manifest.mainFile).toBe("content/RULE.md")
    expect(result.manifest.files[0]?.path).toBe("content/RULE.md")
  })
})
