import type { PublishedAgentCommand } from "./command-registry"
import type { RegisteredPromptCommand } from "./command-router"
import type { AgentMessage, AgentRuntimeTurnResult } from "./types"

export type AgentProjectMessageContext = {
  readonly isNewLiveSession: boolean
}

export type AgentSdkPluginSpec = {
  readonly type: "local"
  readonly path: string
}

export type AgentProjectAfterTurnInput = {
  readonly message: AgentMessage
  readonly result: AgentRuntimeTurnResult
  readonly conversationId: string
  readonly isNewLiveSession: boolean
}

export type AgentProjectContribution = {
  readonly commands: readonly RegisteredPromptCommand[]
  readonly publishedCommands?: readonly PublishedAgentCommand[]
  readonly sdkPlugins?: readonly AgentSdkPluginSpec[]
  prepareMessage?(
    message: AgentMessage,
    context: AgentProjectMessageContext,
  ): AgentMessage | Promise<AgentMessage>
  afterTurn?(input: AgentProjectAfterTurnInput): void | Promise<void>
}

export function mergeAgentProjectContributions(
  contributions: readonly AgentProjectContribution[],
): AgentProjectContribution {
  return {
    commands: contributions.flatMap((contribution) => contribution.commands),
    publishedCommands: contributions.flatMap((contribution) => contribution.publishedCommands ?? []),
    sdkPlugins: contributions.flatMap((contribution) => contribution.sdkPlugins ?? []),
    async prepareMessage(message, context) {
      let next = message
      for (const contribution of contributions) {
        next = await Promise.resolve(contribution.prepareMessage?.(next, context) ?? next)
      }
      return next
    },
    async afterTurn(input) {
      for (const contribution of contributions) {
        await Promise.resolve(contribution.afterTurn?.(input))
      }
    },
  }
}
