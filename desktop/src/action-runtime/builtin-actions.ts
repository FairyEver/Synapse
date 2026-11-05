import { agentActionManifest, type AgentActionConfig } from "../../action-packages/builtin/agent"
import { AgentConfigForm } from "../../action-packages/builtin/agent/config.renderer"
import { ActionResultView } from "./action-result-view"
import { RendererActionRegistry, type RendererActionDefinition } from "./action-registry"

const agentRendererAction: RendererActionDefinition<AgentActionConfig> = {
  manifest: agentActionManifest,
  summarizeConfig: (config) => {
    const agentLabel = config.agentType === "claude-code" ? "CC/Synapse" : "Codex"
    return `${agentLabel} · ${config.mode}`
  },
  ConfigForm: AgentConfigForm,
  ResultView: ActionResultView,
}

export const rendererActionRegistry = new RendererActionRegistry()
rendererActionRegistry.register(agentRendererAction)
