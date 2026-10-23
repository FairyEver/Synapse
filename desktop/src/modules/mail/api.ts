import { requireBridgeDomain, requireSynapseBridge } from "@/lib/electron-bridge"
export const mailApi = () => requireBridgeDomain("mail")
export const openMailLink = (url: string) => requireSynapseBridge().shell.openExternal(url)
export const mailError = (error: unknown) => error instanceof Error ? error.message : "邮箱操作失败"

export async function openMailCompose(compose: import("../../../app-capabilities/mail/shared/private-schema").ComposeIntent) {
  const scope = await mailApi().uiScope()
  if (!scope.ownerId) throw new Error("请先登录 Synapse")
  await requireSynapseBridge().apps.openSystemApp("mail", { mailOpenRequest: { requestId: crypto.randomUUID(), ownerId: scope.ownerId, generation: scope.generation, compose } })
}
