import { AgentRuntimePanel } from "@/modules/settings/components/agent-runtime-panel"
import { AgentDefaultsContent } from "@/modules/settings/components/agent-defaults-panel"
import { ProviderPanel } from "@/modules/settings/components/provider-panel"

function ClaudeCodePanel() {
  return (
    <div className="flex flex-col gap-4">
      <AgentRuntimePanel>
        <AgentDefaultsContent />
      </AgentRuntimePanel>
      <ProviderPanel />
    </div>
  )
}

export { ClaudeCodePanel }
