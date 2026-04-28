import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResult,
  SynapseResolveEditorCopyTargetPayload,
} from "@/types/editor-copy"
import type { SynapseEditorResolvedTarget } from "@/types/editor"

const DEFAULT_EDITOR_COPY_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的编辑器复制桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererEditorCopyBridge = NonNullable<Window["synapse"]>["editorCopy"]

function requireEditorCopyBridge(): RendererEditorCopyBridge {
  const bridge = getSynapseBridge()?.editorCopy

  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_EDITOR_COPY_BRIDGE_ERROR_MESSAGE)
  }

  return bridge
}

async function resolveEditorCopyTarget(
  payload: SynapseResolveEditorCopyTargetPayload,
): Promise<SynapseEditorResolvedTarget> {
  return requireEditorCopyBridge().resolveTarget(payload)
}

async function copyToEditor(
  payload: SynapseCopyToEditorPayload,
): Promise<SynapseEditorCopyResult> {
  return requireEditorCopyBridge().copy(payload)
}

export { copyToEditor, resolveEditorCopyTarget }
