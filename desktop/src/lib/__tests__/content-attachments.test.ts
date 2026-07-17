import { describe, expect, it } from "vitest"

import {
  assertNoRuntimeSkillEnvPath,
  assertNoPublishRuntimeEnvPath,
  assertUniqueContentAttachmentPaths,
  normalizeContentAttachmentPath,
  normalizeContentAttachmentSegment,
  normalizeContentFileNameSegment,
} from "../content-attachments"

describe("normalizeContentAttachmentPath", () => {
  it("keeps nested paths while removing traversal segments", () => {
    expect(normalizeContentAttachmentPath("../assets/./template.txt"))
      .toBe("assets/template.txt")
  })

  it("converts Windows-unsafe path segments", () => {
    expect(normalizeContentAttachmentPath("assets/a:b*?.txt"))
      .toBe("assets/a_b__.txt")
  })

  it("protects Windows reserved names and trailing dots", () => {
    expect(normalizeContentAttachmentPath("CON.txt/aux. /valid. "))
      .toBe("_CON.txt/_aux/valid")
  })

  it("removes absolute drive prefixes and empty unsafe segments", () => {
    expect(normalizeContentAttachmentPath("C:\\temp\\...\\NUL"))
      .toBe("C_/temp/_NUL")
  })

  it("normalizes one Windows-safe file segment", () => {
    expect(normalizeContentAttachmentSegment("C:\\temp\\AUX.txt"))
      .toBe("_AUX.txt")
  })

  it("normalizes one Windows-safe download file name segment", () => {
    expect(normalizeContentFileNameSegment("CON"))
      .toBe("_CON")
    expect(normalizeContentFileNameSegment("PRN.zip"))
      .toBe("_PRN.zip")
    expect(normalizeContentFileNameSegment("会议:纪要. "))
      .toBe("会议_纪要")
    expect(normalizeContentFileNameSegment("")).toBe("download")
  })

  it("rejects collisions after Windows-safe normalization", () => {
    expect(() => assertUniqueContentAttachmentPaths(["assets/a:b.txt", "assets/a?b.txt"]))
      .toThrow("附件文件名重复：assets/a_b.txt")
  })

  it("rejects case-only collisions on Windows paths", () => {
    expect(() => assertUniqueContentAttachmentPaths(["assets/Readme.md", "assets/readme.md"]))
      .toThrow("附件文件名重复：assets/readme.md")
  })

  it("normalizes Unicode names before comparing attachment paths", () => {
    expect(() => assertUniqueContentAttachmentPaths(["assets/e\u0301.txt", "assets/é.txt"]))
      .toThrow("附件文件名重复：assets/é.txt")
  })

  it("rejects root Skill install control files as attachments", () => {
    expect(() => assertUniqueContentAttachmentPaths(["skill.md"]))
      .toThrow("附件路径不能使用 Skill 安装保留文件：skill.md")
    expect(() => assertUniqueContentAttachmentPaths([".Synapse.JSON"]))
      .toThrow("附件路径不能使用 Skill 安装保留文件：.Synapse.JSON")
    expect(() => assertUniqueContentAttachmentPaths([".synapse.repository.json"]))
      .toThrow("附件路径不能使用 Skill 安装保留文件：.synapse.repository.json")
    expect(() => assertUniqueContentAttachmentPaths(["references/SKILL.md"]))
      .not.toThrow()
  })

  it("allows only root .env.example in publish attachments", () => {
    expect(() => assertNoPublishRuntimeEnvPath([".env.example", "references/guide.md"]))
      .not.toThrow()
    expect(() => assertNoPublishRuntimeEnvPath([".env.local"]))
      .toThrow("运行时 .env")
    expect(() => assertNoPublishRuntimeEnvPath(["nested/.env.example"]))
      .toThrow("运行时 .env")
  })

  it("allows only root .env.example in install attachments", () => {
    expect(() => assertNoRuntimeSkillEnvPath([".env.example", "references/guide.md"]))
      .not.toThrow()
    expect(() => assertNoRuntimeSkillEnvPath([".env.local"]))
      .toThrow("Skill 源目录不能包含 .env")
    expect(() => assertNoRuntimeSkillEnvPath(["nested/.ENV.production"]))
      .toThrow("Skill 源目录不能包含 .env")
    expect(() => assertNoRuntimeSkillEnvPath(["nested/.env.example"]))
      .toThrow("Skill 源目录不能包含 .env")
  })
})
