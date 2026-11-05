import { useEffect, useRef, useState } from "react"
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react"
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
      <div className="@container flex h-full min-h-0 min-w-0 flex-col bg-surface">
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
            <div className="min-w-0" data-layout="automation-editor-body">
              <h1 className="sr-only">{item ? "编辑自动化" : "新建自动化"}</h1>
              <Tabs value={tab} onValueChange={setTab} className="gap-0">
                <div className="border-b bg-background" data-layout="automation-editor-heading">
                  <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 @3xl:px-8">
                    <Field className="w-full min-w-0 @xl:w-auto @xl:flex-1 @xl:max-w-md">
                      <FieldLabel htmlFor="automation-name" className="sr-only">自动化名称</FieldLabel>
                      <Input id="automation-name" aria-label="自动化名称" value={loadState.draft.name} maxLength={200}
                        disabled={saving || tab !== "config"} className="font-medium" onChange={event => editor.updateDraft(current => ({ ...current, name: event.target.value }))} />
                    </Field>
                    <TabsList variant="line" aria-label="自动化配置视图">
                      <TabsTrigger value="config">配置</TabsTrigger>
                      <TabsTrigger value="history" disabled={!item || saving}>运行记录</TabsTrigger>
                    </TabsList>
                  </div>
                </div>
                <TabsContent value="config" forceMount hidden={tab !== "config"}>
                  <fieldset disabled={saving} className="mx-auto w-full min-w-0 max-w-7xl border-0 px-5 py-6 @3xl:px-8 @3xl:py-8">
                    <div className="grid min-w-0 items-start gap-8 @4xl:grid-cols-2" data-layout="automation-editor-flow">
                      <TriggerExecutorBuilder step="trigger" onChoosingChange={editor.setChoosingType} triggerType={loadState.draft.triggerType} triggerConfig={loadState.draft.triggerConfig}
                        executorType={loadState.draft.executorType} executorConfig={loadState.draft.executorConfig}
                        projects={config.global.projects} platform={getRendererPlatform()} onTriggerChange={editor.changeTrigger}
                        onExecutorChange={editor.changeExecutor} />
                      <div ref={executorPanel} tabIndex={-1} className="min-w-0">
                        <TriggerExecutorBuilder step="executor" onChoosingChange={editor.setChoosingType} triggerType={loadState.draft.triggerType} triggerConfig={loadState.draft.triggerConfig}
                          executorType={loadState.draft.executorType} executorConfig={loadState.draft.executorConfig}
                          projects={config.global.projects} platform={getRendererPlatform()} onTriggerChange={editor.changeTrigger}
                          onExecutorChange={editor.changeExecutor} />
                      </div>
                    </div>
                  </fieldset>
                  <div className="border-y bg-background" data-layout="automation-editor-actions">
                    <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-4 px-5 py-4 @3xl:px-8">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-8 gap-y-4">
                        <section aria-label="流程摘要" className="min-w-0 flex-1 basis-64">
                          <h2 className="mb-1 text-xs font-medium text-muted-foreground">流程摘要</h2>
                          <p className="wrap-anywhere text-sm leading-relaxed">{summarizeAutomationDraft(loadState.draft, config.global.projects ?? [])}</p>
                        </section>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                          {saving ? <p role="status" className="text-sm text-muted-foreground">保存中</p> : null}
                          <Button variant={item?.enabled ? "default" : "outline"} disabled={!canSave} onClick={() => { void editor.save(false) }}>{item?.enabled ? "保存更改" : "仅保存"}</Button>
                          {!item?.enabled ? <Button disabled={!canSave} onClick={() => { void editor.save(true) }}>保存并启用</Button> : null}
                        </div>
                      </div>
                      {error ? <p role="alert" className="wrap-anywhere text-sm text-destructive">{error}</p> : null}
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="history" className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 @3xl:px-8">{item ? <AutomationRunsPanel item={item} busy={saving} onStopRun={editor.stopRun} /> : null}</TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        )}
      </div>
    </SystemAppWindowShell>
  )
}
