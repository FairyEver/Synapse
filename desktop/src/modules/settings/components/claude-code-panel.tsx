import { useState } from "react"
import { AgentRuntimePanel } from "@/modules/settings/components/agent-runtime-panel"
import { AgentDefaultsContent } from "@/modules/settings/components/agent-defaults-panel"
import { ProviderPanel } from "@/modules/settings/components/provider-panel"

function ClaudeCodePanel() {
  const [providerRefreshKey, setProviderRefreshKey] = useState(0)

  return (
    <div className="flex flex-col gap-4">
      <AgentRuntimePanel onRefresh={() => setProviderRefreshKey((value) => value + 1)}>
        <AgentDefaultsContent />
      </AgentRuntimePanel>
      <ProviderPanel refreshKey={providerRefreshKey} />
    </div>
  )
}

export { ClaudeCodePanel }
