import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { pickInitialProviderModelSelection } from "@/lib/provider-model-selection"
import type { ProviderModelSelection } from "@/types/provider-model"

const logger = createRendererLogger("claude-code.launch")

const LAUNCH_BOUNDARY = "renderer.claude-code-terminal.launch"

const NO_SELECTABLE_MODEL_MESSAGE = "没有可用的供应商模型，请先配置供应商。"
const RUNTIME_MISSING_MESSAGE = "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。"
const LAUNCH_FAILED_MESSAGE = "无法在终端中启动 Claude Code。"
/** 主进程用这句话把「内置 runtime 缺失」和别的启动失败分开（`PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE`）。 */
const RUNTIME_MISSING_DETAIL = "内置 Claude Code runtime 缺失"

type ClaudeCodeTerminalLaunchFailureCode = "no-model" | "runtime-missing" | "failed"

type ClaudeCodeTerminalLaunchResult =
  | { readonly ok: true; readonly sessionId: string }
  | {
    readonly ok: false
    readonly code: ClaudeCodeTerminalLaunchFailureCode
    /** Written for the user: shown verbatim, not translated per surface. */
    readonly message: string
  }

/**
 * Starts the bundled Claude Code CLI in one of the user's projects, as a terminal session.
 *
 * The one renderer-side entry point, shared by both ⌘-click shortcuts: the Agent sidebar
 * resolves its own default first and passes it in, the Terminal sidebar names only the
 * project and lets this resolve the same default. Doing it in one place is what keeps the
 * two from disagreeing about which model "the default" is. Credentials stay on the other
 * side of that line — the main process reads them and never hands them to the renderer.
 *
 * A failure comes back as a sentence instead of a throw, because every caller's next move
 * is the same one: tell the user which of the three ways it did not work.
 */
async function launchClaudeCodeTerminal(input: {
  readonly projectId: string
  /** Already resolved by the caller, or omitted to resolve here from the configured default. */
  readonly selection?: ProviderModelSelection | null
}): Promise<ClaudeCodeTerminalLaunchResult> {
  try {
    const selection = input.selection ?? await resolveDefaultSelection()
    if (!selection) {
      logger.warn("Claude Code terminal launch found no selectable model.", {
        boundary: LAUNCH_BOUNDARY,
        projectId: input.projectId,
        code: "no-model",
      })
      return { ok: false, code: "no-model", message: NO_SELECTABLE_MODEL_MESSAGE }
    }

    const created = await requireSynapseBridge().agent.createClaudeCodeTerminal({
      projectId: input.projectId,
      providerId: selection.providerId,
      modelTier: selection.modelTier,
    })
    return { ok: true, sessionId: created.sessionId }
  } catch (rawError) {
    const detail = rawError instanceof Error ? rawError.message : ""
    const runtimeMissing = detail.includes(RUNTIME_MISSING_DETAIL)
    const code: ClaudeCodeTerminalLaunchFailureCode = runtimeMissing ? "runtime-missing" : "failed"
    logger.warn("Claude Code terminal launch failed.", {
      boundary: LAUNCH_BOUNDARY,
      projectId: input.projectId,
      code,
      errorName: rawError instanceof Error ? rawError.name : typeof rawError,
      errorLength: errorMessageLength(rawError),
    })
    return { ok: false, code, message: runtimeMissing ? RUNTIME_MISSING_MESSAGE : LAUNCH_FAILED_MESSAGE }
  }
}

/**
 * The Provider and tier the desktop launches with when the caller named none.
 *
 * The configured default first, then the active Provider, then the first usable one — the
 * same call against the same default the Agent sidebar makes before its own ⌘-click.
 */
async function resolveDefaultSelection(): Promise<ProviderModelSelection | undefined> {
  const bridge = requireSynapseBridge()
  const [providers, config] = await Promise.all([
    bridge.agent.listAllProviders(),
    bridge.config.get(),
  ])
  return pickInitialProviderModelSelection(providers, config.agent.defaultProviderModel)
}

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { launchClaudeCodeTerminal }
export type { ClaudeCodeTerminalLaunchResult }
