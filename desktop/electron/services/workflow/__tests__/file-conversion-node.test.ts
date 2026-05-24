import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"

import { validateWorkflow } from "../workflow-validator"
import { createWorkflowFileConversionOutputWriter } from "../file-conversion-output-writer"
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

function makeRuntimeDeps(input: {
  readonly convert?: NonNullable<NodeRuntimeDeps["fileConversionService"]>["convert"]
  readonly writeWorkflowFileConversionOutput?: NodeRuntimeDeps["writeWorkflowFileConversionOutput"]
} = {}): NodeRuntimeDeps {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn(),
    fileConversionService: { convert: input.convert ?? vi.fn().mockResolvedValue(conversionResult) },
    writeWorkflowFileConversionOutput: input.writeWorkflowFileConversionOutput,
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
    const result = await fileConversionNodeExecutor.execute(makeInput({ inputPath: "/tmp/source.docx" }, makeRuntimeDeps({ convert })))

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

      const result = await fileConversionNodeExecutor.execute(makeInput({}, makeRuntimeDeps({ convert })))

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

  it("result mode succeeds without the workflow output writer dependency", async () => {
    const result = await fileConversionNodeExecutor.execute(makeInput({}, makeRuntimeDeps()))

    expect(result.status).toBe("success")
    expect(result.outputs).not.toHaveProperty("outputPath")
  })

  it("writes markdown through the injected workflow output writer", async () => {
    const outputPath = join(getWorkflowFileConversionOutputRoot(), "run-1", "converted.md")
    const writeWorkflowFileConversionOutput = vi.fn().mockResolvedValue(undefined)

    const result = await fileConversionNodeExecutor.execute(makeInput(
      { outputMode: "markdown-file", outputPath },
      makeRuntimeDeps({ writeWorkflowFileConversionOutput }),
    ))

    expect(result.status).toBe("success")
    expect(result.outputs).toEqual(expect.objectContaining({ outputPath }))
    expect(writeWorkflowFileConversionOutput).toHaveBeenCalledWith({
      outputPath,
      markdown: conversionResult.markdown,
      actor: undefined,
      runId: "run-1",
      abortSignal: expect.any(AbortSignal),
    })
  })

  it("returns sanitized write_failed output when markdown-file output writing fails", async () => {
    const outputPath = join(getWorkflowFileConversionOutputRoot(), "run-1", "converted.md")
    const writeWorkflowFileConversionOutput = vi.fn().mockRejectedValue(new Error(`EACCES: ${outputPath}`))

    const result = await fileConversionNodeExecutor.execute(makeInput(
      { outputMode: "markdown-file", outputPath },
      makeRuntimeDeps({ writeWorkflowFileConversionOutput }),
    ))

    expect(result.status).toBe("failed")
    expect(result.outputs).toEqual(expect.objectContaining({
      ok: false,
      code: "write_failed",
      sourcePath: conversionResult.sourcePath,
    }))
    expect(JSON.stringify(result)).not.toContain(outputPath)
  })

  it("rejects a markdown-file output path that traverses a symlinked ancestor", async () => {
    const root = getWorkflowFileConversionOutputRoot()
    await mkdir(root, { recursive: true })
    tempRoot = await mkdtemp(join(root, "test-"))
    const outsideRoot = await mkdtemp(join(tmpdir(), "synapse-workflow-outside-"))
    const symlinkPath = join(tempRoot, "escape")
    try {
      await symlink(outsideRoot, symlinkPath, "dir")
    } catch (error) {
      await rm(outsideRoot, { recursive: true, force: true })
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : ""
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") return
      throw error
    }

    const auditSink = { record: vi.fn(), list: vi.fn(() => []), clearForTests: vi.fn() }
    const writer = createWorkflowFileConversionOutputWriter({
      permissionGuard: {
        registerPolicy: vi.fn(),
        check: vi.fn().mockResolvedValue({ allowed: true }),
      },
      auditSink,
    })
    const outputPath = join(symlinkPath, "converted.md")

    await expect(writer({
      outputPath,
      markdown: conversionResult.markdown,
      runId: "run-1",
      abortSignal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "invalid_output_path" })
    await expect(readFile(join(outsideRoot, "converted.md"), "utf8")).rejects.toThrow()
    await rm(outsideRoot, { recursive: true, force: true })
  })

  it("writer checks fs.write permission and records an allowed audit for output writes", async () => {
    await mkdir(getWorkflowFileConversionOutputRoot(), { recursive: true })
    tempRoot = await mkdtemp(join(getWorkflowFileConversionOutputRoot(), "test-"))
    const outputPath = join(tempRoot, "converted.md")
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn().mockResolvedValue({ allowed: true }),
    }
    const auditSink = { record: vi.fn(), list: vi.fn(() => []), clearForTests: vi.fn() }
    const writer = createWorkflowFileConversionOutputWriter({ permissionGuard, auditSink })

    await writer({
      outputPath,
      markdown: conversionResult.markdown,
      runId: "run-1",
      abortSignal: new AbortController().signal,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: outputPath,
      context: { source: "workflow.fileConversionOutput", runId: "run-1" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: outputPath,
      outcome: "allowed",
      metadata: { source: "workflow.fileConversionOutput", runId: "run-1" },
    }))
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
