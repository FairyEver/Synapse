import { requireBridgeDomain, requireSynapseBridge } from "@/lib/electron-bridge"
export const mailApi = () => requireBridgeDomain("mail")
export const openMailLink = (url: string) => requireSynapseBridge().shell.openExternal(url)
export const mailError = (error: unknown) => error instanceof Error ? error.message : "邮箱操作失败"
