import path from "node:path"
import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import {
  documentTextExtractionCancelResultSchema,
  documentTextExtractionOperationSchema,
  documentTextExtractionRequestSchema,
  documentTextExtractionResponseSchema,
  documentTextExtractionStatusEventSchema,
  documentTextOutputChooseRequestSchema,
  documentTextSaveInputSchema,
  documentTextSaveResponseSchema,
  type DocumentTextExtractionRequest,
  type DocumentTextOutputChooseRequest,
  type DocumentTextSaveInput,
} from "../shared/schema"
import { DocumentTextSaveError } from "../shared/errors"
import type { DocumentTextExtractionTask } from "./scheduler"
import type { DocumentTextExtractorService } from "./service"
import { serializeDocumentTextExtractionError } from "./service"
import {
  createDocumentTextSaveService,
  serializeDocumentTextSaveError,
  type DocumentTextSaveService,
} from "./save-service"

type ActiveTask = DocumentTextExtractionTask<Awaited<ReturnType<DocumentTextExtractorService["extract"]>>>
type ActiveTaskEntry = {
  readonly task: ActiveTask
  readonly senderId: number | undefined
  detachSender(): void
}

export function createDocumentTextExtractorIpcModule(deps: {
  readonly saveService?: DocumentTextSaveService
} = {}): IpcModule {
  const activeTasks = new Map<string, ActiveTaskEntry>()

  const module: IpcModule = {
    id: "documentTextExtractor",
    methods: {
      chooseDocument: {
        operationId: "app.document_text_extractor.document.choose",
        kind: "invoke",
        request: z.void().optional(),
        response: z.string().nullable(),
        handler: async () => chooseDocument(),
      },
      extractDocument: {
        operationId: "app.document_text_extractor.document.extract",
        kind: "invoke",
        request: documentTextExtractionRequestSchema,
        response: documentTextExtractionResponseSchema,
        handler: async (ctx, request: DocumentTextExtractionRequest) => {
          if (activeTasks.has(request.operationId)) {
            throw new Error("文档文本提取任务已存在。")
          }
          const service = ctx.resolve<DocumentTextExtractorService>("core.document-text-extractor")
          let task: ActiveTask
          try {
            task = service.createTask(
              { filePath: request.filePath },
              { actor: { kind: "user", id: "synapse-renderer", display: "Synapse" } },
            )
          } catch (error) {
            return { ok: false as const, error: serializeDocumentTextExtractionError(error) }
          }
          const windowManager = ctx.resolve<WindowManager>("core.window-manager")
          let detachSender: () => void = () => undefined
          const entry: ActiveTaskEntry = {
            task,
            senderId: ctx.sender?.id,
            detachSender: () => detachSender(),
          }
          activeTasks.set(request.operationId, entry)
          if (ctx.sender) {
            detachSender = ctx.sender.onDestroyed(() => {
              if (activeTasks.get(request.operationId) === entry) task.cancel()
            })
            if (ctx.sender.isDestroyed()) task.cancel()
          }
          const unsubscribe = task.subscribe((state) => {
            if (state.status !== "waiting" && state.status !== "running") return
            windowManager.broadcast(
              ipcOperationIdToChannel(module.events.status.operationId),
              { operationId: request.operationId, status: state.status },
            )
          })
          try {
            return { ok: true as const, result: await task.result }
          } catch (error) {
            return { ok: false as const, error: serializeDocumentTextExtractionError(error) }
          } finally {
            unsubscribe()
            entry.detachSender()
            if (activeTasks.get(request.operationId) === entry) {
              activeTasks.delete(request.operationId)
            }
          }
        },
      },
      cancelExtraction: {
        operationId: "app.document_text_extractor.operation.cancel",
        kind: "invoke",
        request: documentTextExtractionOperationSchema,
        response: documentTextExtractionCancelResultSchema,
        handler: async (ctx, request: z.infer<typeof documentTextExtractionOperationSchema>) => {
          const entry = activeTasks.get(request.operationId)
          if (!entry || (entry.senderId !== undefined && entry.senderId !== ctx.sender?.id)) {
            return { cancelled: false }
          }
          return { cancelled: entry.task.cancel() }
        },
      },
      chooseOutput: {
        operationId: "app.document_text_extractor.output.choose",
        kind: "invoke",
        request: documentTextOutputChooseRequestSchema,
        response: z.string().nullable(),
        handler: async (_ctx, request: DocumentTextOutputChooseRequest) => chooseOutput(request),
      },
      saveText: {
        operationId: "app.document_text_extractor.text.save",
        kind: "invoke",
        request: documentTextSaveInputSchema,
        response: documentTextSaveResponseSchema,
        handler: async (ctx, request: DocumentTextSaveInput) => {
          try {
            await authorizeTextWrite(ctx, request.outputPath)
            const result = await (deps.saveService ?? createDocumentTextSaveService({
              logger: ctx.logger?.child("document-text-extractor.save"),
            })).save(request)
            return { ok: true as const, result }
          } catch (error) {
            return { ok: false as const, error: serializeDocumentTextSaveError(error) }
          }
        },
      },
    },
    events: {
      status: {
        operationId: "app.document_text_extractor.operation.status",
        kind: "event",
        payload: documentTextExtractionStatusEventSchema,
      },
    },
  }

  return module
}

export const documentTextExtractorIpcModule = createDocumentTextExtractorIpcModule()

async function chooseDocument(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "选择文档",
    filters: [{ name: "PDF 或 Word 文档", extensions: ["pdf", "docx"] }],
    properties: ["openFile"],
  }
  const parent = focusedWindow()
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

async function chooseOutput(request: DocumentTextOutputChooseRequest): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    title: "保存文本",
    defaultPath: request.defaultPath,
    filters: [{ name: "文本文件", extensions: ["txt"] }],
  }
  const parent = focusedWindow()
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}

async function authorizeTextWrite(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  outputPath: string,
): Promise<void> {
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const metadata = { source: "documentTextExtractor.saveText" }
  const permission = await permissionGuard.check({
    action: "fs.write.outside-userdata",
    actor,
    resource: outputPath,
    context: metadata,
  })
  auditSink.record({
    action: "fs.write.outside-userdata",
    actor,
    resource: path.basename(outputPath),
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? metadata
      : { ...metadata, policyId: permission.policyId },
  })
  if (!permission.allowed) throw new DocumentTextSaveError("PERMISSION_DENIED")
}
