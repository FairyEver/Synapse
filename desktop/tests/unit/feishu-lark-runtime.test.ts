import { describe, expect, it } from "vitest"
import { createDefaultConfig } from "../../src/lib/config"
import type { SynapseConfig, SynapseProjectConfig, SynapseProjectPlatformConnection } from "../../src/types/config"
import { AgentSessionsStoreService } from "../../electron/services/agent-sessions-store-service"
import {
  FeishuLarkRuntimeService,
  parseFeishuLarkMessageEvent,
  type FeishuLarkAdapterContext,
  type FeishuLarkAdapterHandlers,
  type FeishuLarkOutboundText,
  type FeishuLarkRuntimeAdapter,
} from "../../electron/services/feishu-lark-runtime-service"
import type { AuditSink, PermissionGuard } from "../../electron/runtime/security"

class FakeAdapter implements FeishuLarkRuntimeAdapter {
  handlers: FeishuLarkAdapterHandlers | null = null
  sent: FeishuLarkOutboundText[] = []
  stopped = false

  async start(handlers: FeishuLarkAdapterHandlers): Promise<void> {
    this.handlers = handlers
  }

  async stop(): Promise<void> {
    this.stopped = true
  }

  async sendText(input: FeishuLarkOutboundText): Promise<void> {
    this.sent.push(input)
  }
}

function createProjectConnection(type: "feishu" | "lark"): {
  project: SynapseProjectConfig
  connection: SynapseProjectPlatformConnection
} {
  const connection: SynapseProjectPlatformConnection = {
    id: `connector:${type}:synapse-${type}`,
    type,
    name: `synapse-${type}`,
    status: "configured",
    enabled: true,
    options: {
      app_id: `cli_${type}`,
      allow_from: "*",
      group_reply_all: true,
      thread_isolation: true,
    },
    secretRefs: {
      app_secret: `secret:${type}`,
    },
    allowFrom: "*",
    groupReplyAll: true,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  }

  return {
    connection,
    project: {
      id: `project-${type}`,
      name: `project-${type}`,
      path: `/repo/${type}`,
      workDir: `/repo/${type}`,
      agentType: "codex",
      platformConnections: [connection],
    },
  }
}

function createRuntimeHarness(types: Array<"feishu" | "lark">) {
  const projects = types.map((type) => createProjectConnection(type).project)
  const config: SynapseConfig = {
    ...createDefaultConfig(),
    global: {
      ...createDefaultConfig().global,
      projects,
    },
  }
  const adapters: FakeAdapter[] = []
  const contexts: FeishuLarkAdapterContext[] = []
  const auditEvents: Array<{ action: string; resource: string; outcome: string }> = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: () => () => undefined,
    check: async () => ({ allowed: true }),
  }
  const auditSink = {
    record: (event) => {
      auditEvents.push({
        action: event.action,
        resource: event.resource,
        outcome: event.outcome,
      })
    },
    list: () => [],
    clearForTests: () => undefined,
  } satisfies AuditSink
  const agentSessions = new AgentSessionsStoreService({
    namespace: null,
    now: () => new Date("2026-04-26T01:00:00.000Z"),
  })
  const service = new FeishuLarkRuntimeService({
    config: {
      load: async () => structuredClone(config),
    },
    secretStore: {
      readConnectorSecretValue: async (id) => `value-for-${id}`,
    },
    agentSessions,
    permissionGuard,
    auditSink,
    adapterFactory: (context) => {
      contexts.push(context)
      const adapter = new FakeAdapter()
      adapters.push(adapter)
      return adapter
    },
    agentEvents: async () => [
      { type: "text", content: "收到，继续。", sessionId: "agent-thread-1" },
      { type: "result", done: true },
    ],
    now: () => new Date("2026-04-26T01:00:00.000Z"),
  })

  return { service, config, projects, adapters, contexts, auditEvents, agentSessions }
}

function messageEvent(platform: "feishu" | "lark") {
  return {
    sender: {
      sender_id: {
        open_id: `ou_${platform}`,
      },
      sender_type: "user",
    },
    message: {
      message_id: `om_${platform}`,
      root_id: `om_root_${platform}`,
      chat_id: `oc_${platform}`,
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "看一下这个变更" }),
      mentions: [],
      create_time: "1777150800000",
    },
  }
}

describe("Feishu/Lark runtime service", () => {
  it("starts configured Feishu and Lark runtimes from config", async () => {
    const harness = createRuntimeHarness(["feishu", "lark"])

    await harness.service.startAllFromConfig()

    expect(harness.contexts.map((context) => context.platform)).toEqual(["feishu", "lark"])
    expect(harness.contexts.map((context) => context.appSecret)).toEqual([
      "value-for-secret:feishu",
      "value-for-secret:lark",
    ])
    expect(harness.service.listSnapshots()).toMatchObject([
      { platform: "feishu", status: "connected" },
      { platform: "lark", status: "connected" },
    ])
  })

  it.each(["feishu", "lark"] as const)(
    "routes %s inbound message into Synapse session and sends the agent reply",
    async (platform) => {
      const harness = createRuntimeHarness([platform])
      await harness.service.startAllFromConfig()

      const adapter = harness.adapters[0]
      await adapter?.handlers?.onMessage(messageEvent(platform))

      expect(adapter?.sent).toEqual([{
        chatId: `oc_${platform}`,
        content: "收到，继续。",
        replyToMessageId: `om_${platform}`,
        replyInThread: true,
        receiveIdType: "chat_id",
      }])
      const sessions = await harness.agentSessions.list(harness.projects)
      expect(sessions.sessions[0]).toMatchObject({
        projectId: `project-${platform}`,
        platform,
        lastMessage: {
          role: "assistant",
          content: "收到，继续。",
        },
      })
    },
  )

  it("dispatches card actions and bot menu commands through the same session chain", async () => {
    const harness = createRuntimeHarness(["feishu"])
    await harness.service.startAllFromConfig()
    const adapter = harness.adapters[0]

    await adapter?.handlers?.onCardAction({
      context: {
        open_chat_id: "oc_feishu",
        open_message_id: "om_card",
      },
      operator: {
        open_id: "ou_feishu",
      },
      action: {
        value: {
          action: "cmd:/status",
          session_key: "feishu:oc_feishu:ou_feishu",
        },
      },
    })
    await adapter?.handlers?.onBotMenu({
      operator: {
        operator_id: {
          open_id: "ou_feishu",
        },
      },
      event_key: "help",
    })

    expect(adapter?.sent).toMatchObject([
      {
        chatId: "oc_feishu",
        content: "收到，继续。",
        replyToMessageId: "om_card",
      },
      {
        chatId: "ou_feishu",
        content: "收到，继续。",
        receiveIdType: "open_id",
      },
    ])
  })

  it("parses Feishu/Lark raw message events without exposing secrets", () => {
    expect(parseFeishuLarkMessageEvent(messageEvent("feishu"))).toMatchObject({
      messageId: "om_feishu",
      chatId: "oc_feishu",
      senderId: "ou_feishu",
      messageType: "text",
    })
  })
})
