import { EventEmitter } from "node:events"
import https from "node:https"
import { Readable } from "node:stream"
import { afterEach, expect, it, vi } from "vitest"
import { fetchRemoteImage } from "../body-resources"
import { MailError } from "../../shared/types"

const png = Buffer.from("89504e470d0a1a0a", "hex")
const fakeLookup = async () => [{ address: "198.18.0.26", family: 4 }]
const options = (lookup = fakeLookup) => ({ allowed: true, signal: new AbortController().signal, authorize: vi.fn(async (_origin: string) => undefined), lookup })
type Reply = { statusCode: number; headers: Record<string, string | undefined>; body: Buffer | string }
function network(reply: (options: https.RequestOptions) => Reply) {
  return vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions, callback: (response: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), { end() {
      const result = reply(options)
      queueMicrotask(() => callback(Object.assign(Readable.from([result.body]), result)))
    }, destroy() { return req } })
    return req
  }) as typeof https.request)
}
function dnsReply(options: https.RequestOptions, address = "93.184.216.34"): Reply {
  const type = new URL(String(options.path), "https://dns.alidns.com").searchParams.get("type")
  return { statusCode: 200, headers: {}, body: JSON.stringify({ Status: 0, Answer: type === "A" ? [{ type: 1, data: address }] : [] }) }
}
afterEach(() => vi.restoreAllMocks())

it("resolves Fake-IP through authorized pinned HTTPS DNS and connects only to the real public IP", async () => {
  const settings = options()
  const request = network(input => {
    if (input.hostname === "223.5.5.5") {
      expect(settings.authorize).toHaveBeenCalledWith("https://dns.alidns.com")
      expect(input).toMatchObject({ servername: "dns.alidns.com", headers: { Host: "dns.alidns.com" }, agent: false })
      return dnsReply(input)
    }
    expect(input).toMatchObject({ hostname: "93.184.216.34", servername: "images.example", headers: { Host: "images.example" }, agent: false })
    return { statusCode: 200, headers: {}, body: png }
  })
  await expect(fetchRemoteImage("https://images.example/a", settings)).resolves.toEqual({ bytes: png, mime: "image/png" })
  expect(request).toHaveBeenCalledTimes(3)
})

it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "198.18.0.1"])("blocks restricted HTTPS DNS answer %s", async address => {
  const request = network(input => dnsReply(input, address))
  await expect(fetchRemoteImage("https://images.example/a", options())).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.every(([input]) => (input as https.RequestOptions).hostname === "223.5.5.5")).toBe(true)
})

it.each(["https://198.18.0.1/a", "https://198.19.255.255/a", "https://127.0.0.1/a", "https://[::1]/a"])("does not use DNS fallback to allow literal address %s", async url => {
  const request = network(() => { throw new Error("Unexpected request") })
  await expect(fetchRemoteImage(url, options())).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(request).not.toHaveBeenCalled()
})

it("rejects mixed fake and private system DNS answers before using public DNS", async () => {
  const request = network(() => { throw new Error("Unexpected request") })
  await expect(fetchRemoteImage("https://images.example/a", options(async () => [{ address: "198.18.0.26", family: 4 }, { address: "192.168.1.1", family: 4 }]))).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(request).not.toHaveBeenCalled()
})

it("does not use public DNS for ordinary public addresses", async () => {
  const request = network(() => ({ statusCode: 200, headers: {}, body: png }))
  await expect(fetchRemoteImage("https://images.example/a", options(async () => [{ address: "93.184.216.34", family: 4 }]))).resolves.toMatchObject({ mime: "image/png" })
  expect(request).toHaveBeenCalledTimes(1)
})

it("rechecks a redirected fake hostname and blocks its real private address", async () => {
  const request = network(input => {
    if (input.hostname === "223.5.5.5") return dnsReply(input, String(input.path).includes("internal.example") ? "10.0.0.1" : "93.184.216.34")
    return { statusCode: 302, headers: { location: "https://internal.example/a" }, body: "" }
  })
  await expect(fetchRemoteImage("https://images.example/a", options())).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(request.mock.calls.filter(([input]) => (input as https.RequestOptions).hostname !== "223.5.5.5")).toHaveLength(1)
})

it.each([
  { statusCode: 302, headers: { location: "http://127.0.0.1/a" }, body: "" },
  { statusCode: 500, headers: {}, body: "" },
  { statusCode: 200, headers: {}, body: "{" },
  { statusCode: 200, headers: {}, body: JSON.stringify({ Status: 3 }) },
  { statusCode: 200, headers: {}, body: "x".repeat(65537) },
])("fails closed for invalid DNS responses %#", async reply => {
  const request = network(() => reply)
  await expect(fetchRemoteImage("https://images.example/a", options())).rejects.toMatchObject({ code: "IMAGE_FAILED" })
  expect(request.mock.calls.every(([input]) => (input as https.RequestOptions).hostname === "223.5.5.5")).toBe(true)
})

it("makes no fallback request if DNS permission is denied", async () => {
  const settings = options()
  settings.authorize.mockImplementation(async origin => { if (origin === "https://dns.alidns.com") throw new MailError("PERMISSION_DENIED", "denied") })
  const request = network(() => { throw new Error("Unexpected request") })
  await expect(fetchRemoteImage("https://images.example/a", settings)).rejects.toMatchObject({ code: "PERMISSION_DENIED" })
  expect(settings.authorize).toHaveBeenCalledWith("https://dns.alidns.com")
  expect(request).not.toHaveBeenCalled()
})

it.each(["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks private IPv6 DNS answer %s even with a public A record", async address => {
  const request = network(input => String(input.path).includes("AAAA")
    ? { statusCode: 200, headers: {}, body: JSON.stringify({ Status: 0, Answer: [{ type: 28, data: address }] }) }
    : dnsReply(input))
  await expect(fetchRemoteImage("https://images.example/a", options())).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(request).toHaveBeenCalledTimes(2)
})

it("fails closed when neither DNS family has an address", async () => {
  const request = network(() => ({ statusCode: 200, headers: {}, body: JSON.stringify({ Status: 0 }) }))
  await expect(fetchRemoteImage("https://images.example/a", options())).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(request).toHaveBeenCalledTimes(2)
})

it("cancels an in-flight DNS request without connecting to the image", async () => {
  const controller = new AbortController()
  let destroyed = false
  const request = vi.spyOn(https, "request").mockImplementation(((input: https.RequestOptions) => {
    const req = Object.assign(new EventEmitter(), {
      end() { input.signal?.addEventListener("abort", () => { destroyed = true; req.emit("error", new Error("aborted")) }, { once: true }); controller.abort() },
      destroy() { return req },
    })
    return req
  }) as typeof https.request)
  await expect(fetchRemoteImage("https://images.example/a", { ...options(), signal: controller.signal })).rejects.toMatchObject({ code: "IMAGE_FAILED" })
  expect(destroyed).toBe(true)
  expect(request).toHaveBeenCalledTimes(1)
})
