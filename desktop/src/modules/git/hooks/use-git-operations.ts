import { useEffect, useRef, useState } from "react"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitOperationState, SynapseGitUserFacingFailure } from "@/types/git"

type CloneRepositoryInput = {
  readonly remoteUrl: string
  readonly parentDirectory: string
  readonly directoryName: string
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
  readonly globalOperationId?: string | null
  readonly globalPhase?: SynapseGitOperationState["status"] | null
  readonly repositoryOperationIds?: Readonly<Record<string, string>>
  readonly repositoryPhases?: Readonly<Record<string, SynapseGitOperationState["status"]>>
}

const EMPTY_BUSY_STATE: GitOperationBusyState = {
  global: null,
  repositories: {},
  globalOperationId: null,
  globalPhase: null,
  repositoryOperationIds: {},
  repositoryPhases: {},
}

function createClientOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `git-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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

function isCancelledOperation(error: unknown): boolean {
  return error instanceof Error && (error.name === "GitOperationCancelledError" || /操作已取消/.test(error.message))
}

export function useGitOperations(onCompleted: () => void | Promise<void>) {
  const [busy, setBusy] = useState<GitOperationBusyState>(EMPTY_BUSY_STATE)
  const [error, setError] = useState<string | null>(null)
  const [lastFailure, setLastFailure] = useState<GitOperationFailure | null>(null)
  const retryRef = useRef<(() => Promise<GitGlobalOperationResult | GitRepositoryOperationResult>) | null>(null)

  useEffect(() => {
    const subscribe = getSynapseBridge()?.git.onOperationChanged
    if (typeof subscribe !== "function") return
    return subscribe((state) => {
    setBusy((current) => {
      if (current.globalOperationId === state.operationId) {
        return { ...current, globalPhase: state.status }
      }
      const repositoryId = Object.entries(current.repositoryOperationIds ?? {})
        .find(([, operationId]) => operationId === state.operationId)?.[0]
      if (!repositoryId) return current
      return {
        ...current,
        repositoryPhases: {
          ...current.repositoryPhases,
          [repositoryId]: state.status,
        },
      }
    })
    })
  }, [])

  async function runGlobal(label: GitGlobalOperation, action: (operationId: string) => Promise<unknown>): Promise<GitGlobalOperationResult> {
    const operationId = createClientOperationId()
    setBusy((current) => ({ ...current, global: label, globalOperationId: operationId, globalPhase: "queued" }))
    setError(null)
    setLastFailure(null)
    try {
      await action(operationId)
      await onCompleted()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败。"
      if (isCancelledOperation(err)) {
        await onCompleted()
        setError(null)
        setLastFailure(null)
        return { ok: false, error: message, failure: null }
      }
      await onCompleted()
      const failure = readOperationFailure(err, label)
      setError(message)
      setLastFailure(failure)
      retryRef.current = failure && (failure.category === "network" || failure.category === "timeout")
        ? () => runGlobal(label, action)
        : null
      return { ok: false, error: message, failure }
    } finally {
      setBusy((current) => current.globalOperationId === operationId
        ? { ...current, global: null, globalOperationId: null, globalPhase: null }
        : current)
    }
  }

  async function runRepository(
    repositoryId: string,
    operation: GitRepositoryOperation,
    action: (operationId: string) => Promise<unknown>,
  ): Promise<GitRepositoryOperationResult> {
    const operationId = createClientOperationId()
    setBusy((current) => ({
      ...current,
      repositories: {
        ...current.repositories,
        [repositoryId]: operation,
      },
      repositoryOperationIds: {
        ...current.repositoryOperationIds,
        [repositoryId]: operationId,
      },
      repositoryPhases: {
        ...current.repositoryPhases,
        [repositoryId]: "queued",
      },
    }))
    setError(null)
    setLastFailure(null)
    try {
      await action(operationId)
      await onCompleted()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败。"
      if (isCancelledOperation(err)) {
        await onCompleted()
        setError(null)
        setLastFailure(null)
        return { ok: false, error: message, failure: null }
      }
      await onCompleted()
      const failure = readOperationFailure(err, undefined, repositoryId, operation)
      setLastFailure(failure)
      setError(message)
      retryRef.current = failure && (failure.category === "network" || failure.category === "timeout")
        ? () => runRepository(repositoryId, operation, action)
        : null
      return { ok: false, error: message, failure }
    } finally {
      setBusy((current) => {
        const repositories = { ...current.repositories }
        const repositoryOperationIds = { ...current.repositoryOperationIds }
        const repositoryPhases = { ...current.repositoryPhases }
        if (repositoryOperationIds[repositoryId] !== operationId) return current
        delete repositories[repositoryId]
        delete repositoryOperationIds[repositoryId]
        delete repositoryPhases[repositoryId]
        return { ...current, repositories, repositoryOperationIds, repositoryPhases }
      })
    }
  }

  return {
    busy,
    error,
    lastFailure,
    cloneRepository: (input: CloneRepositoryInput) =>
      runGlobal("clone", (operationId) => requireSynapseBridge().git.cloneRepository({ ...input, operationId })),
    addLocalRepository: (input: AddLocalRepositoryInput) =>
      runGlobal("add-local", () => requireSynapseBridge().git.addLocalRepository(input)),
    sync: (repositoryId: string) =>
      runRepository(repositoryId, "sync", (operationId) => requireSynapseBridge().git.sync(repositoryId, operationId)),
    pull: (repositoryId: string) =>
      runRepository(repositoryId, "pull", (operationId) => requireSynapseBridge().git.pull(repositoryId, operationId)),
    push: (repositoryId: string, remoteName?: string) =>
      runRepository(repositoryId, "push", (operationId) => requireSynapseBridge().git.push(repositoryId, remoteName, operationId)),
    removeRepository: (repositoryId: string) =>
      runRepository(repositoryId, "remove", () => requireSynapseBridge().git.removeRepository(repositoryId)).then((result) => result.ok),
    cancelGlobal: () => {
      const operationId = busy.globalOperationId
      return operationId ? requireSynapseBridge().git.cancelOperation(operationId) : Promise.resolve(false)
    },
    cancelRepository: (repositoryId: string) => {
      const operationId = busy.repositoryOperationIds?.[repositoryId]
      return operationId ? requireSynapseBridge().git.cancelOperation(operationId) : Promise.resolve(false)
    },
    retry: () => retryRef.current?.() ?? Promise.resolve(null),
  }
}
