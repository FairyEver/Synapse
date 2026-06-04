import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  createBuiltinToolRegistryForTests,
  findBuiltinTools,
  getBuiltinToolDescriptor,
  listBuiltinToolDescriptors,
  projectBuiltinToolDescriptor,
} from "../registry"
import type { BuiltinToolDescriptor } from "../types"

function descriptor(id: string): BuiltinToolDescriptor<{ inputPath: string }, { markdown: string }> {
  const inputSchema = z.object({ inputPath: z.string().min(1) })
  const outputSchema = z.object({ markdown: z.string() })
  return {
    id,
    title: id,
    description: "Convert one file.",
    category: "conversion",
    inputSchema,
    outputSchema,
    ui: {
      fields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
      resultPreview: { kind: "markdown", pathFromOutput: "outputPath" },
    },
    permissions: [{ action: "fs.read.outside-userdata", pathFromInput: "inputPath" }],
    entryPoints: ["tools"],
    input: { extensions: [".docx"], kind: "file" },
    output: { kind: "markdown" },
    executor: async () => ({ markdown: "# Converted" }),
  }
}

describe("builtin tool registry", () => {
  it("lists the five initial atomic conversion tools", () => {
    expect(listBuiltinToolDescriptors().map((tool) => tool.id)).toEqual([
      "docx-to-markdown",
      "xlsx-to-markdown",
      "csv-to-markdown",
      "pdf-to-markdown",
      "pptx-to-markdown",
    ])
  })

  it("returns descriptors by id", () => {
    expect(getBuiltinToolDescriptor("docx-to-markdown")?.title).toBe("DOCX 转 Markdown")
    expect(getBuiltinToolDescriptor("missing")).toBeNull()
  })

  it("rejects duplicate ids in test registries", () => {
    expect(() => createBuiltinToolRegistryForTests([
      descriptor("same"),
      descriptor("same"),
    ])).toThrow("Duplicate builtin tool id: same")
  })

  it("projects descriptors without executable fields or zod schemas", () => {
    const projected = projectBuiltinToolDescriptor(descriptor("docx-to-markdown"))
    expect(projected).toMatchObject({
      id: "docx-to-markdown",
      title: "docx-to-markdown",
      category: "conversion",
      inputFields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
      outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
    })
    expect("executor" in projected).toBe(false)
    expect("inputSchema" in projected).toBe(false)
    expect("outputSchema" in projected).toBe(false)
  })

  it("finds tools by input extension and output kind", () => {
    const registry = createBuiltinToolRegistryForTests([
      descriptor("docx-to-markdown"),
      {
        ...descriptor("pdf-to-markdown"),
        input: { extensions: [".pdf"], kind: "file" },
      },
    ])
    expect(findBuiltinTools({ inputExtension: ".DOCX", outputKind: "markdown" }, registry).map((tool) => tool.id)).toEqual(["docx-to-markdown"])
  })
})

