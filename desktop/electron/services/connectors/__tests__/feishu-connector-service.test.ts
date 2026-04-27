import path from "node:path"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"

import { describe, expect, it } from "vitest"

import type {
  ConnectorEntryV1,
  DataNamespace,
  DataRepository,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import {
  AGENT_RUNTIME_SERVICE_ID,
  type AgentMessage,
  type AgentPermissionResponseRequest,
  type AgentRuntimeTurnResult,
} from "../../agent-runtime"
import type { SideChannelService } from "../../side-channel"
import { FeishuConnectorService } from "../feishu/connector-service"
import type {
  FeishuReplyContext,
  FeishuRuntimeClient,
  FeishuRuntimeClientHandlers,
} from "../feishu/feishu-types"

describe("FeishuConnectorService", () => {
  it("starts Feishu WS client, routes messages to AgentRuntime, and handles permission card actions", async () => {
    const dataRepository = new MemoryDataRepository()
    const client = new FakeFeishuClient()
    const agent = new FakeAgentRuntime()
    agent.activeAgentType = "claude-code"
    const service = new FeishuConnectorService({
      dataRepository,
      projectContainers: fakeProjectContainers(agent),
      sideChannel: new FakeSideChannel() as unknown as SideChannelService,
      listProjects: async () => [{ projectId: "project-1", name: "Project", workspacePath: "/repo" }],
      clientFactory: { create: () => client },
    })
    service.start()
    await service.saveManualCredentials({
      projectId: "project-1",
      appId: "cli_a",
      appSecret: "secret_a",
      ownerOpenId: "ou_admin",
    })

    const status = await service.startProject("project-1")
    expect(status.running).toBe(true)
    expect(client.started).toBe(true)

    await client.handlers?.onMessage({
      sender: { sender_id: { open_id: "ou_admin" } },
      message: {
        message_id: "m1",
        create_time: String(Date.now() + 1000),
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "@bot run tests" }),
        mentions: [{ key: "@bot", id: { open_id: "ou_bot" } }],
      },
    })

    expect(agent.messages).toHaveLength(1)
    expect(client.replies).toEqual([])
    expect(client.reactions).toEqual([
      ["addReaction", "m1", "OnIt"],
      ["removeReaction", "m1", "reaction-1"],
    ])
    expect(agent.messages[0]).toEqual(expect.objectContaining({
      projectId: "project-1",
      platform: "feishu",
      content: "run tests",
      sessionKey: "feishu:oc_group:ou_admin",
      channelKey: "feishu:oc_group",
    }))
    const connector = await dataRepository.namespace<ConnectorEntryV1>("connectors").get("feishu:project-1")
    expect(connector?.dedupe?.lastMessageIds).toEqual(["m1"])

    const cardActionResponse = await client.handlers?.onCardAction({
      operator: { open_id: "ou_admin" },
      action: {
        value: {
          projectId: "project-1",
          connectorId: "feishu:project-1",
          requestId: "req-1",
          behavior: "allow",
        },
      },
    })
    expect(cardActionResponse).toEqual(expect.objectContaining({
      header: expect.objectContaining({
        title: { tag: "plain_text", content: "权限确认" },
      }),
      elements: [
        expect.objectContaining({
          text: { tag: "plain_text", content: "已允许" },
        }),
      ],
    }))
    expect(agent.permissions).toEqual([expect.objectContaining({
      requestId: "req-1",
      behavior: "allow",
      actor: { kind: "user", id: "feishu:ou_admin" },
    })])

    await service.stopProject("project-1")
    expect(client.stopped).toBe(true)
  })

  it("binds Feishu channels to workspaces before sending agent turns", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "synapse-feishu-workspaces-"))
    const workspaceDir = path.join(baseDir, "repo-a")
    await mkdir(workspaceDir)
    const normalizedWorkspaceDir = await realpath(workspaceDir)
    const dataRepository = new MemoryDataRepository()
    const client = new FakeFeishuClient()
    const agent = new FakeAgentRuntime()
    const service = new FeishuConnectorService({
      dataRepository,
      projectContainers: fakeProjectContainers(agent),
      sideChannel: new FakeSideChannel() as unknown as SideChannelService,
      listProjects: async () => [{ projectId: "project-1", name: "Project", workspacePath: "/repo" }],
      clientFactory: { create: () => client },
    })
    service.start()
    await service.saveManualCredentials({
      projectId: "project-1",
      appId: "cli_a",
      appSecret: "secret_a",
      ownerOpenId: "ou_admin",
    })
    await service.updateWorkspaceConfig({
      projectId: "project-1",
      enabled: true,
      baseDir,
      autoBindByChannelName: false,
    })
    await service.startProject("project-1")

    await client.handlers?.onMessage({
      sender: { sender_id: { open_id: "ou_admin" } },
      message: {
        message_id: "m1",
        create_time: String(Date.now() + 1000),
        chat_id: "oc_group",
        chat_type: "group",
        chat_name: "Repo A",
        message_type: "text",
        content: JSON.stringify({ text: "@bot status" }),
        mentions: [{ key: "@bot", id: { open_id: "ou_bot" } }],
      },
    })

    expect(agent.messages).toHaveLength(0)
    expect(client.replies.at(-1)?.content).toBe("当前频道未绑定工作区。发送目录名、本地路径或 Git URL。")

    await client.handlers?.onMessage({
      sender: { sender_id: { open_id: "ou_admin" } },
      message: {
        message_id: "m2",
        create_time: String(Date.now() + 2000),
        chat_id: "oc_group",
        chat_type: "group",
        chat_name: "Repo A",
        message_type: "text",
        content: JSON.stringify({ text: "@bot /workspace bind repo-a" }),
        mentions: [{ key: "@bot", id: { open_id: "ou_bot" } }],
      },
    })

    expect(client.replies.at(-1)?.content).toBe(`已绑定：${normalizedWorkspaceDir}`)

    await client.handlers?.onMessage({
      sender: { sender_id: { open_id: "ou_admin" } },
      message: {
        message_id: "m3",
        create_time: String(Date.now() + 3000),
        chat_id: "oc_group",
        chat_type: "group",
        chat_name: "Repo A",
        message_type: "text",
        content: JSON.stringify({ text: "@bot run tests" }),
        mentions: [{ key: "@bot", id: { open_id: "ou_bot" } }],
      },
    })

    expect(agent.messages).toEqual([
      expect.objectContaining({
        content: "run tests",
        channelKey: "feishu:oc_group",
        channelName: "Repo A",
        workspacePath: normalizedWorkspaceDir,
        workspaceKey: expect.stringMatching(/^workspace:/),
      }),
    ])
    expect(await service.listWorkspaceBindings("project-1")).toEqual(expect.objectContaining({
      project: [
        expect.objectContaining({
          channelKey: "feishu:oc_group",
          workspacePath: normalizedWorkspaceDir,
        }),
      ],
    }))

    await service.stopProject("project-1")
  })
})

