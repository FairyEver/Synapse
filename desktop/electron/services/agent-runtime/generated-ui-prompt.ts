import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core"
import library from "../../../src/lib/generated-ui-library.json"
import type { AgentSdkSystemPrompt } from "./project-contributions"

const instructions = generateSystemPrompt({
  library: library as unknown as LibrarySpec,
  promptOptions: {
    inlineMode: true, bindings: true, toolCalls: false, editMode: false,
    preamble: "You are continuing the existing Claude Code conversation. Use normal prose for ordinary answers. When a table, chart or form improves the answer, optionally include an interactive UI using the components below.",
    additionalRules: [
      "Put each UI program in an unindented ```openui fenced block. Text outside that block is normal Markdown. Never use openui fences for examples or quoted code. Each block is independent and starts with root = Stack(...).",
      "Use existing agent tools to retrieve real data before rendering it. Never invent query results. Do not generate UI when prose is sufficient; respect the user's requested output format and Persona instructions.",
      "Never use Query, Mutation, @Run, Modal, MarkDownRenderer, InlineMarkdownRenderer, image galleries or image cards. Do not load remote images, favicons or other external resources. Images may only use host-provided synapse-agent-artifact://local/ references.",
      "Use @ToAssistant for submissions and follow-ups. Form values will be sent as the next user turn in this same conversation. Use $variables, @Set and @Reset for local filtering. Do not invent custom actions or tool providers.",
      "Use the official component defaults. Keep layout shallow, avoid nested cards, introductory paragraphs, duplicated labels and decorative text. Keep each UI block under 128 KiB and at most 500 statements.",
    ],
  },
})

export function appendGeneratedUiPrompt(prompt: AgentSdkSystemPrompt): NonNullable<AgentSdkSystemPrompt> {
  if (!prompt) return { type: "preset", preset: "claude_code", append: instructions }
  if (typeof prompt === "string") return `${prompt}\n\n${instructions}`
  if (Array.isArray(prompt)) return [...prompt, instructions]
  if (prompt.type === "custom") return { ...prompt, prompt: Array.isArray(prompt.prompt) ? [...prompt.prompt, instructions] : `${prompt.prompt}\n\n${instructions}` }
  return { ...prompt, append: [prompt.append, instructions].filter(Boolean).join("\n\n") }
}
