import type { ActionManifest } from "../../types"
import { claudeCodeActionConfigSchema, type ClaudeCodeActionConfig } from "./schema"

export const claudeCodeActionManifest = {
  id: "builtin.claude-code",
  title: "Claude Code",
  permissions: ["agent.spawn"],
  previousOutputs: "none",
  defaultConfig: { projectId: "", prompt: "", singleRun: false },
  configSchema: claudeCodeActionConfigSchema,
  configFields: [
    { name: "projectId", kind: "string", required: true, description: "Target project ID. Uses the current default provider, model and permission mode." },
    { name: "prompt", kind: "string", required: true, description: "Initial prompt passed to a new Claude Code terminal. Supports trigger variables. Success confirms submission, not task completion." },
    { name: "singleRun", kind: "boolean", required: false, description: "Run Claude Code in native print mode and close this terminal when the CLI exits. Defaults to false (interactive; keeps the terminal open after responding). Does not change trigger frequency or submission-based success." },
  ],
} satisfies ActionManifest<ClaudeCodeActionConfig>
