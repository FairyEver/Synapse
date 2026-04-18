import { useEffect, useMemo, useState } from "react"
import {
  readRuleContent,
  readSkillContent,
  readSkillFiles,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import type {
  SynapseContentFile,
  SynapseContentMeta,
} from "@/types/content"

type UseContentDetailResult = {
  activeFilePath: string | null
  files: SynapseContentFile[]
  isLoading: boolean
  previewError: string | null
  setActiveFilePath: (path: string) => void
}

function useContentDetail(
  item: SynapseContentMeta | null,
  open: boolean,
): UseContentDetailResult {
  const logger = useMemo(
    () => createRendererLogger(`content.detail.${item?.type ?? "idle"}`),
    [item?.type],
  )
  const [files, setFiles] = useState<SynapseContentFile[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeFilePath, setActiveFilePathState] = useState<string | null>(null)

  useEffect(() => {
    if (!open || item === null) {
      setFiles([])
      setPreviewError(null)
      setIsLoading(false)
      setActiveFilePathState(null)
      return
    }

    let cancelled = false

    setFiles([])
    setPreviewError(null)
    setIsLoading(true)
    setActiveFilePathState(null)

    void (async () => {
      try {
        const nextFiles =
          item.type === "rule"
            ? [await readRuleContent(item.id)]
            : item.files.length === 0
              ? [await readSkillContent(item.id)]
              : await readSkillFiles(item.id)

        if (cancelled) {
          return
        }

        setFiles(nextFiles)
        setPreviewError(null)
        setActiveFilePathState(nextFiles[0]?.relativePath ?? null)
      } catch (loadError) {
        logger.error("Failed to load content detail.", {
          contentId: item.id,
          contentType: item.type,
          loadError,
        })

        if (cancelled) {
          return
        }

        setFiles([])
        setPreviewError(loadError instanceof Error ? loadError.message : "读取详情失败。")
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [item, logger, open])

  const setActiveFilePath = (path: string) => {
    setActiveFilePathState(path)
  }

  return {
    activeFilePath,
    files,
    isLoading,
    previewError,
    setActiveFilePath,
  }
}

export { useContentDetail }
