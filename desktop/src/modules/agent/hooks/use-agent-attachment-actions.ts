import { useCallback, useMemo } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { AgentDraftAttachment } from "../attachments"

const logger = createRendererLogger("agent.attachments")

export type DraftAttachmentResult = {
  readonly attachments: readonly AgentDraftAttachment[]
  readonly rejectedCount: number
}

export function useAgentAttachmentActions(projectId: string | undefined) {
  const requireProjectId = useCallback(() => {
    if (!projectId) throw new Error("projectId is required")
    return projectId
  }, [projectId])

  const choose = useCallback(async (
    draftScopeId: string,
    kind: "file" | "directory",
  ): Promise<DraftAttachmentResult> => {
    const result = await requireSynapseBridge().agent.chooseAttachments({
      projectId: requireProjectId(),
      draftScopeId,
      kind,
    })
    return {
      attachments: result.attachments.map((candidate) => candidate.ref),
      rejectedCount: result.rejectedCount,
    }
  }, [requireProjectId])

  const stageFiles = useCallback(async (
    files: readonly File[],
    draftScopeId: string,
  ): Promise<DraftAttachmentResult> => {
    const pathSources: Array<{ readonly sourceIndex: number; readonly path: string }> = []
    let rejectedCount = 0
    for (const [sourceIndex, file] of files.entries()) {
      const path = droppedFilePath(file)
      if (!path || !isAbsolutePathLine(path)) {
        rejectedCount += 1
        continue
      }
      pathSources.push({ sourceIndex, path })
    }
    if (pathSources.length === 0) return { attachments: [], rejectedCount }
    const result = await requireSynapseBridge().agent.resolveAttachmentPaths({
      projectId: requireProjectId(),
      draftScopeId,
      paths: pathSources.map((item) => item.path),
    })
    return {
      attachments: result.attachments.map((candidate) => candidate.ref),
      rejectedCount: rejectedCount + result.rejectedCount,
    }
  }, [requireProjectId])

  const stageClipboardImage = useCallback(async (
    draftScopeId: string,
    name: string | undefined,
  ): Promise<DraftAttachmentResult> => {
    const result = await requireSynapseBridge().agent.stageClipboardImage({
      projectId: requireProjectId(),
      draftScopeId,
      name,
    })
    return {
      attachments: result.attachments.map((candidate) => candidate.ref),
      rejectedCount: result.rejectedCount,
    }
  }, [requireProjectId])

  const release = useCallback(async (
    draftScopeId: string,
    attachmentIds: readonly string[],
  ): Promise<void> => {
    if (!projectId || attachmentIds.length === 0) return
    try {
      await requireSynapseBridge().agent.releaseAttachments({ projectId, draftScopeId, attachmentIds })
    } catch (error) {
      logger.warn("Agent attachment release failed.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }, [projectId])

  return useMemo(() => ({
    choose,
    hasDroppedFilePath: (file: File) => Boolean(droppedFilePath(file)),
    release,
    stageClipboardImage,
    stageFiles,
  }), [choose, release, stageClipboardImage, stageFiles])
}

function droppedFilePath(file: File): string | null {
  return requireSynapseBridge().shell.filePathForDroppedFile(file) || legacyFilePath(file)
}

function legacyFilePath(file: File): string | null {
  return (file as File & { readonly path?: string }).path || null
}

function isAbsolutePathLine(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || isWindowsUncAbsolutePath(value)
}

function isWindowsUncAbsolutePath(value: string): boolean {
  return /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)
}
