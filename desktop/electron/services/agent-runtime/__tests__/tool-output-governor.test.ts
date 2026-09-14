import { describe, expect, it } from "vitest"

import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  governToolOutput,
  isFileMutationTool,
  isStructuredFileMutationOutput,
} from "../tool-output-governor"

describe("tool output governor", () => {
  it("leaves bounded text unchanged", () => {
    expect(governToolOutput({
      toolName: "Read",
      toolResponse: { type: "text", file: { content: "small", totalLines: 1 } },
    })).toBeUndefined()
  })

  it("keeps a byte-bounded Read prefix with continuation guidance", () => {
    const result = governToolOutput({
      toolName: "Read",
      toolResponse: {
        type: "text",
        file: { content: "甲".repeat(30_000), totalLines: 1 },
      },
      maxBytes: 24 * 1024,
    })

    expect(result).toMatchObject({ kept: "head", originalLines: 1 })
    expect(result?.deliveredBytes).toBeLessThanOrEqual(24 * 1024)
    expect(result?.updatedToolOutput).toContain("smaller limit/offset")
    expect(result?.updatedToolOutput).not.toMatch(/[\uD800-\uDFFF]$/)
  })

  it("includes a persisted full-output path inside the bounded replacement", () => {
    const result = governToolOutput({
      toolName: "Read",
      toolResponse: "0123456789".repeat(100),
      maxBytes: 512,
      persistedOutputPath: "/managed/conversation/tool-output/result.txt",
    })

    expect(result?.updatedToolOutput).toContain("Output saved at /managed/conversation/tool-output/result.txt")
    expect(result?.updatedToolOutput).toContain("do not rerun the original tool")
    expect(result?.originalText).toBe("0123456789".repeat(100))
    expect(Buffer.byteLength(result?.updatedToolOutput ?? "", "utf8")).toBeLessThanOrEqual(512)
  })

  it("allows a zero-byte remaining budget without falling back to the default limit", () => {
    const result = governToolOutput({
      toolName: "Read",
      toolResponse: "large output",
      maxBytes: 0,
    })

    expect(result?.updatedToolOutput).toBe("")
    expect(result?.deliveredBytes).toBe(0)
  })

  it("keeps the Bash tail and warns against replaying the command", () => {
    const result = governToolOutput({
      toolName: "Bash",
      toolResponse: {
        stdout: `${"old output\n".repeat(8_000)}FINAL STATUS`,
        stderr: "",
        interrupted: false,
      },
      maxBytes: 8 * 1024,
      maxLines: 200,
    })

    expect(result?.kept).toBe("tail")
    expect(result?.updatedToolOutput).toContain("FINAL STATUS")
    expect(result?.updatedToolOutput).toContain("Do not rerun it")
    expect(result?.deliveredBytes).toBeLessThanOrEqual(8 * 1024)
    expect(result?.deliveredLines).toBeLessThanOrEqual(200)
  })

  it("applies the line cap independently of the byte cap", () => {
    const result = governToolOutput({
      toolName: "Grep",
      toolResponse: { content: Array.from({ length: 2_100 }, () => "x").join("\n") },
      maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES,
      maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
    })

    expect(result?.originalBytes).toBeLessThan(DEFAULT_TOOL_OUTPUT_MAX_BYTES)
    expect(result?.deliveredLines).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_MAX_LINES)
  })

  it("does not rewrite image or PDF payloads", () => {
    expect(governToolOutput({
      toolName: "Read",
      toolResponse: {
        type: "image",
        file: { base64: "a".repeat(80_000), type: "image/png" },
      },
    })).toBeUndefined()
    expect(governToolOutput({
      toolName: "mcp__example__read",
      toolResponse: [{ type: "image", source: { type: "base64", data: "a".repeat(80_000) } }],
    })).toBeUndefined()
  })

  it("bounds unknown structured text outputs without assuming their schema", () => {
    const result = governToolOutput({
      toolName: "mcp__example__query",
      toolResponse: { rows: Array.from({ length: 5_000 }, (_, index) => ({ index, value: "payload" })) },
      maxBytes: 16 * 1024,
    })

    expect(result?.deliveredBytes).toBeLessThanOrEqual(16 * 1024)
    expect(result?.updatedToolOutput).toContain("narrower read, search, filter, or pagination")
  })

  it("identifies native file-mutation payloads as confirmation-only results", () => {
    expect(isStructuredFileMutationOutput("Edit", {
      filePath: "/repo/page.html",
      oldString: "a",
      newString: "b",
      originalFile: "filler".repeat(20_000),
      structuredPatch: [],
      userModified: false,
      replaceAll: false,
    })).toBe(true)
    expect(isStructuredFileMutationOutput("Write", {
      type: "create",
      filePath: "/repo/page.html",
      content: "filler".repeat(20_000),
      structuredPatch: [],
      originalFile: null,
    })).toBe(true)
    expect(isStructuredFileMutationOutput("NotebookEdit", {
      notebook_path: "/repo/notes.ipynb",
      original_file: "{}",
      updated_file: "{}",
    })).toBe(true)
  })

  it("leaves non mutation tools and string results governed", () => {
    expect(isFileMutationTool("Read")).toBe(false)
    expect(isFileMutationTool("Bash")).toBe(false)
    expect(isStructuredFileMutationOutput("Edit", "<tool_use_error>File has been modified since read</tool_use_error>")).toBe(false)
    expect(isStructuredFileMutationOutput("Read", {
      type: "text",
      file: { content: "原始内容".repeat(30_000), numLines: 1, startLine: 1, totalLines: 1 },
    })).toBe(false)
  })
})
