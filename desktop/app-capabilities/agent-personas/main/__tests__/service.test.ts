import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { AgentPersonaItemEntryV1 } from "../../../../electron/runtime/data-repo/schemas/agent-personas"
import { BUILTIN_ZH_EN_TRANSLATOR_ID } from "../../shared/defaults"
import { createAgentPersonaService } from "../service"

describe("AgentPersonaService", () => {
  it("lists built-in personas before user personas", async () => {
    const harness = createHarness()
    harness.items.records.set("user-1", {
      id: "user-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      source: "user",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    })
    harness.items.records.set("user-0", {
      id: "user-0",
      schemaVersion: 1,
      name: "更早的智能体",
      description: "创建时间更早。",
      systemPrompt: "你是更早的智能体。",
      providerModel: null,
      source: "user",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    })

    const service = createAgentPersonaService(harness.deps)

    await expect(service.list()).resolves.toMatchObject([
      { id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin", readonly: true },
      { id: "user-0", source: "user", readonly: false },
      { id: "user-1", source: "user", readonly: false },
    ])
  })

  it("creates, updates, and deletes user personas", async () => {
    const harness = createHarness()
    const service = createAgentPersonaService(harness.deps)
    const changed = vi.fn()
    service.events.on("changed", changed)

    const created = await service.create({
      name: "  产品顾问  ",
      description: "  整理产品判断  ",
      systemPrompt: "  你是产品顾问。  ",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })
    expect(created).toMatchObject({
      id: "id-1",
      name: "产品顾问",
      description: "整理产品判断",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      source: "user",
      readonly: false,
    })

    const updated = await service.update({
      id: created.id,
      name: "翻译助手",
      description: "处理中英文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
    })
    expect(updated).toMatchObject({
      id: created.id,
      name: "翻译助手",
      providerModel: null,
    })

    await service.delete({ id: created.id })
    expect((await service.list()).map((item) => item.id)).toEqual([BUILTIN_ZH_EN_TRANSLATOR_ID])
    expect(changed).toHaveBeenCalled()
    expect(changed).toHaveBeenLastCalledWith({
      items: expect.arrayContaining([
        expect.objectContaining({ id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin" }),
      ]),
    })
  })

  it("rejects blank required fields", async () => {
    const service = createAgentPersonaService(createHarness().deps)

    await expect(service.create({
      name: "",
      description: "简介",
      systemPrompt: "提示词",
      providerModel: null,
    })).rejects.toThrow("名称不能为空")

    await expect(service.create({
      name: "名称",
      description: " ",
      systemPrompt: "提示词",
      providerModel: null,
    })).rejects.toThrow("简介不能为空")

    await expect(service.create({
      name: "名称",
      description: "简介",
      systemPrompt: "",
      providerModel: null,
    })).rejects.toThrow("系统提示词不能为空")
  })

  it("normalizes optional model selection", async () => {
    const service = createAgentPersonaService(createHarness().deps)

    await expect(service.create({
      name: "默认模型",
      description: "不指定模型。",
      systemPrompt: "你是默认模型智能体。",
    })).resolves.toMatchObject({
      providerModel: null,
    })

    await expect(service.create({
      name: "指定模型",
      description: "指定 Claude Sonnet。",
      systemPrompt: "你是指定模型智能体。",
      providerModel: { providerId: "  claude  ", modelTier: "sonnet" },
    })).resolves.toMatchObject({
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })

    await expect(service.create({
      name: "空模型",
      description: "模型供应商为空。",
      systemPrompt: "你是空模型智能体。",
      providerModel: { providerId: " ", modelTier: "sonnet" },
    })).rejects.toThrow("模型供应商不能为空")
  })

  it("rejects updates and deletes for built-in personas", async () => {
    const service = createAgentPersonaService(createHarness().deps)

    await expect(service.update({
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
      name: "中英翻译",
      description: "描述",
      systemPrompt: "提示词",
      providerModel: null,
    })).rejects.toThrow("内置智能体不可编辑")

    await expect(service.delete({ id: BUILTIN_ZH_EN_TRANSLATOR_ID }))
      .rejects.toThrow("内置智能体不可删除")
  })

  it("rejects updates and deletes for missing user personas", async () => {
    const service = createAgentPersonaService(createHarness().deps)

    await expect(service.update({
      id: "missing",
      name: "不存在",
      description: "不存在。",
      systemPrompt: "你是不存在的智能体。",
      providerModel: null,
    })).rejects.toThrow("智能体不存在")

    await expect(service.delete({ id: "missing" }))
      .rejects.toThrow("智能体不存在")
  })
})

function createHarness() {
  const items = createMemoryNamespace<AgentPersonaItemEntryV1>()
  return {
    items,
    deps: {
      items,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
      createId: () => `id-${items.records.size + 1}`,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function createMemoryNamespace<T extends { id: string }>(): DataNamespace<T> & { records: Map<string, T> } {
  const events = new EventEmitter()
  const records = new Map<string, T>()
  return {
    name: "memory",
    schemaVersion: 1,
    backend: "sqlite",
    records,
    async getSingleton() { return null },
    async setSingleton() {},
    async clearSingleton() {},
    async list() { return Array.from(records.values()) },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
}
