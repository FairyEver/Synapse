import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "@/types/backup"

const DEFAULT_BACKUP_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的配置备份桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererConfigBridge = NonNullable<Window["synapse"]>["config"]

function getConfigBridge(): RendererConfigBridge | undefined {
  return getSynapseBridge()?.config
}

function exportConfigBackup(): Promise<SynapseConfigBackupExportResult | null> {
  const bridge = getConfigBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_BACKUP_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.exportBackup()
}

function importConfigBackup(): Promise<SynapseConfigBackupImportResult | null> {
  const bridge = getConfigBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_BACKUP_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.importBackup()
}

export {
  exportConfigBackup,
  importConfigBackup,
}
