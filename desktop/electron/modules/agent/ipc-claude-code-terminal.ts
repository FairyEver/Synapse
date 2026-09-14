import { z } from "zod"

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
      const session = await ctx.resolve<TerminalService>("core.terminal").createSessionWithEphemeralEnvironment({
        title: CLAUDE_CODE_TERMINAL_TITLE,
        cwd: project.localPath,
        shell: executablePath,
        environment: {
          ...providerEnv,
          ...(tierModel ? { ANTHROPIC_MODEL: tierModel } : {}),
          DISABLE_AUTOUPDATER: "1",
        },
      })
      return { sessionId: session.id }
    },
  },
}
