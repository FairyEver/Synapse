import { Button } from "../../../../src/components/ui/button"
import { ScrollArea } from "../../../../src/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "../../../../src/components/ui/tabs"
import type { SynapseProjectConfig } from "../../../../src/types/config"
import type { SwarmRun, SwarmTask, SwarmTaskConfig, SwarmWorkerRun } from "../../shared/schema"
import { formatRunMode, formatRunStatus, formatRunTotals, formatTimestamp } from "../swarm-task-format"
import { SwarmRunHistory } from "./swarm-run-history"
import { SwarmRunPanel } from "./swarm-run-panel"
import { SwarmTaskConfigForm } from "./swarm-task-config-form"

export type SwarmTaskTab = "overview" | "config" | "active" | "history"

type SwarmTaskDetailProps = {
  readonly task: SwarmTask
  readonly activeTab: SwarmTaskTab
  readonly onActiveTabChange: (next: SwarmTaskTab) => void
  readonly draftConfig: SwarmTaskConfig
  readonly activeRun: SwarmRun | null
  readonly workerRuns: readonly SwarmWorkerRun[]
  readonly runHistory: readonly SwarmRun[]
  readonly loadingRun: boolean
  readonly saving: boolean
  readonly running: boolean
  readonly projects: readonly SynapseProjectConfig[]
  readonly canSaveConfig: boolean
  readonly canStartRun: boolean
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
  onActiveTabChange,
  draftConfig,
  activeRun,
  workerRuns,
  runHistory,
  loadingRun,
  saving,
  running,
  projects,
  canSaveConfig,
  canStartRun,
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
      <div className="bg-background px-3 py-3 sm:px-5">
        <Tabs
          className="w-full items-center"
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as SwarmTaskTab)}
        >
          <TabsList>
            <TabsTrigger value="overview" onClick={() => onActiveTabChange("overview")}>概览</TabsTrigger>
            <TabsTrigger value="config" onClick={() => onActiveTabChange("config")}>配置</TabsTrigger>
            <TabsTrigger value="active" onClick={() => onActiveTabChange("active")}>运行</TabsTrigger>
            <TabsTrigger value="history" onClick={() => onActiveTabChange("history")}>历史</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "overview" ? (
          <ScrollArea className="h-full min-h-0 min-w-0">
            <SwarmTaskOverview task={task} run={activeRun} projects={projects} />
          </ScrollArea>
        ) : null}
        {activeTab === "config" ? (
          <div className="flex h-full min-h-0 flex-col">
            <ScrollArea className="min-h-0 min-w-0 flex-1">
              <SwarmTaskConfigForm
                value={draftConfig}
                projects={projects}
                onChange={onDraftConfigChange}
              />
            </ScrollArea>
            <div className="shrink-0 border-t bg-background px-3 py-3 sm:px-5">
              <div className="mx-auto flex w-full max-w-3xl flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button type="button" variant="outline" onClick={onSaveConfig} disabled={saving || !canSaveConfig}>
                  保存配置
                </Button>
                <Button type="button" onClick={onStartRun} disabled={running || !canStartRun}>
                  运行任务
                </Button>
              </div>
            </div>
          </div>
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

function SwarmTaskOverview({
  task,
  run,
  projects,
}: {
  readonly task: SwarmTask
  readonly run: SwarmRun | null
  readonly projects: readonly SynapseProjectConfig[]
}) {
  const config = task.currentConfig
  const project = projects.find((item) => item.id === config.projectId)
  const projectName = project?.name ?? (config.projectId ? "项目不可用" : "未选择项目")

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-3 pb-3 sm:px-5 sm:pb-5">
      <section className="rounded-lg border bg-card p-4 text-sm">
        <h3 className="mb-3 text-sm font-medium">当前任务</h3>
        <InfoGrid
          items={[
            ["名称", task.name],
            ["状态", formatRunStatus(task.lastStatus)],
            ["项目", projectName],
            ["运行模式", formatRunMode(config.runMode)],
            ["并发", String(config.concurrency)],
            ["轮次", String(config.maxRounds)],
            ...(config.promptInjection.fileWrite.enabled
              ? [["文件", config.promptInjection.fileWrite.path]] as ReadonlyArray<readonly [string, string]>
              : []),
          ]}
        />
      </section>

      <section className="rounded-lg border bg-card p-4 text-sm">
        <h3 className="mb-3 text-sm font-medium">最近运行</h3>
        {run ? (
          <InfoGrid
            items={[
              ["状态", formatRunStatus(run.status)],
              ["统计", formatRunTotals(run)],
              ["开始", formatTimestamp(run.startedAt)],
              ["结束", formatTimestamp(run.finishedAt)],
            ]}
          />
        ) : (
          <div className="text-sm text-muted-foreground">暂无运行</div>
        )}
      </section>
    </div>
  )
}

function InfoGrid({ items }: { readonly items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-foreground tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
