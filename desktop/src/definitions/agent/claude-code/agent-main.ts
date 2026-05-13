import type { AgentRuntimeDefinition } from "../../main-types"
import { agentBaseDefinition } from "./agent-shared"

export const agentRuntimeDefinition = {
  ...agentBaseDefinition,
  runtimeKind: "claude-agent-sdk",
} satisfies AgentRuntimeDefinition
