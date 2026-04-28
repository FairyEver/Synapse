import { useCallback, useEffect, useMemo, useState } from "react"
import { resolveEditorInstallStatus } from "@/app-shell/editor-install-status"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseContentDetail, SynapseContentMeta } from "@/types/content"
import type {
  SynapseEditorInstallStatusEntry,
  SynapseEditorInstallStatusProject,
} from "@/types/editor-install-status"

type UseEditorInstallStatusInput = {
  content: string | null
  detail: SynapseContentDetail | null
  item: SynapseContentMeta | null
  open: boolean
  projects: SynapseProjectConfig[]
  refreshSignal?: number
}

type UseEditorInstallStatusResult = {
  entries: SynapseEditorInstallStatusEntry[]
  error: string | null
  isLoading: boolean
  refresh: () => Promise<void>
}

function toStatusProjects(
  projects: SynapseProjectConfig[],
): SynapseEditorInstallStatusProject[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
  }))
}

function isInstallableContentDetail(
  detail: SynapseContentDetail | null,
): detail is SynapseContentDetail<"rule" | "skill"> {
  return detail?.type === "rule" || detail?.type === "skill"
}

function useEditorInstallStatus({
  content,
  detail,
  item,
  open,
  projects,
  refreshSignal,
}: UseEditorInstallStatusInput): UseEditorInstallStatusResult {
  const logger = useMemo(() => createRendererLogger("content.install-status"), [])
  const [entries, setEntries] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const canLoad = open && isInstallableContentDetail(detail)

  const refresh = useCallback(async () => {
    if (!canLoad || !isInstallableContentDetail(detail)) {
      setEntries([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    const startedAt = performance.now()

    try {
      const result = await resolveEditorInstallStatus({
        content: content ?? detail.content,
        contentId: detail.id,
        contentName: detail.name,
        contentType: detail.type,
        projects: toStatusProjects(projects),
        title: detail.title,
      })

      setEntries(result.entries)
      logger.info("Editor install status resolved.", {
        contentId: detail.id,
        contentType: detail.type,
        elapsedMs: Math.round(performance.now() - startedAt),
        entryCount: result.entries.length,
        itemId: item?.id ?? null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取安装状态失败。")
      logger.error("Failed to resolve editor install status.", {
        contentId: detail.id,
        contentType: detail.type,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: err,
        itemId: item?.id ?? null,
      })
    } finally {
      setIsLoading(false)
    }
  }, [canLoad, content, detail, item, logger, projects])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  return {
    entries,
    error,
    isLoading,
    refresh,
  }
}

export { useEditorInstallStatus }
export type { UseEditorInstallStatusResult }
