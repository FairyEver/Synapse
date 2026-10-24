import { BrowserWindow, ClipboardItem, clipboard, dialog, webContents } from "electron"
import { z } from "zod"
import { AGENT_SHARE_MAX_PNG_BYTES, type AgentShareImageRequest } from "../../../src/types/agent-share"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { AgentShareImageService } from "../../services/agent-share-image-service"
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("agent.share")
export const shareImageRequestSchema = z.object({
  action: z.enum(["copy", "save"]),
  pngBase64: z.string().min(1).max(Math.ceil(AGENT_SHARE_MAX_PNG_BYTES / 3) * 4),
  fileName: z.string().min(1).max(120),
}).strict()

export const shareMethods: IpcModule["methods"] = {
  exportShareImage: {
    kind: "invoke",
    operationId: "app.agent.operation.export_share_image",
    request: shareImageRequestSchema,
    response: z.object({ success: z.boolean(), filePath: z.string().optional() }),
    handler: async (ctx, input: AgentShareImageRequest) => {
      const sender = ctx.sender ? webContents.fromId(ctx.sender.id) : undefined
      const parent = sender ? BrowserWindow.fromWebContents(sender) : undefined
      if (!parent || parent.isDestroyed()) throw new Error("当前窗口不可用，请重新打开对话。")
      const service = new AgentShareImageService({
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
      try { return await service.exportImage(input) }
      catch (cause) {
        logger.warn("Agent share image output failed.", { action: input.action, errorName: cause instanceof Error ? cause.name : typeof cause })
        throw cause
      }
    },
  },
}
