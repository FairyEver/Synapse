import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Pencil, Play, RefreshCw, Zap } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { sanitizeUrl } from "@/lib/url-sanitize"
import { useProviderModelLabel } from "@/lib/provider-model"
import { Switch } from "@/components/ui/switch"
import { useMailTriggerAccounts } from "../../../../automation-trigger-packages/builtin/mail-received/use-mail-accounts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { automationConditionsSchema, summarizeAutomationConditions } from "../../../../automation-trigger-packages/schedule-constraints"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { AutomationItem } from "@/types/automation"
import { AutomationRunsPanel } from "../components/automation-runs-dialog"
import type { AutomationEditorStep } from "../types"
import { formatAutomationExecutor, formatAutomationExecutorType, formatAutomationNextRun, formatAutomationScope, formatAutomationTrigger, formatAutomationTriggerType } from "../utils"
import { buildAutomationConfigurationFields, getAutomationProviderModelSelection } from "./configuration-fields"

type AutomationDetailProps = {
  readonly item: AutomationItem
  readonly initialTab?: "config" | "history"
  readonly busy: boolean
  readonly missing?: boolean
  readonly error: string | null
  readonly onCreate?: () => void
  readonly onBack: () => void
  readonly onEdit: (step?: AutomationEditorStep) => void
  readonly onToggleEnabled: (enabled: boolean) => void
  readonly onStopRun: (runId: string) => Promise<void>
  readonly onRefresh: () => void
}

