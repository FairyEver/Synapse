import type { SynapseAgentBaseDefinition } from "../../types"

export const agentBaseDefinition = {
  id: "claude-code",
  label: "Claude Code",
  order: 10,
  relatedEditorId: "claude-code",
  runtime: {
    kind: "local-cli",
    binaries: ["claude"],
  },
  modes: [
    { key: "default", label: "Default" },
    { key: "acceptEdits", label: "Accept Edits" },
    { key: "plan", label: "Plan" },
    { key: "auto", label: "Auto" },
    { key: "bypassPermissions", label: "Bypass Permissions" },
    { key: "dontAsk", label: "Don't Ask" },
  ],
  capabilities: {
    chat: true,
    projectContext: true,
    permissions: true,
    mcp: true,
  },
} as const satisfies SynapseAgentBaseDefinition
