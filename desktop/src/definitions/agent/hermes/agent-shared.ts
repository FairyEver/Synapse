import type { SynapseAgentBaseDefinition } from "../../types"

export const agentBaseDefinition = {
  id: "hermes",
  label: "Hermes",
  order: 30,
  relatedEditorId: "hermes",
  runtime: {
    kind: "local-cli",
    binaries: ["hermes"],
  },
  modes: [
    { key: "default", label: "Default" },
    { key: "yolo", label: "YOLO", unattended: true },
  ],
  commands: [
    { name: "model", description: "Switch model" },
    { name: "skills", description: "Browse skills" },
    { name: "cron", description: "Manage scheduled tasks" },
    { name: "new", description: "Start a new session" },
  ],
  capabilities: {
    chat: true,
    projectContext: true,
    permissions: false,
    mcp: true,
  },
  displayProfile: {
    agentLabel: "Hermes",
    thinkingDefaultCollapsed: true,
    toolDefaultCollapsed: "collapsed",
    toolPreviewLines: 4,
    toolPreviewChars: 800,
    aliases: {},
    tools: {},
    statusLabels: {
      pending: "Pending",
      running: "Running",
      success: "Done",
      error: "Failed",
      denied: "Denied",
    },
  },
} as const satisfies SynapseAgentBaseDefinition
