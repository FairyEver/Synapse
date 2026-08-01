import { useCallback, useState } from "react"
import type { SynapseGitProvider } from "@/types/git"

type PendingGitActionBase = {
  readonly host: string
  readonly port?: number | null
  readonly protocol: "http" | "https" | "ssh"
  readonly provider: SynapseGitProvider
  readonly username?: string | null
}

export type PendingGitCloneAction = PendingGitActionBase & {
  readonly type: "clone"
  readonly input: {
    readonly directoryName: string
    readonly parentDirectory: string
    readonly remoteUrl: string
  }
}

export type PendingGitRepositoryOperation = "pull" | "push" | "sync"

export type PendingGitRepositoryAction = PendingGitActionBase & {
  readonly type: PendingGitRepositoryOperation
  readonly repositoryId: string
}

export type PendingGitAction = PendingGitCloneAction | PendingGitRepositoryAction

export function usePendingGitAction() {
  const [pendingAction, setPendingAction] = useState<PendingGitAction | null>(null)
  const clearPendingAction = useCallback(() => {
    setPendingAction(null)
  }, [])

  return {
    pendingAction,
    setPendingAction,
    clearPendingAction,
  }
}
