import { BrowserWindow, ClipboardItem, clipboard, dialog, webContents } from "electron"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { AgentShareImageService } from "../../../electron/services/agent-share-image-service"

export function createNativeShareOutput(deps: { permissionGuard: PermissionGuard; auditSink: AuditSink; logger: { warn(message: string, metadata: Record<string, unknown>): void } }, rendererId: number) {
  return new AgentShareImageService({ ...deps,
    chooseSavePath: async fileName => {
      const sender = webContents.fromId(rendererId), parent = sender ? BrowserWindow.fromWebContents(sender) : undefined
      if (!parent || parent.isDestroyed()) throw new Error("来源窗口已关闭，请指定保存路径。")
      const result = await dialog.showSaveDialog(parent, { title: "保存分享图片", defaultPath: fileName, filters: [{ name: "PNG 图片", extensions: ["png"] }] })
      if (parent.isDestroyed()) throw new Error("来源窗口已关闭。")
      return result.canceled ? null : result.filePath ?? null
    },
    copyPng: async bytes => { await clipboard.write([new ClipboardItem({ "image/png": new Blob([Uint8Array.from(bytes)], { type: "image/png" }) })]) },
  })
}
