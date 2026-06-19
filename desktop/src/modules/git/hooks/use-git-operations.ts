import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepositoryRemoveInput } from "@/types/git"

type CloneRepositoryInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type AddLocalRepositoryInput = {
  readonly name: string
  readonly localPath: string
}

type GitGlobalOperation = "clone" | "add-local"
export type GitRepositoryOperation = "sync" | "pull" | "push" | "remove"

export type GitGlobalOperationResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

export type GitOperationBusyState = {
  readonly global: GitGlobalOperation | null
  readonly repositories: Readonly<Record<string, GitRepositoryOperation>>
}

const EMPTY_BUSY_STATE: GitOperationBusyState = {
  global: null,
  repositories: {},
}

export function useGitOperations(onCompleted: () => void | Promise<void>) {
  const [busy, setBusy] = useState<GitOperationBusyState>(EMPTY_BUSY_STATE)
  const [error, setError] = useState<string | null>(null)

  async function runGlobal(label: GitGlobalOperation, action: () => Promise<unknown>): Promise<GitGlobalOperationResult> {
    setBusy((current) => ({ ...current, global: label }))
    setError(null)
    try {
      await action()
      await onCompleted()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败。"
      setError(message)
      return { ok: false, error: message }
    } finally {
      setBusy((current) => ({ ...current, global: null }))
    }
  }

  async function runRepository(
    repositoryId: string,
    operation: GitRepositoryOperation,
    action: () => Promise<unknown>,
  ): Promise<boolean> {
    setBusy((current) => ({
      ...current,
      repositories: {
        ...current.repositories,
        [repositoryId]: operation,
      },
    }))
    setError(null)
    try {
      await action()
      await onCompleted()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败。")
      return false
    } finally {
      setBusy((current) => {
        const { [repositoryId]: _completedOperation, ...repositories } = current.repositories
        return { ...current, repositories }
      })
    }
  }

  return {
    busy,
    error,
    cloneRepository: (input: CloneRepositoryInput) =>
      runGlobal("clone", () => requireSynapseBridge().git.cloneRepository(input)),
    addLocalRepository: (input: AddLocalRepositoryInput) =>
      runGlobal("add-local", () => requireSynapseBridge().git.addLocalRepository(input)),
    sync: (repositoryId: string) =>
      runRepository(repositoryId, "sync", () => requireSynapseBridge().git.sync(repositoryId)),
    pull: (repositoryId: string) =>
      runRepository(repositoryId, "pull", () => requireSynapseBridge().git.pull(repositoryId)),
    push: (repositoryId: string) =>
      runRepository(repositoryId, "push", () => requireSynapseBridge().git.push(repositoryId)),
    removeRepository: (input: SynapseGitRepositoryRemoveInput) =>
      runRepository(input.repositoryId, "remove", () => requireSynapseBridge().git.removeRepository(input)),
  }
}
