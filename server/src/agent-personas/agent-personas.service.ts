import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common"
import { Prisma, type AgentPersona, type AgentPersonaPreference } from "@prisma/client"
import {
  agentPersonaCreateInputSchema,
  agentPersonaPreferenceUpdateInputSchema,
  agentPersonaProviderModelSchema,
  agentPersonaToolPolicySchema,
  agentPersonaUpdateInputSchema,
  type AgentPersonaCreateInputDto,
  type AgentPersonaDto,
  type AgentPersonaListResponseDto,
  type AgentPersonaPreferenceUpdateInputDto,
  type AgentPersonaToolPolicyDto,
  type AgentPersonaUpdateInputDto,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { builtinAgentPersonas } from "./agent-personas.defaults"

@Injectable()
export class AgentPersonasService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBuiltins()
  }

  async ensureBuiltins(): Promise<void> {
    for (const item of builtinAgentPersonas) {
      await this.prisma.agentPersona.upsert({
        where: { source_stableKey: { source: "builtin", stableKey: item.stableKey } },
        create: {
          source: "builtin",
          ownerUserId: null,
          stableKey: item.stableKey,
          name: item.name,
          description: item.description,
          systemPrompt: item.systemPrompt,
          defaultProviderModel: toPrismaJson(item.defaultProviderModel),
          defaultToolPolicy: toPrismaJson(item.defaultToolPolicy),
          status: "active",
          version: item.version,
        },
        update: {
          name: item.name,
          description: item.description,
          systemPrompt: item.systemPrompt,
          defaultProviderModel: toPrismaJson(item.defaultProviderModel),
          defaultToolPolicy: toPrismaJson(item.defaultToolPolicy),
          status: "active",
          version: item.version,
        },
      })
    }
  }

  async list(userId: string): Promise<AgentPersonaListResponseDto> {
    const rows = await this.prisma.agentPersona.findMany({
      where: {
        status: "active",
        OR: [{ source: "builtin" }, { source: "user", ownerUserId: userId }],
      },
      orderBy: [{ source: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    const preferences = await this.prisma.agentPersonaPreference.findMany({
      where: { userId, personaId: { in: rows.map((row) => row.id) } },
    })
    const preferenceByPersonaId = new Map(preferences.map((preference) => [preference.personaId, preference]))
    return { items: rows.map((row) => toDto(row, preferenceByPersonaId.get(row.id))) }
  }

  async create(userId: string, input: AgentPersonaCreateInputDto): Promise<AgentPersonaDto> {
    const parsed = agentPersonaCreateInputSchema.parse(input)
    const row = await this.prisma.agentPersona.create({
      data: {
        source: "user",
        ownerUserId: userId,
        stableKey: null,
        name: parsed.name,
        description: parsed.description,
        systemPrompt: parsed.systemPrompt,
        defaultProviderModel: toPrismaJson(parsed.providerModel ?? null),
        defaultToolPolicy: toPrismaJson(parsed.toolPolicy ?? null),
        status: "active",
        version: 1,
      },
    })
    return toDto(row)
  }

  async update(userId: string, id: string, input: AgentPersonaUpdateInputDto): Promise<AgentPersonaDto> {
    const parsed = agentPersonaUpdateInputSchema.parse(input)
    const existing = await this.prisma.agentPersona.findFirst({
      where: { id, source: "user", ownerUserId: userId, status: "active" },
    })
    if (!existing) throw new NotFoundException("智能体不存在。")
    const row = await this.prisma.agentPersona.update({
      where: { id },
      data: {
        name: parsed.name,
        description: parsed.description,
        systemPrompt: parsed.systemPrompt,
        defaultProviderModel: toPrismaJson(parsed.providerModel ?? null),
        defaultToolPolicy: toPrismaJson(parsed.toolPolicy ?? null),
        version: { increment: 1 },
      },
    })
    return toDto(row)
  }

  async delete(userId: string, id: string): Promise<void> {
    const result = await this.prisma.agentPersona.updateMany({
      where: { id, source: "user", ownerUserId: userId, status: "active" },
      data: { status: "archived" },
    })
    if (result.count === 0) throw new NotFoundException("智能体不存在。")
  }

  async updateBuiltinPreference(
    userId: string,
    id: string,
    input: AgentPersonaPreferenceUpdateInputDto,
  ): Promise<AgentPersonaDto> {
    const parsed = agentPersonaPreferenceUpdateInputSchema.parse(input)
    const builtin = await this.prisma.agentPersona.findFirst({
      where: { id, source: "builtin", status: "active" },
    })
    if (!builtin) throw new NotFoundException("内置智能体不存在。")
    const preference = await this.prisma.agentPersonaPreference.upsert({
      where: { userId_personaId: { userId, personaId: id } },
      create: {
        userId,
        personaId: id,
        providerModel: toPrismaJson(parsed.providerModel),
        toolPolicy: toPrismaJson(parsed.toolPolicy),
      },
      update: {
        providerModel: toPrismaJson(parsed.providerModel),
        toolPolicy: toPrismaJson(parsed.toolPolicy),
      },
    })
    return toDto(builtin, preference)
  }
}

function toDto(row: AgentPersona, preference?: AgentPersonaPreference): AgentPersonaDto {
  if (row.source === "builtin") {
    if (row.ownerUserId !== null || !row.stableKey) throw new BadRequestException("内置智能体数据无效。")
    return {
      id: row.id,
      schemaVersion: 1,
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      providerModel: normalizeProviderModel(preference?.providerModel ?? row.defaultProviderModel),
      toolPolicy: normalizeToolPolicy(preference?.toolPolicy ?? row.defaultToolPolicy),
      source: "builtin",
      readonly: true,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
  if (row.source !== "user" || !row.ownerUserId || row.stableKey !== null) {
    throw new BadRequestException("用户智能体数据无效。")
  }
  return {
    id: row.id,
    schemaVersion: 1,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    providerModel: normalizeProviderModel(row.defaultProviderModel),
    toolPolicy: normalizeToolPolicy(row.defaultToolPolicy),
    source: "user",
    readonly: false,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function normalizeProviderModel(value: unknown): AgentPersonaDto["providerModel"] {
  if (value === null || value === undefined) return null
  return agentPersonaProviderModelSchema.parse(value)
}

function normalizeToolPolicy(value: unknown): AgentPersonaToolPolicyDto | null {
  if (value === null || value === undefined) return null
  return agentPersonaToolPolicySchema.parse(value)
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}
