import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readlink } from "node:fs/promises"
import type {
  SynapseGitChangeSelection,
  SynapseGitFileChange,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
} from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath, normalizeRepositoryPathForCompare } from "./git-path-utils"

const DEFAULT_TTL_MS = 15 * 60 * 1_000
const DEFAULT_MAX_SELECTIONS_PER_REPOSITORY = 32
const FINGERPRINT_CONCURRENCY = 8

type StoredSelection = {
  readonly selectionId: string
  readonly repositoryId: string
  readonly repositoryPath: string
  readonly expiresAtMs: number
  readonly head: string | null
  readonly changes: readonly SynapseGitFileChange[]
  readonly paths: readonly string[]
  readonly fingerprints: ReadonlyMap<string, string>
}

type SelectionDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes">>
  readonly fingerprintPath?: (absolutePath: string) => Promise<string>
  readonly maxSelectionsPerRepository?: number
  readonly now?: () => Date
  readonly randomId?: () => string
  readonly ttlMs?: number
}

function sameChange(left: SynapseGitFileChange, right: SynapseGitFileChange): boolean {
  return left.path === right.path
    && left.originalPath === right.originalPath
    && left.status === right.status
    && left.staged === right.staged
    && left.conflicted === right.conflicted
}

async function defaultFingerprintPath(absolutePath: string): Promise<string> {
  try {
    const fileStat = await lstat(absolutePath)
    const hash = createHash("sha256")
    hash.update(`${fileStat.mode}:${fileStat.isSymbolicLink() ? "symlink" : fileStat.isFile() ? "file" : "other"}\0`)
    if (fileStat.isSymbolicLink()) {
      hash.update(await readlink(absolutePath))
    } else if (fileStat.isFile()) {
      for await (const chunk of createReadStream(absolutePath)) hash.update(chunk)
    } else {
      hash.update(`${fileStat.size}:${fileStat.mtimeMs}`)
    }
    return hash.digest("hex")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "missing"
    throw error
  }
}

export function createGitChangeSelectionService(deps: SelectionDeps) {
  const fingerprintPath = deps.fingerprintPath ?? defaultFingerprintPath
  const maxSelectionsPerRepository = deps.maxSelectionsPerRepository ?? DEFAULT_MAX_SELECTIONS_PER_REPOSITORY
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? randomUUID
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS
  const selections = new Map<string, StoredSelection>()

  const readHead = async (repository: SynapseGitRepository): Promise<string | null> => {
    const result = await deps.commandRunner.run({
      acceptedExitCodes: [0, 128],
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: repository.localPath,
      fallbackMessage: "无法确认仓库当前版本。",
      logFailure: false,
      operation: "git.changes.prepare",
      repoPath: repository.localPath,
      repositoryId: repository.id,
    })
    return result.stdout.trim() || null
  }

  const readFingerprints = async (
    repository: SynapseGitRepository,
    paths: readonly string[],
  ): Promise<Map<string, string>> => {
    const entries = new Array<readonly [string, string]>(paths.length)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(FINGERPRINT_CONCURRENCY, paths.length) }, async () => {
      while (nextIndex < paths.length) {
        const index = nextIndex
        nextIndex += 1
        const filePath = paths[index]!
        const absolutePath = assertRepositoryPath(repository.localPath, filePath)
        entries[index] = [filePath, await fingerprintPath(absolutePath)]
      }
    })
    await Promise.all(workers)
    return new Map(entries)
  }

  const invalidateWithError = (selectionId: string, message: string): never => {
    selections.delete(selectionId)
    throw new Error(message)
  }

  const prune = (repositoryId?: string): void => {
    const timestamp = now().getTime()
    for (const [selectionId, selection] of selections) {
      if (selection.expiresAtMs <= timestamp) selections.delete(selectionId)
    }
    if (!repositoryId) return
    const repositorySelections = [...selections.values()].filter((selection) => selection.repositoryId === repositoryId)
    for (const selection of repositorySelections.slice(0, Math.max(0, repositorySelections.length - maxSelectionsPerRepository))) {
      selections.delete(selection.selectionId)
    }
  }

  return {
    async prepare(
      repository: SynapseGitRepository,
      selectedPaths: readonly string[],
    ): Promise<SynapseGitChangeSelection> {
      const requestedPaths = [...new Set(selectedPaths)]
      if (requestedPaths.length === 0) throw new Error("请选择要操作的文件。")
      for (const filePath of requestedPaths) assertRepositoryPath(repository.localPath, filePath)

      const snapshot = await deps.getSnapshot(repository)
      const currentChanges = new Map(snapshot.changes.map((change) => [change.path, change]))
      const changes = requestedPaths.map((filePath) => currentChanges.get(filePath))
      if (changes.some((change) => !change)) throw new Error("所选文件已发生变化，请重新审阅后再试。")
      const canonicalChanges = changes as SynapseGitFileChange[]
      if (canonicalChanges.some((change) => change.conflicted)) throw new Error("冲突文件需要在外部处理后再提交。")
      if (canonicalChanges.some((change) => change.status === "unknown")) throw new Error("存在无法识别的 Git 改动，请在外部工具中检查后重试。")

      const paths = [...new Set(canonicalChanges.flatMap((change) => (
        change.originalPath ? [change.originalPath, change.path] : [change.path]
      )))]
      const [head, fingerprints] = await Promise.all([
        readHead(repository),
        readFingerprints(repository, paths),
      ])
      const selectionId = randomId()
      const expiresAtMs = now().getTime() + ttlMs
      selections.set(selectionId, {
        selectionId,
        repositoryId: repository.id,
        repositoryPath: normalizeRepositoryPathForCompare(repository.localPath),
        expiresAtMs,
        head,
        changes: canonicalChanges,
        paths,
        fingerprints,
      })
      prune(repository.id)
      return {
        selectionId,
        repositoryId: repository.id,
        expiresAt: new Date(expiresAtMs).toISOString(),
        changes: canonicalChanges,
      }
    },

    async validate(repository: SynapseGitRepository, selectionId: string): Promise<StoredSelection> {
      prune()
      const selection = selections.get(selectionId)
      if (!selection) throw new Error("所选文件的确认已过期，请重新审阅后再试。")
      if (
        selection.repositoryId !== repository.id
        || selection.repositoryPath !== normalizeRepositoryPathForCompare(repository.localPath)
      ) {
        return invalidateWithError(selectionId, "所选文件不属于当前仓库，请重新审阅后再试。")
      }
      if (selection.expiresAtMs <= now().getTime()) {
        return invalidateWithError(selectionId, "所选文件的确认已过期，请重新审阅后再试。")
      }

      const snapshot = await deps.getSnapshot(repository)
      const currentChanges = new Map(snapshot.changes.map((change) => [change.path, change]))
      const statusChanged = selection.changes.some((change) => {
        const current = currentChanges.get(change.path)
        return !current || !sameChange(change, current)
      })
      if (statusChanged || await readHead(repository) !== selection.head) {
        return invalidateWithError(selectionId, "所选文件已发生变化，请重新审阅后再提交。")
      }

      const fingerprints = await readFingerprints(repository, selection.paths)
      if (selection.paths.some((filePath) => fingerprints.get(filePath) !== selection.fingerprints.get(filePath))) {
        return invalidateWithError(selectionId, "所选文件已发生变化，请重新审阅后再提交。")
      }
      return selection
    },

    invalidate(selectionId: string): void {
      selections.delete(selectionId)
    },
  }
}

export type GitChangeSelectionService = ReturnType<typeof createGitChangeSelectionService>
