import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type {
  CustomAppCreateInput,
  CustomAppDockOperation,
  CustomAppId,
  CustomAppSnapshotDto,
  CustomAppUpdateInput,
  CustomAppsClientState,
} from "@synapse/shared"

import { getSynapseBridge } from "@/lib/electron-bridge"
import type { CustomAppIconResult } from "./create-edit-dialog"

const EMPTY_STATE: CustomAppsClientState = {
  accountId: null,
  snapshot: null,
  syncState: "signed-out",
  errorCode: null,
}

type CustomAppsContextValue = {
  readonly state: CustomAppsClientState
  readonly editable: boolean
  refresh: () => Promise<void>
  create: (input: CustomAppCreateInput) => Promise<CustomAppSnapshotDto>
  update: (id: CustomAppId, input: CustomAppUpdateInput) => Promise<CustomAppSnapshotDto>
  delete: (id: CustomAppId, operationId: string) => Promise<CustomAppSnapshotDto>
  bootstrapDock: (input: {
    operationId: string
    dockAppIds: string[]
    dockMigrationIds: string[]
  }) => Promise<CustomAppSnapshotDto>
  applyDockOperation: (input: CustomAppDockOperation) => Promise<CustomAppSnapshotDto>
  fetchFavicon: (url: string) => Promise<CustomAppIconResult | null>
  chooseIcon: () => Promise<CustomAppIconResult | null>
}

const CustomAppsContext = createContext<CustomAppsContextValue | null>(null)

export function CustomAppsProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<CustomAppsClientState>(EMPTY_STATE)
  const bridge = getSynapseBridge()?.customApps

  useEffect(() => {
    if (!bridge) return undefined
    let cancelled = false
    void bridge.getSnapshot().then((next) => {
      if (!cancelled) setState(next)
    }).catch(() => {
      if (!cancelled) setState({ ...EMPTY_STATE, syncState: "error", errorCode: "sync_failed" })
    })
    const unsubscribe = bridge.onChanged(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridge])

  const acceptSnapshot = useCallback((snapshot: CustomAppSnapshotDto) => {
    setState((current) => ({
      ...current,
      snapshot,
      syncState: "ready",
      errorCode: null,
    }))
    return snapshot
  }, [])

  const value = useMemo<CustomAppsContextValue>(() => ({
    state,
    editable: state.syncState === "ready",
    async refresh() {
      if (!bridge) return
      setState(await bridge.retry())
    },
    async create(input) {
      if (!bridge) throw new Error("Custom app bridge is unavailable.")
      return acceptSnapshot(await bridge.create(input))
    },
    async update(id, input) {
      if (!bridge) throw new Error("Custom app bridge is unavailable.")
      return acceptSnapshot(await bridge.update(id, input))
    },
    async delete(id, operationId) {
      if (!bridge) throw new Error("Custom app bridge is unavailable.")
      return acceptSnapshot(await bridge.delete(id, operationId))
    },
    async bootstrapDock(input) {
      if (!bridge) throw new Error("Custom app bridge is unavailable.")
      return acceptSnapshot(await bridge.bootstrapDock(input))
    },
    async applyDockOperation(input) {
      if (!bridge) throw new Error("Custom app bridge is unavailable.")
      return acceptSnapshot(await bridge.applyDockOperation(input))
    },
    async fetchFavicon(url) {
      if (!bridge) return null
      return bridge.fetchFavicon(url)
    },
    async chooseIcon() {
      if (!bridge) return null
      return bridge.chooseIcon()
    },
  }), [acceptSnapshot, bridge, state])

  return <CustomAppsContext.Provider value={value}>{children}</CustomAppsContext.Provider>
}

export function useCustomApps(): CustomAppsContextValue {
  const value = useContext(CustomAppsContext)
  if (!value) throw new Error("useCustomApps must be used inside CustomAppsProvider.")
  return value
}
