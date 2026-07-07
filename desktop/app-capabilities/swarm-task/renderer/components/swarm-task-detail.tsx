import { Button } from "../../../../src/components/ui/button"
import type { SwarmRun, SwarmTask, SwarmTaskConfig, SwarmWorkerRun } from "../../shared/schema"
import { SwarmRunHistory } from "./swarm-run-history"
import { SwarmRunPanel } from "./swarm-run-panel"
import { SwarmTaskConfigForm } from "./swarm-task-config-form"

export type SwarmTaskTab = "config" | "active" | "history"

type SwarmTaskDetailProps = {
  readonly task: SwarmTask
  readonly activeTab: SwarmTaskTab
  readonly draftConfig: SwarmTaskConfig
  readonly activeRun: SwarmRun | null
  readonly workerRuns: readonly SwarmWorkerRun[]
  readonly runHistory: readonly SwarmRun[]
  readonly loadingRun: boolean
  readonly saving: boolean
  readonly running: boolean
  readonly onDraftConfigChange: (next: SwarmTaskConfig) => void
  readonly onSaveConfig: () => void
  readonly onStartRun: () => void
  readonly onRefreshRun: () => void
  readonly onStopRefill: () => void
  readonly onCancelRun: () => void
  readonly onOpenConversation: (worker: SwarmWorkerRun) => void
}

export function SwarmTaskDetail({
  task,
  activeTab,
  draftConfig,
  activeRun,
  workerRuns,
  runHistory,
  loadingRun,
  saving,
  running,
  onDraftConfigChange,
  onSaveConfig,
  onStartRun,
  onRefreshRun,
  onStopRefill,
  onCancelRun,
  onOpenConversation,
}: SwarmTaskDetailProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{task.name}</div>
          <div className="truncate text-xs text-muted-foreground">{task.currentConfig.workspacePath}</div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "config" ? (
            <Button type="button" variant="outline" onClick={onSaveConfig} disabled={saving}>
              保存
            </Button>
          ) : null}
          <Button type="button" onClick={onStartRun} disabled={running}>
            运行
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === "config" ? (
          <SwarmTaskConfigForm value={draftConfig} onChange={onDraftConfigChange} />
        ) : null}
        {activeTab === "active" ? (
          <SwarmRunPanel
            run={activeRun}
            workers={workerRuns}
            loading={loadingRun}
            onRefresh={onRefreshRun}
            onStopRefill={onStopRefill}
            onCancelRun={onCancelRun}
            onOpenConversation={onOpenConversation}
          />
        ) : null}
        {activeTab === "history" ? (
          <SwarmRunHistory runs={runHistory} onStartRun={onStartRun} />
        ) : null}
      </div>
    </div>
  )
}
