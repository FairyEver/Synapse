import { BrowserWindow, dialog } from "electron"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { TextFileWriterService } from "./service"
import {
  textFileOutputChooseRequestSchema,
  textFileWriteInputSchema,
  textFileWriteResultSchema,
  textFileWriteResponseSchema,
  type TextFileOutputChooseRequest,
  type TextFileWriteInput,
} from "../shared/schema"
import { TEXT_FILE_WRITER_SERVICE_ID } from "../shared/capability"
import { serializeTextFileWriteError } from "../shared/errors"

export const textFileWriterIpcModule: IpcModule = {
  id: "textFileWriter",
  methods: {
    chooseOutput: {
      operationId: "app.text_file_writer.output.choose",
      kind: "invoke",
      request: textFileOutputChooseRequestSchema,
      response: textFileWriteResultSchema.shape.path.nullable(),
      handler: async (_ctx, request: TextFileOutputChooseRequest) => {
        const options = {
          title: "选择输出文件",
          defaultPath: request?.defaultPath ?? "output.md",
        }
        const parent = focusedWindow()
        const result = parent
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
    },
    writeFile: {
      operationId: "app.text_file_writer.file.write",
      kind: "invoke",
      request: textFileWriteInputSchema,
      response: textFileWriteResponseSchema,
      handler: async (ctx, request: TextFileWriteInput) => {
        try {
          const service = ctx.resolve<TextFileWriterService>(TEXT_FILE_WRITER_SERVICE_ID)
          const result = await service.write(request, {
            actor: { kind: "user", id: "text-file-writer-app" },
            source: "app.ui",
          })
          return { ok: true as const, result }
        } catch (error) {
          return { ok: false as const, error: serializeTextFileWriteError(error) }
        }
      },
    },
  },
  events: {},
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}
