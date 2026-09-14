import { z } from "zod"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import {
  PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE,
  resolveBundledClaudeExecutable,
} from "../../services/agent-runtime/claude-runtime-binary"
import { resolveTierModelFromEnv } from "../../services/agent-runtime/provider-model-tier"
import { resolveProjectAgent } from "./ipc-shared"

const CLAUDE_CODE_TERMINAL_TITLE = "Claude Code"

const claudeCodeTerminalRequestSchema = projectRequestSchema.extend({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
})

const claudeCodeTerminalResponseSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

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
      const providerEnv = await providerService.buildEnv(request.providerId, {
        actor: { kind: "user", id: "renderer" },
        projectId: request.projectId,
      })
      const tierModel = resolveTierModelFromEnv(providerEnv, request.modelTier)
      const environment = {
        ...providerEnv,
        ...(tierModel ? { ANTHROPIC_MODEL: tierModel } : {}),
        DISABLE_AUTOUPDATER: "1",
      }
      // The user's own ~/.claude/settings.json env outranks the process env, so the selected
      // Provider and model must be pinned through the higher-priority flag settings layer.
      const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-"))
      const settingsPath = path.join(directory, "settings.json")
      try {
        await writeFile(settingsPath, JSON.stringify({
          env: environment,
          ...(tierModel ? { model: tierModel } : {}),
        }), { mode: 0o600 })
        const session = await ctx.resolve<TerminalService>("core.terminal").createSessionWithEphemeralEnvironment({
          title: CLAUDE_CODE_TERMINAL_TITLE,
          cwd: project.localPath,
          shell: executablePath,
          args: ["--settings", settingsPath, ...(tierModel ? ["--model", tierModel] : [])],
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
