import type { ControlledProcessLineHandler, ControlledProcessRunRequest } from "../../electron/runtime/process"
import type { ActorIdentity } from "../../electron/runtime/security"
import { sanitizeError } from "../../electron/services/error-sanitize"
import type { ClaudeCodeNodeConfig } from "./schema"

export interface BuildClaudeCodePrintRequestInput {
  readonly config: ClaudeCodeNodeConfig
  readonly prompt: string
  readonly cwd: string
  readonly actor: ActorIdentity
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly onStdoutLine?: ControlledProcessLineHandler
  readonly onStderrLine?: ControlledProcessLineHandler
  readonly metadata?: Record<string, unknown>
}

export function buildClaudeCodePrintRequest(input: BuildClaudeCodePrintRequestInput): ControlledProcessRunRequest {
  return {
    actor: input.actor,
    action: "shell.exec",
    command: "claude",
    args: buildClaudeCodePrintArgs(input.config, input.prompt),
    cwd: input.cwd,
    pathStrategy: "merge",
    output: { stdout: "ignore", stderr: "ignore" },
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
    ...(input.onStdoutLine === undefined ? {} : { onStdoutLine: input.onStdoutLine }),
    ...(input.onStderrLine === undefined ? {} : { onStderrLine: input.onStderrLine }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  }
}

export function buildClaudeCodePrintArgs(config: ClaudeCodeNodeConfig, prompt: string): string[] {
  const args: string[] = []

  args.push("-p")
  args.push("--output-format", config.outputFormat)

  if (config.verbose) {
    args.push("--verbose")
  }

  args.push("--permission-mode", config.permissionMode)
  args.push("--setting-sources", config.settingSources.join(","))

  if (config.model !== undefined) {
    args.push("--model", config.model)
  }

  if (config.maxTurns !== undefined) {
    args.push("--max-turns", String(config.maxTurns))
  }

  if (config.safeMode) {
    args.push("--safe-mode")
  }

  if (config.bareMode) {
    args.push("--bare")
  }

  if (config.noSessionPersistence) {
    args.push("--no-session-persistence")
  }

  if (config.settingsPath !== undefined) {
    args.push("--settings", config.settingsPath)
  }

  if (config.mcpConfigPath !== undefined) {
    args.push("--mcp-config", config.mcpConfigPath)
  }

  if (config.strictMcpConfig) {
    args.push("--strict-mcp-config")
  }

  for (const additionalDirectory of config.additionalDirectories) {
    args.push("--add-dir", additionalDirectory)
  }

  for (const allowedTool of config.allowedTools) {
    args.push("--allowedTools", allowedTool)
  }

  for (const disallowedTool of config.disallowedTools) {
    args.push("--disallowedTools", disallowedTool)
  }

  args.push("--", prompt)

  return args
}

export function sanitizeClaudeCodeArgsForDebug(args: readonly string[], prompt: string): string[] {
  const output: string[] = []

  const secretFlags = new Set(["--settings", "--mcp-config", "--allowedTools", "--disallowedTools"])

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === prompt) {
      output.push("[prompt]")
      continue
    }

    if (secretFlags.has(arg) && index + 1 < args.length && shouldOmitArg(args[index + 1])) {
      index += 1
      continue
    }

    if (shouldOmitArg(arg)) {
      if (output.length > 0 && secretFlags.has(output.at(-1)!)) {
        output.pop()
      }
      continue
    }

    output.push(sanitizeError(arg))
  }

  return output
}

function shouldOmitArg(value: string): boolean {
  const hasSecretHint = /(?:^|[?&/=])(?:[A-Za-z0-9_-]*(?:secret|token|api[-_]?key|authorization|cookie|password|credential)[A-Za-z0-9_-]*=)/i.test(value)
    || /^Authorization\b/i.test(value)
  const sanitized = sanitizeError(value)
  const hasSanitizedSecret = /(\[redacted\]|\[key\])/i.test(sanitized)
  return hasSecretHint || hasSanitizedSecret
}
