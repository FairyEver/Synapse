import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type ProjectionContext = {
  readonly baseTree: string
  readonly gitIndexFile: string
  readonly head: string | null
}

type TemporaryIndex = {
  readonly path: string
  readonly cleanup: () => Promise<void>
}

async function withGitChangeProjection<T>(input: {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly operation: string
  readonly operationId: string
  readonly paths: readonly string[]
  readonly repository: SynapseGitRepository
  readonly head?: string | null
  readonly signal?: AbortSignal
  readonly createTemporaryIndex?: () => Promise<TemporaryIndex>
  readonly onCleanupError?: (error: unknown) => void
}, task: (context: ProjectionContext) => Promise<T>): Promise<T> {
  let temporaryIndex: TemporaryIndex | null = null
  const command = (args: readonly string[], options: { readonly acceptedExitCodes?: readonly number[] } = {}) => (
    input.commandRunner.run({
      acceptedExitCodes: options.acceptedExitCodes,
      args,
      cwd: input.repository.localPath,
      gitIndexFile: temporaryIndex?.path,
      operation: input.operation,
      operationId: input.operationId,
      repoPath: input.repository.localPath,
      repositoryId: input.repository.id,
    })
  )
  temporaryIndex = input.createTemporaryIndex
    ? await input.createTemporaryIndex()
    : await (async () => {
        const indexResult = await input.commandRunner.run({
          args: ["rev-parse", "--git-path", "index"],
          cwd: input.repository.localPath,
          operation: input.operation,
          operationId: input.operationId,
          repoPath: input.repository.localPath,
          repositoryId: input.repository.id,
        })
        const indexPath = path.isAbsolute(indexResult.stdout.trim())
          ? indexResult.stdout.trim()
          : path.resolve(input.repository.localPath, indexResult.stdout.trim())
        const directory = await mkdtemp(path.join(path.dirname(indexPath), "synapse-index-"))
        return {
          path: path.join(directory, "index"),
          cleanup: () => rm(directory, { force: true, recursive: true }),
        }
      })()

  let projectionResult: T | undefined
  let projectionError: unknown = null
  try {
    const head = input.head === undefined
      ? (await command(["rev-parse", "--verify", "HEAD"], { acceptedExitCodes: [0, 128] })).stdout.trim() || null
      : input.head
    await command(head ? ["read-tree", head] : ["read-tree", "--empty"])
    const baseTree = (await command(["write-tree"])).stdout.trim()
    await input.commandRunner.run({
      abortSignal: input.signal,
      args: ["--literal-pathspecs", "add", "--all", "--", ...input.paths],
      cwd: input.repository.localPath,
      gitIndexFile: temporaryIndex.path,
      operation: input.operation,
      operationId: input.operationId,
      repoPath: input.repository.localPath,
      repositoryId: input.repository.id,
    })
    projectionResult = await task({ baseTree, gitIndexFile: temporaryIndex.path, head })
  } catch (error) {
    projectionError = error
  }
  try {
    await temporaryIndex.cleanup()
  } catch (error) {
    if (input.onCleanupError) input.onCleanupError(error)
    else if (!projectionError) projectionError = error
  }
  if (projectionError) throw projectionError
  return projectionResult as T
}

export { withGitChangeProjection }
