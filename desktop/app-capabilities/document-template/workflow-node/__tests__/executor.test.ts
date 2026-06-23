import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import { documentTemplateNodeExecutor } from "../executor.main"
import type { DocumentTemplateNodeConfig } from "../schema"

const generateDocx = vi.hoisted(() => vi.fn(async () => ({
  outputPath: "/tmp/Ada.docx",
  fileName: "Ada.docx",
  size: 123,
  generatedAt: "2026-06-23T00:00:00.000Z",
})))

vi.mock("../../main/service", () => ({
  createDocumentTemplateService: () => ({ generateDocx }),
}))

describe("documentTemplateNodeExecutor", () => {
  it("interpolates paths and passes inline JSON to the document template service", async () => {
    const result = await documentTemplateNodeExecutor.execute(createInput({
      templatePath: "/tmp/{{name}}.docx",
      outputPath: "/tmp/{{name}}.docx",
      dataSource: "inline",
      dataJson: "{\"name\":\"{{name}}\"}",
      overwrite: true,
      variables: [],
    }))

    expect(result.status).toBe("success")
    expect(result.output).toBe("/tmp/Ada.docx")
    expect(generateDocx).toHaveBeenCalledWith({
      templatePath: "/tmp/Ada.docx",
      outputPath: "/tmp/Ada.docx",
      data: { name: "Ada" },
      overwrite: true,
    })
  })

  it("passes JSON file paths through after interpolation", async () => {
    await documentTemplateNodeExecutor.execute(createInput({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/{{name}}.docx",
      dataSource: "dataPath",
      dataPath: "/tmp/{{name}}.json",
      overwrite: false,
      variables: [],
    }))

    expect(generateDocx).toHaveBeenLastCalledWith({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/Ada.docx",
      dataPath: "/tmp/Ada.json",
      overwrite: false,
    })
  })
})

function createInput(config: DocumentTemplateNodeConfig): NodeExecutionInput<DocumentTemplateNodeConfig> {
  return {
    config,
    resolvedVariables: { name: "Ada" },
    context: {
      runId: "run-1",
      abortSignal: new AbortController().signal,
    },
    agentDeps: {
      sendToAgent: vi.fn(),
    },
  }
}
