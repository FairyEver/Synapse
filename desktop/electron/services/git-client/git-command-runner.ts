import type { SynapseGitErrorCategory, SynapseGitUserFacingFailure } from "../../../src/types/git"
import { runGitCommand, type GitCommandResult } from "../git-command"
import { createGitOperationId, gitErrorMeta, summarizeGitArgs } from "./git-logging"
import { createGitUserFacingFailure, sanitizeGitUserFacingFailureText } from "./git-user-facing-failure"

type GitClientRunInput = {
  readonly acceptedExitCodes?: readonly number[]
  readonly abortSignal?: AbortSignal
  readonly cwd: string
  readonly args: readonly string[]
  readonly captureStdout?: boolean
  readonly fallbackMessage?: string
  readonly logFailure?: boolean
  readonly maxBufferBytes?: number
  readonly operation?: string
  readonly operationId?: string
  readonly repoPath?: string
  readonly repositoryId?: string
  readonly remoteUrl?: string | null
  readonly outputOverflow?: "error" | "truncate"
  readonly onStdoutChunk?: (chunk: Uint8Array) => void
  readonly timeoutMs?: number
}

type GitCommandFunction = typeof runGitCommand
type GitCommandRunnerLogger = {
  error(message: string, meta?: unknown): void
}

type GitErrorWithUserFacingFailure = Error & {
  readonly userFacingFailure?: SynapseGitUserFacingFailure
}

const USER_FACING_FAILURE_PROPERTY = "userFacingFailure"
const DIAGNOSTIC_STRING_KEYS = ["message", "output", "stderr", "stdout"] as const
const SAFE_DIAGNOSTIC_KEYS = ["exitCode", "signal", "timedOut", "code"] as const

export function categorizeGitError(error: unknown): SynapseGitErrorCategory {
  const message = error instanceof Error ? error.message : String(error)
  if (/no available git|no git command|ENOENT|没有可用的 git|git 命令/i.test(message)) return "git-missing"
  if (/authentication failed|permission denied|could not read username|access denied|认证失败/i.test(message)) return "auth-failed"
  if (/could not resolve host|failed to connect|network|timed out|timeout|超时/i.test(message)) return "network-failed"
  if (/not a git repository/i.test(message)) return "not-git-repository"
  if (/local changes would be overwritten|working tree|uncommitted changes|未提交/i.test(message)) return "working-tree-dirty"
  if (/non-fast-forward|fetch first|rejected/i.test(message)) return "non-fast-forward"
  if (/conflict|merge conflict|CONFLICT/i.test(message)) return "conflict"
  return "unknown"
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) return error.message || fallbackMessage
  if (error && typeof error === "object" && typeof (error as { readonly message?: unknown }).message === "string") {
    return (error as { readonly message: string }).message
  }
  if (typeof error === "string") return error
  return fallbackMessage
}

function attachGitUserFacingFailure(error: object, failure: SynapseGitUserFacingFailure): void {
  try {
    Object.defineProperty(error, USER_FACING_FAILURE_PROPERTY, {
      configurable: true,
      enumerable: false,
      value: failure,
      writable: false,
    })
  } catch {
    // Some external errors can be non-extensible. The thrown wrapper still carries the failure.
  }
}

function copySafeDiagnostics(source: unknown, target: Error): void {
  if (!source || typeof source !== "object") return
  const sourceRecord = source as Record<string, unknown>
  const targetRecord = target as unknown as Record<string, unknown>
  for (const key of DIAGNOSTIC_STRING_KEYS) {
    const value = sourceRecord[key]
    if (typeof value === "string" && key !== "message") {
      targetRecord[key] = sanitizeGitUserFacingFailureText(value)
    }
  }
  for (const key of SAFE_DIAGNOSTIC_KEYS) {
    const value = sourceRecord[key]
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      targetRecord[key] = value
    }
  }
}

function prepareGitClientError(
  error: unknown,
  fallbackMessage: string,
  failure: SynapseGitUserFacingFailure,
): Error {
  const safeMessage = sanitizeGitUserFacingFailureText(getErrorMessage(error, fallbackMessage))
  if (error && typeof error === "object") {
    attachGitUserFacingFailure(error, failure)
  }
  const prepared = new Error(safeMessage || fallbackMessage)
  if (error instanceof Error) {
    prepared.name = error.name
  }
  copySafeDiagnostics(error, prepared)
  attachGitUserFacingFailure(prepared, failure)
  return prepared
}

export function getGitUserFacingFailure(error: unknown): SynapseGitUserFacingFailure | null {
  if (!error || typeof error !== "object") return null
  const failure = (error as GitErrorWithUserFacingFailure).userFacingFailure
  return failure ?? null
}

export function createGitClientCommandRunner(deps: {
  readonly logger?: GitCommandRunnerLogger
  readonly runGitCommand?: GitCommandFunction
} = {}) {
  const command = deps.runGitCommand ?? runGitCommand
  return {
    async run(input: GitClientRunInput): Promise<GitCommandResult> {
      const startedAt = performance.now()
      const operation = input.operation ?? `git.${input.args[0] ?? "command"}`
      const operationId = input.operationId ?? createGitOperationId()
      try {
        return await command({
          acceptedExitCodes: input.acceptedExitCodes,
          abortSignal: input.abortSignal,
          args: [...input.args],
          captureStdout: input.captureStdout,
          cwd: input.cwd,
          fallbackMessage: input.fallbackMessage ?? "Git 操作失败。",
          maxBufferBytes: input.maxBufferBytes,
          outputOverflow: input.outputOverflow,
          onStdoutChunk: input.onStdoutChunk,
          timeoutMessage: "Git 操作超时。",
          timeoutMs: input.timeoutMs ?? 60_000,
        })
      } catch (error) {
        const fallbackMessage = input.fallbackMessage ?? "Git 操作失败。"
        const userFacingFailure = createGitUserFacingFailure(error, {
          fallbackMessage,
          remoteUrl: input.remoteUrl,
        })
        if (input.logFailure !== false) {
          deps.logger?.error("Git command failed.", {
            operation,
            operationId,
            ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
            repoPath: input.repoPath ?? input.cwd,
            cwd: input.cwd,
            gitArgs: summarizeGitArgs(input.args),
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            ...gitErrorMeta(error),
          })
        }
        throw prepareGitClientError(error, fallbackMessage, userFacingFailure)
      }
    },
  }
}

export type GitClientCommandRunner = ReturnType<typeof createGitClientCommandRunner>
export type { GitClientRunInput }
