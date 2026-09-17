import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import {
  createClaudeCodeTerminalSession,
  ClaudeCodeTerminalError,
} from "./claude-code-terminal"

const claudeCodeTerminalRequestSchema = projectRequestSchema.extend({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
})

const claudeCodeTerminalResponseSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

/**
 * UI-only launch of the bundled Claude Code CLI as a terminal session.
 *
 * Both fields stay required here even though the extraction below made them optional:
 * the renderer resolves its own default selection — it has the Provider list and the
 * configured default in hand, and does it before the click — and sends the answer. A
 * caller that has no such list, the mobile gateway, calls the service directly and
 * lets the main process resolve. Making them optional on the wire would move that
 * resolution into the main process for a caller that already did it, and would leave
 * the two paths able to disagree.
 */
export const claudeCodeTerminalMethods: Record<string, IpcMethodDescriptor> = {
  createClaudeCodeTerminal: {
    kind: "invoke",
    operationId: "app.agent.operation.create_claude_code_terminal",
    request: claudeCodeTerminalRequestSchema,
    response: claudeCodeTerminalResponseSchema,
    handler: async (ctx, request: z.infer<typeof claudeCodeTerminalRequestSchema>) => {
      try {
        const session = await createClaudeCodeTerminalSession(ctx.resolve, {
          projectId: request.projectId,
          providerId: request.providerId,
          modelTier: request.modelTier,
        })
        return { sessionId: session.id }
      } catch (error) {
        // The renderer has always shown the launcher's own message for a missing
        // runtime; the error type carries a code for the mobile gateway, which
        // classifies on it, and lifting it into a plain Error here would be a second
        // contract to keep in step for no gain.
        if (error instanceof ClaudeCodeTerminalError) throw new Error(error.message)
        throw error
      }
    },
  },
}
