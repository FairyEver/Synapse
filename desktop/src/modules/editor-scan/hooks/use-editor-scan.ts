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
  const hasFetched = useRef(false)
  const currentReqRef = useRef(0)

  const scan = useCallback(async () => {
    const reqId = ++currentReqRef.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("Bridge not available")
      }
      const result = await bridge.editorScan.scanAll()
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
    }
  }, [])

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true
      void scan().catch((error) => {
        logger.warn("Initial editor scan failed.", { error })
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
