import { AgentRuntimePanel } from "@/modules/settings/components/agent-runtime-panel"
import { AgentDefaultsContent } from "@/modules/settings/components/agent-defaults-panel"
import { ProviderPanel } from "@/modules/settings/components/provider-panel"
import { AgentAllowedDirectoriesPanel } from "@/modules/settings/components/agent-allowed-directories-panel"

function ClaudeCodePanel() {
  return (
    <div className="flex flex-col gap-2">
      <AgentRuntimePanel>
        <AgentDefaultsContent />
      </AgentRuntimePanel>
      <AgentAllowedDirectoriesPanel />
      <ProviderPanel />
    </div>
  )
}

export { ClaudeCodePanel }
