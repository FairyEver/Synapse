import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import type { TerminalSession } from "../../../app-capabilities/terminal/shared/schema"
import type { ModelTier } from "../../../src/types/provider-model"
import { SYNAPSE_AGENT_PERMISSION_MODES, type SynapseAgentPermissionMode } from "../../../src/types/agent"
import { pickInitialProviderModelSelection } from "../../../src/lib/provider-model-selection"
import { configStore } from "../../services/config-store"
import {
  PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE,
  resolveBundledClaudeExecutable,
} from "../../services/agent-runtime/claude-runtime-binary"
import { resolveTierModelFromEnv } from "../../services/agent-runtime/provider-model-tier"
import { sweepStaleClaudeCodeLaunchDirectories } from "./claude-code-terminal-launch-dirs"
import { resolveProjectAgent } from "./ipc-shared"

const CLAUDE_CODE_TERMINAL_TITLE = "Claude Code"

/**
 * Raised instead of the `Error` a caller would otherwise have to read the message of.
 *
 * `code` is what the mobile gateway classifies on and `message` is what it shows the
 * user, so every one of these has to be something a person can act on: these launches
 * fail for reasons — no runtime installed, no Provider configured — that the user
 * fixes on the computer, and "操作没有完成" would leave them with nothing to do.
 */
export class ClaudeCodeTerminalError extends Error {
  readonly code: string
  /**
   * Tells the mobile gateway that `message` is already written for the user, so it
   * can be shown verbatim rather than replaced by a generic sentence. Declared as a
   * property rather than a shared class so neither module has to import the other to
   * agree on it — the gateway's `describeError` reads exactly this flag.
   */
  readonly userFacing = true

  constructor(code: string, message: string) {
    super(message)
    this.name = "ClaudeCodeTerminalError"
    this.code = code
  }
}

const NO_DEFAULT_MODEL_MESSAGE = "电脑上没有可用的供应商模型，请先在桌面端配置供应商。"

export interface CreateClaudeCodeTerminalSessionInput {
  readonly projectId: string
  /**
   * Explicit Provider and tier, or neither.
   *
   * Neither is the ordinary case for an automated caller, and it means "use the
   * desktop's own default" — the same selection its ⌘-click shortcut resolves. Half
   * of one is refused rather than completed: a Provider with no tier names no model,
   * so a caller that sent one of the two meant something the desktop cannot infer.
   */
  readonly providerId?: string
  readonly modelTier?: ModelTier
  /** Initial grid; see `createSessionWithEphemeralEnvironment`. Omitted, the default holds. */
  readonly cols?: number
  readonly rows?: number
  /**
   * The remote client that asked for the session, as `mobile:<client instance id>`.
   *
   * Absent for the desktop's own launches. Present, it is recorded on the terminal so
   * a conversation started from a phone is distinguishable from one started here.
   */
  readonly createdByClientId?: string
}

/**
 * Starts the bundled Claude Code CLI in one of the user's projects, as a terminal session.
 *
 * This is the one implementation behind every entry point: the renderer's ⌘-click and
 * the new-conversation button resolve their own defaults and pass both explicitly, the
 * mobile gateway passes neither and lets the desktop decide. It is one function rather
 * than two because the promise it keeps — the Provider's credentials are read here, in
 * the main process, and never reach the renderer or the persisted session record — is
 * a promise about there being a single place that does this.
 *
 * What it deliberately does not do is create a conversation: there is no `conversations`
 * record and no Agent session. The CLI replaces the shell for the life of the terminal,
 * and closing the terminal is the end of it.
 */
