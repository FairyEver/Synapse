import type { SynapseAgentBaseDefinition } from "../../types"

export const agentBaseDefinition = {
  id: "codex",
  label: "Codex",
  order: 20,
  relatedEditorId: "codex",
  runtime: {
    kind: "local-cli",
    binaries: ["codex"],
  },
  modes: [
    { key: "suggest", label: "Suggest" },
    { key: "auto-edit", label: "Auto Edit" },
    { key: "full-auto", label: "Full Auto" },
    { key: "yolo", label: "YOLO" },
  ],
  capabilities: {
    chat: true,
    projectContext: true,
    permissions: true,
    mcp: true,
  },
} as const satisfies SynapseAgentBaseDefinition
