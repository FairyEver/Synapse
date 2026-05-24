import type { PublishedAgentCommand } from "./command-registry"
import type { RegisteredPromptCommand } from "./command-router"
import type { AgentEvent, AgentMessage, AgentRuntimeTurnResult } from "./types"

export type AgentProjectMessageContext = {
  readonly isNewLiveSession: boolean
  readonly conversationId: string
  readonly turnId: string
}

export type AgentSdkPluginSpec = {
  readonly type: "local"
  readonly path: string
}

export type AgentProjectAfterTurnInput = {
  readonly message: AgentMessage
  readonly result: AgentRuntimeTurnResult
  readonly conversationId: string
  readonly turnId: string
  readonly isNewLiveSession: boolean
}

export type AgentProjectAfterTurnOutput = {
  readonly events?: readonly AgentEvent[]
}

export type AgentProjectContribution = {
  readonly commands: readonly RegisteredPromptCommand[]
  readonly publishedCommands?: readonly PublishedAgentCommand[]
  sdkPlugins?(message: AgentMessage): readonly AgentSdkPluginSpec[] | Promise<readonly AgentSdkPluginSpec[]>
  prepareMessage?(
    message: AgentMessage,
    context: AgentProjectMessageContext,
  ): AgentMessage | Promise<AgentMessage>
  afterTurn?(input: AgentProjectAfterTurnInput): void | AgentProjectAfterTurnOutput | Promise<void | AgentProjectAfterTurnOutput>
}

export function mergeAgentProjectContributions(
  contributions: readonly AgentProjectContribution[],
): AgentProjectContribution {
  return {
    commands: contributions.flatMap((contribution) => contribution.commands),
    publishedCommands: contributions.flatMap((contribution) => contribution.publishedCommands ?? []),
    async sdkPlugins(message) {
      const plugins = await Promise.all(contributions.map((contribution) =>
        Promise.resolve(contribution.sdkPlugins?.(message) ?? [])))
      return plugins.flat()
    },
    async prepareMessage(message, context) {
      let next = message
      for (const contribution of contributions) {
        next = await Promise.resolve(contribution.prepareMessage?.(next, context) ?? next)
      }
      return next
    },
    async afterTurn(input) {
      const events: AgentEvent[] = []
      for (const contribution of contributions) {
        const result = await Promise.resolve(contribution.afterTurn?.(input))
        events.push(...result?.events ?? [])
      }
      return { events }
    },
  }
}
