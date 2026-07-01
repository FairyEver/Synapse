import { BadRequestException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { AgentPersonasService } from "./agent-personas.service"

describe("AgentPersonasService", () => {
  it("seeds built-in personas and merges user preferences", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)

    prisma.agentPersona.upsert.mockResolvedValueOnce(builtinRow())
    prisma.agentPersona.findMany.mockResolvedValueOnce([
      builtinRow(),
      userRow({ id: "persona-user-1", ownerUserId: "user-1" }),
    ])
    prisma.agentPersonaPreference.findMany.mockResolvedValueOnce([{
      id: "pref-1",
      userId: "user-1",
      personaId: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "allowlist", allowedTools: ["Read"] },
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    }])

    await service.ensureBuiltins()
    const result = await service.list("user-1")

    expect(prisma.agentPersona.upsert).toHaveBeenCalled()
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "builtin-1",
        source: "builtin",
        readonly: true,
        providerModel: { providerId: "claude", modelTier: "sonnet" },
        toolPolicy: { mode: "allowlist", allowedTools: ["Read"] },
      }),
      expect.objectContaining({
        id: "persona-user-1",
        source: "user",
        readonly: false,
      }),
    ])
  })

  it("creates and updates only current user's personas", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.create.mockResolvedValueOnce(userRow({ id: "persona-user-1", ownerUserId: "user-1", name: "产品顾问" }))
    prisma.agentPersona.findFirst.mockResolvedValueOnce(userRow({ id: "persona-user-1", ownerUserId: "user-1" }))
    prisma.agentPersona.update.mockResolvedValueOnce(userRow({ id: "persona-user-1", ownerUserId: "user-1", name: "翻译助手" }))

    await expect(service.create("user-1", {
      name: " 产品顾问 ",
      description: " 整理产品判断。 ",
      systemPrompt: " 你是产品顾问。 ",
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    })).resolves.toMatchObject({ id: "persona-user-1", name: "产品顾问" })

    await expect(service.update("user-1", "persona-user-1", {
      name: "翻译助手",
      description: "翻译文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
      toolPolicy: null,
    })).resolves.toMatchObject({ name: "翻译助手" })
  })

  it("rejects editing built-in definitions through user update", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.findFirst.mockResolvedValueOnce(null)

    await expect(service.update("user-1", "builtin-1", {
      name: "x",
      description: "x",
      systemPrompt: "x",
      providerModel: null,
      toolPolicy: null,
    })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("archives only current user's personas on delete", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.updateMany.mockResolvedValueOnce({ count: 1 })

    await service.delete("user-1", "persona-user-1")

    expect(prisma.agentPersona.updateMany).toHaveBeenCalledWith({
      where: { id: "persona-user-1", source: "user", ownerUserId: "user-1", status: "active" },
      data: { status: "archived" },
    })
  })

  it("rejects deleting missing or foreign personas", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(service.delete("user-1", "persona-user-1"))
      .rejects.toBeInstanceOf(NotFoundException)
  })

  it("updates built-in preferences only for built-in personas", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.findFirst.mockResolvedValueOnce(builtinRow({ id: "builtin-1" }))
    prisma.agentPersonaPreference.upsert.mockResolvedValueOnce({
      id: "pref-1",
      userId: "user-1",
      personaId: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    })

    await expect(service.updateBuiltinPreference("user-1", "builtin-1", {
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
    })).resolves.toMatchObject({
      id: "builtin-1",
      source: "builtin",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
    })
  })

  it("rejects invalid source ownership combinations", async () => {
    const prisma = createPrisma()
    const service = new AgentPersonasService(prisma as unknown as PrismaService)
    prisma.agentPersona.findMany.mockResolvedValueOnce([
      builtinRow({ ownerUserId: "user-1" }),
    ])
    prisma.agentPersonaPreference.findMany.mockResolvedValueOnce([])

    await expect(service.list("user-1")).rejects.toBeInstanceOf(BadRequestException)
  })
})

function createPrisma() {
  return {
    agentPersona: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentPersonaPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  }
}

function builtinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "builtin-1",
    source: "builtin",
    ownerUserId: null,
    stableKey: "zh-en-translator",
    name: "中英翻译",
    description: "在中文和英文之间互译。",
    systemPrompt: "你是中英翻译智能体。",
    defaultProviderModel: null,
    defaultToolPolicy: { mode: "disabled" },
    status: "active",
    version: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "persona-user-1",
    source: "user",
    ownerUserId: "user-1",
    stableKey: null,
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    defaultProviderModel: null,
    defaultToolPolicy: null,
    status: "active",
    version: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}
