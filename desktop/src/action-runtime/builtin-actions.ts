import { commandActionManifest, type CommandActionConfig } from "../../action-packages/builtin/command"
import { CommandConfigForm } from "../../action-packages/builtin/command/config.renderer"
import { httpRequestActionManifest, type HttpRequestActionConfig } from "../../action-packages/builtin/http-request"
import { HttpRequestConfigForm } from "../../action-packages/builtin/http-request/config.renderer"
import { scriptActionManifest, type ScriptActionConfig } from "../../action-packages/builtin/script"
import { ScriptConfigForm } from "../../action-packages/builtin/script/config.renderer"
import { agentActionManifest, type AgentActionConfig } from "../../action-packages/builtin/agent"
import { AgentConfigForm } from "../../action-packages/builtin/agent/config.renderer"
import { workflowActionManifest, type WorkflowActionConfig } from "../../action-packages/builtin/workflow"
import { WorkflowConfigForm } from "../../action-packages/builtin/workflow/config.renderer"
import { WorkflowActionResultView } from "../../action-packages/builtin/workflow/result.renderer"
import { ActionResultView } from "./action-result-view"
import {
  RendererActionRegistry,
  type RendererActionDefinition,
} from "./action-registry"

const commandRendererAction: RendererActionDefinition<CommandActionConfig> = {
  manifest: commandActionManifest,
  summarizeConfig: (config) => `命令 · ${config.command || "未设置"}`,
  ConfigForm: CommandConfigForm,
  ResultView: ActionResultView,
}

const scriptRendererAction: RendererActionDefinition<ScriptActionConfig> = {
  manifest: scriptActionManifest,
  summarizeConfig: (config) => `脚本 · ${config.shell}`,
  ConfigForm: ScriptConfigForm,
  ResultView: ActionResultView,
}

const httpRequestRendererAction: RendererActionDefinition<HttpRequestActionConfig> = {
  manifest: httpRequestActionManifest,
  summarizeConfig: (config) => `${config.method} · ${config.url || "未设置 URL"}`,
  ConfigForm: HttpRequestConfigForm,
  ResultView: ActionResultView,
}

const agentRendererAction: RendererActionDefinition<AgentActionConfig> = {
  manifest: agentActionManifest,
  summarizeConfig: (config) => {
    const agentLabel = config.agentType === "claude-code" ? "ClaudeCode/Synapse" : "Codex"
    return `${agentLabel} · ${config.mode}`
  },
  ConfigForm: AgentConfigForm,
  ResultView: ActionResultView,
}

const workflowRendererAction: RendererActionDefinition<WorkflowActionConfig> = {
  manifest: workflowActionManifest,
  summarizeConfig: (config) => `工作流 · ${config.workflowId || "未选择"}`,
  ConfigForm: WorkflowConfigForm,
  ResultView: WorkflowActionResultView,
}

export const rendererActionRegistry = new RendererActionRegistry()
rendererActionRegistry.register(commandRendererAction)
rendererActionRegistry.register(scriptRendererAction)
rendererActionRegistry.register(httpRequestRendererAction)
rendererActionRegistry.register(agentRendererAction)
rendererActionRegistry.register(workflowRendererAction)
