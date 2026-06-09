import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ModelCoverageView } from "./components/model-coverage-view"
import { PriceRulesView } from "./components/price-rules-view"
import { useModelPriceCoverage, useModelPriceRules } from "./hooks"
import type { ModelPriceCoverageRange, ModelPriceCoverageSource, ModelPriceViewId } from "./types"

const MODEL_PRICE_VIEWS: readonly { readonly id: ModelPriceViewId; readonly label: string }[] = [
  { id: "coverage", label: "模型覆盖" },
  { id: "rules", label: "价格规则" },
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
  const [view, setView] = useState<ModelPriceViewId>("coverage")
  const [source, setSource] = useState<ModelPriceCoverageSource>("all")
  const [range, setRange] = useState<ModelPriceCoverageRange>("30d")
  const [refreshKey, setRefreshKey] = useState(0)
  const coverageState = useModelPriceCoverage({ source, range, limit: 200 }, refreshKey)
  const rulesState = useModelPriceRules(refreshKey)
  const activeState = view === "coverage" ? coverageState : rulesState

  const refresh = () => {
    setRefreshKey((current) => current + 1)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-surface">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-sm font-medium">价格</h2>
          <Tabs value={view} onValueChange={(next) => setView(next as ModelPriceViewId)}>
            <TabsList>
              {MODEL_PRICE_VIEWS.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          {view === "coverage" ? (
            <>
              <Select value={source} onValueChange={(next) => setSource(next as ModelPriceCoverageSource)}>
                <SelectTrigger size="sm" aria-label="来源">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={range} onValueChange={(next) => setRange(next as ModelPriceCoverageRange)}>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={activeState.loading}
            aria-busy={activeState.loading}
            onClick={refresh}
          >
            <RefreshCw data-icon="inline-start" className={activeState.loading ? "animate-spin" : undefined} />
            {activeState.loading ? "刷新中" : "刷新"}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1" viewportClassName="min-w-0 max-w-full">
        <div className="min-h-full min-w-full w-0 max-w-full overflow-x-hidden px-2 pb-2 pt-0">
          {view === "coverage" ? <ModelCoverageView state={coverageState} /> : null}
          {view === "rules" ? (
            <PriceRulesView
              state={rulesState}
              onSaved={refresh}
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
