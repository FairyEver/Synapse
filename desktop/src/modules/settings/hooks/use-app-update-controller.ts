import { useCallback, useEffect, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { useUpdateOpenRequest } from "@/hooks/use-update-open-request"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAppUpdateState } from "@/types/update"

const logger = createRendererLogger("settings.app-update")

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
}

function useAppUpdateController() {
  const [updateState, setUpdateState] = useState<SynapseAppUpdateState>(INITIAL_UPDATE_STATE)
  const [actionError, setActionError] = useState<string | null>(null)
  const [automaticInstallArmed, setAutomaticInstallArmedState] = useState(false)
  const [installArmVersion, setInstallArmVersion] = useState(0)
  const updateStateRef = useRef(INITIAL_UPDATE_STATE)
  const automaticInstallArmedRef = useRef(false)
  const automaticActionRef = useRef<"check" | "download" | null>(null)

  const setAutomaticInstallArmed = useCallback((armed: boolean) => {
    if (automaticInstallArmedRef.current === armed) return

    automaticInstallArmedRef.current = armed
    setAutomaticInstallArmedState(armed)
    if (armed) {
      setInstallArmVersion((current) => current + 1)
    } else {
      automaticActionRef.current = null
    }
  }, [])

  const applyUpdateState = useCallback((state: SynapseAppUpdateState) => {
    updateStateRef.current = state
    setUpdateState(state)
  }, [])

  const advanceAutomaticUpdate = useCallback(async (initialState: SynapseAppUpdateState) => {
    const bridge = getSynapseBridge()?.updater
    if (!bridge || !automaticInstallArmedRef.current) return

    let state = initialState
    while (automaticInstallArmedRef.current) {
      if (state.status === "error" || state.status === "not-available") {
        setAutomaticInstallArmed(false)
        return
      }
      if (state.status === "checking") {
        automaticActionRef.current = "check"
        return
      }
      if (state.status === "downloading") {
        automaticActionRef.current = "download"
        return
      }
      if (state.status === "downloaded") {
        automaticActionRef.current = null
        return
      }
      if (state.status === "idle" && automaticActionRef.current === "check") return
      if (state.status === "available" && automaticActionRef.current === "download") return
      if (state.status !== "idle" && state.status !== "available") return

      automaticActionRef.current = state.status === "available" ? "download" : "check"
      try {
        state = state.status === "available"
          ? await bridge.downloadUpdate()
          : await bridge.checkForUpdates()
        applyUpdateState(state)
      } catch (error) {
        const message = error instanceof Error ? error.message : "软件更新操作失败。"
        logger.error("Automatic app update action failed in settings.", error)
        setAutomaticInstallArmed(false)
        setActionError(message)
        return
      }
    }
  }, [applyUpdateState, setAutomaticInstallArmed])

  useEffect(() => {
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
      unsubscribe()
    }
  }, [advanceAutomaticUpdate, applyUpdateState])

  useUpdateOpenRequest(useCallback(async (request, { acknowledge }) => {
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
    const nextState = await getSynapseBridge()?.updater?.checkForUpdates()
    if (nextState) applyUpdateState(nextState)
  }, [applyUpdateState])

  const downloadUpdate = useCallback(async () => {
    const nextState = await getSynapseBridge()?.updater?.downloadUpdate()
    if (nextState) applyUpdateState(nextState)
  }, [applyUpdateState])

  const cancelDownload = useCallback(async () => {
    await getSynapseBridge()?.updater?.cancelDownload()
  }, [])

  const installUpdate = useCallback(async () => {
    await getSynapseBridge()?.updater?.installUpdate()
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