class FakeFeishuClient implements FeishuRuntimeClient {
  handlers: FeishuRuntimeClientHandlers | undefined
  started = false
  stopped = false
  readonly replies: Array<{ readonly ctx: FeishuReplyContext; readonly content: string }> = []
  readonly reactions: unknown[][] = []

  async start(handlers: FeishuRuntimeClientHandlers): Promise<void> {
    this.handlers = handlers
    this.started = true
  }

  async stop(): Promise<void> {
    this.stopped = true
  }

  async fetchBotOpenId(): Promise<string | undefined> {
    return "ou_bot"
  }

  async replyText(ctx: FeishuReplyContext, content: string): Promise<void> {
    this.replies.push({ ctx, content })
  }
  async createText(_ctx: FeishuReplyContext, _content: string): Promise<void> {}
  async sendCard(_ctx: FeishuReplyContext, _card: Record<string, unknown>): Promise<void> {}
  async sendImage(_ctx: FeishuReplyContext, _image: Buffer): Promise<void> {}
  async sendFile(_ctx: FeishuReplyContext, _fileName: string, _file: Buffer): Promise<void> {}
  async addReaction(messageId: string, emojiType: string): Promise<string | undefined> {
    this.reactions.push(["addReaction", messageId, emojiType])
    return "reaction-1"
  }
  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    this.reactions.push(["removeReaction", messageId, reactionId])
  }
}

class FakeAgentRuntime {
  activeAgentType = "codex"
  readonly messages: AgentMessage[] = []
  readonly permissions: AgentPermissionResponseRequest[] = []

  async getActiveAgentType(): Promise<string> {
    return this.activeAgentType
  }

  async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    this.messages.push(message)
    return {
      conversationId: "conv-1",
      events: [],
      resultText: "",
    }
  }

  async respondPermission(request: AgentPermissionResponseRequest): Promise<void> {
    this.permissions.push(request)
  }
}

class FakeSideChannel {
  registerDispatcher(): () => void {
    return () => {}
  }
}

function fakeProjectContainers(agent: FakeAgentRuntime): ProjectContainerRegistry {
  const container: ProjectContainer = {
    projectId: "project-1",
    get: <T,>(id: string): T => {
      if (id === AGENT_RUNTIME_SERVICE_ID) return agent as unknown as T
      throw new Error(`Unknown service: ${id}`)
    },
    inspect: () => [],
    dispose: async () => {},
  }
  return {
    open: async () => container,
    close: async () => {},
    list: () => [],
    registerService: () => {},
    setQuota: () => {},
  }
}

class MemoryDataRepository implements DataRepository {
  private readonly namespaces = new Map<string, MemoryNamespace<Record<string, unknown> & { id: string }>>()

  namespace<T>(name: string): DataNamespace<T> {
    let namespace = this.namespaces.get(name)
    if (!namespace) {
      namespace = new MemoryNamespace(name)
      this.namespaces.set(name, namespace)
    }
    return namespace as unknown as DataNamespace<T>
  }

  async exportAll() {
    return { format: "synapse-backup-v1" as const, exportedAt: "", namespaces: [] }
  }

  async importAll(): Promise<void> {}

  inspect() {
    return []
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(_value: T): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.items.values()]
    if (!filter) return values
    return values.filter((item) =>
      Object.entries(filter).every(([key, value]) => item[key as keyof T] === value),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(): () => void {
    return () => {}
  }
}
