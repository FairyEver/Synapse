import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { normalizeRuleBody, normalizeSkillFiles } from "./content-store-file-rules"
import { buildContentStorePackage } from "./content-store-package"

describe("buildContentStorePackage", () => {
  it("creates a skill package manifest with stable content paths", async () => {
    const files = normalizeSkillFiles([
      { path: "SKILL.md", bytes: Buffer.from("# Skill") },
      { path: "references/guide.md", bytes: Buffer.from("Guide") },
    ])
    const result = await buildContentStorePackage({
      contentId: "content-1",
      versionId: "version-1",
      type: "skill",
      title: "Skill",
      files,
    })

    expect(result.bytes.length).toBeGreaterThan(0)
    expect(result.sha256).toBe(createHash("sha256").update(result.bytes).digest("hex"))
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
    expect(readZipEntryNames(result.bytes)).toEqual([
      "manifest.json",
      "content/SKILL.md",
      "content/references/guide.md",
    ])
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
    expect(result.sha256).toBe(createHash("sha256").update(result.bytes).digest("hex"))
    expect(readZipEntryNames(result.bytes)).toEqual(["manifest.json", "content/RULE.md"])
  })
})

function readZipEntryNames(bytes: Buffer): string[] {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(bytes)
  const totalEntries = bytes.readUInt16LE(endOfCentralDirectoryOffset + 10)
  const centralDirectoryOffset = bytes.readUInt32LE(endOfCentralDirectoryOffset + 16)
  const names: string[] = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
    const fileNameLength = bytes.readUInt16LE(offset + 28)
    const extraFieldLength = bytes.readUInt16LE(offset + 30)
    const fileCommentLength = bytes.readUInt16LE(offset + 32)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength

    names.push(bytes.subarray(fileNameStart, fileNameEnd).toString("utf8"))
    offset = fileNameEnd + extraFieldLength + fileCommentLength
  }

  return names
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error("ZIP end of central directory not found")
}
