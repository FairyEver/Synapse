import { describe, expect, it, vi } from "vitest"

import type { ConversationEntryV1, DataRepository } from "../../../../electron/runtime/data-repo"
import { createEventBus } from "../../../../electron/runtime/event-bus"
import type { AgentRuntimeService } from "../../../../electron/services/agent-runtime"
import { AgentConversationCapabilityError } from "../../shared/errors"
import { AgentConversationControlService } from "../control-service"
import { agentConversationReference } from "../conversation-reference"

const idempotencyKey = "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f"

function conversation(platform = "local-renderer"): ConversationEntryV1 {
  return {
    id: "conversation-1",
    schemaVersion: 1,
    projectId: "project-1",
    sessionKey: "secret-session-key",
    platform,
    history: [
      { role: "user", content: "do it", timestamp: "2026-09-12T00:00:00.000Z" },
      {
        role: "assistant",
        content: "thinking with apiKey=secret-value",
        timestamp: "2026-09-12T00:00:01.000Z",
        metadata: { agentEventType: "thinking", sdkSessionId: "sdk-private" },
      },
      {
        role: "tool",
        content: "Bash\ncommand",
        timestamp: "2026-09-12T00:00:02.000Z",
        metadata: {
          agentEventType: "toolUse",
          toolName: "Bash",
          toolInputRaw: {
            password: "secret",
            base64: "AAAA",
            nested: { data: "A".repeat(1_024) },
            url: "artifact://private",
          },
        },
      },
    ],
    active: true,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:02.000Z",
  }
}