export async function createClaudeCodeTerminalSession(
  resolve: <T>(serviceId: string) => T,
  input: CreateClaudeCodeTerminalSessionInput,
): Promise<TerminalSession> {
  const explicitProviderId = input.providerId
  const explicitModelTier = input.modelTier
  if ((explicitProviderId === undefined) !== (explicitModelTier === undefined)) {
    throw new ClaudeCodeTerminalError("invalid_input", "供应商和模型必须一起选择。")
  }

  const { providerService, project } = await resolveProjectAgent(resolve, input.projectId)
  const executablePath = resolveBundledClaudeExecutable()
  if (!executablePath) {
    // The desktop's own wording, because this is the desktop's own problem to fix.
    throw new ClaudeCodeTerminalError("runtime_missing", PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE)
  }
  const config = await configStore.load()
  const selection = explicitProviderId !== undefined && explicitModelTier !== undefined
    ? { providerId: explicitProviderId, modelTier: explicitModelTier }
    : await resolveDefaultProviderModel(providerService)
  const permissionMode = resolveClaudeCodeTerminalPermissionMode(config.agent?.defaultPermissionMode)
  const providerEnv = await providerService.buildEnv(selection.providerId, {
    actor: { kind: "user", id: "renderer" },
    projectId: input.projectId,
  })
  const tierModel = resolveTierModelFromEnv(providerEnv, selection.modelTier)
  const environment = {
    ...providerEnv,
    ...(tierModel ? { ANTHROPIC_MODEL: tierModel } : {}),
    DISABLE_AUTOUPDATER: "1",
    /*
     * 跨会话消息（用户在自己装的 Claude Code 里说一句话，就能让这里跑的那个收到）。
     *
     * 这个功能的门控默认值随版本漂移：同一个开关在旧版内置 runtime 里默认关、在新版里
     * 默认开，靠版本默认值等于让行为随升级忽明忽暗。显式写死，行为就与版本无关。
     */
    CLAUDE_CODE_HARBOR_KITE: "1",
  }
  // The user's own ~/.claude/settings.json env outranks the process env, so the selected
  // Provider and model must be pinned through the higher-priority flag settings layer.
  await sweepStaleClaudeCodeLaunchDirectories()
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-"))
  const settingsPath = path.join(directory, "settings.json")
  try {
    await writeFile(settingsPath, JSON.stringify({
      env: environment,
      ...(tierModel ? { model: tierModel } : {}),
    }), { mode: 0o600 })
    // Concurrent Claude Code sessions must stay distinguishable in the terminal list.
    const title = project.name
      ? `${CLAUDE_CODE_TERMINAL_TITLE} · ${project.name}`.slice(0, 120)
      : CLAUDE_CODE_TERMINAL_TITLE
    return await resolve<TerminalService>("core.terminal").createSessionWithEphemeralEnvironment({
      title,
      cwd: project.localPath,
      shell: executablePath,
      args: [
        "--settings", settingsPath,
        ...(tierModel ? ["--model", tierModel] : []),
        "--permission-mode", permissionMode,
      ],
      environment,
      ...(input.cols === undefined ? {} : { cols: input.cols }),
      ...(input.rows === undefined ? {} : { rows: input.rows }),
      ...(input.createdByClientId === undefined ? {} : { createdByClientId: input.createdByClientId }),
      onEnded: () => { void rm(directory, { recursive: true, force: true }).catch(() => undefined) },
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * The Provider and tier the desktop uses when a caller names neither.
 *
 * The same call the renderer makes for its ⌘-click shortcut, against the same
 * configured default, so the two entry points cannot disagree about what "default"
 * means. Resolved here rather than on the phone for exactly that reason: a phone
 * computing its own default would need the Provider list, and any difference between
 * the two answers would be a bug nobody could reproduce on the desktop alone.
 */
async function resolveDefaultProviderModel(
  providerService: { listAllProviders(): Promise<readonly unknown[]> },
): Promise<{ readonly providerId: string; readonly modelTier: ModelTier }> {
  const config = await configStore.load()
  const providers = await providerService.listAllProviders()
  const selection = pickInitialProviderModelSelection(
    providers as Parameters<typeof pickInitialProviderModelSelection>[0],
    config.agent?.defaultProviderModel,
  )
  if (!selection) throw new ClaudeCodeTerminalError("model_unavailable", NO_DEFAULT_MODEL_MESSAGE)
  return { providerId: selection.providerId, modelTier: selection.modelTier }
}

/**
 * The terminal session runs with the same default permission mode as Agent conversations so a
 * user who disabled permission prompts is not asked again by the Claude Code TUI.
 */
export function resolveClaudeCodeTerminalPermissionMode(mode: string | undefined): SynapseAgentPermissionMode {
  return SYNAPSE_AGENT_PERMISSION_MODES.includes(mode as SynapseAgentPermissionMode)
    ? mode as SynapseAgentPermissionMode
    : "default"
}

