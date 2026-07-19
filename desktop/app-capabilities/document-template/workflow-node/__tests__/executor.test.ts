import path from "node:path"
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

const templatePath = path.resolve("tmp", "template.docx")
const templatePathPattern = path.resolve("tmp", "{{name}}.docx")
const outputPath = path.resolve("tmp", "Ada.docx")
const outputPathPattern = path.resolve("tmp", "{{name}}.docx")
const dataPath = path.resolve("tmp", "Ada.json")
const dataPathPattern = path.resolve("tmp", "{{name}}.json")

vi.mock("../../main/service", () => ({
  createDocumentTemplateService: () => ({ generateDocx }),
}))

describe("documentTemplateNodeExecutor", () => {
  it("interpolates paths and passes inline JSON to the document template service", async () => {
    const result = await documentTemplateNodeExecutor.execute(createInput({
      templatePath: templatePathPattern,
      outputPath: outputPathPattern,
      dataSource: "inline",
      dataJson: "{\"name\":\"{{name}}\"}",
      overwrite: true,
      variables: [],
    }))

    expect(result.status).toBe("success")
    expect(result.output).toBe("/tmp/Ada.docx")
    expect(generateDocx).toHaveBeenCalledWith({
      templatePath: outputPath,
      outputPath,
      data: { name: "Ada" },
      overwrite: true,
    })
  })

  it("passes JSON file paths through after interpolation", async () => {
    await documentTemplateNodeExecutor.execute(createInput({
      templatePath,
      outputPath: outputPathPattern,
      dataSource: "dataPath",
      dataPath: dataPathPattern,
      overwrite: false,
      variables: [],
    }))

    expect(generateDocx).toHaveBeenLastCalledWith({
      templatePath,
      outputPath,
      dataPath,
      overwrite: false,
    })
  })

  it("rejects interpolated relative paths before permission checks", async () => {
    generateDocx.mockClear()
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
    const input = createInput({
      templatePath: "{{name}}.docx",
      outputPath: outputPathPattern,
      dataSource: "inline",
      dataJson: "{\"name\":\"{{name}}\"}",
      overwrite: false,
      variables: [],
    })
    input.runtimeDeps = {
      permissionGuard,
      auditSink: { record: vi.fn() },
    } as never

    await expect(documentTemplateNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("必须使用绝对路径"),
    })
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(generateDocx).not.toHaveBeenCalled()
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
