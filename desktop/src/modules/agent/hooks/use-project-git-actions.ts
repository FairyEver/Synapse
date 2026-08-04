import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { isDefaultAgentWorkspaceProjectId } from "@/lib/default-agent-workspace"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { arePathsEqualForCompare } from "@/lib/path-compare"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"

type AgentGitAction = "commit" | "commit-and-push" | "pull" | "push" | "sync"
type AgentGitCommitAction = Extract<AgentGitAction, "commit" | "commit-and-push">

type PendingAgentGitCommit = {
  readonly action: AgentGitCommitAction
  readonly changeCount: number
  readonly message: string
  readonly selectionId: string | null
}

const logger = createRendererLogger("agent.git-actions")

function formatSynapseCommitMessage(changeCount: number): string {
  return `Update ${changeCount} ${changeCount === 1 ? "file" : "files"} via Synapse`
}

function findProjectGitRepository(
  project: Pick<SynapseProjectConfig, "id" | "path"> | undefined,
  repositories: readonly SynapseGitRepository[],
  platform = getRendererPlatform(),
): SynapseGitRepository | null {
  if (!project || isDefaultAgentWorkspaceProjectId(project.id)) return null
  return repositories.find((repository) => (
    arePathsEqualForCompare(repository.localPath, project.path, { platform })
  )) ?? null
}

function assertCommitSnapshot(snapshot: SynapseGitRepositorySnapshot): void {
  if (!snapshot.pathExists) throw new Error("Git 仓库目录不可访问。")
  if (!snapshot.isGitRepository) throw new Error("当前目录不是 Git 仓库。")
  if (snapshot.repositoryOperationState !== "normal") {
    throw new Error("仓库正在进行其他 Git 操作，请在 Git 应用中处理。")
  }
  if (snapshot.hasConflicts) throw new Error("仓库存在冲突，请在 Git 应用中处理。")
  if (snapshot.changeCount === 0) throw new Error("暂无可提交改动。")
  if (snapshot.changesTruncated || snapshot.changes.length !== snapshot.changeCount) {
    throw new Error("改动超过 10,000 项，请在 Git 应用中处理。")
  }
}

function createOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `agent-git-${Date.now().toString(36)}`
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "GitOperationCancelledError" || /操作已取消/.test(error.message))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Git 操作失败。"
}

