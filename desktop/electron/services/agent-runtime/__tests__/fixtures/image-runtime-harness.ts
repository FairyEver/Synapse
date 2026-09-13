import path from "node:path"
import { query, type Options } from "@anthropic-ai/claude-agent-sdk"
import { JsonNamespace, conversationsSchema, type ConversationEntryV1, type AgentArtifactEntry, type AgentEventEntryV1 } from "../../../../runtime/data-repo"
import type { ProviderService } from "../../../provider"
import { AgentArtifactStore } from "../../artifact-store"
import { ClaudeSDKSession } from "../../claude-sdk-session"
import { ConversationRouter } from "../../conversation-router"
import { AgentSessionRepository } from "../../session-repository"
import { SessionManager } from "../../session-manager"
import type { AgentMessage } from "../../types"

/** Real Runtime router, persistence and native SDK. Only Provider selection and
 * sandboxed SDK configuration are supplied by the isolated acceptance harness. */
export function imageRuntimeHarness(input: {
  root: string; env: Record<string, string>; model: string; bodyBudget?: number; firstImagePressure?: boolean; denyResumedReads?: boolean; pressureGenerations?: number
}) {
  const namespace = <T extends Record<string, unknown>>(name: string) => new JsonNamespace<T>({
    name, schemaVersion: 1, backend: "json", filePath: path.join(input.root, `${name}.json`),
  })
  const conversations = new JsonNamespace<ConversationEntryV1>({ name: "conversations", schemaVersion: 1,
    backend: "json", filePath: path.join(input.root, "conversations.json"), validate: conversationsSchema.validate })
  const agentEvents = namespace<AgentEventEntryV1>("agent.events")
  const store = new AgentArtifactStore({ rootDirectory: path.join(input.root, "artifacts"), artifacts: namespace<AgentArtifactEntry>("agent.artifacts") })
  const repository = new AgentSessionRepository({ projectId: "image-acceptance", conversations })
  const sessions: ClaudeSDKSession[] = []
  const logs: Array<{ message: string; metadata: unknown }> = []
  const logger = { trace: () => undefined, debug: () => undefined, error: () => undefined, fatal: () => undefined, child: () => logger, info: (message: string, metadata?: unknown) => { logs.push({ message, metadata }) },
    warn: (message: string, metadata?: unknown) => { logs.push({ message, metadata }) } }
  const pendingPermissions = new Map()
  const sessionManager = new SessionManager({ projectId: "image-acceptance", workDir: input.root,
    repository, pendingPermissions, states: new Map(), agentArtifactStore: store,
    providerService: { getActiveProvider: async () => ({ id: "acceptance-provider" }), buildEnv: async () => input.env } as unknown as ProviderService,
    createSession: (options) => {
      const generation = sessions.length
      let pressureApplied = false
      const session = new ClaudeSDKSession({ ...options, conversationId: options.conversation.id,
        env: input.env, hostEnv: { PATH: process.env.PATH, HOME: input.root, CLAUDE_CONFIG_DIR: path.join(input.root, "sdk-config") },
        model: input.model, mode: "bypassPermissions", maxTurns: 128, autoCompactWindowTokens: 200_000,
        maxRequestBodyBytes: 6 * 1024 * 1024, requestBodyBudgetBytes: input.bodyBudget ?? 5 * 1024 * 1024,
        disallowedTools: input.denyResumedReads && generation > 0 ? ["Read"] : undefined,
        tools: ["Read", "Bash"], systemPrompt: "Complete the user's image verification task using native Read. Preserve progress after maintenance.",
        logger, synapseToolRouter: undefined,
        queryFactory: ({ prompt, options: sdkOptions }) => {
          const native = sdkOptions as Options
          if (input.firstImagePressure && generation < (input.pressureGenerations ?? 1)) {
            native.hooks!.PostToolUse = native.hooks!.PostToolUse!.map((matcher) => ({ ...matcher,
              hooks: matcher.hooks.map((hook) => async (...args) => {
                if (!pressureApplied && args[0].hook_event_name === "PostToolUse" && args[0].tool_name === "Read"
                  && (args[0].tool_response as { type?: string } | null)?.type === "image") {
                  pressureApplied = true
                  const budget = (session as unknown as { contextBudget: { recordToolOutputCost(cost: { bytes: number; tokens: null; source: "native-non-text"; batch: number }): void } }).contextBudget
                  budget.recordToolOutputCost({ bytes: 5 * 1024 * 1024, tokens: null, source: "native-non-text", batch: 0 })
                }
                return hook(...args)
              }),
            }))
          }
          return query({ prompt, options: {
          ...sdkOptions, settingSources: [], strictMcpConfig: true, mcpServers: {},
          env: { ...(sdkOptions.env as Record<string, string>), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
        } as Options })
        },
      })
      sessions.push(session)
      return session
    },
  })
  const router = new ConversationRouter({ repository, sessionManager, pendingPermissions, commandRouter: undefined,
    deps: { projectId: "image-acceptance", defaultAgentType: "claude-code", workDir: input.root,
      agentArtifactStore: store, agentEvents, logger } })
  return { router, sessions, conversations, agentEvents, logs, store, repository,
    message(content: string): AgentMessage { return { projectId: "image-acceptance", sessionKey: "synthetic-images",
      platform: "local", workspacePath: input.root, content } },
    async close() { for (const session of sessions) await session.close() },
  }
}