export function AutomationDetail({ item, initialTab = "config", busy, missing, error, onCreate, onBack, onEdit, onToggleEnabled, onStopRun, onRefresh }: AutomationDetailProps) {
  const { config } = useAppConfig()
  const [tab, setTab] = useState(initialTab)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [item.id])
  const { accounts } = useMailTriggerAccounts(item.trigger.type === "builtin.mail-received")
  const triggerConfig = item.trigger.type === "builtin.mail-received" ? { ...item.trigger.config, accountId: item.trigger.config.accountId ?? "__all__" } : item.trigger.config
  const projects = config.global.projects
  const providerSelection = getAutomationProviderModelSelection(item.executor.config)
  const providerModelLabel = useProviderModelLabel(providerSelection)
  const legacy = item.schemaVersion === 1
  const readOnly = item.schemaVersion !== 2 || item.readOnly
  const parsedConditions = automationConditionsSchema.safeParse(item.conditions)
  const conditionsSummary = parsedConditions.success ? summarizeAutomationConditions(parsedConditions.data) : "附加条件需要更新"
  const TriggerIcon = rendererAutomationTriggerRegistry.list().find(trigger => trigger.manifest.id === item.trigger.type)?.icon ?? Zap
  const ExecutorIcon = rendererActionRegistry.list().find(action => action.manifest.id === item.executor.type)?.icon ?? Play
  const displayItem = typeof item.executor.config.url === "string"
    ? { ...item, executor: { ...item.executor, config: { ...item.executor.config, url: sanitizeUrl(item.executor.config.url) } } }
    : item
  const sections = [
    { key: "trigger", title: "触发条件", type: formatAutomationTriggerType(item), summary: formatAutomationTrigger(item), fields: buildAutomationConfigurationFields(triggerConfig, projects, accounts), icon: <TriggerIcon /> },
    { key: "executor", title: "执行操作", type: formatAutomationExecutorType(item), summary: item.executor.type === "builtin.claude-code" ? "" : formatAutomationExecutor(displayItem), fields: buildAutomationConfigurationFields(item.executor.config, projects, [], providerSelection ? providerModelLabel || "加载中…" : undefined), icon: <ExecutorIcon /> },
  ] as const
  const policyFields = [
    ["范围", formatAutomationScope(item, projects)],
    ["下次运行", formatAutomationNextRun(item)],
    ["错过计划时", item.policy.missedRunPolicy === "run_once" ? "补跑一次" : item.policy.missedRunPolicy === "skip" ? "跳过" : "当前客户端不支持"],
    ["运行重叠时", item.policy.overlapPolicy === "skip" ? "跳过本次执行" : "当前客户端不支持"],
  ] as const
  const backAction = <SystemAppTopBarActionButton iconOnly aria-label="返回自动化列表" tooltip="返回列表" onClick={onBack}><ArrowLeft /></SystemAppTopBarActionButton>
  return (
    <SystemAppWindowShell headerMode="replace" left={backAction}>
      <div className="@container h-full min-h-0 bg-surface">
        <ScrollArea className="h-full min-h-0" viewportClassName="overflow-x-hidden">
          <Tabs value={tab} onValueChange={value => setTab(value as "config" | "history")} className="gap-0" data-layout="automation-detail">
            <div className="border-b bg-card text-card-foreground">
              <div className="mx-auto w-full max-w-7xl px-5 pt-6 @3xl:px-8">
                <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-4">
                  <h1 ref={heading} tabIndex={-1} className="min-w-0 flex-1 basis-64 wrap-anywhere text-xl font-semibold outline-none">{item.name}</h1>
                  {!missing ? <div className="flex flex-wrap items-center gap-2">
                    {readOnly ? <Badge variant="outline">{legacy ? "旧版已停用" : "需要升级客户端"}</Badge> : <>
                      <div className="flex items-center gap-2">
                        <label htmlFor={`automation-enabled-${item.id}`} className="text-sm text-muted-foreground">{item.enabled ? "已启用" : "已停用"}</label>
                        <Switch id={`automation-enabled-${item.id}`} aria-label={item.enabled ? "停用自动化" : "启用自动化"} checked={item.enabled} disabled={busy || item.validation?.status === "needs_update"} onCheckedChange={onToggleEnabled} />
                      </div>
                      <Button variant="outline" disabled={busy} onClick={() => onEdit()}><Pencil data-icon="inline-start" />编辑</Button>
                    </>}
                  </div> : null}
                </div>
                {!missing ? <TabsList variant="line" aria-label="自动化详情"><TabsTrigger value="config">概览</TabsTrigger><TabsTrigger value="history">运行记录</TabsTrigger></TabsList> : null}
              </div>
            </div>
            <div className="mx-auto w-full max-w-7xl px-5 py-6 @3xl:px-8 @3xl:py-8">
              {missing ? <p role="alert" className="text-sm text-muted-foreground">自动化不存在</p> : <>
                {error ? <div className="mb-6 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={onRefresh}><RefreshCw />重试</Button></div> : null}
                {legacy ? <div className="mb-6 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-muted-foreground">旧版自动化已停用，请新建后重新配置。</p>{onCreate ? <Button onClick={onCreate}>新建自动化</Button> : null}</div> : null}
                {!legacy && item.validation?.status === "needs_update" ? <p role="alert" className="mb-6 text-sm text-destructive">{readOnly ? "自动化配置需要更新，请升级客户端后操作" : "配置需要更新，请编辑后保存。"}</p> : null}
                <TabsContent value="config">
                  <div className="grid min-w-0 gap-8">
                    <div className="grid min-w-0 items-start gap-8 @4xl:grid-cols-2">
                      {sections.map((section, index) => <section key={section.key} className="min-w-0" aria-label={section.title}>
                        <h2 className="mb-4 flex items-center gap-2 text-base font-medium"><span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-card text-xs">{index + 1}</span>{section.title}</h2>
                        <div className="min-w-0 rounded-xl border bg-card text-card-foreground">
                          <div className="flex items-center justify-between gap-3 px-6 py-4">
                            <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:shrink-0"><span className="text-muted-foreground">{section.icon}</span>{section.type}</h3>
                            {!readOnly ? <Button variant="ghost" disabled={busy} onClick={() => onEdit(section.key)}>修改<span className="sr-only">{section.title}</span></Button> : null}
                          </div>
                          {section.fields.length > 0 || (section.summary && section.summary !== section.type) ? <div className="grid min-w-0 gap-5 border-t p-6">
                            {section.summary && section.summary !== section.type ? <p className="wrap-anywhere text-sm text-muted-foreground">{section.summary}</p> : null}
                            {section.fields.length > 0 ? <dl className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-4 text-sm">
                              {section.fields.map(field => <div key={field.key} className="contents"><dt className="wrap-anywhere text-muted-foreground">{field.label}</dt><dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{field.value}</dd></div>)}
                            </dl> : null}
                          </div> : null}
                        </div>
                      </section>)}
                    </div>
                    {!legacy && item.conditions ? <section aria-label="附加条件" className="min-w-0 rounded-xl border bg-card p-6 text-card-foreground">
                      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-base font-medium">附加条件</h2>{!readOnly ? <Button variant="ghost" disabled={busy} onClick={() => onEdit("conditions")}>修改<span className="sr-only">附加条件</span></Button> : null}</div>
                      <p className="text-sm">{conditionsSummary}</p>
                    </section> : null}
                    <section aria-label="运行策略" className="min-w-0 rounded-xl border bg-card p-6 text-card-foreground">
                      <h2 className="mb-5 text-base font-medium">运行策略</h2>
                      <dl className="grid min-w-0 gap-x-8 gap-y-4 text-sm @3xl:grid-cols-2">
                        {policyFields.map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 wrap-anywhere">{value}</dd></div>)}
                      </dl>
                    </section>
                  </div>
                </TabsContent>
                <TabsContent value="history"><AutomationRunsPanel item={item} busy={busy} onStopRun={onStopRun} /></TabsContent>
              </>}
            </div>
          </Tabs>
        </ScrollArea>
      </div>
    </SystemAppWindowShell>
  )
}
