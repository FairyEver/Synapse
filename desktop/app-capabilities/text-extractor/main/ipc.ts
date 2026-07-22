import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import {
  textExtractionCancelResultSchema,
  textExtractionOperationSchema,
  textExtractionRequestSchema,
  textExtractionResponseSchema,
  textExtractionStatusEventSchema,
  textOutputChooseRequestSchema,
  textSaveInputSchema,
  textSaveResponseSchema,
  type TextExtractionRequest,
  type TextOutputChooseRequest,
  type TextSaveInput,
} from "../shared/schema"
import type { TextFileWriterService } from "../../text-file-writer/main/service"
import { TEXT_FILE_WRITER_SERVICE_ID } from "../../text-file-writer/shared/capability"
import type { TextExtractionTask } from "./scheduler"
import type { TextExtractorService } from "./service"
import { serializeTextExtractionError } from "./service"
import {
  createTextSaveService,
  serializeTextSaveError,
  type TextSaveService,
} from "./save-service"

type ActiveTask = TextExtractionTask<Awaited<ReturnType<TextExtractorService["extract"]>>>
type ActiveTaskEntry = {
  readonly task: ActiveTask
  readonly senderId: number | undefined
  detachSender(): void
}

export function createTextExtractorIpcModule(deps: {
  readonly saveService?: TextSaveService
} = {}): IpcModule {
  const activeTasks = new Map<string, ActiveTaskEntry>()

  const module: IpcModule = {
    id: "textExtractor",
    methods: {
      chooseDocument: {
        operationId: "app.text_extractor.document.choose",
        kind: "invoke",
        request: z.void().optional(),
        response: z.string().nullable(),
        handler: async () => chooseDocument(),
      },
      extractDocument: {
        operationId: "app.text_extractor.document.extract",
        kind: "invoke",
        request: textExtractionRequestSchema,
        response: textExtractionResponseSchema,
        handler: async (ctx, request: TextExtractionRequest) => {
          if (activeTasks.has(request.operationId)) {
            throw new Error("文本提取任务已存在。")
          }
          const service = ctx.resolve<TextExtractorService>("core.text-extractor")
          let task: ActiveTask
          try {
            task = service.createTask(
              { filePath: request.filePath },
              { actor: { kind: "user", id: "synapse-renderer", display: "Synapse" } },
            )
          } catch (error) {
            return { ok: false as const, error: serializeTextExtractionError(error) }
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
            return { ok: false as const, error: serializeTextExtractionError(error) }
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
        operationId: "app.text_extractor.operation.cancel",
        kind: "invoke",
        request: textExtractionOperationSchema,
        response: textExtractionCancelResultSchema,
        handler: async (ctx, request: z.infer<typeof textExtractionOperationSchema>) => {
          const entry = activeTasks.get(request.operationId)
          if (!entry || (entry.senderId !== undefined && entry.senderId !== ctx.sender?.id)) {
            return { cancelled: false }
          }
          return { cancelled: entry.task.cancel() }
        },
      },
      chooseOutput: {
        operationId: "app.text_extractor.output.choose",
        kind: "invoke",
        request: textOutputChooseRequestSchema,
        response: z.string().nullable(),
        handler: async (_ctx, request: TextOutputChooseRequest) => chooseOutput(request),
      },
      saveText: {
        operationId: "app.text_extractor.text.save",
        kind: "invoke",
        request: textSaveInputSchema,
        response: textSaveResponseSchema,
        handler: async (ctx, request: TextSaveInput) => {
          try {
            const saveService = deps.saveService ?? createTextSaveService(
              ctx.resolve<TextFileWriterService>(TEXT_FILE_WRITER_SERVICE_ID),
            )
            const result = await saveService.save(request, {
              actor: { kind: "user", id: "text-extractor-app" },
              source: "text-extractor",
            })
            return { ok: true as const, result }
          } catch (error) {
            return { ok: false as const, error: serializeTextSaveError(error) }
          }
        },
      },
    },
    events: {
      status: {
        operationId: "app.text_extractor.operation.status",
        kind: "event",
        payload: textExtractionStatusEventSchema,
      },
    },
  }

  return module
}

export const textExtractorIpcModule = createTextExtractorIpcModule()

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

async function chooseOutput(request: TextOutputChooseRequest): Promise<string | null> {
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
