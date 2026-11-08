import { webhookForwardActionManifest } from "../../action-packages/builtin/webhook-forward/manifest"
import { WebhookForwardConfigForm } from "../../action-packages/builtin/webhook-forward/config.renderer"
import type { WebhookForwardActionConfig } from "../../action-packages/builtin/webhook-forward/schema"
import { Bot, SquareTerminal, Send } from "lucide-react"

import { agentActionManifest, type AgentActionConfig } from "../../action-packages/builtin/agent"
import { AgentConfigForm } from "../../action-packages/builtin/agent/config.renderer"
import { claudeCodeActionManifest, type ClaudeCodeActionConfig } from "../../action-packages/builtin/claude-code"
import { ClaudeCodeConfigForm } from "../../action-packages/builtin/claude-code/config.renderer"
import { ClaudeCodeResultView } from "../../action-packages/builtin/claude-code/result.renderer"
import { terminalActionManifest, type TerminalActionConfig } from "../../action-packages/builtin/terminal"
import { TerminalConfigForm } from "../../action-packages/builtin/terminal/config.renderer"
import { TerminalResultView } from "../../action-packages/builtin/terminal/result.renderer"
import { ActionResultView } from "./action-result-view"
import { RendererActionRegistry, type RendererActionDefinition } from "./action-registry"
import { permissionModeLabels } from "@/modules/agent/permission-mode-options"

const agentRendererAction: RendererActionDefinition<AgentActionConfig> = {
  manifest: agentActionManifest,
  icon: Bot,
  summarizeConfig: (config) => {
    const agentLabel = config.agentType === "claude-code" ? "CC/Synapse" : "Codex"
    return `${agentLabel} · ${permissionModeLabels[config.mode]}`
  },
  ConfigForm: AgentConfigForm,
  ResultView: ActionResultView,
}

export const rendererActionRegistry = new RendererActionRegistry()
rendererActionRegistry.register(agentRendererAction)
rendererActionRegistry.register<ClaudeCodeActionConfig>({
  manifest: claudeCodeActionManifest,
  icon: SquareTerminal,
  summarizeConfig: () => "默认设置",
  ConfigForm: ClaudeCodeConfigForm,
  ResultView: ClaudeCodeResultView,
})
rendererActionRegistry.register<TerminalActionConfig>({
  manifest: terminalActionManifest,
  icon: SquareTerminal,
  summarizeConfig: config => config.command.split(/\r?\n/, 1)[0]!,
  ConfigForm: TerminalConfigForm,
  ResultView: TerminalResultView,
})

rendererActionRegistry.register<WebhookForwardActionConfig>({
  manifest: webhookForwardActionManifest, icon: Send,
  summarizeConfig: config => new URL(config.url).origin,
  ConfigForm: WebhookForwardConfigForm, ResultView: ActionResultView,
})
