import { useCallback, useEffect, useRef, useState } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import type { EditorScanResult } from "@/types/editor-scan"

const logger = createRendererLogger("editor-scan")

type EditorScanState = {
  data: EditorScanResult | null
  loading: boolean
  error: string | null
}

function useEditorScan() {
  const [state, setState] = useState<EditorScanState>({
    data: null,
    loading: false,
    error: null,
  })
  const activeScanRequestRef = useRef<string | null>(null)
  const currentReqRef = useRef(0)

  const scan = useCallback(async () => {
    const reqId = ++currentReqRef.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const bridge = getSynapseBridge()
    if (!bridge) {
      const error = new Error("Bridge not available")
      logger.error("Editor scan failed.", error)
      setState((prev) => ({ ...prev, loading: false, error: error.message }))
      throw error
    }
    const previousRequestId = activeScanRequestRef.current
    if (previousRequestId) {
      try {
        await bridge.editorScan.cancelScan({ requestId: previousRequestId })
      } catch (error) {
        logger.warn("Previous editor scan cancellation failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
      }
    }
    const request = { requestId: crypto.randomUUID() }
    activeScanRequestRef.current = request.requestId
    try {
      const result = await bridge.editorScan.scanAll(request)
      if (reqId !== currentReqRef.current) return
      setState({ data: result, loading: false, error: null })
    } catch (error) {
      if (reqId !== currentReqRef.current) return
      logger.error("Editor scan failed.", error)
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "扫描失败",
      }))
      throw error
    } finally {
      if (activeScanRequestRef.current === request.requestId) {
        activeScanRequestRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void scan().catch((error) => {
      logger.warn("Initial editor scan failed.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
    })
    return () => {
      currentReqRef.current += 1
      const requestId = activeScanRequestRef.current
      activeScanRequestRef.current = null
      const bridge = getSynapseBridge()
      if (!requestId || !bridge) return
      void bridge.editorScan.cancelScan({ requestId }).catch((error) => {
        logger.warn("Editor scan cancellation on unmount failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })
    }
  }, [scan])

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    refresh: scan,
  }
}

export { useEditorScan }
