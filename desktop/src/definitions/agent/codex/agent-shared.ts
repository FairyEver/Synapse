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
  displayProfile: {
    agentLabel: "Codex",
    thinkingDefaultCollapsed: true,
    toolDefaultCollapsed: "auto",
    toolPreviewLines: 6,
    toolPreviewChars: 1200,
    aliases: {
      Bash: "Bash",
      FileChange: "File change",
      read_file: "Read file",
      apply_patch: "Apply patch",
    },
    tools: {
      Bash: { defaultCollapsed: "auto", previewLines: 8, previewChars: 1600 },
      FileChange: { defaultCollapsed: "expanded", previewLines: 12, previewChars: 2000 },
      read_file: { defaultCollapsed: "collapsed", previewLines: 6, previewChars: 1200 },
    },
    statusLabels: {
      pending: "Pending",
      running: "Running",
      success: "Done",
      error: "Failed",
      denied: "Denied",
    },
  },
} as const satisfies SynapseAgentBaseDefinition
