import type { RegisteredPromptCommand } from "./command-router"
import type { AgentMessage } from "./types"

export type AgentProjectMessageContext = {
  readonly isNewLiveSession: boolean
}

export type AgentProjectContribution = {
  readonly commands: readonly RegisteredPromptCommand[]
  prepareMessage?(
    message: AgentMessage,
    context: AgentProjectMessageContext,
  ): AgentMessage | Promise<AgentMessage>
}

export function mergeAgentProjectContributions(
  contributions: readonly AgentProjectContribution[],
): AgentProjectContribution {
  return {
    commands: contributions.flatMap((contribution) => contribution.commands),
    async prepareMessage(message, context) {
      let next = message
      for (const contribution of contributions) {
        next = await Promise.resolve(contribution.prepareMessage?.(next, context) ?? next)
      }
      return next
    },
  }
}