function useProjectGitActions(project?: SynapseProjectConfig) {
  const projectId = project?.id
  const projectPath = project?.path
  const [repository, setRepository] = useState<SynapseGitRepository | null>(null)
  const [pendingCommit, setPendingCommit] = useState<PendingAgentGitCommit | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [preparingCommit, setPreparingCommit] = useState(false)
  const [busyAction, setBusyAction] = useState<AgentGitAction | null>(null)
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null)

  const refreshRepository = useCallback(async () => {
    if (!projectId || !projectPath || isDefaultAgentWorkspaceProjectId(projectId)) {
      setRepository(null)
      return
    }
    try {
      const repositories = await requireSynapseBridge().git.listRepositories()
      setRepository(findProjectGitRepository({ id: projectId, path: projectPath }, repositories))
    } catch (error) {
      logger.warn("Failed to resolve Agent project Git repository.", {
        boundary: "renderer.agent.git.resolve-repository",
        projectId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }, [projectId, projectPath])

  useEffect(() => {
    setRepository(null)
    setPendingCommit(null)
    setCommitError(null)
    void refreshRepository()
  }, [refreshRepository])

  useEffect(() => {
    const handleFocus = () => void refreshRepository()
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [refreshRepository])

  const openGit = useCallback(async () => {
    if (!repository) return
    try {
      await requireSynapseBridge().apps.openSystemApp("git", {
        gitOpenRequest: {
          requestId: createOperationId(),
          repositoryId: repository.id,
        },
      })
    } catch (error) {
      logger.warn("Failed to open Git repository from Agent.", {
        boundary: "renderer.agent.git.open-workbench",
        projectId: project?.id,
        repositoryId: repository.id,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      toast.error("打开 Git 失败")
    }
  }, [project?.id, repository])

  const showOperationError = useCallback((
    title: string,
    error: unknown,
    options: { readonly preserveTitleWhenCancelled?: boolean } = {},
  ) => {
    const cancelled = isCancelledError(error)
    if (cancelled && !options.preserveTitleWhenCancelled) {
      toast("Git 操作已取消")
      return
    }
    logger.warn("Agent Git operation failed.", {
      boundary: "renderer.agent.git.operation",
      projectId: project?.id,
      repositoryId: repository?.id,
      title,
      errorName: error instanceof Error ? error.name : typeof error,
    })
    toast.error(title, {
      description: cancelled ? "推送已取消。" : errorMessage(error),
      action: repository ? {
        label: "打开 Git",
        onClick: () => void openGit(),
      } : undefined,
    })
  }, [openGit, project?.id, repository])

  const prepareCommit = useCallback(async (action: AgentGitCommitAction) => {
    if (!repository || preparingCommit || busyAction) return
    setPreparingCommit(true)
    setCommitError(null)
    try {
      const snapshot = await requireSynapseBridge().git.getSnapshot(repository.id)
      assertCommitSnapshot(snapshot)
      const selection = await requireSynapseBridge().git.prepareChangeSelection({
        repositoryId: repository.id,
        paths: snapshot.changes.map((change) => change.path),
      })
      setPendingCommit({
        action,
        changeCount: snapshot.changeCount,
        message: formatSynapseCommitMessage(snapshot.changeCount),
        selectionId: selection.selectionId,
      })
    } catch (error) {
      showOperationError("无法准备提交", error)
    } finally {
      setPreparingCommit(false)
    }
  }, [busyAction, preparingCommit, repository, showOperationError])

  const confirmCommit = useCallback(async () => {
    if (!repository || !pendingCommit?.selectionId || busyAction) return
    const { action, message, selectionId } = pendingCommit
    const commitOperationId = createOperationId()
    setBusyAction(action)
    setActiveOperationId(commitOperationId)
    setCommitError(null)
    try {
      await requireSynapseBridge().git.commit({
        repositoryId: repository.id,
        message,
        selectionId,
        operationId: commitOperationId,
      })
      setPendingCommit(null)
      if (action === "commit") {
        toast.success("提交完成")
        return
      }

      const pushOperationId = createOperationId()
      setActiveOperationId(pushOperationId)
      try {
        await requireSynapseBridge().git.push(repository.id, undefined, pushOperationId)
        toast.success("提交并推送完成")
      } catch (error) {
        showOperationError("已提交，推送失败", error, { preserveTitleWhenCancelled: true })
      }
    } catch (error) {
      logger.warn("Agent Git commit failed.", {
        boundary: "renderer.agent.git.commit",
        projectId: project?.id,
        repositoryId: repository.id,
        action,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      if (isCancelledError(error)) {
        setCommitError("操作已取消。")
      } else {
        setCommitError(errorMessage(error))
      }
      setPendingCommit((current) => current ? { ...current, selectionId: null } : current)
    } finally {
      setBusyAction(null)
      setActiveOperationId(null)
    }
  }, [busyAction, pendingCommit, project?.id, repository, showOperationError])

  const reprepareCommit = useCallback(async () => {
    const action = pendingCommit?.action
    setPendingCommit(null)
    setCommitError(null)
    if (action) await prepareCommit(action)
  }, [pendingCommit?.action, prepareCommit])

  const runRemoteAction = useCallback(async (action: "pull" | "push" | "sync") => {
    if (!repository || busyAction || preparingCommit) return
    const operationId = createOperationId()
    setBusyAction(action)
    setActiveOperationId(operationId)
    try {
      if (action === "pull") await requireSynapseBridge().git.pull(repository.id, operationId)
      if (action === "push") await requireSynapseBridge().git.push(repository.id, undefined, operationId)
      if (action === "sync") await requireSynapseBridge().git.sync(repository.id, operationId)
      toast.success(action === "pull" ? "拉取完成" : action === "push" ? "推送完成" : "同步完成")
    } catch (error) {
      showOperationError(action === "pull" ? "拉取失败" : action === "push" ? "推送失败" : "同步失败", error)
    } finally {
      setBusyAction(null)
      setActiveOperationId(null)
    }
  }, [busyAction, preparingCommit, repository, showOperationError])

  const cancelOperation = useCallback(async () => {
    if (!activeOperationId) return
    try {
      await requireSynapseBridge().git.cancelOperation(activeOperationId)
    } catch (error) {
      logger.warn("Failed to cancel Agent Git operation.", {
        boundary: "renderer.agent.git.cancel-operation",
        projectId,
        repositoryId: repository?.id,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      toast.error("取消 Git 操作失败", {
        action: repository ? {
          label: "打开 Git",
          onClick: () => void openGit(),
        } : undefined,
      })
    }
  }, [activeOperationId, openGit, projectId, repository])

  const dismissCommit = useCallback(() => {
    if (busyAction) return
    setPendingCommit(null)
    setCommitError(null)
  }, [busyAction])

  return {
    repository,
    pendingCommit,
    commitError,
    preparingCommit,
    busyAction,
    prepareCommit,
    confirmCommit,
    reprepareCommit,
    dismissCommit,
    runRemoteAction,
    cancelOperation,
    openGit,
  }
}

export {
  findProjectGitRepository,
  formatSynapseCommitMessage,
  useProjectGitActions,
}
export type { AgentGitAction, PendingAgentGitCommit }
