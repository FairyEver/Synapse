import path from "node:path"
import { readFile } from "node:fs/promises"
import { isGitRebaseInProgress } from "./git-command"

const PREEXISTING_GIT_REBASE_MESSAGE = "当前仓库正在进行 rebase，请先在 Git 工具中完成或中止后再重试。"

type PreexistingGitRebaseListener = (localPath: string) => void

type RebaseCommand = (args: readonly string[]) => Promise<{ readonly stdout: string }>

async function assertNoPreexistingGitRebase(
  localPath: string,
  onDetected?: PreexistingGitRebaseListener,
): Promise<void> {
  if (!(await isGitRebaseInProgress(localPath))) {
    return
  }

  onDetected?.(localPath)
  throw new Error(PREEXISTING_GIT_REBASE_MESSAGE)
}

function failureText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error)
  const record = error as Record<string, unknown>
  return [record.message, record.output, record.stderr, record.stdout]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
}

function isRecoverableRebaseFailure(error: unknown): boolean {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    if (record.timedOut === true) return true
    if (["SIGINT", "SIGKILL", "SIGTERM"].includes(String(record.signal ?? ""))) return true
  }
  return /conflict|could not apply|resolve all conflicts|timed out|timeout|cancelled|canceled|冲突|超时|取消/i.test(failureText(error))
}

async function readRebaseMetadataFile(
  localPath: string,
  run: RebaseCommand,
  stateDirectory: "rebase-merge" | "rebase-apply",
  fileName: "orig-head" | "onto",
): Promise<string | null> {
  const result = await run(["rev-parse", "--git-path", `${stateDirectory}/${fileName}`])
  const resolvedPath = path.isAbsolute(result.stdout.trim())
    ? result.stdout.trim()
    : path.resolve(localPath, result.stdout.trim())
  try {
    return (await readFile(resolvedPath, "utf8")).trim() || null
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

async function recoverOwnedRebase(input: {
  readonly error: unknown
  readonly expectedOnto: string
  readonly expectedOrigHead: string
  readonly localPath: string
  readonly run: RebaseCommand
}): Promise<"aborted" | "not-owned" | "not-recoverable" | "not-started"> {
  if (!(await isGitRebaseInProgress(input.localPath))) return "not-started"
  if (!isRecoverableRebaseFailure(input.error)) return "not-recoverable"

  for (const stateDirectory of ["rebase-merge", "rebase-apply"] as const) {
    const [origHead, onto] = await Promise.all([
      readRebaseMetadataFile(input.localPath, input.run, stateDirectory, "orig-head"),
      readRebaseMetadataFile(input.localPath, input.run, stateDirectory, "onto"),
    ])
    if (!origHead && !onto) continue
    if (origHead !== input.expectedOrigHead || onto !== input.expectedOnto) return "not-owned"
    try {
      await input.run(["rebase", "--abort"])
      return "aborted"
    } catch (abortError) {
      throw new AggregateError(
        [input.error, abortError],
        "同步失败，且无法中止 Synapse 启动的 rebase；请手动检查仓库状态。",
        { cause: abortError },
      )
    }
  }
  return "not-owned"
}

export {
  assertNoPreexistingGitRebase,
  PREEXISTING_GIT_REBASE_MESSAGE,
  recoverOwnedRebase,
}
