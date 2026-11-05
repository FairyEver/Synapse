import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw, Workflow } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getRendererPlatform } from "@/lib/runtime-platform"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { AutomationItem } from "@/types/automation"
import { useAutomationEditor } from "../hooks/use-automation-editor"
import type { AutomationEditorMode, AutomationEditorSession, AutomationEditorStep } from "../types"
import { TriggerExecutorBuilder } from "./trigger-executor-builder"
import { AutomationRunsPanel } from "../components/automation-runs-dialog"
import { summarizeAutomationDraft } from "../utils"

type AutomationEditorFormProps = {
  readonly mode: AutomationEditorMode
  readonly initialSession?: AutomationEditorSession
  readonly initialStep?: AutomationEditorStep
  readonly onBack: (session?: AutomationEditorSession) => void
  readonly onSaved?: (item: AutomationItem) => void
}

export function AutomationEditorForm(props: AutomationEditorFormProps) {
  const { config } = useAppConfig()
  const editor = useAutomationEditor(props)
  const { loadState, saving, error, leaveKind } = editor
  const [tab, setTab] = useState("config")
  const executorPanel = useRef<HTMLDivElement>(null)
  const ready = loadState.status === "ready"
  useEffect(() => {
    if (ready && (props.initialStep ?? props.initialSession?.step) === "executor") {
      executorPanel.current?.focus()
      executorPanel.current?.scrollIntoView({ block: "nearest" })
    }
  }, [ready, props.initialStep, props.initialSession?.step])
  const draft = loadState.status === "ready" ? loadState.draft : null
  const item = loadState.status === "ready" ? loadState.item : undefined
  const canSave = Boolean(draft?.name.trim() && draft.triggerType && draft.executorType && !saving && !editor.choosingType)
  const backAction = (
    <SystemAppTopBarActionButton iconOnly aria-label="返回自动化列表" tooltip="返回" disabled={saving} onClick={editor.back}>
      <ArrowLeft />
    </SystemAppTopBarActionButton>
  )

  return (
    <SystemAppWindowShell headerMode="replace" left={backAction}>
      <div className="@container flex h-full min-h-0 min-w-0 flex-col bg-background">
        {leaveKind ? (
          <div role="region" aria-label="未保存的更改" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted px-5 py-3">
            <p className="text-sm">更改尚未保存</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" disabled={saving} onClick={() => editor.resolveLeave("continue")}>继续编辑</Button>
              {leaveKind === "back" ? <Button variant="outline" disabled={saving} onClick={() => editor.resolveLeave("stash")}>暂存草稿并返回</Button> : null}
              <Button variant="ghost" className="text-destructive" disabled={saving} onClick={() => editor.resolveLeave("discard")}>放弃修改</Button>
            </div>
          </div>
        ) : null}
        {loadState.status === "loading" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载中</div>
        ) : loadState.status === "error" ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p role="alert">{loadState.message}</p><Button variant="outline" onClick={editor.retry}><RefreshCw />重试</Button>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="overflow-x-hidden">
            <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8" data-layout="automation-editor-body">
              <h1 className="sr-only">{item ? "编辑自动化" : "新建自动化"}</h1>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList variant="line" className="mb-6" aria-label="自动化配置视图">
                  <TabsTrigger value="config">配置</TabsTrigger>
                  <TabsTrigger value="history" disabled={!item || saving}>运行记录</TabsTrigger>
                </TabsList>
                <TabsContent value="config" forceMount hidden={tab !== "config"}>
                  <fieldset disabled={saving} className="min-w-0 border-0 p-0">
                    <Field className="mb-7 max-w-lg">
                      <FieldLabel htmlFor="automation-name" className="sr-only">自动化名称</FieldLabel>
                      <Input id="automation-name" aria-label="自动化名称" value={loadState.draft.name} maxLength={200}
                        className="font-semibold" onChange={event => editor.updateDraft(current => ({ ...current, name: event.target.value }))} />
                    </Field>
                    <div className="grid min-w-0 items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" data-layout="automation-editor-flow">
                      <TriggerExecutorBuilder step="trigger" onChoosingChange={editor.setChoosingType} triggerType={loadState.draft.triggerType} triggerConfig={loadState.draft.triggerConfig}
                        executorType={loadState.draft.executorType} executorConfig={loadState.draft.executorConfig}
                        projects={config.global.projects} platform={getRendererPlatform()} onTriggerChange={editor.changeTrigger}
                        onExecutorChange={editor.changeExecutor} />
                      <div data-layout="automation-editor-divider" className="flex justify-center text-muted-foreground @4xl:pt-16" aria-hidden="true"><ArrowRight className="size-5 rotate-90 @4xl:rotate-0" /></div>
                      <div ref={executorPanel} tabIndex={-1} className="min-w-0">
                        <TriggerExecutorBuilder step="executor" onChoosingChange={editor.setChoosingType} triggerType={loadState.draft.triggerType} triggerConfig={loadState.draft.triggerConfig}
                          executorType={loadState.draft.executorType} executorConfig={loadState.draft.executorConfig}
                          projects={config.global.projects} platform={getRendererPlatform()} onTriggerChange={editor.changeTrigger}
                          onExecutorChange={editor.changeExecutor} />
                      </div>
                    </div>
                  </fieldset>
                  <section aria-label="流程摘要" className="mt-7 flex min-w-0 gap-3 border-t pt-5">
                    <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0"><h2 className="mb-2 text-xs text-muted-foreground">流程摘要</h2><p className="wrap-anywhere text-sm leading-relaxed">{summarizeAutomationDraft(loadState.draft, config.global.projects ?? [])}</p></div>
                  </section>
                  {error ? <p role="alert" className="mt-4 wrap-anywhere text-sm text-destructive">{error}</p> : null}
                  <div className="mt-5 flex flex-wrap items-center justify-end gap-2" data-layout="automation-editor-actions">
                    {saving ? <p role="status" className="mr-auto text-sm text-muted-foreground">保存中</p> : null}
                    <Button variant={item?.enabled ? "default" : "outline"} disabled={!canSave} onClick={() => { void editor.save(false) }}>{item?.enabled ? "保存更改" : "仅保存"}</Button>
                    {!item?.enabled ? <Button disabled={!canSave} onClick={() => { void editor.save(true) }}>保存并启用</Button> : null}
                  </div>
                </TabsContent>
                <TabsContent value="history">{item ? <AutomationRunsPanel item={item} busy={saving} onStopRun={editor.stopRun} /> : null}</TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        )}
      </div>
    </SystemAppWindowShell>
  )
}
