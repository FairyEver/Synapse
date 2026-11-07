import { useEffect, useMemo, useRef, useState } from "react"
import type {
  CustomAppDockAction,
  SynapseAppId,
} from "@synapse/shared"

import { useAppConfig } from "@/app-shell/config"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  DEFAULT_DOCK_APP_IDS,
  normalizeDockAppIds,
  type DockMoveDirection,
} from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"
import { isSystemAppEntryVisible } from "@/modules/apps/visibility"
import { useCustomApps } from "./context"
import { buildAppCatalog, type AppCatalogEntry } from "./app-adapter"

export type CloudDockEntry = Pick<AppCatalogEntry, "id" | "name" | "icon"> & {
  readonly kind: AppCatalogEntry["kind"]
}

export function useCloudDock({ workflowEntryVisible }: { readonly workflowEntryVisible: boolean }) {
  const { config } = useAppConfig()
  const customApps = useCustomApps()
  const { error: notifyError } = useAppNotifications()
  const [optimisticIds, setOptimisticIds] = useState<readonly SynapseAppId[] | null>(null)
  const [saving, setSaving] = useState(false)
  const bootstrappingRef = useRef(false)

  const localDockIds = useMemo(
    () => normalizeDockAppIds(config.global.dockAppIds),
    [config.global.dockAppIds],
  )
  const cloudSnapshot = customApps.state.snapshot
  const dockAppIds = optimisticIds ?? (cloudSnapshot?.dockAppIds as SynapseAppId[] | undefined) ?? localDockIds
  const canEdit = customApps.state.syncState === "ready"
  const catalog = useMemo(
    () => buildAppCatalog(
      listSystemApps().filter((app) =>
        app.id === "launcher" || isSystemAppEntryVisible(app, { workflowEntryVisible })),
      customApps.state,
    ),
    [customApps.state, workflowEntryVisible],
  )
  const catalogById = useMemo(() => new Map(catalog.map((entry) => [entry.id, entry])), [catalog])
  const pinnedApps = useMemo(
    () => dockAppIds.flatMap((id) => {
      const entry = catalogById.get(id)
      return entry ? [toDockEntry(entry)] : []
    }),
    [catalogById, dockAppIds],
  )
  const addableApps = useMemo(
    () => catalog
      .filter((entry) => entry.id !== "launcher")
      .filter((entry) => !dockAppIds.includes(entry.id))
      .filter((entry) => entry.pinnable)
      .map(toDockEntry),
    [catalog, dockAppIds],
  )

  useEffect(() => {
    if (!cloudSnapshot || cloudSnapshot.initialized || !canEdit || bootstrappingRef.current) return
    bootstrappingRef.current = true
    void customApps.bootstrapDock({
      operationId: crypto.randomUUID(),
      dockAppIds: [...localDockIds],
      dockMigrationIds: [...(config.global.dockMigrationIds ?? [])],
    }).catch(() => {
      bootstrappingRef.current = false
      notifyError("初始化 Dock 失败")
    })
  }, [canEdit, cloudSnapshot, config.global.dockMigrationIds, customApps, localDockIds, notifyError])

  const apply = async (action: CustomAppDockAction): Promise<boolean> => {
    if (!canEdit || saving) return false
    setSaving(true)
    try {
      await customApps.applyDockOperation({
        ...action,
        operationId: crypto.randomUUID(),
      })
      return true
    } catch {
      notifyError("保存 Dock 设置失败")
      return false
    } finally {
      setSaving(false)
      setOptimisticIds(null)
    }
  }

  const addDockApp = (appId: SynapseAppId) => apply({ type: "pin", appId })
  const removeDockApp = (appId: SynapseAppId) => apply({ type: "unpin", appId })
  const moveDockApp = (appId: SynapseAppId, direction: DockMoveDirection) => {
    const index = dockAppIds.indexOf(appId)
    if (index < 0) return Promise.resolve(false)
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= dockAppIds.length) return Promise.resolve(false)
    const next = [...dockAppIds]
    const [item] = next.splice(index, 1)
    next.splice(targetIndex, 0, item)
    return apply({ type: "move", appId, beforeAppId: next[targetIndex + 1] ?? null })
  }
  const reorderDockApps = (activeId: SynapseAppId, overId: SynapseAppId) => {
    const from = dockAppIds.indexOf(activeId)
    const to = dockAppIds.indexOf(overId)
    if (from < 0 || to < 0 || from === to) return Promise.resolve(false)
    const next = [...dockAppIds]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return apply({ type: "move", appId: activeId, beforeAppId: next[to + 1] ?? null })
  }
  const restoreDefaultDock = () => apply({ type: "restore-default" })

  return {
    addableApps,
    addDockApp,
    canEdit,
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

function toDockEntry(entry: AppCatalogEntry): CloudDockEntry {
  return {
    id: entry.id,
    name: entry.name,
    icon: entry.icon,
    kind: entry.kind,
  }
}
