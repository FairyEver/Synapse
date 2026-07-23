import { BrowserWindow, dialog } from "electron"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import { isTextFileWriteError, serializeTextFileWriteError } from "../../text-file-writer/shared/errors"
import {
  HTML_GENERATOR_FILE_SERVICE_ID,
  HTML_GENERATOR_SERVICE_ID,
} from "../shared/capability"
import { serializeHtmlGenerationError } from "../shared/errors"
import {
  htmlGenerationFileInputSchema,
  htmlGenerationFileResponseSchema,
  htmlGenerationInputSchema,
  htmlGenerationResponseSchema,
  htmlGeneratorOutputChooseRequestSchema,
  type HtmlGenerationFileInput,
  type HtmlGenerationInput,
  type HtmlGeneratorOutputChooseRequest,
} from "../shared/schema"
import type { HtmlGenerationToFileService } from "./file-service"
import type { HtmlGenerationService } from "./service"

export const htmlGeneratorIpcModule: IpcModule = {
  id: "htmlGenerator",
  methods: {
    chooseOutput: {
      operationId: "app.html_generator.output.choose",
      kind: "invoke",
      request: htmlGeneratorOutputChooseRequestSchema,
      response: htmlGenerationFileInputSchema.shape.outputPath.nullable(),
      handler: async (_ctx, request: HtmlGeneratorOutputChooseRequest) => {
        const options = {
          title: "选择输出文件",
          defaultPath: request?.defaultPath ?? "output.html",
          filters: [{ name: "HTML 文件", extensions: ["html", "htm"] }],
        }
        const parent = focusedWindow()
        const result = parent
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
    },
    generateHtml: {
      operationId: "app.html_generator.ejs.generate",
      kind: "invoke",
      request: htmlGenerationInputSchema,
      response: htmlGenerationResponseSchema,
      handler: async (ctx, request: HtmlGenerationInput) => withSenderAbort(ctx, async (signal) => {
        try {
          const service = ctx.resolve<HtmlGenerationService>(HTML_GENERATOR_SERVICE_ID)
          const result = await service.generate(request, {
            actor: { kind: "user", id: "html-generator-app" },
            source: "app.ui",
            abortSignal: signal,
          })
          return { ok: true as const, result }
        } catch (error) {
          return { ok: false as const, error: serializeHtmlGenerationError(error) }
        }
      }),
    },
    generateFile: {
      operationId: "app.html_generator.ejs_file.generate",
      kind: "invoke",
      request: htmlGenerationFileInputSchema,
      response: htmlGenerationFileResponseSchema,
      handler: async (ctx, request: HtmlGenerationFileInput) => withSenderAbort(ctx, async (signal) => {
        try {
          const service = ctx.resolve<HtmlGenerationToFileService>(HTML_GENERATOR_FILE_SERVICE_ID)
          const result = await service.generateToFile(request, {
            actor: { kind: "user", id: "html-generator-app" },
            source: "app.ui",
            abortSignal: signal,
          })
          return { ok: true as const, result }
        } catch (error) {
          return {
            ok: false as const,
            error: isTextFileWriteError(error)
              ? serializeTextFileWriteError(error)
              : serializeHtmlGenerationError(error),
          }
        }
      }),
    },
  },
  events: {},
}

async function withSenderAbort<T>(
  ctx: IpcHandlerContext,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const detach = ctx.sender?.onDestroyed(() => controller.abort()) ?? (() => undefined)
  if (ctx.sender?.isDestroyed()) controller.abort()
  try {
    return await task(controller.signal)
  } finally {
    detach()
  }
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}
