import { useCallback, useEffect, useRef, useState } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import type { EditorScanSkillFileEntry } from "@/types/editor-scan"

const logger = createRendererLogger("editor-scan")

function useScanItemContent(filePath: string | null) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastPathRef = useRef<string | null>(null)

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const bridge = getSynapseBridge()
      if (!bridge) throw new Error("Bridge not available")
      const result = await bridge.editorScan.readItemContent(path)
      setContent(result)
    } catch (err) {
      logger.error("Failed to load scan item content.", { path, error: err })
      setError(err instanceof Error ? err.message : "读取内容失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!filePath) {
      setContent(null)
      setError(null)
      lastPathRef.current = null
      return
    }

    if (filePath === lastPathRef.current) return

    lastPathRef.current = filePath
    void load(filePath)
  }, [filePath, load])

  return { content, loading, error }
}

function useSkillFiles(dirPath: string | null) {
  const [files, setFiles] = useState<EditorScanSkillFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!dirPath) {
      setFiles([])
      setError(null)
      setLoading(false)
      lastPathRef.current = null
      return
    }

    if (dirPath === lastPathRef.current) return
    lastPathRef.current = dirPath

    const bridge = getSynapseBridge()
    if (!bridge) return

    setLoading(true)
    setError(null)
    void bridge.editorScan.listSkillFiles(dirPath)
      .then(setFiles)
      .catch((err) => {
        logger.error("Failed to load skill files.", { path: dirPath, error: err })
        setFiles([])
        setError(err instanceof Error ? err.message : "读取关联文件失败")
      })
      .finally(() => setLoading(false))
  }, [dirPath])

  return { files, loading, error }
}

export { useScanItemContent, useSkillFiles }