function createHarness(entry = conversation(), overrides: Partial<AgentRuntimeService> = {}) {
  const entries = new Map([[entry.id, entry]])
  const listeners = new Set<(change: { id?: string; value?: ConversationEntryV1; previous?: ConversationEntryV1 }) => void>()
  const dataRepository = {
    namespace: vi.fn(() => ({
      get: vi.fn(async (id: string) => entries.get(id) ?? null),
      list: vi.fn(async (filter?: Partial<ConversationEntryV1>) => [...entries.values()].filter(
        (item) => !filter?.projectId || item.projectId === filter.projectId,
      )),
      onChange: vi.fn((listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }),
    })),
  } as unknown as DataRepository
  const runtime = {
    getConversationRuntimeSnapshot: vi.fn(() => ({
      lifecycle: "running" as const,
      activeTurnId: "turn-1",
      queuedTurns: [],
      pendingPermissionRequestId: null,
    })),
    listPendingPermissions: vi.fn(() => []),
    submitToConversation: vi.fn(async (_message, conversationId, options) => ({
      accepted: true as const,
      conversationId,
      turnId: options?.turnId ?? "missing",
      disposition: "started" as const,
      queuePosition: 0,
    })),
    steer: vi.fn(async () => ({
      status: "accepted" as const,
      conversationId: entry.id,
      turnId: "turn-1",
      clientMessageId: "2289964b-0493-4cae-ae0d-46aa3812d87b",
    })),
    cancelExpectedTurn: vi.fn(async () => ({ status: "graceful-pending" as const })),
    forceKillExpectedTurn: vi.fn(async () => ({ status: "hard-killed" as const })),
    respondPermission: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AgentRuntimeService
  const eventBus = createEventBus({ defaultBackpressure: "block" })
  const listProjects = vi.fn(async () => [{ id: "project-1", name: "Project One" }])
  const listProviders = vi.fn(async () => [
    { id: "local-claude-code", name: "Local", env: { TOKEN: "secret-canary" } },
    { id: "custom", name: "Custom", opusModel: "model-two", model: "model-one", baseUrl: "private-url", secretRef: "secret-canary" },
    { id: "archived", name: "Archived", model: "hidden", archived: true },
  ] as never)
  const createConversation = vi.fn(async (input: { projectId: string; name?: string; providerId?: string; modelTier?: "default" | "opus" | "sonnet" | "haiku" }) => {
    const created = { ...conversation(), id: `new-${entries.size}`, projectId: input.projectId, history: [], name: input.name, providerId: input.providerId, modelTier: input.modelTier }
    entries.set(created.id, created)
    return created
  })
  const readDefaultProviderModel = vi.fn(async () => null as null | { providerId: string; modelTier: "default" | "opus" | "sonnet" | "haiku" })
  const service = new AgentConversationControlService({
    listProjects,
    listProviders,
    readDefaultProviderModel,
    createConversation,
    dataRepository,
    eventBus,
    resolveRuntime: vi.fn(async () => runtime),
    peekRuntime: vi.fn(() => runtime),
    logger: { warn: vi.fn() },
  })
  return {
    service, runtime, eventBus, entries, listeners, listProjects, createConversation,
    listProviders, readDefaultProviderModel,
  }
}

describe("AgentConversationControlService", () => {
  it("discovers selectable provider models with safe fields, search and pagination", async () => {
    const { service } = createHarness()
    await expect(service.listProviders({ offset: 0, limit: 1 })).resolves.toEqual({
      providers: [{ providerId: "local-claude-code", name: "Local", models: [{ modelTier: "default", modelName: null, displayName: "Claude Code 默认" }] }], nextOffset: 1,
    })
    const result = await service.listProviders({ offset: 1, limit: 1 })
    expect(result).toEqual({ providers: [{ providerId: "custom", name: "Custom", models: [
      { modelTier: "default", modelName: "model-one", displayName: "model-one" },
      { modelTier: "opus", modelName: "model-two", displayName: "model-two" },
    ] }], nextOffset: null })
    expect(await service.listProviders({ query: "MODEL-TWO", offset: 0, limit: 50 })).toEqual(result)
    expect(await service.listProviders({ providerId: "custom", offset: 0, limit: 50 })).toEqual(result)
    expect(await service.listProviders({ providerId: "archived", offset: 0, limit: 50 })).toEqual({ providers: [], nextOffset: null })
    service.dispose()
  })

  it("forwards explicit models and includes them in creation idempotency", async () => {
    const { service, createConversation } = createHarness()
    const input = { providerId: "custom", modelTier: "opus" as const, idempotencyKey }
    const result = await service.create(input, "client")
    expect(result).toMatchObject({ providerId: "custom", modelTier: "opus" })
    expect(createConversation).toHaveBeenCalledWith(expect.objectContaining({ providerId: "custom", modelTier: "opus" }))
    expect(await service.create(input, "client")).toEqual(result)
    await expect(service.create({ ...input, modelTier: "default" }, "client")).rejects.toMatchObject({ code: "idempotency_conflict" })
    expect(createConversation).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it("lists the default and configured groups with name search and pagination, without paths", async () => {
    const { service } = createHarness()
    await expect(service.listGroups({ offset: 0, limit: 1 })).resolves.toEqual({
      groups: [{ projectId: "builtin:default-agent-workspace", name: "本地对话", isDefault: true }],
      nextOffset: 1,
    })
    await expect(service.listGroups({ offset: 1, limit: 1 })).resolves.toEqual({
      groups: [{ projectId: "project-1", name: "Project One", isDefault: false }], nextOffset: null,
    })
    await expect(service.listGroups({ query: "project", offset: 0, limit: 50 })).resolves.toMatchObject({
      groups: [{ projectId: "project-1" }], nextOffset: null,
    })
    await expect(service.listGroups({ query: "missing", offset: 0, limit: 50 })).resolves.toEqual({
      groups: [], nextOffset: null,
    })
  })

  it("hands the whole project directory to a consumer that is not paging", async () => {
    // The mobile gateway draws the phone's project picker from this, so it has to be
    // the same list `listGroups` pages over — one answer to "which projects exist",
    // not two that can drift apart.
    const { service } = createHarness()
    await expect(service.listAllGroups()).resolves.toEqual([
      { projectId: "builtin:default-agent-workspace", name: "本地对话", isDefault: true },
      { projectId: "project-1", name: "Project One", isDefault: false },
    ])
    service.dispose()
  })

  it("offers a phone only what it may know about a Provider", async () => {
    const { service } = createHarness()
    await expect(service.listProviderChoices()).resolves.toEqual([
      {
        id: "local-claude-code",
        name: "Local",
        isDefault: true,
        defaultTier: "default",
        models: { default: "Claude Code 默认" },
      },
      {
        id: "custom",
        name: "Custom",
        isDefault: false,
        // Its own best tier is `default`, because it names no sonnet model — which is
        // also the order the desktop's picker would offer them in.
        defaultTier: "default",
        models: { default: "model-one", opus: "model-two" },
      },
    ])
    // Archived is "the user put this away", and a phone must not be offered it —
    // even though this reads the unfiltered source the capability's own list filters.
    const choices = await service.listProviderChoices()
    expect(choices.map((choice) => choice.id)).not.toContain("archived")

    // The harness plants a canary in every place a provider record can hold one. A
    // phone's copy of a Provider names an id, a name and some model names, and there
    // is no field in the projection where any of the rest could arrive.
    const serialized = JSON.stringify(choices)
    expect(serialized).not.toContain("secret-canary")
    expect(serialized).not.toContain("private-url")
    expect(serialized).not.toContain("TOKEN")
    service.dispose()
  })

  it("marks the Provider the desktop itself would use, not merely the active one", async () => {
    /*
     * The two are not the same thing. The desktop's own shortcut resolves the
     * *configured* default first and falls back to the active Provider only when that
     * setting names nothing usable — so a phone that marked the active one would be
     * showing a decision that is not the one the computer is about to make.
     */
    const { service, readDefaultProviderModel } = createHarness()
    readDefaultProviderModel.mockResolvedValueOnce({ providerId: "custom", modelTier: "opus" })

    const choices = await service.listProviderChoices()
    expect(choices.filter((choice) => choice.isDefault).map((choice) => choice.id)).toEqual(["custom"])
    // And the marked row carries the configured tier, not the Provider's own best one.
    expect(choices.find((choice) => choice.id === "custom")?.defaultTier).toBe("opus")

    // With nothing configured, the fallback is the first usable Provider — the same
    // answer the desktop's own resolution gives.
    readDefaultProviderModel.mockResolvedValue(null)
    const fallback = await service.listProviderChoices()
    expect(fallback.filter((choice) => choice.isDefault).map((choice) => choice.id)).toEqual(["local-claude-code"])
    service.dispose()
  })

  it("leaves out a Provider that names no model at all, rather than sending a row with no tier", async () => {
    const { service, listProviders } = createHarness()
    listProviders.mockResolvedValueOnce([
      { id: "empty", name: "Empty", env: {} },
      { id: "custom", name: "Custom", model: "model-one" },
    ] as never)

    const choices = await service.listProviderChoices()
    // It cannot start anything: the desktop's own resolution would find no tier for
    // it, and offering it would put a row on the phone with nothing to name.
    expect(choices.map((choice) => choice.id)).toEqual(["custom"])
    // Every surviving row is usable, which is what lets `defaultTier` be required
    // rather than optional on the wire.
    expect(choices.every((choice) => Object.keys(choice.models).length > 0)).toBe(true)
    service.dispose()
  })

  it("creates in 本地对话 without a selector and returns a target usable by inspect and send", async () => {
    const { service, createConversation, runtime } = createHarness()
    const result = await service.create({ idempotencyKey }, "client")
    expect(createConversation).toHaveBeenCalledWith({ projectId: "builtin:default-agent-workspace", name: undefined })
    const target = await service.resolveTarget({ deepLink: result.deepLink as string })
    expect(target.projectId).toBe("builtin:default-agent-workspace")
    await expect(service.inspect({ ...target, limit: 50 })).resolves.toMatchObject({
      conversation: { controllable: true, conversationRef: result.conversationRef },
    })
    expect(runtime.submitToConversation).not.toHaveBeenCalled()
    await service.send({ ...target, content: "hello", idempotencyKey }, "client")
    expect(runtime.submitToConversation).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello" }), target.conversationId, expect.anything(),
    )
  })

  it.each([
    { projectId: "project-1" },
    { projectName: "Project One" },
    { sameGroupAs: { projectId: "project-1", conversationRef: agentConversationReference("project-1", "conversation-1") } },
    { sameGroupAs: { deepLink: `synapse://threads/${agentConversationReference("project-1", "conversation-1").slice(4)}` } },
  ])("creates in the requested group: %j", async (selector) => {
    const { service, createConversation } = createHarness()
    await service.create({ ...selector, name: "New conversation", idempotencyKey }, "client")
    expect(createConversation).toHaveBeenCalledExactlyOnceWith({ projectId: "project-1", name: "New conversation" })
  })

  it("uses only the group of an external source conversation, without copying its identity or content", async () => {
    const { service, createConversation } = createHarness(conversation("telegram"))
    await service.create({ sameGroupAs: { projectId: "project-1", conversationId: "conversation-1" }, idempotencyKey }, "client")
    expect(createConversation).toHaveBeenCalledExactlyOnceWith({ projectId: "project-1", name: undefined })
  })

  it("rejects missing, ambiguous, and archived groups without creating in the default group", async () => {
    const { service, createConversation, listProjects } = createHarness()
    await expect(service.create({ projectName: "Missing", idempotencyKey }, "client")).rejects.toMatchObject({ code: "group_not_found" })
    listProjects.mockResolvedValue([{ id: "project-1", name: "Same" }, { id: "project-2", name: "Same" }])
    await expect(service.create({ projectName: "Same", idempotencyKey }, "client")).rejects.toMatchObject({ code: "group_ambiguous" })
    listProjects.mockResolvedValue([])
    await expect(service.create({ sameGroupAs: { projectId: "project-1", conversationId: "conversation-1" }, idempotencyKey }, "client")).rejects.toMatchObject({ code: "group_not_found" })
    await expect(service.create({ sameGroupAs: { projectId: "project-1", conversationId: "missing" }, idempotencyKey }, "client")).rejects.toMatchObject({ code: "not_found" })
    expect(createConversation).not.toHaveBeenCalled()
  })

  it("deduplicates concurrent creation and rejects a reused key with changed input", async () => {
    const { service, createConversation } = createHarness()
    const input = { projectName: "Project One", idempotencyKey }
    const results = await Promise.all([service.create(input, "client"), service.create(input, "client")])
    expect(results[0]).toEqual(results[1])
    expect(createConversation).toHaveBeenCalledTimes(1)
    await expect(service.create({ ...input, name: "different" }, "client")).rejects.toMatchObject({ code: "idempotency_conflict" })
    await service.create(input, "other-client")
    expect(createConversation).toHaveBeenCalledTimes(2)
  })

  it("refreshes the sidebar once on creation and does not duplicate creation if notification fails", async () => {
    const { service, eventBus, createConversation } = createHarness()
    const emit = vi.spyOn(eventBus, "emit").mockImplementationOnce(() => { throw new Error("Renderer unavailable") })
    const result = await service.create({ idempotencyKey }, "client")
    await expect(service.create({ idempotencyKey }, "client")).resolves.toEqual(result)
    expect(createConversation).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      domain: "agent", type: "conversationUpdated",
      payload: expect.objectContaining({ projectId: result.projectId, conversationId: "new-1", batchId: expect.any(String) }),
    }))
  })

  it("surfaces creation failures and allows an unchanged request to retry", async () => {
    const { service, createConversation } = createHarness()
    createConversation.mockRejectedValueOnce(new AgentConversationCapabilityError("project_unavailable"))
    await expect(service.create({ idempotencyKey }, "client")).rejects.toMatchObject({ code: "project_unavailable" })
    await expect(service.create({ idempotencyKey }, "client")).resolves.toMatchObject({ created: true })
  })

  it("resolves a raw deep link to the canonical internal conversation target", async () => {
    const entry = conversation()
    const { service } = createHarness(entry)
    const conversationRef = agentConversationReference(entry.projectId, entry.id)
    await expect(service.resolveTarget({
      deepLink: `synapse://threads/${conversationRef.slice("agc_".length)}`,
    })).resolves.toEqual({ projectId: entry.projectId, conversationId: entry.id })
    await expect(service.resolveTarget({
      conversationRef,
    })).resolves.toEqual({ projectId: entry.projectId, conversationId: entry.id })
    await expect(service.resolveTarget({
      deepLink: `synapse://app/agent/open?projectId=${entry.projectId}&conversationId=${encodeURIComponent(entry.id)}`,
    })).rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "invalid_link" })
    await expect(service.resolveTarget({
      projectId: entry.projectId,
      conversationRef: `${conversationRef.slice(0, -1)}A`,
    })).rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "invalid_locator" })
    service.dispose()
  })

  it("reads the visible timeline while removing secrets and internal transport fields", async () => {
    const { service } = createHarness()
    const result = await service.inspect({
      projectId: "project-1",
      conversationId: "conversation-1",
      limit: 50,
    })
    expect(result.conversation).toMatchObject({
      source: "user",
      controllable: true,
      conversationRef: agentConversationReference("project-1", "conversation-1"),
    })
    const serialized = JSON.stringify(result)
    expect(serialized).toContain('"kind":"thinking"')
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain("secret-value")
    expect(serialized).not.toContain("sdk-private")
    expect(serialized).not.toContain("artifact://private")
    expect(serialized).not.toContain('"base64"')
    expect(serialized).not.toContain("A".repeat(1_024))
    service.dispose()
  })

  it("bounds individual timeline items and the complete inspection page", async () => {
    const entry = conversation()
    entry.history = [
      { role: "user", content: "large result", timestamp: "2026-09-12T00:00:00.000Z" },
      ...Array.from({ length: 40 }, (_, index) => ({
        role: "assistant" as const,
        content: `${index}:${"界".repeat(30_000)}`,
        timestamp: "2026-09-12T00:00:01.000Z",
        metadata: { agentEventType: "thinking" },
      })),
    ]
    const { service } = createHarness(entry)
    const result = await service.inspect({
      projectId: "project-1",
      conversationId: "conversation-1",
      limit: 50,
    })
    const timeline = result.timeline as { entries: unknown[] }
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(1024 * 1024)
    for (const item of timeline.entries) {
      expect(Buffer.byteLength(JSON.stringify(item), "utf8")).toBeLessThanOrEqual(64 * 1024)
    }
    service.dispose()
  })

  it("pages every record of a completed oversized turn without a truncatedTurn placeholder", async () => {
    const entry = conversation()
    entry.history = Array.from({ length: 611 }, (_, index) => ({
      role: index === 0 ? "user" : "assistant",
      content: index === 610 ? "Completed all work" : `${index}:` + "记录\n".repeat(3_000),
      timestamp: "2026-09-13T00:00:00.000Z",
    }))
    const original = JSON.stringify(entry.history)
    const { service } = createHarness(entry, {
      getConversationRuntimeSnapshot: vi.fn(() => ({
        lifecycle: "idle", activeTurnId: null, queuedTurns: [], pendingPermissionRequestId: null,
      })),
    })
    let beforeIndex = entry.history.length
    let ids: string[] = []
    while (beforeIndex > 0) {
      const result = await service.inspect({
        projectId: entry.projectId, conversationId: entry.id, limit: 100, beforeIndex,
      })
      const page = result.timeline as {
        entries: { id: string; kind: string; content?: string }[];
        startIndex: number; endIndex: number; total: number; hasMore: boolean; nextBeforeIndex: number | null;
      }
      expect(result.state).toMatchObject({ lifecycle: "idle", activeTurnId: null })
      expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(1024 * 1024)
      expect(page.entries.length).toBeGreaterThan(0)
      expect(page.entries.length).toBeLessThan(100)
      expect(page.startIndex).toBe(beforeIndex - page.entries.length)
      expect(page.endIndex).toBe(beforeIndex)
      expect(page.total).toBe(611)
      expect(page.hasMore).toBe(page.startIndex > 0)
      expect(page.nextBeforeIndex).toBe(page.startIndex > 0 ? page.startIndex : null)
      expect(page.entries.every((item) => item.kind !== "truncatedTurn")).toBe(true)
      if (beforeIndex === 611) expect(page.entries.at(-1)?.content).toBe("Completed all work")
      ids = [...page.entries.map((item) => item.id), ...ids]
      beforeIndex = page.startIndex
    }
    expect(ids).toEqual(Array.from({ length: 611 }, (_, index) => `${entry.id}:history:${index}`))
    expect(JSON.stringify(entry.history)).toBe(original)
    await expect(service.inspect({ projectId: entry.projectId, conversationId: entry.id, limit: 100, beforeIndex: 0 }))
      .resolves.toMatchObject({ timeline: { entries: [], hasMore: false, nextBeforeIndex: null } })
    await expect(service.inspect({ projectId: entry.projectId, conversationId: entry.id, limit: 100, beforeIndex: 612 }))
      .rejects.toMatchObject({ code: "invalid_input" })
    service.dispose()
  })

  it("retains toolUseId on oversized tool result summaries and accepts an existing cursor after append", async () => {
    const entry = conversation()
    entry.history[2]!.metadata = { agentEventType: "toolUse", toolName: "Read", toolUseId: "read-1" }
    entry.history.push({
      role: "tool", content: "正文".repeat(50_000), timestamp: "2026-09-13T00:00:00.000Z",
      metadata: { agentEventType: "toolResult", toolName: "Read", toolUseId: "read-1", success: true },
    })
    const { service } = createHarness(entry)
    const target = { projectId: entry.projectId, conversationId: entry.id, limit: 1 }
    const latest = await service.inspect(target)
    expect(latest.timeline).toMatchObject({
      startIndex: 3, nextBeforeIndex: 3,
      entries: [{ kind: "toolResult", toolUseId: "read-1", truncated: true }],
    })
    entry.history.push({ role: "assistant", content: "done", timestamp: "2026-09-13T00:00:01.000Z" })
    const older = await service.inspect({ ...target, beforeIndex: 3 })
    expect(older.timeline).toMatchObject({
      total: 5, startIndex: 2, endIndex: 3,
      entries: [{ kind: "toolCall", toolUseId: "read-1" }],
    })
    service.dispose()
  })

  it("shrinks pending previews without dropping history and explicitly rejects an oversized envelope", async () => {
    const pending = Array.from({ length: 40 }, (_, index) => ({
      requestId: `request-${index}`, projectId: "project-1", conversationId: "conversation-1",
      sessionKey: "local:renderer", turnId: "turn-1", toolName: "Read",
      toolInput: "记录\n".repeat(5_000), createdAt: "2026-09-13T00:00:00.000Z",
    }))
    const { service, runtime } = createHarness(conversation(), {
      listPendingPermissions: vi.fn(() => pending),
    })
    const target = { projectId: "project-1", conversationId: "conversation-1", limit: 50 }
    const result = await service.inspect(target)
    expect((result.timeline as { entries: unknown[] }).entries).toHaveLength(3)
    expect(result.pending).toEqual(pending.map((item) => ({
      kind: "tool_permission", requestId: item.requestId, turnId: item.turnId, toolName: item.toolName, truncated: true,
    })))
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(1024 * 1024)
    runtime.getConversationRuntimeSnapshot.mockReturnValue({
      lifecycle: "running", activeTurnId: "t".repeat(1024 * 1024), queuedTurns: [], pendingPermissionRequestId: null,
    })
    await expect(service.inspect(target)).rejects.toMatchObject({
      code: "operation_failed", data: { reason: "inspection_page_too_large" },
    })
    service.dispose()
  })

  it("allows reading background conversations but refuses control", async () => {
    const { service } = createHarness(conversation("automation"))
    await expect(service.inspect({
      projectId: "project-1",
      conversationId: "conversation-1",
      limit: 50,
    })).resolves.toMatchObject({ conversation: { source: "automation", controllable: false } })
    await expect(service.send({
      projectId: "project-1",
      conversationId: "conversation-1",
      content: "continue",
      idempotencyKey,
    }, "client-1")).rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({
      code: "control_not_supported",
    })
    service.dispose()
  })

  it("accepts sends asynchronously and deduplicates them per client", async () => {
    const { service, runtime } = createHarness()
    const input = {
      projectId: "project-1",
      conversationId: "conversation-1",
      content: "continue",
      idempotencyKey,
    }
    const first = await service.send(input, "client-1")
    const second = await service.send(input, "client-1")
    expect(first).toEqual(second)
    expect(first).toMatchObject({ accepted: true, disposition: "started", queuePosition: 0 })
    expect(runtime.submitToConversation).toHaveBeenCalledTimes(1)
    await expect(service.send({ ...input, content: "different" }, "client-1"))
      .rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "idempotency_conflict" })
    service.dispose()
  })

  it("observes revision changes without returning timeline bodies", async () => {
    const { service, eventBus } = createHarness()
    const observing = service.observe({
      projectId: "project-1",
      conversationId: "conversation-1",
      afterRevision: 0,
      maxWaitMs: 1_000,
    }, "client-1")
    eventBus.emitInternal({
      domain: "agent",
      type: "phase.update",
      payload: { projectId: "project-1", conversationId: "conversation-1" },
      timestamp: "2026-09-12T00:00:03.000Z",
    })
    await expect(observing).resolves.toMatchObject({
      changed: true,
      revision: 1,
      changeTypes: ["state"],
      historyCount: 3,
    })
    service.dispose()
  })

  it("rejects future watermarks and caps concurrent observers per conversation", async () => {
    const { service } = createHarness()
    await expect(service.observe({
      projectId: "project-1",
      conversationId: "conversation-1",
      afterRevision: 1,
      maxWaitMs: 0,
    }, "client-1")).rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "watermark_ahead" })

    const abort = new AbortController()
    const active = Array.from({ length: 4 }, () => service.observe({
      projectId: "project-1",
      conversationId: "conversation-1",
      afterRevision: 0,
      maxWaitMs: 1_000,
    }, "client-1", abort.signal))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(service.observe({
      projectId: "project-1",
      conversationId: "conversation-1",
      afterRevision: 0,
      maxWaitMs: 1_000,
    }, "client-2")).rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "quota_exceeded" })
    abort.abort()
    await Promise.all(active)
    service.dispose()
  })

  it("rejects stale turn controls and validates complete question answers", async () => {
    const pending = {
      requestId: "request-1",
      projectId: "project-1",
      sessionKey: "secret-session-key",
      conversationId: "conversation-1",
      turnId: "turn-1",
      toolName: "AskUserQuestion",
      questions: [{ question: "Choose", options: [{ label: "A" }, { label: "B" }], multiSelect: false }],
      createdAt: "2026-09-12T00:00:02.000Z",
    }
    const { service, runtime } = createHarness(conversation(), {
      cancelExpectedTurn: vi.fn(async () => ({ status: "turn-changed" as const, turnId: "turn-2" })),
      listPendingPermissions: vi.fn(() => [pending]),
    })
    await expect(service.stop({
      projectId: "project-1",
      conversationId: "conversation-1",
      expectedTurnId: "turn-1",
      idempotencyKey,
    }, "client-1")).rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "turn_changed" })

    await expect(service.respondPermission({
      projectId: "project-1",
      conversationId: "conversation-1",
      expectedTurnId: "turn-1",
      requestId: "request-1",
      idempotencyKey: "07b03ab4-c9a6-4a41-bff8-a6617031013c",
      kind: "user_question",
      decision: "answer",
      answers: [{ questionIndex: 0, values: ["unknown"] }],
    }, "client-1", { kind: "user", id: "user-1" }))
      .rejects.toMatchObject<Partial<AgentConversationCapabilityError>>({ code: "invalid_input" })
    expect(runtime.respondPermission).not.toHaveBeenCalled()

    await expect(service.respondPermission({
      projectId: "project-1",
      conversationId: "conversation-1",
      expectedTurnId: "turn-1",
      requestId: "request-1",
      idempotencyKey: "720ba333-e729-4220-aa45-25fcd6d98222",
      kind: "user_question",
      decision: "answer",
      answers: [{ questionIndex: 0, values: ["A"] }],
    }, "client-1", { kind: "user", id: "user-1" })).resolves.toMatchObject({ responded: true })
    expect(runtime.respondPermission).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1",
      behavior: "allow",
      updatedInput: {
        questions: pending.questions,
        answers: { "question-0": ["A"] },
      },
    }))
    service.dispose()
  })
})
