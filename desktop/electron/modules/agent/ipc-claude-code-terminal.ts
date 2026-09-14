import { z } from "zod"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import {
  SYNAPSE_AGENT_PERMISSION_MODES,
  type SynapseAgentPermissionMode,
} from "../../../src/types/agent"
import { configStore } from "../../services/config-store"
import {
  PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE,
  resolveBundledClaudeExecutable,
} from "../../services/agent-runtime/claude-runtime-binary"
import { resolveTierModelFromEnv } from "../../services/agent-runtime/provider-model-tier"
import { resolveModelContextConfiguration } from "../../services/model-capability/catalog"
import { resolveProjectAgent } from "./ipc-shared"

const CLAUDE_CODE_TERMINAL_TITLE = "Claude Code"
const LAUNCH_DIRECTORY_PATTERN = /^synapse-claude-code-[A-Za-z0-9]{6}$/

/**
 * Removes launch directories left behind by a previous app process. They hold provider
 * credentials, so a crash, quit or update that kills the PTY without its exit callback must not
 * leave them on disk.
 */
export async function removeStaleClaudeCodeLaunchDirectories(baseDir: string): Promise<readonly string[]> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !LAUNCH_DIRECTORY_PATTERN.test(entry.name)) continue
    try {
      await rm(path.join(baseDir, entry.name), { recursive: true, force: true })
      removed.push(entry.name)
    } catch {
      continue
    }
  }
  return removed
}

let staleSweep: Promise<readonly string[]> | undefined

function sweepStaleLaunchDirectories(): Promise<readonly string[]> {
  staleSweep ??= removeStaleClaudeCodeLaunchDirectories(os.tmpdir())
  return staleSweep
}

// Only the Electron main process owns these directories; tests and renderer bundles must never
// delete another process's live launch assets.
if (process.type === "browser") void sweepStaleLaunchDirectories()

const claudeCodeTerminalRequestSchema = projectRequestSchema.extend({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
})

const claudeCodeTerminalResponseSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

/**
 * The terminal session runs with the same default permission mode as Agent conversations so a
 * user who disabled permission prompts is not asked again by the Claude Code TUI.
 */
export function resolveClaudeCodeTerminalPermissionMode(mode: string | undefined): SynapseAgentPermissionMode {
  return SYNAPSE_AGENT_PERMISSION_MODES.includes(mode as SynapseAgentPermissionMode)
    ? mode as SynapseAgentPermissionMode
    : "default"
}

/**
 * UI-only launch of the bundled Claude Code CLI as a terminal session. The selected Provider and
 * model tier are resolved here so credentials never reach the renderer or the terminal store.
 */
export const claudeCodeTerminalMethods: Record<string, IpcMethodDescriptor> = {
  createClaudeCodeTerminal: {
    kind: "invoke",
    operationId: "app.agent.operation.create_claude_code_terminal",
    request: claudeCodeTerminalRequestSchema,
    response: claudeCodeTerminalResponseSchema,
    handler: async (ctx, request: z.infer<typeof claudeCodeTerminalRequestSchema>) => {
      const { providerService, project } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const executablePath = resolveBundledClaudeExecutable()
      if (!executablePath) throw new Error(PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE)
      const config = await configStore.load()
      const permissionMode = resolveClaudeCodeTerminalPermissionMode(config.agent?.defaultPermissionMode)
      const providerEnv = await providerService.buildEnv(request.providerId, {
        actor: { kind: "user", id: "renderer" },
        projectId: request.projectId,
      })
      const tierModel = resolveTierModelFromEnv(providerEnv, request.modelTier)
      const provider = await providerService.getProvider(request.providerId).catch(() => undefined)
      // Claude Code assumes an unknown custom model is 200k, so pin the window Synapse knows.
      const modelContext = resolveModelContextConfiguration({
        baseUrl: providerEnv.ANTHROPIC_BASE_URL
          ?? (provider?.category === "official" ? "https://api.anthropic.com" : undefined),
        modelId: tierModel ?? providerEnv.ANTHROPIC_MODEL,
        configuredContextWindow: providerEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
      })
      const environment = {
        ...providerEnv,
        ...(tierModel ? { ANTHROPIC_MODEL: tierModel } : {}),
        ...(modelContext.contextWindowTokens !== undefined
          ? { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(modelContext.contextWindowTokens) }
          : {}),
        DISABLE_AUTOUPDATER: "1",
      }
      // The user's own ~/.claude/settings.json env outranks the process env, so the selected
      // Provider and model must be pinned through the higher-priority flag settings layer.
      await sweepStaleLaunchDirectories()
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
        const session = await ctx.resolve<TerminalService>("core.terminal").createSessionWithEphemeralEnvironment({
          title,
          cwd: project.localPath,
          shell: executablePath,
          args: [
            "--settings", settingsPath,
            ...(tierModel ? ["--model", tierModel] : []),
            "--permission-mode", permissionMode,
          ],
          environment,
          onEnded: () => { void rm(directory, { recursive: true, force: true }).catch(() => undefined) },
        })
        return { sessionId: session.id }
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    },
  },
}
