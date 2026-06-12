import type { ControlledProcessRunRequest } from "../../electron/runtime/process"
import type { ActorIdentity } from "../../electron/runtime/security"
import type { CodexNodeConfig } from "./schema"

export interface BuildCodexExecRequestInput {
  readonly config: CodexNodeConfig
  readonly prompt: string
  readonly cwd: string
  readonly lastMessagePath: string
  readonly actor: ActorIdentity
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly metadata?: Record<string, unknown>
}

export function buildCodexExecRequest(input: BuildCodexExecRequestInput): ControlledProcessRunRequest {
  return {
    actor: input.actor,
    action: "shell.exec",
    command: "codex",
    args: buildCodexExecArgs(input.config, input.cwd, input.lastMessagePath),
    cwd: input.cwd,
    stdin: input.prompt,
    pathStrategy: "login-shell",
    output: { stdout: "buffer", stderr: "buffer" },
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  }
}

export function buildCodexExecArgs(
  config: CodexNodeConfig,
  cwd: string,
  lastMessagePath: string,
): string[] {
  const args: string[] = ["exec"]

  if (config.bypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox")
  } else {
    args.push("--ask-for-approval", config.approvalPolicy)
    args.push("--sandbox", config.sandbox)
  }

  args.push("--json")
  args.push("--output-last-message", lastMessagePath)

  if (config.skipGitRepoCheck) {
    args.push("--skip-git-repo-check")
  }

  if (config.model) {
    args.push("--model", config.model)
  }

  if (config.profile) {
    args.push("--profile", config.profile)
  }

  if (config.enableSearch) {
    args.push("--search")
  }

  if (config.features.goals === "enabled") {
    args.push("--enable", "goals")
  } else if (config.features.goals === "disabled") {
    args.push("--disable", "goals")
  }

  if (config.strictConfig) {
    args.push("--strict-config")
  }

  if (config.bypassHookTrust) {
    args.push("--dangerously-bypass-hook-trust")
  }

  for (const dir of config.additionalWritableDirs) {
    args.push("--add-dir", dir)
  }

  for (const image of config.images) {
    args.push("--image", image)
  }

  for (const override of config.configOverrides) {
    args.push("--config", `${override.key}=${override.value}`)
  }

  args.push("--cd", cwd)
  args.push("-")

  return args
}
