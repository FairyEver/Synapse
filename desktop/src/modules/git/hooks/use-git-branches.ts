import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type {
  SynapseGitBranch,
  SynapseGitCheckoutRemoteBranchInput,
  SynapseGitRemoteBranchGroup,
} from "@/types/git"

type UseGitBranchesOptions = {
  readonly repositoryId: string
  readonly loadEnabled: boolean
  readonly refreshKey: number
  readonly onChanged: () => void | Promise<void>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function useGitBranches({ repositoryId, loadEnabled, refreshKey, onChanged }: UseGitBranchesOptions) {
  const [branches, setBranches] = useState<readonly SynapseGitBranch[]>([])
  const [remoteBranchGroups, setRemoteBranchGroups] = useState<readonly SynapseGitRemoteBranchGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [fetchingRemote, setFetchingRemote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchOperationIdRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const [localResult, remoteResult] = await Promise.allSettled([
      requireSynapseBridge().git.listBranches(repositoryId),
      requireSynapseBridge().git.listRemoteBranches(repositoryId),
    ])
    if (localResult.status === "fulfilled") setBranches(localResult.value)
    if (remoteResult.status === "fulfilled") setRemoteBranchGroups(remoteResult.value)
    const failure = localResult.status === "rejected"
      ? localResult.reason
      : remoteResult.status === "rejected"
        ? remoteResult.reason
        : null
    if (failure) throw failure
  }, [repositoryId])

  useEffect(() => {
    if (!loadEnabled) return
    let active = true
    void refresh()
      .then(() => {
        if (active) setError(null)
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, "读取分支失败。"))
      })
    return () => {
      active = false
    }
  }, [loadEnabled, refresh, refreshKey])

  const runMutation = async (eventKey: string, action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    const finishTracking = startTrackedOperation({ component: "git", eventKey })
    setBusy(true)
    setError(null)
    try {
      await action()
      if (loadEnabled) await refresh()
      await onChanged()
      finishTracking("success")
      return true
    } catch (cause) {
      finishTracking("failure")
      setError(errorMessage(cause, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const checkoutLocal = async (branchName: string): Promise<boolean> => runMutation(
    "git.branch.checkout",
    () => requireSynapseBridge().git.checkoutBranch(repositoryId, branchName),
    "切换分支失败。",
  )

  const createBranch = async (branchName: string): Promise<boolean> => runMutation(
    "git.branch.create",
    () => requireSynapseBridge().git.createBranch(repositoryId, branchName),
    "新建分支失败。",
  )

  const checkoutRemote = async (input: SynapseGitCheckoutRemoteBranchInput): Promise<boolean> => runMutation(
    "git.branch.checkout-remote",
    () => requireSynapseBridge().git.checkoutRemoteBranch(repositoryId, input),
    "检出远程分支失败。",
  )

  const fetchRemote = async (): Promise<void> => {
    const finishTracking = startTrackedOperation({ component: "git", eventKey: "git.branch.fetch-remote" })
    const operationId = globalThis.crypto?.randomUUID?.()
      ?? `git-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    fetchOperationIdRef.current = operationId
    setFetchingRemote(true)
    setError(null)
    try {
      await requireSynapseBridge().git.fetchRemoteBranches(repositoryId, operationId)
      await refresh()
      await onChanged()
      finishTracking("success")
    } catch (cause) {
      finishTracking("failure")
      setError(errorMessage(cause, "获取远程分支失败。"))
    } finally {
      if (fetchOperationIdRef.current === operationId) {
        fetchOperationIdRef.current = null
        setFetchingRemote(false)
      }
    }
  }

  const cancelRemoteFetch = async (): Promise<void> => {
    const operationId = fetchOperationIdRef.current
    if (!operationId) return
    const finishTracking = startTrackedOperation({ component: "git", eventKey: "git.branch.fetch-cancel" })
    try {
      await requireSynapseBridge().git.cancelOperation(operationId)
      finishTracking("success")
    } catch (cause) {
      finishTracking("failure")
      setError(errorMessage(cause, "取消获取远程分支失败。"))
    }
  }

  return {
    branches,
    remoteBranchGroups,
    busy,
    fetchingRemote,
    error,
    clearError: () => setError(null),
    checkoutLocal,
    createBranch,
    checkoutRemote,
    fetchRemote,
    cancelRemoteFetch,
  }
}
