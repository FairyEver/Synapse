import type { ActionManifest } from "../../types"
import { agentActionConfigSchema, type AgentActionConfig } from "./schema"
import { SYNAPSE_AGENT_PERMISSION_MODES } from "../../../src/types/agent"

export const agentActionManifest = {
  id: "builtin.agent",
  title: "Agent",
  permissions: ["agent.spawn"],
  defaultConfig: {
    projectId: "",
    agentType: "claude-code",
    providerId: "",
    modelTier: "sonnet",
    mode: "bypassPermissions",
    prompt: "",
    sessionPolicy: "fresh",
    timeoutMins: 30,
  },
  configFields: [
    {
      name: "projectId",
      kind: "string",
      required: true,
      description: "Target project ID.",
    },
    {
      name: "agentType",
      kind: "enum",
      required: true,
      description: "Agent type to use.",
      choices: ["claude-code"],
      defaultValue: "claude-code",
    },
    {
      name: "providerId",
      kind: "string",
      required: true,
      description: "Provider ID.",
    },
    {
      name: "modelTier",
      kind: "enum",
      required: true,
      description: "Model tier.",
      choices: ["default", "haiku", "sonnet", "opus"],
      defaultValue: "sonnet",
    },
    {
      name: "mode",
      kind: "enum",
      required: true,
      description: "Agent permission mode.",
      choices: SYNAPSE_AGENT_PERMISSION_MODES,
      defaultValue: "bypassPermissions",
    },
    {
      name: "prompt",
      kind: "string",
      required: true,
      description: "Prompt to send to the agent.",
    },
    {
      name: "sessionPolicy",
      kind: "enum",
      required: true,
      description: "Session lifecycle policy.",
      choices: ["fresh", "resume"],
      defaultValue: "fresh",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes (1-120). Null disables.",
      defaultValue: 30,
    },
  ],
  configSchema: agentActionConfigSchema,
} satisfies ActionManifest<AgentActionConfig>
