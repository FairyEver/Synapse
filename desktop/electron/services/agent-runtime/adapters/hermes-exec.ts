import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
} from "../../../runtime/process/controlled-runner"
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentMessage,
} from "../types"

export interface HermesProcessRunner {
  run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult>
}

export interface HermesExecOptions {
  readonly command?: string
  readonly mode?: string
  readonly env?: Record<string, string | undefined>
  readonly envAllowlist?: readonly string[]
  readonly timeoutMs?: number
}

export class HermesExecAdapter implements AgentAdapter {
  readonly agentType = "hermes"

  private readonly runner: HermesProcessRunner
  private readonly options: HermesExecOptions

  constructor(runner: HermesProcessRunner, options: HermesExecOptions = {}) {
    this.runner = runner
    this.options = options
  }

  async execute(
    message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const command = this.options.command ?? "hermes"
    const args = buildHermesExecArgs({
      mode: message.modeOverride ?? this.options.mode,
    })

    const env = mergeEnv(this.options.env, context.sessionEnv)
    const envAllowlist = mergeEnvAllowlist(this.options.envAllowlist, context.sessionEnv)

    const events: AgentEvent[] = []
    let resultText = ""
    let error: string | undefined

    try {
      const result = await this.runner.run({
        actor: context.actor,
        action: "agent.spawn",
        command,
        args,
        cwd: context.workDir,
        stdin: message.content,
        env,
        envAllowlist,
        timeoutMs: this.options.timeoutMs ?? 30 * 60 * 1000,
        output: { stdout: "buffer", stderr: "buffer" },
        metadata: {
          adapter: this.agentType,
          projectId: context.projectId,
          sessionKey: message.sessionKey,
          platform: message.platform,
        },
      })

      resultText = (result.stdout ?? "").trim()

      if (result.exitCode !== 0 && !resultText) {
        error = (result.stderr ?? "").trim() || `hermes exited with code ${result.exitCode}`
        const errorEvent: AgentEvent = { type: "error", message: error }
        events.push(errorEvent)
        context.onEvent?.(errorEvent)
      } else {
        const resultEvent: AgentEvent = { type: "result", content: resultText, done: true }
        events.push(resultEvent)
        context.onEvent?.(resultEvent)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      const errorEvent: AgentEvent = { type: "error", message: error }
      events.push(errorEvent)
      context.onEvent?.(errorEvent)
    }

    return { events, resultText, error }
  }
}

function buildHermesExecArgs(options: { mode?: string }): string[] {
  const args = ["-z", "--quiet"]

  if (options.mode === "yolo") {
    args.push("--yolo")
  }

  args.push("-")
  return args
}

function mergeEnv(
  base: Record<string, string | undefined> | undefined,
  sessionEnv: Record<string, string> | undefined,
): Record<string, string | undefined> | undefined {
  if (!base && !sessionEnv) return undefined
  return { ...(base ?? {}), ...(sessionEnv ?? {}) }
}

function mergeEnvAllowlist(
  base: readonly string[] | undefined,
  sessionEnv: Record<string, string> | undefined,
): readonly string[] | undefined {
  const values = new Set(base ?? [])
  for (const key of Object.keys(sessionEnv ?? {})) values.add(key)
  return values.size > 0 ? [...values] : undefined
}
