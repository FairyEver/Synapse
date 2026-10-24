import { beforeEach, expect, it, vi } from "vitest"
import { AgentShareImageService } from "../agent-share-image-service"

const network = vi.hoisted(() => ({ fetch: vi.fn(), options: undefined as undefined | { beforeRequest: (url: URL) => Promise<void> } }))
vi.mock("../source-acquisition/guarded-fetch-url", () => ({ createGuardedFetchResource: (options: NonNullable<typeof network.options>) => { network.options = options; return network.fetch } }))
const check = vi.fn(), record = vi.fn()
const service = () => new AgentShareImageService({ permissionGuard: { check }, auditSink: { record }, chooseSavePath: vi.fn(), copyPng: vi.fn() })
beforeEach(() => {
  vi.resetAllMocks()
  check.mockResolvedValue({ allowed: true })
  network.fetch.mockImplementation(async (src: string) => {
    await network.options!.beforeRequest(new URL(src))
    return { status: 200, headers: { get: () => "image/png" }, bytes: async () => Buffer.from("89504e470d0a1a0a", "hex"), discard: vi.fn() }
  })
})
it("reads public image bytes without browser CORS and audits every requested origin", async () => {
  await expect(service().readRemoteImage("https://images.example/photo?signature=private", new AbortController().signal)).resolves.toEqual({ dataUrl: "data:image/png;base64,iVBORw0KGgo=" })
  expect(check).toHaveBeenCalledWith(expect.objectContaining({ action: "network.connect", resource: "https://images.example" }))
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed", resource: "https://images.example" }))
  expect(JSON.stringify(record.mock.calls)).not.toContain("private")
  expect(network.options).toMatchObject({ redactUrlDetails: true })
})
it.each(["image/apng", "image/jpg", "image/svg+xml", "image/avif", "image/webp", "image/gif"])("accepts supported browser image MIME %s", async (mime) => {
  network.fetch.mockResolvedValue({ status: 200, headers: { get: () => mime }, bytes: async () => Buffer.from("image"), discardBody: vi.fn() })
  const result = await service().readRemoteImage("https://images.example/photo", new AbortController().signal)
  expect(result.dataUrl).toBe(`data:${mime === "image/jpg" ? "image/jpeg" : mime};base64,aW1hZ2U=`)
})
it.each(["file:///etc/passwd", "synapse-agent-artifact://local/p/s/image.png", "https://user:password@images.example/photo"])("does not use privileged network fallback for %s", async (src) => {
  await expect(service().readRemoteImage(src, new AbortController().signal)).rejects.toThrow()
  expect(network.fetch).not.toHaveBeenCalled()
})
it("stops on denied permission and audits denial", async () => {
  check.mockResolvedValue({ allowed: false })
  await expect(service().readRemoteImage("https://images.example/photo", new AbortController().signal)).rejects.toThrow("权限")
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
})
it("rejects non-image responses and cancels stale reads", async () => {
  network.fetch.mockResolvedValue({ status: 200, headers: { get: () => "text/html" }, discard: vi.fn() })
  await expect(service().readRemoteImage("https://images.example/login", new AbortController().signal)).rejects.toThrow("图片")
  const controller = new AbortController(); controller.abort()
  network.fetch.mockClear()
  await expect(service().readRemoteImage("https://images.example/photo", controller.signal)).rejects.toThrow()
  expect(network.fetch).not.toHaveBeenCalled()
})
