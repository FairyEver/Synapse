import { isMainAppWindow, requestOpenTerminalSession } from "@/app-shell/terminal-navigation"
import { requireSynapseBridge } from "./electron-bridge"

/** Read-only validation before explicit navigation; never creates a replacement terminal. */
export async function openTerminalSession(input: { readonly projectId: string; readonly sessionId: string }): Promise<void> {
  const bridge = requireSynapseBridge()
  try {
    const [session, groups] = await Promise.all([
      bridge.terminal.session.get({ sessionId: input.sessionId }),
      bridge.terminal.group.list(),
    ])
    if (session.id !== input.sessionId || !groups.some(group => group.id === session.groupId && group.projectId === input.projectId)) {
      throw new Error("unavailable")
    }
  } catch {
    throw new Error("终端会话已不可用")
  }
  const request = { requestId: crypto.randomUUID(), sessionId: input.sessionId }
  if (isMainAppWindow()) requestOpenTerminalSession(request)
  else await bridge.apps.navigateMain({ appId: "terminal", target: request })
}
