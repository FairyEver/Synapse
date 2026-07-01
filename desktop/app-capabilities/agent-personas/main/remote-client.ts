import type {
  AgentPersona,
  AgentPersonaBuiltinModelUpdateInput,
  AgentPersonaCreateInput,
  AgentPersonaUpdateInput,
} from "../shared/schema"
import { agentPersonaSchema } from "../shared/schema"

export type AgentPersonaAccountPort = {
  fetchAuthenticated(pathOrUrl: string, init?: RequestInit, errorMessage?: string): Promise<Response>
}

export class RemoteAgentPersonaClient {
  constructor(private readonly account: AgentPersonaAccountPort) {}

  async list(): Promise<AgentPersona[]> {
    const response = await this.account.fetchAuthenticated("/agent-personas", {}, "智能体加载失败。")
    return parseListResponse(await readJson(response))
  }

  async create(input: AgentPersonaCreateInput): Promise<AgentPersona> {
    return this.write("POST", "/agent-personas", input, "智能体保存失败。")
  }

  async update(input: AgentPersonaUpdateInput): Promise<AgentPersona> {
    const { id, ...body } = input
    return this.write("PUT", `/agent-personas/${encodeURIComponent(id)}`, body, "智能体保存失败。")
  }

  async updateBuiltinModel(input: AgentPersonaBuiltinModelUpdateInput): Promise<AgentPersona> {
    return this.write("PUT", `/agent-personas/builtin/${encodeURIComponent(input.id)}/preferences`, {
      providerModel: input.providerModel,
      toolPolicy: input.toolPolicy ?? null,
    }, "智能体设置保存失败。")
  }

  async delete(input: { id: string }): Promise<void> {
    await this.account.fetchAuthenticated(`/agent-personas/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
    }, "智能体删除失败。")
  }

  private async write(method: string, path: string, body: unknown, errorMessage: string): Promise<AgentPersona> {
    const response = await this.account.fetchAuthenticated(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, errorMessage)
    return agentPersonaSchema.parse(await readJson(response))
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : undefined
}

function parseListResponse(value: unknown): AgentPersona[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Agent persona list response is invalid.")
  }
  return value.items.map((item) => agentPersonaSchema.parse(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
