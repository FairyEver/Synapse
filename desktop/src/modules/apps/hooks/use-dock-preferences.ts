import { useCallback, useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  DEFAULT_DOCK_APP_IDS,
  insertDockAppId,
  listAddableDockApps,
  listDockApps,
  moveDockAppId,
  normalizeDockAppIds,
  removeDockAppId,
  reorderDockAppIds,
  restoreDefaultDockAppIds,
  type DockMoveDirection,
} from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"
import type { SynapseSystemAppId } from "@/modules/apps/types"

const logger = createRendererLogger("dock.preferences")

type UseDockPreferencesOptions = {
  readonly workflowEntryVisible: boolean
}

function areDockAppIdsEqual(
  left: readonly SynapseSystemAppId[],
  right: readonly SynapseSystemAppId[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function useDockPreferences({ workflowEntryVisible }: UseDockPreferencesOptions) {
  const { config, updateConfig } = useAppConfig()
  const { error: notifyError, success: notifySuccess } = useAppNotifications()
  const [optimisticDockAppIds, setOptimisticDockAppIds] = useState<readonly SynapseSystemAppId[] | null>(null)
  const [saving, setSaving] = useState(false)

  const savedDockAppIds = useMemo(
    () => normalizeDockAppIds(config.global.dockAppIds),
    [config.global.dockAppIds],
  )
  const dockAppIds = optimisticDockAppIds ?? savedDockAppIds
  const allApps = listSystemApps()
  const pinnedApps = useMemo(
    () => listDockApps(allApps, { dockAppIds, workflowEntryVisible }),
    [allApps, dockAppIds, workflowEntryVisible],
  )
  const addableApps = useMemo(
    () => listAddableDockApps(allApps, { dockAppIds, workflowEntryVisible }),
    [allApps, dockAppIds, workflowEntryVisible],
  )

  const saveDockAppIds = useCallback(async (
    nextDockAppIds: readonly SynapseSystemAppId[],
    messages: { readonly success: string; readonly failure: string },
  ) => {
    const normalizedNextDockAppIds = normalizeDockAppIds(nextDockAppIds)
    if (saving || areDockAppIdsEqual(normalizedNextDockAppIds, normalizeDockAppIds(dockAppIds))) {
      return false
    }

    setSaving(true)
    setOptimisticDockAppIds([...normalizedNextDockAppIds])
    try {
      await updateConfig({ global: { dockAppIds: [...normalizedNextDockAppIds] } })
      notifySuccess(messages.success)
      return true
    } catch (saveError) {
      logger.error("Failed to save Dock preferences.", saveError)
      notifyError(messages.failure)
      return false
    } finally {
      setOptimisticDockAppIds(null)
      setSaving(false)
    }
  }, [dockAppIds, notifyError, notifySuccess, saving, updateConfig])

  const addDockApp = useCallback((appId: SynapseSystemAppId) => (
    saveDockAppIds(insertDockAppId(dockAppIds, appId), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const removeDockApp = useCallback((appId: SynapseSystemAppId) => (
    saveDockAppIds(removeDockAppId(dockAppIds, appId), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const moveDockApp = useCallback((appId: SynapseSystemAppId, direction: DockMoveDirection) => (
    saveDockAppIds(moveDockAppId(dockAppIds, appId, direction), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const reorderDockApps = useCallback((activeId: SynapseSystemAppId, overId: SynapseSystemAppId) => (
    saveDockAppIds(reorderDockAppIds(dockAppIds, activeId, overId), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const restoreDefaultDock = useCallback(() => (
    saveDockAppIds(restoreDefaultDockAppIds(), {
      success: "Dock 已恢复默认",
      failure: "恢复 Dock 默认设置失败",
    })
  ), [saveDockAppIds])

  return {
    addableApps,
    addDockApp,
    defaultDockAppIds: DEFAULT_DOCK_APP_IDS,
    dockAppIds,
    moveDockApp,
    pinnedApps,
    removeDockApp,
    reorderDockApps,
    restoreDefaultDock,
    saving,
  }
}
