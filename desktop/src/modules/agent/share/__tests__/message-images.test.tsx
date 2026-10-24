/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { AgentShareMessageBody } from "../../components/agent-message-event"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"

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
