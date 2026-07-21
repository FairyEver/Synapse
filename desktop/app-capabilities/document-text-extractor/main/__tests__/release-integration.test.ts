import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { documentTextExtractNodeExecutor } from "../../workflow-node/executor.main"
import type { DocumentTextExtractNodeConfig } from "../../workflow-node/schema"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import { DocumentTextExtractionError, DOCUMENT_TEXT_EXTRACTION_ERROR_CODES } from "../../shared/errors"
import { createDocumentTextExtractorCapabilityDispatcher } from "../dispatcher"
import { createDocumentTextExtractorIpcModule } from "../ipc"
import { createDocumentTextExtractorService, type DocumentTextExtractorService } from "../service"
import { createDocxFixture, textParagraph } from "./docx-fixture"
import { createPdfFixture } from "./pdf-fixture"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
  },
  BrowserWindow: {
    getFocusedWindow: () => undefined,
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}))

describe("document text extraction release integration", () => {
  it.each([
    {
      extension: "pdf",
      bytes: createPdfFixture(["shared release fixture"]),
      expected: {
        text: "shared release fixture",
        format: "pdf" as const,
        pages: 1,
      },
    },
    {
      extension: "docx",
      bytes: createDocxFixture(textParagraph("shared release fixture")),
      expected: {
        text: "shared release fixture",
        format: "docx" as const,
      },
    },
  ])("returns the same $extension fixture semantics through App, MCP, and Workflow", async ({
    extension,
    bytes,
    expected,
  }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-document-release-"))
    const filePath = path.join(root, `shared-fixture.${extension}`)
    const service = createReleaseService()
    try {
      await writeFile(filePath, bytes)
      const expectedResult = {
        ...expected,
        fileName: path.basename(filePath),
        size: (await stat(filePath)).size,
      }

      const appResponse = await createDocumentTextExtractorIpcModule().methods.extractDocument.handler(
        createIpcContext(service),
        { operationId: `release-${extension}`, filePath },
      )
      const mcpResponse = await createDocumentTextExtractorCapabilityDispatcher({ service }).dispatch(
        "app.document_text_extractor.document.extract",
        { filePath },
        { source: "mcp-http" },
      )
      const workflowResponse = await documentTextExtractNodeExecutor.execute(
        createWorkflowInput(filePath, service),
      )

      expect(appResponse).toEqual({ ok: true, result: expectedResult })
      expect(mcpResponse).toEqual({ ok: true, data: expectedResult, affected: 1 })
      expect(workflowResponse).toMatchObject({
        status: "success",
        output: expectedResult.text,
        outputs: {
          format: expectedResult.format,
          fileName: expectedResult.fileName,
          size: expectedResult.size,
          ...("pages" in expectedResult ? { pages: expectedResult.pages } : {}),
        },
      })
      expect(workflowResponse.outputs).not.toHaveProperty("text")
    } finally {
      await service.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(DOCUMENT_TEXT_EXTRACTION_ERROR_CODES)(
    "preserves %s across App, MCP, and Workflow error projections",
    async (code) => {
      const filePath = path.resolve(`release-${code}.pdf`)
      const service = createFailingService(code)

      const appResponse = await createDocumentTextExtractorIpcModule().methods.extractDocument.handler(
        createIpcContext(service),
        { operationId: `release-${code}`, filePath },
      )
      const mcpResponse = await createDocumentTextExtractorCapabilityDispatcher({ service }).dispatch(
        "app.document_text_extractor.document.extract",
        { filePath },
        { source: "mcp-http" },
      )
      const workflowResponse = await documentTextExtractNodeExecutor.execute(
        createWorkflowInput(filePath, service),
      )

      expect(appResponse).toMatchObject({ ok: false, error: { code } })
      expect(mcpResponse).toMatchObject({ ok: false, code })
      expect(workflowResponse).toMatchObject({
        status: code === "EXTRACTION_CANCELLED" ? "cancelled" : "failed",
        error: expect.stringContaining(code),
      })
      expect(JSON.stringify({ appResponse, mcpResponse, workflowResponse })).not.toContain(filePath)
    },
  )

  it("preserves a real permission denial across App, MCP, and Workflow", async () => {
    const filePath = path.resolve("permission-denied.pdf")
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false as const,
        reason: "private policy detail",
        policyId: "document-read-denied",
      })),
    }
    const auditSink = { record: vi.fn() }
    const service = createDocumentTextExtractorService({
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    const appResponse = await createDocumentTextExtractorIpcModule().methods.extractDocument.handler(
      createIpcContext(service),
      { operationId: "release-permission-denied", filePath },
    )
    const mcpResponse = await createDocumentTextExtractorCapabilityDispatcher({ service }).dispatch(
      "app.document_text_extractor.document.extract",
      { filePath },
      { source: "mcp-http" },
    )
    const workflowResponse = await documentTextExtractNodeExecutor.execute(
      createWorkflowInput(filePath, service),
    )

    expect(appResponse).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } })
    expect(mcpResponse).toMatchObject({ ok: false, code: "PERMISSION_DENIED" })
    expect(workflowResponse).toMatchObject({
      status: "failed",
      error: expect.stringContaining("PERMISSION_DENIED"),
    })
    expect(JSON.stringify({ appResponse, mcpResponse, workflowResponse })).not.toContain(filePath)
    expect(JSON.stringify({ appResponse, mcpResponse, workflowResponse })).not.toContain("private policy detail")
    expect(permissionGuard.check).toHaveBeenCalledTimes(3)
    expect(auditSink.record).toHaveBeenCalledTimes(3)
  })
})

function createReleaseService(): DocumentTextExtractorService {
  return createDocumentTextExtractorService({
    permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) } as never,
    auditSink: { record: vi.fn() } as never,
  })
}

function createFailingService(
  code: (typeof DOCUMENT_TEXT_EXTRACTION_ERROR_CODES)[number],
): DocumentTextExtractorService {
  return {
    createTask: vi.fn(() => ({
      result: Promise.reject(new DocumentTextExtractionError(code)),
      getState: () => ({ id: `task-${code}`, status: "failed" as const }),
      subscribe: () => () => undefined,
      cancel: () => false,
    })),
    extract: vi.fn(async () => { throw new DocumentTextExtractionError(code) }),
    stop: vi.fn(async () => undefined),
  }
}

function createIpcContext(service: DocumentTextExtractorService): IpcHandlerContext {
  return {
    moduleId: "documentTextExtractor",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.document-text-extractor") return service as T
      if (serviceId === "core.window-manager") return { broadcast: vi.fn() } as T
      throw new Error(`Unexpected service id: ${serviceId}`)
    },
  }
}

function createWorkflowInput(
  filePath: string,
  service: DocumentTextExtractorService,
): NodeExecutionInput<DocumentTextExtractNodeConfig> {
  return {
    config: { filePath, variables: [] },
    resolvedVariables: {},
    context: {
      workflowId: "workflow-release",
      workflowName: "文档文本提取发布验收",
      runId: "run-release",
      nodeId: "extract-release",
      nodeName: "文档文本提取",
      abortSignal: new AbortController().signal,
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps: {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn(),
      resolveService: <T,>() => service as T,
    },
  }
}
