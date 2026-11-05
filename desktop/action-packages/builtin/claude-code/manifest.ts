import type { ActionManifest } from "../../types"
import { claudeCodeActionConfigSchema, type ClaudeCodeActionConfig } from "./schema"

export const claudeCodeActionManifest = {
  id: "builtin.claude-code",
  title: "Claude Code",
  permissions: ["agent.spawn"],
  previousOutputs: "none",
  defaultConfig: { projectId: "", prompt: "" },
  configSchema: claudeCodeActionConfigSchema,
  configFields: [
    { name: "projectId", kind: "string", required: true, description: "Target project ID. Uses the current default provider, model and permission mode." },
    { name: "prompt", kind: "string", required: true, description: "Initial prompt passed to a new interactive Claude Code terminal. Supports trigger variables. Success confirms submission, not task completion." },
  ],
} satisfies ActionManifest<ClaudeCodeActionConfig>
