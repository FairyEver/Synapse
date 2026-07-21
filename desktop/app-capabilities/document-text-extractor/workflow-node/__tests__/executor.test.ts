import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { DocumentTextExtractorService } from "../../main/service"
import type {
  DocumentTextExtractionTask,
  DocumentTextExtractionTaskState,
} from "../../main/scheduler"
import { DocumentTextExtractionError } from "../../shared/errors"
import type { DocumentTextExtractionResult } from "../../shared/schema"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import { documentTextExtractNodeExecutor } from "../executor.main"
import type { DocumentTextExtractNodeConfig } from "../schema"

describe("documentTextExtractNodeExecutor", () => {
  it("extracts a fixed local file and returns complete text without duplicating it in metadata", async () => {
    const filePath = path.resolve("tmp", "report.pdf")
    const { service, createTask } = createServiceWithResult({
      text: "完整正文",
      format: "pdf",
      fileName: "report.pdf",
      size: 128,
      pages: 2,
    })

    const result = await documentTextExtractNodeExecutor.execute(createInput({
      filePath,
      variables: [],
    }, service))

    expect(createTask).toHaveBeenCalledWith(
      { filePath },
      expect.objectContaining({
        source: "workflow",
        actor: { kind: "system", id: "workflow-engine" },
      }),
    )
    expect(result).toMatchObject({
      status: "success",
      output: "完整正文",
      outputs: {
        format: "pdf",
        fileName: "report.pdf",
        size: 128,
        pages: 2,
      },
    })
    expect(result.outputs).not.toHaveProperty("text")
  })

  it.each([
    {
      label: "workflow parameter",
      variables: [{ name: "source", source: { type: "param" as const, param: "source" } }],
    },
    {
      label: "upstream node output",
      variables: [{
        name: "source",
        source: { type: "node_output" as const, node: "select-file" },
      }],
    },
  ])("resolves a file path from $label", async ({ variables }) => {
    const filePath = path.resolve("tmp", "source.docx")
    const { service, createTask } = createServiceWithResult({
      text: "正文",
      format: "docx",
      fileName: "source.docx",
      size: 64,
    })

    await documentTextExtractNodeExecutor.execute(createInput({
      filePath: "{{source}}",
      variables,
    }, service, { source: filePath }))

    expect(createTask).toHaveBeenCalledWith(
      { filePath },
      expect.objectContaining({ source: "workflow" }),
    )
  })

  it("treats an empty document as a successful extraction", async () => {
    const { service } = createServiceWithResult({
      text: "",
      format: "docx",
      fileName: "empty.docx",
      size: 32,
    })

    const result = await documentTextExtractNodeExecutor.execute(createInput({
      filePath: path.resolve("tmp", "empty.docx"),
      variables: [],
    }, service))

    expect(result).toMatchObject({ status: "success", output: "" })
    expect(result.outputs).toEqual({
      format: "docx",
      fileName: "empty.docx",
      size: 32,
    })
  })

  it("forwards waiting and running task progress", async () => {
    const onProgress = vi.fn()
    const { service } = createServiceWithResult({
      text: "正文",
      format: "pdf",
      fileName: "report.pdf",
      size: 128,
      pages: 1,
    }, [
      { id: "task-1", status: "waiting" },
      { id: "task-1", status: "running" },
    ])

    await documentTextExtractNodeExecutor.execute(createInput({
      filePath: path.resolve("tmp", "report.pdf"),
      variables: [],
    }, service, {}, { onProgress }))

    expect(onProgress).toHaveBeenNthCalledWith(1, "waiting", "等待提取")
    expect(onProgress).toHaveBeenNthCalledWith(2, "extracting", "提取中")
  })

  it("cancels the shared extraction task when the workflow is aborted", async () => {
    const controller = new AbortController()
    let rejectTask!: (error: unknown) => void
    const result = new Promise<DocumentTextExtractionResult>((_resolve, reject) => {
      rejectTask = reject
    })
    const cancel = vi.fn(() => {
      rejectTask(new DocumentTextExtractionError("EXTRACTION_CANCELLED"))
      return true
    })
    const service = createService({
      result,
      getState: () => ({ id: "task-1", status: "running" }),
      subscribe: () => vi.fn(),
      cancel,
    })

    const execution = documentTextExtractNodeExecutor.execute(createInput({
      filePath: path.resolve("tmp", "report.pdf"),
      variables: [],
    }, service, {}, { abortSignal: controller.signal }))
    controller.abort()

    await expect(execution).resolves.toMatchObject({
      status: "cancelled",
      output: "",
      error: expect.stringContaining("EXTRACTION_CANCELLED"),
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("preserves the shared service error code", async () => {
    const service = createService({
      result: Promise.reject(new DocumentTextExtractionError("PASSWORD_PROTECTED")),
      getState: () => ({ id: "task-1", status: "failed" }),
      subscribe: () => vi.fn(),
      cancel: () => false,
    })

    const result = await documentTextExtractNodeExecutor.execute(createInput({
      filePath: path.resolve("tmp", "protected.pdf"),
      variables: [],
    }, service))

    expect(result).toMatchObject({
      status: "failed",
      output: "",
      error: expect.stringContaining("PASSWORD_PROTECTED"),
    })
  })

  it("normalizes unexpected failures to the stable extraction error code", async () => {
    const service = {
      createTask: vi.fn(() => {
        throw new Error("internal service detail")
      }),
    } as unknown as DocumentTextExtractorService

    const result = await documentTextExtractNodeExecutor.execute(createInput({
      filePath: path.resolve("tmp", "report.pdf"),
      variables: [],
    }, service))

    expect(result).toMatchObject({
      status: "failed",
      output: "",
      error: "EXTRACTION_FAILED: 文档文本提取失败。",
    })
    expect(result.error).not.toContain("internal service detail")
  })
})

function createServiceWithResult(
  result: DocumentTextExtractionResult,
  states: readonly DocumentTextExtractionTaskState[] = [],
): {
  service: DocumentTextExtractorService
  createTask: ReturnType<typeof vi.fn>
} {
  const task: DocumentTextExtractionTask<DocumentTextExtractionResult> = {
    result: Promise.resolve(result),
    getState: () => states.at(-1) ?? { id: "task-1", status: "waiting" },
    subscribe(listener) {
      for (const state of states) listener(state)
      return vi.fn()
    },
    cancel: vi.fn(() => true),
  }
  const createTask = vi.fn(() => task)
  return {
    service: { createTask } as unknown as DocumentTextExtractorService,
    createTask,
  }
}

function createService(
  task: DocumentTextExtractionTask<DocumentTextExtractionResult>,
): DocumentTextExtractorService {
  return { createTask: vi.fn(() => task) } as unknown as DocumentTextExtractorService
}

function createInput(
  config: DocumentTextExtractNodeConfig,
  service: DocumentTextExtractorService,
  resolvedVariables: Record<string, string> = {},
  overrides: {
    abortSignal?: AbortSignal
    onProgress?: NodeExecutionInput<DocumentTextExtractNodeConfig>["onProgress"]
  } = {},
): NodeExecutionInput<DocumentTextExtractNodeConfig> {
  return {
    config,
    resolvedVariables,
    context: {
      workflowId: "workflow-1",
      workflowName: "提取文档",
      runId: "run-1",
      nodeId: "extract-1",
      nodeName: "文档文本提取",
      abortSignal: overrides.abortSignal ?? new AbortController().signal,
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps: {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn(),
      resolveService: <T,>() => service as T,
    },
    onProgress: overrides.onProgress,
  }
}
