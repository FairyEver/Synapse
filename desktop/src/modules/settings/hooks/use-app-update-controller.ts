import { useCallback, useEffect, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { useUpdateOpenRequest } from "@/hooks/use-update-open-request"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { runTrackedOperation, track } from "@/lib/ui-tracking"
import type { SynapseAppUpdateState } from "@/types/update"

const logger = createRendererLogger("settings.app-update")

type UpdateAction = "check" | "download" | "install"

const UPDATE_ACTION_EVENT_KEYS = {
  check: "update.check",
  download: "update.download",
} as const

const INITIAL_UPDATE_STATE: SynapseAppUpdateState = {
  currentVersion: "0.0.0",
  releaseVersion: null,
  status: "idle",
  message: "正在读取更新信息...",
  error: null,
  downloadPercent: null,
  bytesPerSecond: null,
  transferredBytes: null,
  totalBytes: null,
  lastCheckedAt: null,
  canCheck: false,
  installRecovery: null,
}

function useAppUpdateController() {
  const [updateState, setUpdateState] = useState<SynapseAppUpdateState>(INITIAL_UPDATE_STATE)
  const [actionError, setActionError] = useState<string | null>(null)
  const [automaticInstallArmed, setAutomaticInstallArmedState] = useState(false)
  const [installArmVersion, setInstallArmVersion] = useState(0)
  const updateStateRef = useRef(INITIAL_UPDATE_STATE)
  const mountedRef = useRef(true)
  const automaticInstallArmedRef = useRef(false)
  const inFlightActionsRef = useRef(new Set<UpdateAction>())

  const setAutomaticInstallArmed = useCallback((armed: boolean) => {
    if (armed && inFlightActionsRef.current.has("install")) return
    if (automaticInstallArmedRef.current === armed) return

    automaticInstallArmedRef.current = armed
    setAutomaticInstallArmedState(armed)
    if (armed) {
      setInstallArmVersion((current) => current + 1)
    }
  }, [])

  const applyUpdateState = useCallback((state: SynapseAppUpdateState) => {
    updateStateRef.current = state
    setUpdateState(state)
  }, [])

  const runUpdateAction = useCallback(async (action: "check" | "download") => {
    if (inFlightActionsRef.current.has(action)) return undefined

    const bridge = getSynapseBridge()?.updater
    if (!bridge) return undefined

    inFlightActionsRef.current.add(action)
    try {
      const eventKey = UPDATE_ACTION_EVENT_KEYS[action]
      const state = await runTrackedOperation(
        { component: "update", eventKey },
        () => action === "download" ? bridge.downloadUpdate() : bridge.checkForUpdates(),
      )
      if (!mountedRef.current) return undefined

      inFlightActionsRef.current.delete(action)
      applyUpdateState(state)
      return state
    } catch (error) {
      inFlightActionsRef.current.delete(action)
      if (!mountedRef.current) return undefined
      throw error
    }
  }, [applyUpdateState])

  const advanceAutomaticUpdate = useCallback(async (initialState: SynapseAppUpdateState) => {
    if (!automaticInstallArmedRef.current) return

    let state = initialState
    while (automaticInstallArmedRef.current) {
      if (state.error || state.status === "error" || state.status === "not-available") {
        setAutomaticInstallArmed(false)
        return
      }
      if (state.status === "checking") {
        return
      }
      if (state.status === "downloading") {
        return
      }
      if (state.status === "downloaded") {
        return
      }
      if (state.status === "idle" && inFlightActionsRef.current.has("check")) return
      if (state.status === "available" && inFlightActionsRef.current.has("download")) return
      if (state.status !== "idle" && state.status !== "available") return

      try {
        const nextState = await runUpdateAction(state.status === "available" ? "download" : "check")
        if (!nextState || !automaticInstallArmedRef.current) return
        if (nextState.status === state.status) {
          setAutomaticInstallArmed(false)
          return
        }
        state = nextState
      } catch (error) {
        const message = error instanceof Error ? error.message : "软件更新操作失败。"
        logger.error("Automatic app update action failed in settings.", error)
        setAutomaticInstallArmed(false)
        setActionError(message)
        return
      }
    }
  }, [runUpdateAction, setAutomaticInstallArmed])

  useEffect(() => {
    mountedRef.current = true
    const bridge = getSynapseBridge()?.updater

    if (!bridge) {
      setUpdateState({
        ...INITIAL_UPDATE_STATE,
        status: "unsupported",
        message: "当前环境不支持自动更新。",
      })
      return
    }

    let cancelled = false
    const receiveState = (state: SynapseAppUpdateState) => {
      if (cancelled) return
      setActionError(null)
      applyUpdateState(state)
      void advanceAutomaticUpdate(state)
    }
    const unsubscribe = bridge.onStateChanged(receiveState)

    const loadAndCheckForUpdates = async () => {
      try {
        const state = await bridge.getState()
        if (cancelled) return
        receiveState(state)

        const checkedState = await bridge.checkForUpdatesOnPageEnter()
        receiveState(checkedState)
      } catch (error) {
        logger.error("Failed to initialize app update state.", error)

        if (!cancelled) {
          const message = error instanceof Error ? error.message : "读取更新信息失败。"
          applyUpdateState({
            ...INITIAL_UPDATE_STATE,
            status: "error",
            message,
            error: message,
          })
        }
      }
    }

    void loadAndCheckForUpdates()

    return () => {
      cancelled = true
      mountedRef.current = false
      automaticInstallArmedRef.current = false
      inFlightActionsRef.current.clear()
      unsubscribe()
    }
  }, [advanceAutomaticUpdate, applyUpdateState])

  useUpdateOpenRequest(useCallback(async (request, { acknowledge }) => {
    track({
      component: "update",
      name: request.automatic ? "update.deeplink.accept" : "update.deeplink.reject",
      action: "open",
      eventKey: request.automatic ? "update.deeplink.accept" : "update.deeplink.reject",
      category: "navigation",
    })
    if (!request.automatic) {
      await acknowledge()
      return
    }

    if (!getSynapseBridge()?.updater) return

    setAutomaticInstallArmed(true)
    await advanceAutomaticUpdate(updateStateRef.current)
    await acknowledge()
  }, [advanceAutomaticUpdate, setAutomaticInstallArmed]))

  const checkForUpdates = useCallback(async () => {
    const nextState = await runUpdateAction("check")
    if (nextState) await advanceAutomaticUpdate(nextState)
  }, [advanceAutomaticUpdate, runUpdateAction])

  const downloadUpdate = useCallback(async () => {
    const nextState = await runUpdateAction("download")
    if (nextState) await advanceAutomaticUpdate(nextState)
  }, [advanceAutomaticUpdate, runUpdateAction])

  const cancelDownload = useCallback(async () => {
    const updater = getSynapseBridge()?.updater
    if (!updater) return
    await runTrackedOperation(
      { component: "update", eventKey: "update.download.cancel" },
      () => updater.cancelDownload(),
    )
  }, [])

  const installUpdate = useCallback(async () => {
    if (inFlightActionsRef.current.has("install")) return

    const bridge = getSynapseBridge()?.updater
    if (!bridge) return

    inFlightActionsRef.current.add("install")
    try {
      await runTrackedOperation(
        { component: "update", eventKey: "update.install" },
        () => bridge.installUpdate(),
      )
    } finally {
      inFlightActionsRef.current.delete("install")
    }
  }, [])

  const clearActionError = useCallback(() => {
    setActionError(null)
  }, [])

  return {
    actionError,
    automaticInstallArmed,
    cancelDownload,
    checkForUpdates,
    clearActionError,
    downloadUpdate,
    installArmVersion,
    installUpdate,
    setActionError,
    setAutomaticInstallArmed,
    updateState,
  }
}

export { useAppUpdateController }
