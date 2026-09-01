import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ModelCoverageView } from "./components/model-coverage-view"
import { PriceRulesView } from "./components/price-rules-view"
import { useModelPriceCoverage, useModelPricePresets, useModelPriceRules } from "./hooks"
import type { ModelPriceCoverageRange, ModelPriceCoverageSource, ModelPriceViewId } from "./types"

const MODEL_PRICE_VIEWS: readonly { readonly id: ModelPriceViewId; readonly label: string }[] = [
  { id: "rules", label: "价格规则" },
  { id: "coverage", label: "模型覆盖" },
]

const SOURCE_OPTIONS: readonly { readonly value: ModelPriceCoverageSource; readonly label: string }[] = [
  { value: "all", label: "全部" },
  { value: "cc", label: "CC" },
  { value: "codex", label: "Codex" },
]

const RANGE_OPTIONS: readonly { readonly value: ModelPriceCoverageRange; readonly label: string }[] = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
  { value: "all", label: "全部" },
]

export function ModelPriceModule() {
  const [view, setView] = useState<ModelPriceViewId>("rules")
  const [source, setSource] = useState<ModelPriceCoverageSource>("all")
  const [range, setRange] = useState<ModelPriceCoverageRange>("30d")
  const [refreshKey, setRefreshKey] = useState(0)
  const [rulesBusy, setRulesBusy] = useState(false)
  const coverageState = useModelPriceCoverage({ source, range, limit: 200 }, refreshKey)
  const rulesState = useModelPriceRules(refreshKey)
  const presetsState = useModelPricePresets(refreshKey)
  const activeLoading = rulesBusy || (view === "coverage" ? coverageState.loading : (rulesState.loading || presetsState.loading))

  const refresh = () => {
    setRefreshKey((current) => current + 1)
  }

  return (
    <SystemAppWindowShell
      tabs={MODEL_PRICE_VIEWS.map((item) => ({ ...item, disabled: rulesBusy }))}
      value={view}
      onValueChange={setView}
      data-track="model-price.view.select"
      actions={(
        <>
          {view === "coverage" ? (
            <>
              <Select value={source} onValueChange={(next) => setSource(next as ModelPriceCoverageSource)} data-track="model-price.coverage.source-select">
                <SelectTrigger size="sm" aria-label="来源">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={range} onValueChange={(next) => setRange(next as ModelPriceCoverageRange)} data-track="model-price.coverage.range-select">
                <SelectTrigger size="sm" aria-label="范围">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : null}
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
        </>
      )}
    >
      <ScrollArea
        data-model-price-scroll-area
        className="h-full min-h-0 min-w-0 max-w-full"
        viewportClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <div data-model-price-content className="min-h-full min-w-0 max-w-full overflow-x-hidden px-3 py-3">
          {view === "coverage" ? <ModelCoverageView state={coverageState} /> : null}
          {view === "rules" ? (
            <PriceRulesView
              state={rulesState}
              presetState={presetsState}
              onBusyChange={setRulesBusy}
              onSaved={refresh}
            />
          ) : null}
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}
