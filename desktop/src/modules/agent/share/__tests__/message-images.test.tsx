/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { AgentShareMessageBody } from "../../components/agent-message-event"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"
import { loadShareContent, shareMessages } from "../messages"

it("includes every user image without thumbnail cropping, attachment paths or interactive controls", () => {
  const item: SynapseAgentMessageTimelineItem = {
    kind: "message", id: "photo-message", role: "user", content: "已隐藏的正文", timestamp: "",
    attachments: [
      ...Array.from({ length: 12 }, (_, index) => ({ kind: "image" as const, id: `photo-${index}`, name: "private@example.com", mimeType: "image/png" as const, byteSize: 4, url: `synapse-agent-artifact://local/p/s/photo-${index}.png` })),
      { kind: "path", path: "/private/report.pdf", name: "report.pdf", entryType: "file" },
    ],
  }
  const node = document.createElement("div")
  node.innerHTML = renderToStaticMarkup(<AgentShareMessageBody item={item} projectId="p" conversationId="c" hideEmails />)
  expect(node.querySelectorAll("img")).toHaveLength(12)
  expect(node.querySelector("img")?.getAttribute("class")).toContain("object-contain")
  expect(node.querySelector("button")).toBeNull()
  expect(node.textContent).toContain("已隐藏的正文")
  expect(node.innerHTML).not.toMatch(/private@example|report.pdf|object-cover|aspect-square/)
})

it("renders image-only messages after the manual share content-loading boundary", async () => {
  const item: SynapseAgentMessageTimelineItem = { kind: "message", id: "photo-message", role: "user", content: "", timestamp: "", attachments: [{ kind: "image", id: "photo", mimeType: "image/png", byteSize: 4, url: "synapse-agent-artifact://local/p/s/photo.png" }] }
  const target = { projectId: "p", conversationId: "c", sessionKey: "s" }
  const messages = await loadShareContent({ getTimelineContentChunk: async () => { throw new Error("unexpected text read") } }, target, shareMessages([item], false), new AbortController().signal)
  const node = document.createElement("div")
  node.innerHTML = renderToStaticMarkup(<AgentShareMessageBody item={messages[0]!} {...target} hideEmails />)
  expect(node.querySelector("img")?.getAttribute("src")).toBe("synapse-agent-artifact://local/p/s/photo.png")
})
