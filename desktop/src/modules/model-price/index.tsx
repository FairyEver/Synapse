import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PriceRulesView } from "./components/price-rules-view"
import { useModelPricePresets, useModelPriceRules } from "./hooks"

export function ModelPriceModule() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [rulesBusy, setRulesBusy] = useState(false)
  const rulesState = useModelPriceRules(refreshKey)
  const presetsState = useModelPricePresets(refreshKey)
  const activeLoading = rulesBusy || rulesState.loading || presetsState.loading

  const refresh = () => {
    setRefreshKey((current) => current + 1)
  }

  return (
    <SystemAppWindowShell
      actions={(
        <SystemAppTopBarActionButton
          data-track="model-price.refresh"
          type="button"
          disabled={activeLoading}
          aria-busy={activeLoading}
          onClick={refresh}
        >
          <RefreshCw data-icon="inline-start" className={activeLoading ? "animate-spin" : undefined} />
          {activeLoading ? "刷新中" : "刷新"}
        </SystemAppTopBarActionButton>
      )}
    >
      <ScrollArea
        data-model-price-scroll-area
        className="h-full min-h-0 min-w-0 max-w-full"
        viewportClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <div data-model-price-content className="min-h-full min-w-0 max-w-full overflow-x-hidden px-3 py-3">
          <PriceRulesView
            state={rulesState}
            presetState={presetsState}
            onBusyChange={setRulesBusy}
            onSaved={refresh}
          />
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}
