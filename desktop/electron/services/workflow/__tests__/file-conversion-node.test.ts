import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"

import { validateWorkflow } from "../workflow-validator"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import { FileConversionError, type FileConversionResult } from "../../file-conversion"
import { getWorkflowFileConversionOutputRoot } from "../../../../workflow-nodes/file-conversion/output-boundary"
import { fileConversionNodeExecutor } from "../../../../workflow-nodes/file-conversion"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../../../workflow-nodes/types"
import "../../../../workflow-nodes/register.main"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

const conversionResult: FileConversionResult = {
  sourcePath: "/tmp/source.docx",
  format: "docx",
  kind: "document",
  title: "Source",
  markdown: "# Source\n\nBody",
  text: "Source\n\nBody",
  metadata: { pages: 1 },
  warnings: [{ code: "partial_metadata", message: "Some metadata could not be read." }],
}

function makeRuntimeDeps(convert = vi.fn().mockResolvedValue(conversionResult)): NodeRuntimeDeps {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn(),
    fileConversionService: { convert },
  }
}

function makeInput(
  config: Partial<NodeExecutionInput<{ inputPath: string; outputMode?: "result" | "markdown-file"; outputPath?: string }>["config"]>,
  runtimeDeps = makeRuntimeDeps(),
): NodeExecutionInput<{ inputPath: string; outputMode?: "result" | "markdown-file"; outputPath?: string }> {
  return {
    config: { inputPath: "/tmp/source.docx", outputMode: "result", ...config },
    resolvedVariables: {},
    context: { runId: "run-1", abortSignal: new AbortController().signal },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

function makeDefinition(config: Record<string, unknown>): WorkflowDefinition {
  return {
    id: "wf-file-conversion",
    name: "File Conversion",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      { id: "convert", name: "Convert", type: "file_conversion", position: { x: 0, y: 0 }, config },
      { id: "end", name: "End", type: "end", position: { x: 200, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
    ],
    edges: [{ id: "edge-1", from: "convert", to: "end" }],
  }
}

describe("file conversion workflow node", () => {
  let tempRoot: string | undefined

  afterEach(async () => {
    logger.info.mockClear()
    logger.warn.mockClear()
    logger.error.mockClear()
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  it("converts a local DOCX using the injected conversion service", async () => {
    const convert = vi.fn().mockResolvedValue(conversionResult)
    const result = await fileConversionNodeExecutor.execute(makeInput({ inputPath: "/tmp/source.docx" }, makeRuntimeDeps(convert)))

    expect(result.status).toBe("success")
    expect(convert).toHaveBeenCalledWith({ filePath: "/tmp/source.docx", preferredOutput: "markdown" })
    expect(result.output).toBe(conversionResult.markdown)
  })

  it("returns structured conversion output and propagates warnings", async () => {
    const result = await fileConversionNodeExecutor.execute(makeInput({}))

    expect(result.outputs).toEqual({
      sourcePath: conversionResult.sourcePath,
      format: conversionResult.format,
      kind: conversionResult.kind,
      title: conversionResult.title,
      markdown: conversionResult.markdown,
      text: conversionResult.text,
      metadata: conversionResult.metadata,
      warnings: conversionResult.warnings,
    })
  })

  it.each(["unsupported_format", "encrypted", "size_limit_exceeded"] as const)(
    "returns a structured failure for %s errors",
    async (code) => {
      const convert = vi.fn().mockRejectedValue(new FileConversionError(code, `conversion failed: ${code}`))

      const result = await fileConversionNodeExecutor.execute(makeInput({}, makeRuntimeDeps(convert)))

      expect(result.status).toBe("failed")
      expect(result.outputs).toEqual({
        ok: false,
        code,
        message: `conversion failed: ${code}`,
        sourcePath: "/tmp/source.docx",
      })
      expect(result.error).toContain(code)
    },
  )

  it("writes markdown inside the conservative workflow output boundary", async () => {
    await mkdir(getWorkflowFileConversionOutputRoot(), { recursive: true })
    tempRoot = await mkdtemp(join(getWorkflowFileConversionOutputRoot(), "test-"))
    const outputPath = join(tempRoot, "converted.md")

    const result = await fileConversionNodeExecutor.execute(makeInput({ outputMode: "markdown-file", outputPath }))

    expect(result.status).toBe("success")
    expect(result.outputs).toEqual(expect.objectContaining({ outputPath }))
    await expect(readFile(outputPath, "utf8")).resolves.toBe(conversionResult.markdown)
  })

  it("validator rejects missing inputPath", () => {
    const validation = validateWorkflow(makeDefinition({ outputMode: "result" }))

    expect(validation.valid).toBe(false)
    expect(validation.errors.some((error) => error.nodeId === "convert" && error.message.includes("inputPath"))).toBe(true)
  })

  it("validator rejects markdown-file without outputPath", () => {
    const validation = validateWorkflow(makeDefinition({ inputPath: "/tmp/source.docx", outputMode: "markdown-file" }))

    expect(validation.valid).toBe(false)
    expect(validation.errors.some((error) => error.nodeId === "convert" && error.message.includes("outputPath"))).toBe(true)
  })

  it("validator rejects output paths outside the workflow output boundary", () => {
    const validation = validateWorkflow(makeDefinition({
      inputPath: "/tmp/source.docx",
      outputMode: "markdown-file",
      outputPath: join(tmpdir(), "outside-workflow-output.md"),
    }))

    expect(validation.valid).toBe(false)
    expect(validation.errors.some((error) => error.nodeId === "convert" && error.message.includes("工作流输出目录"))).toBe(true)
  })
})
