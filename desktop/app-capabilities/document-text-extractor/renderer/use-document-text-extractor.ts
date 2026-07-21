import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type {
  DocumentTextExtractionResult,
  DocumentTextExtractionStatusEvent,
} from "../shared/schema"

const logger = createRendererLogger("document-text-extractor.app")

export type DocumentTextExtractionPhase =
  | "idle"
  | "waiting"
  | "running"
  | "success"
  | "cancelled"
  | "error"

export function useDocumentTextExtractor() {
  const bridge = useMemo(() => requireBridgeDomain("documentTextExtractor"), [])
  const activeOperationId = useRef<string | null>(null)
  const [filePath, setFilePath] = useState("")
  const [phase, setPhase] = useState<DocumentTextExtractionPhase>("idle")
  const [result, setResult] = useState<DocumentTextExtractionResult | null>(null)
  const [error, setError] = useState("")
  const busy = phase === "waiting" || phase === "running"

  useEffect(() => {
    const unsubscribe = bridge.operation.onStatus((event: DocumentTextExtractionStatusEvent) => {
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
    const operationId = crypto.randomUUID()
    activeOperationId.current = operationId
    setResult(null)
    setError("")
    setPhase("waiting")

    try {
      const response = await bridge.document.extract({ operationId, filePath })
      if (activeOperationId.current !== operationId) return
      if (response.ok) {
        setResult(response.result)
        setPhase("success")
        return
      }
      if (response.error.code === "EXTRACTION_CANCELLED") {
        setPhase("cancelled")
        return
      }
      setError(response.error.message)
      setPhase("error")
    } catch (extractionError) {
      if (activeOperationId.current !== operationId) return
      logger.error("Document text extraction IPC failed.", extractionError)
      setError("文档文本提取失败。")
      setPhase("error")
    } finally {
      if (activeOperationId.current === operationId) activeOperationId.current = null
    }
  }, [bridge, busy, filePath])

  const cancelExtraction = useCallback(async () => {
    const operationId = activeOperationId.current
    if (!operationId) return
    try {
      const response = await bridge.document.cancel({ operationId })
      if (response.cancelled && activeOperationId.current === operationId) {
        activeOperationId.current = null
        setPhase("cancelled")
      }
    } catch (cancelError) {
      logger.error("Failed to cancel document text extraction.", cancelError)
      toast.error("取消失败")
    }
  }, [bridge])

  const copyText = useCallback(async () => {
    if (!result?.text) return
    try {
      await navigator.clipboard.writeText(result.text)
      toast.success("已复制")
    } catch (copyError) {
      logger.error("Failed to copy extracted document text.", copyError)
      toast.error("复制失败")
    }
  }, [result])

  const saveText = useCallback(async () => {
    if (!result?.text) return
    try {
      const outputPath = await bridge.output.choose({
        defaultPath: defaultTextFileName(result.fileName),
      })
      if (!outputPath) return
      const response = await bridge.text.save({ outputPath, text: result.text })
      if (!response.ok) {
        toast.error(response.error.message)
        return
      }
      toast.success("已保存")
    } catch (saveError) {
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
