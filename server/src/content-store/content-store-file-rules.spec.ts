import { BadRequestException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import {
  detectContentStoreFileKind,
  normalizeContentStorePath,
  normalizePromptBody,
  normalizeRuleBody,
  normalizeSkillFiles,
} from "./content-store-file-rules"
import {
  contentStoreSkillMaxTotalBytes,
  contentStoreSkillMaxFileBytes,
  contentStoreSkillMaxFileCount,
  contentStoreTextMaxBytes,
} from "./content-store.constants"

describe("content store file rules", () => {
  it("requires a non-empty SKILL.md", () => {
    expect(() => normalizeSkillFiles([{ path: "references/a.md", bytes: Buffer.from("x") }])).toThrow(
      BadRequestException,
    )
    expect(() => normalizeSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("   ") }])).toThrow(
      BadRequestException,
    )

    expect(normalizeSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("# Skill") }])[0]).toMatchObject({
      path: "SKILL.md",
      kind: "text",
      text: "# Skill",
    })
  })

  it("normalizes backslashes and rejects paths that escape the content root", () => {
    expect(normalizeContentStorePath("references\\guide.md")).toBe("references/guide.md")
    expect(normalizeContentStorePath("references/./guide.md")).toBe("references/guide.md")
    expect(() => normalizeContentStorePath("../secret")).toThrow("文件路径不能包含上级目录。")
    expect(() => normalizeContentStorePath("references/../secret")).toThrow("文件路径不能包含上级目录。")
    expect(() => normalizeContentStorePath("references/../../secret")).toThrow("文件路径不能包含上级目录。")
    expect(() => normalizeContentStorePath("/tmp/secret")).toThrow("文件路径必须是相对路径。")
    expect(() => normalizeContentStorePath("C:\\tmp\\secret")).toThrow("文件路径必须是相对路径。")
    expect(() => normalizeContentStorePath("\\\\server\\share")).toThrow("文件路径必须是相对路径。")
  })

  it("rejects Windows-hostile path segments", () => {
    expect(() => normalizeContentStorePath("C:tmp/file")).toThrow("文件路径包含非法字符。")
    expect(() => normalizeContentStorePath("folder/a:b")).toThrow("文件路径包含非法字符。")
    expect(() => normalizeContentStorePath("folder/bad?name.md")).toThrow("文件路径包含非法字符。")
    expect(() => normalizeContentStorePath("folder/a*b.txt")).toThrow("文件路径包含非法字符。")
    expect(() => normalizeContentStorePath("folder/notes<draft>.md")).toThrow("文件路径包含非法字符。")
    expect(() => normalizeContentStorePath("folder/control\u0001.md")).toThrow("文件路径包含非法字符。")
    expect(() => normalizeContentStorePath("CON")).toThrow("文件路径不能使用 Windows 保留名称。")
    expect(() => normalizeContentStorePath("folder/aux.txt")).toThrow("文件路径不能使用 Windows 保留名称。")
    expect(() => normalizeContentStorePath("COM1/readme.md")).toThrow("文件路径不能使用 Windows 保留名称。")
    expect(() => normalizeContentStorePath("folder/name.")).toThrow("文件路径片段不能以点或空格结尾。")
    expect(() => normalizeContentStorePath("folder/name /file.md")).toThrow("文件路径片段不能以点或空格结尾。")
  })

  it("detects text and binary content without banning shell scripts", () => {
    expect(detectContentStoreFileKind("script.sh", Buffer.from("#!/bin/sh\necho hi")).kind).toBe("text")
    expect(detectContentStoreFileKind("notes.unknown", Buffer.from("plain utf8 text")).kind).toBe("text")
    expect(detectContentStoreFileKind("image.png", Buffer.from([0, 1, 2, 3])).kind).toBe("binary")
    expect(detectContentStoreFileKind("blob.bin", Buffer.from([0, 1, 2, 3])).kind).toBe("binary")
    expect(detectContentStoreFileKind("broken.txt", Buffer.from([0xff])).kind).toBe("binary")
    expect(detectContentStoreFileKind("controls.dat", Buffer.from([1, 2, 3, 4])).kind).toBe("binary")
  })

  it("normalizes rule and prompt bodies", () => {
    expect(normalizeRuleBody("Use terse responses.")).toMatchObject({
      path: "RULE.md",
      kind: "text",
      mimeType: "text/markdown",
      text: "Use terse responses.",
    })
    expect(normalizePromptBody("  Write a release note.  ")).toBe("  Write a release note.  ")
    expect(() => normalizeRuleBody("")).toThrow("Rule 正文不能为空。")
    expect(() => normalizePromptBody("")).toThrow("Prompt 正文不能为空。")
  })

  it("rejects duplicate skill paths case-insensitively", () => {
    expect(() =>
      normalizeSkillFiles([
        { path: "SKILL.md", bytes: Buffer.from("# Skill") },
        { path: "references/Guide.md", bytes: Buffer.from("one") },
        { path: "references/guide.md", bytes: Buffer.from("two") },
      ]),
    ).toThrow("Skill 文件路径重复。")
  })

  it("rejects excessive skill file count and file size", () => {
    const tooManyFiles = Array.from({ length: contentStoreSkillMaxFileCount + 1 }, (_, index) => ({
      path: index === 0 ? "SKILL.md" : `references/${index}.md`,
      bytes: Buffer.from("# Skill"),
    }))
    expect(() => normalizeSkillFiles(tooManyFiles)).toThrow("Skill 文件数量超过 200 个。")

    expect(() =>
      normalizeSkillFiles([
        { path: "SKILL.md", bytes: Buffer.from("# Skill") },
        { path: "large.bin", bytes: fakeLengthBuffer(contentStoreSkillMaxFileBytes + 1) },
      ]),
    ).toThrow("Skill 单文件超过 20MB。")
  })

  it("rejects excessive total skill file size", () => {
    const chunk = fakeLengthBuffer(Math.floor(contentStoreSkillMaxTotalBytes / 3) + 1)

    expect(() =>
      normalizeSkillFiles([
        { path: "SKILL.md", bytes: Buffer.from("# Skill") },
        { path: "references/a.bin", bytes: chunk },
        { path: "references/b.bin", bytes: chunk },
        { path: "references/c.bin", bytes: chunk },
      ]),
    ).toThrow("Skill 文件总大小超过 50MB。")
  })

  it("rejects rule and prompt text bodies over 1MB", () => {
    const oversizedBody = "a".repeat(contentStoreTextMaxBytes + 1)

    expect(() => normalizeRuleBody(oversizedBody)).toThrow("正文超过 1MB。")
    expect(() => normalizePromptBody(oversizedBody)).toThrow("Prompt 正文超过 1MB。")
  })
})

function fakeLengthBuffer(length: number): Buffer {
  const buffer = Buffer.alloc(0)
  Object.defineProperty(buffer, "length", { value: length })
  return buffer
}
