import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import type {
  TextExtractionResult,
  TextExtractionStatusEvent,
} from "../shared/schema"

const logger = createRendererLogger("text-extractor.app")

export type TextExtractionPhase =
  | "idle"
  | "waiting"
  | "running"
  | "success"
  | "cancelled"
  | "error"

export function useTextExtractor() {
  const bridge = useMemo(() => requireBridgeDomain("textExtractor"), [])
  const activeOperationId = useRef<string | null>(null)
  const [filePath, setFilePath] = useState("")
  const [phase, setPhase] = useState<TextExtractionPhase>("idle")
  const [result, setResult] = useState<TextExtractionResult | null>(null)
  const [error, setError] = useState("")
  const busy = phase === "waiting" || phase === "running"

  useEffect(() => {
    const unsubscribe = bridge.operation.onStatus((event: TextExtractionStatusEvent) => {
      if (event.operationId !== activeOperationId.current) return
      setPhase(event.status)
    })
    return () => {
      unsubscribe()
      const operationId = activeOperationId.current
      if (!operationId) return
      void bridge.document.cancel({ operationId }).catch((cleanupError) => {
        logger.warn("Failed to cancel document extraction during cleanup.", cleanupError)
      })
    }
  }, [bridge])

  const clearOutcome = useCallback(() => {
    setResult(null)
    setError("")
    setPhase("idle")
  }, [])

  const chooseDocument = useCallback(async () => {
    try {
      const selected = await bridge.document.choose()
      if (!selected) return
      activeOperationId.current = null
      setFilePath(selected)
      clearOutcome()
    } catch (chooseError) {
      logger.error("Failed to choose a document for text extraction.", chooseError)
      toast.error("选择文件失败")
    }
  }, [bridge, clearOutcome])

  const extractDocument = useCallback(async () => {
    if (!filePath || busy) return
    const finishTracking = startTrackedOperation({ component: "text-extractor", eventKey: "text-extractor.document.extract" })
    const operationId = crypto.randomUUID()
    activeOperationId.current = operationId
    setResult(null)
    setError("")
    setPhase("waiting")

    try {
      const response = await bridge.document.extract({ operationId, filePath })
      if (activeOperationId.current !== operationId) {
        finishTracking("cancelled")
        return
      }
      if (response.ok) {
        finishTracking("success")
        setResult(response.result)
        setPhase("success")
        return
      }
      if (response.error.code === "EXTRACTION_CANCELLED") {
        finishTracking("cancelled")
        setPhase("cancelled")
        return
      }
      setError(response.error.message)
      finishTracking("failure")
      setPhase("error")
    } catch (extractionError) {
      if (activeOperationId.current !== operationId) {
        finishTracking("cancelled")
        return
      }
      finishTracking("failure")
      logger.error("Text extraction IPC failed.", extractionError)
      setError("文本提取失败。")
      setPhase("error")
    } finally {
      if (activeOperationId.current === operationId) activeOperationId.current = null
    }
  }, [bridge, busy, filePath])

  const cancelExtraction = useCallback(async () => {
    const operationId = activeOperationId.current
    if (!operationId) return
    const finishTracking = startTrackedOperation({ component: "text-extractor", eventKey: "text-extractor.document.cancel" })
    try {
      const response = await bridge.document.cancel({ operationId })
      if (response.cancelled && activeOperationId.current === operationId) {
        activeOperationId.current = null
        setPhase("cancelled")
      }
      finishTracking(response.cancelled ? "success" : "failure")
    } catch (cancelError) {
      finishTracking("failure")
      logger.error("Failed to cancel text extraction.", cancelError)
      toast.error("取消失败")
    }
  }, [bridge])

  const copyText = useCallback(async () => {
    if (!result?.text) return
    const finishTracking = startTrackedOperation({ component: "text-extractor", eventKey: "text-extractor.result.copy" })
    try {
      await navigator.clipboard.writeText(result.text)
      finishTracking("success")
      toast.success("已复制")
    } catch (copyError) {
      finishTracking("failure")
      logger.error("Failed to copy extracted document text.", copyError)
      toast.error("复制失败")
    }
  }, [result])

  const saveText = useCallback(async () => {
    if (!result?.text) return
    const finishTracking = startTrackedOperation({ component: "text-extractor", eventKey: "text-extractor.result.save" })
    try {
      const outputPath = await bridge.output.choose({
        defaultPath: defaultTextFileName(result.fileName),
      })
      if (!outputPath) {
        finishTracking("cancelled")
        return
      }
      const response = await bridge.text.save({ outputPath, text: result.text })
      if (!response.ok) {
        finishTracking("failure")
        toast.error(response.error.message)
        return
      }
      finishTracking("success")
      toast.success("已保存")
    } catch (saveError) {
      finishTracking("failure")
      logger.error("Failed to save extracted document text.", saveError)
      toast.error("保存失败")
    }
  }, [bridge, result])

  return {
    busy,
    cancelExtraction,
    chooseDocument,
    copyText,
    error,
    extractDocument,
    filePath,
    phase,
    result,
    saveText,
  }
}

function defaultTextFileName(fileName: string): string {
  return `${fileName.replace(/\.(?:pdf|docx)$/i, "")}.txt`
}
