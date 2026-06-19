import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const wikiIngestSkillPath = path.join(
  process.cwd(),
  "resources",
  "knowledge-base",
  "synapse-knowledge-base-template",
  "skills",
  "wiki-ingest",
  "SKILL.md",
)

describe("knowledge base wiki-ingest template", () => {
  it("delegates delta hash comparison and manifest writes to Synapse", async () => {
    const skill = await readFile(wikiIngestSkillPath, "utf8")

    expect(skill).not.toContain("md5sum")
    expect(skill).toContain("Synapse owns the SHA-256 comparison")
    expect(skill).toContain("process only the listed sources")
    expect(skill).toContain("Do not edit `.raw/.manifest.json`")
  })
})
