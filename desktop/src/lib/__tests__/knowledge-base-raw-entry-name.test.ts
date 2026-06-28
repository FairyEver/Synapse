import { describe, expect, it } from "vitest"

import { validateKnowledgeBaseRawEntryNameInput } from "../knowledge-base-raw-entry-name"

describe("validateKnowledgeBaseRawEntryNameInput", () => {
  it("rejects blank names", () => {
    expect(validateKnowledgeBaseRawEntryNameInput("   ")).toBe("请输入名称。")
  })

  it("rejects Windows reserved names with extensions", () => {
    expect(validateKnowledgeBaseRawEntryNameInput("CON")).toBe("名称包含 Windows 不支持的字符或保留名。")
    expect(validateKnowledgeBaseRawEntryNameInput("aux.txt")).toBe("名称包含 Windows 不支持的字符或保留名。")
  })

  it("rejects Windows-invalid characters and trailing dots or spaces", () => {
    expect(validateKnowledgeBaseRawEntryNameInput("会议:纪要")).toBe("名称包含 Windows 不支持的字符或保留名。")
    expect(validateKnowledgeBaseRawEntryNameInput(" name")).toBe("名称包含 Windows 不支持的字符或保留名。")
    expect(validateKnowledgeBaseRawEntryNameInput("name.")).toBe("名称包含 Windows 不支持的字符或保留名。")
    expect(validateKnowledgeBaseRawEntryNameInput("name ")).toBe("名称包含 Windows 不支持的字符或保留名。")
  })

  it("allows normal raw entry names", () => {
    expect(validateKnowledgeBaseRawEntryNameInput("会议纪要.md")).toBeNull()
    expect(validateKnowledgeBaseRawEntryNameInput("auxiliary.txt")).toBeNull()
  })
})
