import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { JsonNamespace, ManagedAssetStore, type ConversationEntryV1 } from "../../../../electron/runtime/data-repo"
import { AgentShareService } from "../share-service"
import type { ShareImageRecord } from "../../../../electron/runtime/data-repo/schemas/agent-share"
import type { ShareRenderRequest } from "../../shared/share"
import { DEFAULT_AGENT_SHARE_SETTINGS } from "../../../../src/types/agent-share"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII="
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-share-test-")); roots.push(root)
  const conversations = new JsonNamespace<ConversationEntryV1>({ name: "conversations", schemaVersion: 1, backend: "json", filePath: path.join(root, "conversations.json") })
  const images = new JsonNamespace<ShareImageRecord>({ name: "app.agent.share-images", schemaVersion: 1, backend: "json", filePath: path.join(root, "images.json") })
  await conversations.upsert({ id: "c", projectId: "p", schemaVersion: 1, platform: "local-renderer", sessionKey: "s", createdAt: "now", updatedAt: "now", history: [
    { role: "user", content: "问题", timestamp: "now" }, { role: "assistant", content: "回答", timestamp: "now" }, { role: "user", content: "分享", timestamp: "now" },
  ] } as ConversationEntryV1)
  const events: ShareRenderRequest[] = []
  const output = vi.fn(async () => ({ success: true }))
  const assets = new ManagedAssetStore(path.join(root, "assets"))
  const dependencies: ConstructorParameters<typeof AgentShareService>[0] = { conversations, images, assets,
    emit: request => { events.push(request) }, changed: vi.fn(), rendererAlive: () => true,
    check: async () => ({ allowed: true }), audit: vi.fn(), output,
    readUiState: async () => ({ revision: 0, state: {}, readOnly: true }), logger: { warn: vi.fn() },
  }
  const service = new AgentShareService(dependencies)
  const ref = await service.createContext({ projectId: "p", conversationId: "c", turnId: "turn", rendererId: 4 })
  const context = { actor: { kind: "agent" as const, id: "test" }, clientId: "test" }
  const generate = () => service.generate({ shareContextRef: ref, selection: "all", settings: DEFAULT_AGENT_SHARE_SETTINGS, idempotencyKey: "53160124-bebf-42f8-a276-3799ed6b7941" }, context)
  return { root, dependencies, service, assets, images, conversations, events, ref, context, generate, output }
}
describe("AgentShareService", () => {
  it("waits for the exact renderer response and persists one image across retries", async () => {
    const h = await setup()
    const task = h.generate(), duplicate = h.generate()
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    const request = h.events[0]!
    expect(request.messages.map(m => m.content)).toEqual(["问题", "回答"])
    await expect(h.service.complete(9, { ...request, pngBase64: png })).rejects.toThrow()
    await h.service.complete(4, { ...request, pngBase64: png })
    const result = await task
    expect(await duplicate).toEqual(result)
    expect(result).toMatchObject({ width: 1, height: 1, messageRefs: expect.any(Array) })
    expect(await h.generate()).toEqual(result)
    expect(h.events).toHaveLength(1)
    expect((await h.service.readImage(result.shareImageRef, h.context)).bytes.toString("base64")).toBe(png)
    expect((await h.service.list("p", "c"))).toHaveLength(1)
    h.service.dispose()
  })
  it("rejects late responses after cancellation and creates no image", async () => {
    const h = await setup(), controller = new AbortController()
    const task = h.service.generate({ shareContextRef: h.ref, selection: "all", settings: DEFAULT_AGENT_SHARE_SETTINGS, idempotencyKey: "53160124-bebf-42f8-a276-3799ed6b7941" }, { ...h.context, abortSignal: controller.signal })
    const rejection = expect(task).rejects.toThrow()
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    controller.abort(); await rejection
    await expect(h.service.complete(4, { ...h.events[0]!, pngBase64: png })).rejects.toThrow()
    expect(await h.service.list("p", "c")).toEqual([])
    h.service.dispose()
  })
  it("keeps the generated image after output failure and removes it with its conversation", async () => {
    const h = await setup(), task = h.generate()
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    await h.service.complete(4, { ...h.events[0]!, pngBase64: png })
    const image = await task
    h.output.mockRejectedValueOnce(new Error("clipboard failed"))
    await expect(h.service.output({ shareImageRef: image.shareImageRef, action: "copy" }, h.context)).rejects.toThrow("clipboard")
    expect(await h.service.list("p", "c")).toHaveLength(1)
    await h.service.removeConversation("c")
    await expect(h.service.readImage(image.shareImageRef, h.context)).rejects.toThrow()
    h.service.dispose()
  })
  it("rejects changed source and cleans removed projects without deleting conversations", async () => {
    const h = await setup(), task = h.generate()
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    await h.service.complete(4, { ...h.events[0]!, pngBase64: png })
    await task
    await h.service.removeProject("p")
    expect(await h.service.list("p", "c")).toEqual([])
    expect(await h.conversations.get("c")).not.toBeNull()
    await expect(h.service.messages({ shareContextRef: h.ref }, h.context)).rejects.toThrow()
    h.service.dispose()
  })

  it("does not recover a staged asset belonging to a live generation", async () => {
    const h = await setup()
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const put = h.assets.put.bind(h.assets)
    vi.spyOn(h.assets, "put").mockImplementation(async (...args) => { await barrier; return put(...args) })
    const task = h.generate()
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    await h.service.complete(4, { ...h.events[0]!, pngBase64: png })
    await vi.waitFor(() => expect(h.assets.put).toHaveBeenCalled())
    await h.service.recover()
    expect(await h.images.list()).toHaveLength(1)
    release()
    const image = await task
    expect((await h.service.readImage(image.shareImageRef, h.context)).bytes.toString("base64")).toBe(png)
    h.service.dispose()
  })

  it("reopens persisted image metadata and bytes after service restart", async () => {
    const h = await setup(), task = h.generate()
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    await h.service.complete(4, { ...h.events[0]!, pngBase64: png })
    const image = await task
    h.service.dispose()
    const recovered = new AgentShareService({ ...h.dependencies,
      conversations: new JsonNamespace<ConversationEntryV1>({ name: "conversations", schemaVersion: 1, backend: "json", filePath: path.join(h.root, "conversations.json") }),
      images: new JsonNamespace<ShareImageRecord>({ name: "app.agent.share-images", schemaVersion: 1, backend: "json", filePath: path.join(h.root, "images.json") }),
      assets: new ManagedAssetStore(path.join(h.root, "assets")),
    })
    try {
      await recovered.recover()
      expect(await recovered.list("p", "c")).toEqual([image])
      expect((await recovered.readImage(image.shareImageRef, h.context)).bytes.toString("base64")).toBe(png)
    } finally { recovered.dispose() }
  })
  it("rejects a changed history prefix and checks read permission before returning any excerpts", async () => {
    const h = await setup()
    const source = (await h.conversations.get("c"))!
    source.history[0]!.content = "changed"
    await h.conversations.upsert(source)
    await expect(h.service.messages({ shareContextRef: h.ref }, h.context)).rejects.toThrow("历史已变化")
    h.dependencies.check = async () => ({ allowed: false })
    await expect(h.service.messages({ shareContextRef: h.ref }, h.context)).rejects.toThrow("权限")
    h.service.dispose()
  })

})
