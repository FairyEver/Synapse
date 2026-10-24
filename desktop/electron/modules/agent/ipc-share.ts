import { BrowserWindow, ClipboardItem, clipboard, dialog, webContents } from "electron"
import { z } from "zod"
import { AGENT_SHARE_MAX_PNG_BYTES, type AgentShareImageRequest } from "../../../src/types/agent-share"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { AgentShareImageService } from "../../services/agent-share-image-service"
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("agent.share")
export const shareImageRequestSchema = z.object({
  action: z.enum(["copy", "save"]),
  pngBase64: z.string().min(1).max(Math.ceil(AGENT_SHARE_MAX_PNG_BYTES / 3) * 4),
  fileName: z.string().min(1).max(120),
}).strict()
export const shareImageResourceRequestSchema = z.object({ url: z.url().max(8192).refine((value) => {
  const url = new URL(value)
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
}) }).strict()

function createShareService(ctx: IpcHandlerContext): AgentShareImageService {
  const sender = ctx.sender ? webContents.fromId(ctx.sender.id) : undefined
  const parent = sender ? BrowserWindow.fromWebContents(sender) : undefined
  if (!parent || parent.isDestroyed()) throw new Error("当前窗口不可用，请重新打开对话。")
  return new AgentShareImageService({
    permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
    auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
    logger,
    chooseSavePath: async (fileName) => {
      const result = await dialog.showSaveDialog(parent, { title: "保存分享图片", defaultPath: fileName, filters: [{ name: "PNG 图片", extensions: ["png"] }] })
      if (result.canceled || !result.filePath) return null
      if (parent.isDestroyed()) throw new Error("对话窗口已关闭。")
      return result.filePath
    },
    copyPng: async (bytes) => {
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([Uint8Array.from(bytes)], { type: "image/png" }) })])
    },
  })
}

export const shareMethods: IpcModule["methods"] = {
  readShareImageResource: {
    kind: "invoke",
    operationId: "app.agent.operation.read_share_image_resource",
    request: shareImageResourceRequestSchema,
    response: z.object({ dataUrl: z.string().max(Math.ceil(AGENT_SHARE_MAX_PNG_BYTES / 3) * 4 + 128) }).strict(),
    maxResponseBytes: Math.ceil(AGENT_SHARE_MAX_PNG_BYTES / 3) * 4 + 1024,
    handler: async (ctx, input: { url: string }) => {
      const service = createShareService(ctx)
      const controller = new AbortController()
      const detach = ctx.sender?.onDestroyed?.(() => controller.abort())
      try { return await service.readRemoteImage(input.url, controller.signal) }
      catch (cause) {
        logger.warn("Agent share remote image read failed.", { errorName: cause instanceof Error ? cause.name : typeof cause })
        throw new Error("远端图片无法读取，请检查图片是否可访问后重试。", { cause })
      } finally { detach?.() }
    },
  },
  exportShareImage: {
    kind: "invoke",
    operationId: "app.agent.operation.export_share_image",
    request: shareImageRequestSchema,
    response: z.object({ success: z.boolean(), filePath: z.string().optional() }),
    handler: async (ctx, input: AgentShareImageRequest) => {
      const service = createShareService(ctx)
      try { return await service.exportImage(input) }
      catch (cause) {
        logger.warn("Agent share image output failed.", { action: input.action, errorName: cause instanceof Error ? cause.name : typeof cause })
        throw cause
      }
    },
  },
}
