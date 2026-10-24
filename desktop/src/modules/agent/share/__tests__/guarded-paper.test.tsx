/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import { AgentSharePaper } from "../share-paper"
import type { ShareMessage } from "../messages"
import { createShareImageReader } from "../guarded-image"

const ports = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("@/lib/electron-bridge", async (original) => ({
  ...await original<typeof import("@/lib/electron-bridge")>(),
  getSynapseBridge: () => ({ agent: { readShareImageResource: ports.read } }),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.resetAllMocks() })
const identity = { requestId: "r", nonce: "n", projectId: "p", conversationId: "c" }
const settings = { width: 720, scale: 2, redact: true, showModel: true, showTime: true } as const
const assistant = (content: string): ShareMessage => ({ kind: "message", id: "reply", role: "assistant", timestamp: "", content })
function paper(messages: ShareMessage[]) {
  return <AgentSharePaper paperRef={() => undefined} target={identity} messages={messages} settings={settings} indexes={new Map()} renderContext={identity} />
}
function messageImages(node: ParentNode) { return [...node.querySelectorAll("section img")] }

it.each([
  "![photo](https://images.example/photo.png)",
  '<img src="http://127.0.0.1/private.png">',
  '<picture><source srcset="https://images.example/large.png 2x"><img src="https://images.example/photo.png"></picture>',
])("never creates remote image resources before an automatic share is authorized: %s", (content) => {
  const node = document.createElement("div")
  node.innerHTML = renderToStaticMarkup(paper([assistant(content)]))
  expect(messageImages(node)).toHaveLength(0)
  expect(node.querySelectorAll("source, section [srcset]")).toHaveLength(0)
  expect(node.querySelector("[data-agent-render-pending]")).not.toBeNull()
  expect(node.querySelector('link[rel="preload"][href*="images.example"]')).toBeNull()
  expect(ports.read).not.toHaveBeenCalled()
})

it("renders only authorized data URLs and deduplicates automatic Markdown and user images", async () => {
  let resolve!: (value: { dataUrl: string }) => void
  ports.read.mockImplementation(() => new Promise(res => { resolve = res }))
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  const url = "https://images.example/photo.png"
  const user: ShareMessage = { kind: "message", id: "question", role: "user", content: "", timestamp: "", attachments: [{ kind: "image", id: "photo", mimeType: "image/png", byteSize: 4, url }] }
  await act(async () => root!.render(paper([user, assistant(`![photo](${url})`)])))
  expect(messageImages(host)).toHaveLength(0)
  expect(ports.read).toHaveBeenCalledExactlyOnceWith({ url, renderContext: identity })
  await act(async () => { resolve({ dataUrl: "data:image/png;base64,cGl4ZWxz" }) })
  expect(messageImages(host)).toHaveLength(2)
  expect(messageImages(host).every(image => image.getAttribute("src") === "data:image/png;base64,cGl4ZWxz")).toBe(true)
  expect(host.querySelector("[data-agent-render-pending]")).toBeNull()
})

it("keeps rejected automatic images out of the DOM and marks the paper as failed", async () => {
  ports.read.mockRejectedValue(new Error("permission denied"))
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(paper([assistant("![photo](https://images.example/photo.png)")])))
  expect(messageImages(host)).toHaveLength(0)
  expect(host.querySelector("[data-agent-render-error]")).not.toBeNull()
})

it("bounds remote reads to four at a time while sharing cached requests", async () => {
  const pending: ((value: { dataUrl: string }) => void)[] = []
  ports.read.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  const reader = createShareImageReader(identity)
  const requests = Array.from({ length: 6 }, (_, index) => reader.read(`https://images.example/${index}.png`))
  expect(reader.read("https://images.example/0.png")).toBe(requests[0])
  expect(ports.read).toHaveBeenCalledTimes(4)
  pending.splice(0).forEach(resolve => resolve({ dataUrl: "data:image/png;base64,cGl4ZWxz" }))
  await vi.waitFor(() => { expect(ports.read).toHaveBeenCalledTimes(6) })
  pending.splice(0).forEach(resolve => resolve({ dataUrl: "data:image/png;base64,cGl4ZWxz" }))
  await expect(Promise.all(requests)).resolves.toHaveLength(6)
})

it.each([
  '<video src="https://images.example/video.mp4" poster="https://images.example/poster.png"></video>',
  '<audio src="https://images.example/audio.mp3"><source src="https://images.example/source.mp3"></audio>',
  '<iframe src="https://images.example/frame"></iframe><object data="https://images.example/object"></object>',
  '<input type="image" src="https://images.example/button.png">',
])("does not mount other raw HTML network resources during automatic sharing: %s", (content) => {
  const node = document.createElement("div")
  node.innerHTML = renderToStaticMarkup(paper([assistant(content)]))
  for (const resource of node.querySelectorAll("section [src], section [srcset], section [poster], section object[data]")) {
    expect(["src", "srcset", "poster", "data"].some(name => resource.getAttribute(name)?.includes("images.example"))).toBe(false)
  }
})
