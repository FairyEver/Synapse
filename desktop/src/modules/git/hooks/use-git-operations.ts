import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

type CloneRepositoryInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type AddLocalRepositoryInput = {
  readonly name: string
  readonly localPath: string
}

export type GitOperationBusyState = "clone" | "add-local" | "sync" | "pull" | "push" | null

export function useGitOperations(onCompleted: () => void | Promise<void>) {
  const [busy, setBusy] = useState<GitOperationBusyState>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(label: Exclude<GitOperationBusyState, null>, action: () => Promise<unknown>): Promise<boolean> {
    setBusy(label)
    setError(null)
    try {
      await action()
      await onCompleted()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败。")
      return false
    } finally {
      setBusy(null)
    }
  }

  return {
    busy,
    error,
    cloneRepository: (input: CloneRepositoryInput) =>
      run("clone", () => requireSynapseBridge().git.cloneRepository(input)),
    addLocalRepository: (input: AddLocalRepositoryInput) =>
      run("add-local", () => requireSynapseBridge().git.addLocalRepository(input)),
    sync: (repositoryId: string) =>
      run("sync", () => requireSynapseBridge().git.sync(repositoryId)),
    pull: (repositoryId: string) =>
      run("pull", () => requireSynapseBridge().git.pull(repositoryId)),
    push: (repositoryId: string) =>
      run("push", () => requireSynapseBridge().git.push(repositoryId)),
  }
}
