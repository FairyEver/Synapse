import type { RegisteredPromptCommand } from "./command-router"
import type { AgentMessage } from "./types"

export type AgentProjectMessageContext = {
  readonly isNewLiveSession: boolean
}

export type AgentSdkPluginSpec = {
  readonly type: "local"
  readonly path: string
}

export type AgentProjectContribution = {
  readonly commands: readonly RegisteredPromptCommand[]
  readonly sdkPlugins?: readonly AgentSdkPluginSpec[]
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
    sdkPlugins: contributions.flatMap((contribution) => contribution.sdkPlugins ?? []),
    async prepareMessage(message, context) {
      let next = message
      for (const contribution of contributions) {
        next = await Promise.resolve(contribution.prepareMessage?.(next, context) ?? next)
      }
      return next
    },
  }
}
