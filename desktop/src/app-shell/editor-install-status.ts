import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseEditorInstallStatusResult,
  SynapseResolveEditorInstallStatusPayload,
} from "@/types/editor-install-status"

const DEFAULT_EDITOR_INSTALL_STATUS_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的编辑器安装状态桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererEditorInstallStatusBridge =
  NonNullable<Window["synapse"]>["editorInstallStatus"]

function requireEditorInstallStatusBridge(): RendererEditorInstallStatusBridge {
  const bridge = getSynapseBridge()?.editorInstallStatus

  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_EDITOR_INSTALL_STATUS_BRIDGE_ERROR_MESSAGE)
  }

  return bridge
}

async function resolveEditorInstallStatus(
  payload: SynapseResolveEditorInstallStatusPayload,
): Promise<SynapseEditorInstallStatusResult> {
  return requireEditorInstallStatusBridge().resolveForContent(payload)
}

export { resolveEditorInstallStatus }
