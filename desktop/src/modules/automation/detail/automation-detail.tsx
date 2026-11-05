import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Pencil, Play, Power, RefreshCw, Zap } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { sanitizeUrl } from "@/lib/url-sanitize"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { AutomationItem } from "@/types/automation"
import { AutomationRunsPanel } from "../components/automation-runs-dialog"
import type { AutomationEditorStep } from "../types"
import { formatAutomationExecutor, formatAutomationExecutorType, formatAutomationNextRun, formatAutomationScope, formatAutomationTrigger, formatAutomationTriggerType } from "../utils"
import { buildAutomationConfigurationFields } from "./configuration-fields"

type AutomationDetailProps = {
  readonly item: AutomationItem
  readonly initialTab?: "config" | "history"
  readonly busy: boolean
  readonly missing?: boolean
  readonly error: string | null
  readonly onBack: () => void
  readonly onEdit: (step?: AutomationEditorStep) => void
  readonly onToggleEnabled: (enabled: boolean) => void
  readonly onStopRun: (runId: string) => Promise<void>
  readonly onRefresh: () => void
}

export function AutomationDetail({ item, initialTab = "config", busy, missing, error, onBack, onEdit, onToggleEnabled, onStopRun, onRefresh }: AutomationDetailProps) {
  const { config } = useAppConfig()
  const [tab, setTab] = useState(initialTab)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [item.id])
  const projects = config.global.projects
  const TriggerIcon = rendererAutomationTriggerRegistry.list().find(trigger => trigger.manifest.id === item.trigger.type)?.icon ?? Zap
  const ExecutorIcon = rendererActionRegistry.list().find(action => action.manifest.id === item.executor.type)?.icon ?? Play
  const displayItem = typeof item.executor.config.url === "string"
    ? { ...item, executor: { ...item.executor, config: { ...item.executor.config, url: sanitizeUrl(item.executor.config.url) } } }
    : item
  const sections = [
    { key: "trigger", title: "触发条件", type: formatAutomationTriggerType(item), summary: formatAutomationTrigger(item), fields: buildAutomationConfigurationFields(item.trigger.config, projects), icon: <TriggerIcon /> },
    { key: "executor", title: "执行操作", type: formatAutomationExecutorType(item), summary: formatAutomationExecutor(displayItem), fields: buildAutomationConfigurationFields(item.executor.config, projects), icon: <ExecutorIcon /> },
  ] as const
  const backAction = <SystemAppTopBarActionButton iconOnly aria-label="返回自动化列表" tooltip="返回列表" onClick={onBack}><ArrowLeft /></SystemAppTopBarActionButton>
  return (
    <SystemAppWindowShell headerMode="replace" left={backAction}>
      <ScrollArea className="h-full min-h-0" viewportClassName="overflow-x-hidden">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8" data-layout="automation-detail">
          <div className="mb-7 flex min-w-0 flex-wrap items-start justify-between gap-4">
            <h1 ref={heading} tabIndex={-1} className="min-w-0 wrap-anywhere text-2xl font-semibold">{item.name}</h1>
            {!missing ? <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{item.enabled ? "已启用" : "未启用"}</Badge>
              <Button variant="outline" disabled={busy} onClick={() => onEdit()}><Pencil />编辑</Button>
              <Button variant="ghost" disabled={busy || item.validation?.status === "needs_update"} onClick={() => onToggleEnabled(!item.enabled)}><Power />{item.enabled ? "停用" : "启用"}</Button>
            </div> : null}
          </div>
          {missing ? <p role="alert" className="text-sm text-muted-foreground">自动化不存在</p> : <>
            {error ? <div className="mb-5 flex items-center gap-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={onRefresh}><RefreshCw />重试</Button></div> : null}
            {item.validation?.status === "needs_update" ? <p role="alert" className="mb-5 text-sm text-destructive">配置需要更新，请编辑后保存。</p> : null}
            <Tabs value={tab} onValueChange={value => setTab(value as "config" | "history")}>
              <TabsList variant="line" className="mb-6" aria-label="自动化详情"><TabsTrigger value="config">概览</TabsTrigger><TabsTrigger value="history">运行记录</TabsTrigger></TabsList>
              <TabsContent value="config">
                <div className="grid min-w-0 gap-8">
                  {sections.map(section => <section key={section.key} className="min-w-0" aria-label={section.title}>
                    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold [&_svg]:size-4">{section.icon}{section.title}</h2>
                      <Button variant="ghost" disabled={busy} onClick={() => onEdit(section.key)}>修改</Button></div>
                    <p className="text-sm font-medium">{section.type}</p>
                    <p className="mt-1 wrap-anywhere text-sm text-muted-foreground">{section.summary}</p>
                    <dl className="mt-5 grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                      {section.fields.map(field => <div key={field.key} className="contents"><dt className="text-muted-foreground">{field.label}</dt><dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{field.value}</dd></div>)}
                    </dl>
                  </section>)}
                  <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-t pt-5 text-sm">
                    <dt className="text-muted-foreground">范围</dt><dd>{formatAutomationScope(item, projects)}</dd>
                    <dt className="text-muted-foreground">下次运行</dt><dd>{formatAutomationNextRun(item)}</dd>
                    <dt className="text-muted-foreground">错过计划时</dt><dd>{item.policy.missedRunPolicy === "run_once" ? "补跑一次" : "跳过"}</dd>
                    <dt className="text-muted-foreground">运行重叠时</dt><dd>跳过本次执行</dd>
                  </dl>
                </div>
              </TabsContent>
              <TabsContent value="history"><AutomationRunsPanel item={item} busy={busy} onStopRun={onStopRun} /></TabsContent>
            </Tabs>
          </>}
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}
