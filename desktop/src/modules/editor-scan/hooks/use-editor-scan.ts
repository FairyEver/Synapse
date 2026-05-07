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

  const scan = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("Bridge not available")
      }
      const result = await bridge.editorScan.scanAll()
      setState({ data: result, loading: false, error: null })
    } catch (error) {
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
