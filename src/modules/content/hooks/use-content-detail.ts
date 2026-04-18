import { useEffect, useMemo, useState } from "react"
import {
  readRuleDetail,
  readRuleHistory,
  readRuleHistoryVersion,
  readSkillDetail,
  readSkillHistory,
  readSkillHistoryVersion,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import type {
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMeta,
} from "@/types/content"

type UseContentDetailResult = {
  detail: SynapseContentDetail | null
  displayedVersion: SynapseContentHistoryVersion | null
  history: SynapseContentHistoryEntry[]
  isLoading: boolean
  previewError: string | null
  selectedHistoryDirname: string | null
  setSelectedHistoryDirname: (historyDirname: string | null) => void
}

function useContentDetail(
  item: SynapseContentMeta | null,
  open: boolean,
): UseContentDetailResult {
  const logger = useMemo(
    () => createRendererLogger(`content.detail.${item?.type ?? "idle"}`),
    [item?.type],
  )
  const [detail, setDetail] = useState<SynapseContentDetail | null>(null)
  const [displayedVersion, setDisplayedVersion] = useState<SynapseContentHistoryVersion | null>(null)
  const [history, setHistory] = useState<SynapseContentHistoryEntry[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedHistoryDirname, setSelectedHistoryDirnameState] = useState<string | null>(null)

  useEffect(() => {
    if (!open || item === null) {
      setDetail(null)
      setDisplayedVersion(null)
      setHistory([])
      setPreviewError(null)
      setIsLoading(false)
      setSelectedHistoryDirnameState(null)
      return
    }

    let cancelled = false

    setDetail(null)
    setDisplayedVersion(null)
    setHistory([])
    setPreviewError(null)
    setIsLoading(true)
    setSelectedHistoryDirnameState(null)

    void (async () => {
      try {
        const [nextDetail, nextHistory] = await Promise.all(
          item.type === "rule"
            ? [readRuleDetail(item.id), readRuleHistory(item.id)]
            : [readSkillDetail(item.id), readSkillHistory(item.id)],
        )

        if (cancelled) {
          return
        }

        setDetail(nextDetail)
        setDisplayedVersion({
          ...nextDetail,
          historyDirname: nextDetail.latestHistoryDirname,
          isCurrent: true,
        })
        setHistory(nextHistory)
        setPreviewError(null)
      } catch (loadError) {
        logger.error("Failed to load content detail.", {
          contentId: item.id,
          contentType: item.type,
          loadError,
        })

        if (cancelled) {
          return
        }

        setDetail(null)
        setDisplayedVersion(null)
        setHistory([])
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

  useEffect(() => {
    if (!open || !item || !detail || !selectedHistoryDirname || selectedHistoryDirname === detail.latestHistoryDirname) {
      if (detail) {
        setDisplayedVersion({
          ...detail,
          historyDirname: detail.latestHistoryDirname,
          isCurrent: true,
        })
      }
      return
    }

    let cancelled = false

    setIsLoading(true)

    void (async () => {
      try {
        const nextVersion =
          item.type === "rule"
            ? await readRuleHistoryVersion(item.id, selectedHistoryDirname)
            : await readSkillHistoryVersion(item.id, selectedHistoryDirname)

        if (cancelled) {
          return
        }

        setDisplayedVersion(nextVersion)
        setPreviewError(null)
      } catch (loadError) {
        logger.error("Failed to load history version.", {
          contentId: item.id,
          contentType: item.type,
          historyDirname: selectedHistoryDirname,
          loadError,
        })

        if (cancelled) {
          return
        }

        setPreviewError(loadError instanceof Error ? loadError.message : "读取历史失败。")
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [detail, item, logger, open, selectedHistoryDirname])

  return {
    detail,
    displayedVersion,
    history,
    isLoading,
    previewError,
    selectedHistoryDirname,
    setSelectedHistoryDirname: setSelectedHistoryDirnameState,
  }
}

export { useContentDetail }
