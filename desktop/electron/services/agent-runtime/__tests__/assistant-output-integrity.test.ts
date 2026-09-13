import { expect, it } from "vitest"
import { AssistantOutputIntegrity } from "../assistant-output-integrity"
const raw = (uuid: string, text: string) => ({ type: "assistant", uuid, parent_tool_use_id: null,
  message: { content: [{ type: "text", text }] } })
it("deduplicates a repeated delivery identity only, preserving identical answers to separate messages", () => {
  const integrity = new AssistantOutputIntegrity()
  expect(integrity.inspect(raw("a", "same"))?.duplicateDelivery).toBe(false)
  expect(integrity.inspect(raw("a", "same"))?.duplicateDelivery).toBe(true)
  expect(integrity.inspect(raw("b", "same"))?.duplicateDelivery).toBe(false)
  expect(integrity.inspect(raw("a", "updated"))?.duplicateDelivery).toBe(false)
})
it("attributes repeated prose and leaked tags to source messages without storing the prose or damaging quotations", () => {
  const integrity = new AssistantOutputIntegrity()
  const paragraph = "A synthetic finding with a stable evidence reference. ".repeat(5)
  const diagnostic = integrity.inspect(raw("loop", `${paragraph}\n\n${paragraph}\n\n${paragraph}\n</think>`))
  expect(diagnostic).toMatchObject({ source: "sdk-assistant-message", repeatedParagraphs: 3, strayThinkingTags: 1 })
  expect(JSON.stringify(diagnostic)).not.toContain("synthetic finding")
  expect(integrity.needsRepair()).toBe(true)
  integrity.inspect(raw("clean", "A clean report with evidence."))
  expect(integrity.needsRepair()).toBe(false)
  integrity.inspect(raw("example", `\`\`\`xml\n</think>\n\`\`\`\n> </think>\nUse \`</think>\` as an example.`))
  expect(integrity.needsRepair()).toBe(false)
})
