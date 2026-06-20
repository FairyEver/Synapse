import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepositoryRemoveInput, SynapseGitUserFacingFailure } from "@/types/git"

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

export type GitOperationFailure = SynapseGitUserFacingFailure & {
  readonly globalOperation?: GitGlobalOperation
  readonly repositoryId?: string
  readonly repositoryOperation?: GitRepositoryOperation
}

export type GitGlobalOperationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly failure: GitOperationFailure | null }

export type GitRepositoryOperationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly failure: GitOperationFailure | null }

export type GitOperationBusyState = {
  readonly global: GitGlobalOperation | null
  readonly repositories: Readonly<Record<string, GitRepositoryOperation>>
}

const EMPTY_BUSY_STATE: GitOperationBusyState = {
  global: null,
  repositories: {},
}

function isUserFacingFailure(value: unknown): value is SynapseGitUserFacingFailure {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<Record<keyof SynapseGitUserFacingFailure, unknown>>
  return typeof record.category === "string"
    && typeof record.message === "string"
    && typeof record.title === "string"
}

export function readOperationFailure(
  err: unknown,
  globalOperation?: GitGlobalOperation,
  repositoryId?: string,
  repositoryOperation?: GitRepositoryOperation,
): GitOperationFailure | null {
  if (!err || typeof err !== "object") return null
  const failure = (err as { readonly userFacingFailure?: unknown }).userFacingFailure
  if (!isUserFacingFailure(failure)) return null
  return { ...failure, globalOperation, repositoryId, repositoryOperation }
}

export function useGitOperations(onCompleted: () => void | Promise<void>) {
  const [busy, setBusy] = useState<GitOperationBusyState>(EMPTY_BUSY_STATE)
  const [error, setError] = useState<string | null>(null)
  const [lastFailure, setLastFailure] = useState<GitOperationFailure | null>(null)

  async function runGlobal(label: GitGlobalOperation, action: () => Promise<unknown>): Promise<GitGlobalOperationResult> {
    setBusy((current) => ({ ...current, global: label }))
    setError(null)
    setLastFailure(null)
    try {
      await action()
      await onCompleted()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败。"
      const failure = readOperationFailure(err, label)
      setError(message)
      setLastFailure(failure)
      return { ok: false, error: message, failure }
    } finally {
      setBusy((current) => ({ ...current, global: null }))
    }
  }

  async function runRepository(
    repositoryId: string,
    operation: GitRepositoryOperation,
    action: () => Promise<unknown>,
  ): Promise<GitRepositoryOperationResult> {
    setBusy((current) => ({
      ...current,
      repositories: {
        ...current.repositories,
        [repositoryId]: operation,
      },
    }))
    setError(null)
    setLastFailure(null)
    try {
      await action()
      await onCompleted()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败。"
      const failure = readOperationFailure(err, undefined, repositoryId, operation)
      setLastFailure(failure)
      setError(message)
      return { ok: false, error: message, failure }
    } finally {
      setBusy((current) => {
        const repositories = { ...current.repositories }
        delete repositories[repositoryId]
        return { ...current, repositories }
      })
    }
  }

  return {
    busy,
    error,
    lastFailure,
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
      runRepository(input.repositoryId, "remove", () => requireSynapseBridge().git.removeRepository(input)).then((result) => result.ok),
  }
}
