import { useState } from "react"
import { ArrowLeft, Check, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getRendererPlatform } from "@/lib/runtime-platform"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { AutomationItem } from "@/types/automation"
import { AutomationRunsPanel } from "../components/automation-runs-dialog"
import { stopAutomationRun } from "../hooks/use-automation"
import { useAutomationEditor } from "../hooks/use-automation-editor"
import type { AutomationEditorMode, AutomationEditorSession } from "../types"
import { formatAutomationTrigger } from "../utils"
import { TriggerExecutorBuilder } from "./trigger-executor-builder"

type AutomationEditorFormProps = {
  readonly mode: AutomationEditorMode
  readonly initialSession?: AutomationEditorSession
  readonly initialTab?: "config" | "history"
  readonly onBack: (session?: AutomationEditorSession) => void
  readonly onSaved?: (item: AutomationItem) => void
}

export function AutomationEditorForm({ initialTab = "config", ...props }: AutomationEditorFormProps) {
  const { config } = useAppConfig()
  const editor = useAutomationEditor(props)
  const [tab, setTab] = useState(initialTab)
  const { loadState, saving, dirty, error, leaveKind } = editor
  const draft = loadState.status === "ready" ? loadState.draft : null
  const item = loadState.status === "ready" ? loadState.item : undefined
  const canSave = Boolean(draft?.name.trim() && draft.triggerType && draft.executorType && !saving)
  const summary = draft?.triggerType
    ? formatAutomationTrigger({ trigger: { type: draft.triggerType, config: draft.triggerConfig } })
    : "选择触发条件和执行操作"

  const navigation = (
    <>
      <SystemAppTopBarActionButton iconOnly aria-label="返回自动化列表" tooltip="返回列表" disabled={saving} onClick={editor.back}><ArrowLeft /></SystemAppTopBarActionButton>
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm">{item || props.mode.mode === "edit" ? "编辑自动化" : "新建自动化"}</span>
    </>
  )
  const saveState = (
    <span role="status" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      {saving ? <><LoaderCircle className="size-3 animate-spin" />保存中</> : dirty ? "未保存" : item ? <><Check className="size-3" />已保存</> : "草稿"}
    </span>
  )

  return (
    <SystemAppWindowShell left={<><span className="text-sm font-semibold">自动化</span>{navigation}</>} embeddedLeftAddon={navigation} actions={saveState}>
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
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
          <Tabs value={tab} onValueChange={(value) => setTab(value as "config" | "history")} className="min-h-0 flex-1 gap-0">
            <ScrollArea className="min-h-0 flex-1" viewportClassName="overflow-x-hidden">
              <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
                <div className="mb-5 flex min-w-0 items-center gap-3">
                  <Input aria-label="自动化名称" value={loadState.draft.name} disabled={saving} maxLength={200}
                    className="min-w-0 flex-1 border-transparent font-semibold md:text-lg"
                    onChange={(event) => editor.updateDraft((current) => ({ ...current, name: event.target.value }))} />
                  <Badge variant="outline">{item?.enabled ? "已启用" : "未启用"}</Badge>
                </div>
                <div className="mb-6 border-b pb-1">
                  <TabsList variant="line" aria-label="自动化详情">
                    <TabsTrigger value="config">配置</TabsTrigger>
                    <TabsTrigger value="history">运行记录</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent forceMount value="config" className="data-[state=inactive]:hidden">
                  <fieldset disabled={saving} className="min-w-0 border-0 p-0">
                    <div data-layout="automation-editor-body" className="min-w-0">
                      <TriggerExecutorBuilder triggerType={loadState.draft.triggerType} triggerConfig={loadState.draft.triggerConfig}
                        executorType={loadState.draft.executorType} executorConfig={loadState.draft.executorConfig}
                        projects={config.global.projects} platform={getRendererPlatform()}
                        onTriggerChange={(triggerType, triggerConfig) => editor.updateDraft((current) => ({ ...current, triggerType, triggerConfig }))}
                        onExecutorChange={(executorType, executorConfig) => editor.updateDraft((current) => ({ ...current, executorType, executorConfig }))} />
                    </div>
                  </fieldset>
                </TabsContent>
                <TabsContent value="history">
                  {item ? <AutomationRunsPanel item={item} busy={saving} onStopRun={async (runId) => {
                    const result = await stopAutomationRun(runId)
                    if (!result.stopped && !result.alreadyFinished && !result.stopRequested) throw new Error("运行已结束")
                  }} /> : <p className="py-16 text-center text-sm text-muted-foreground">保存后即可查看运行记录</p>}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="truncate">{summary}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" disabled={!canSave} onClick={() => { void editor.save(false) }}>仅保存</Button>
            <Button disabled={!canSave} onClick={() => { void editor.save(true) }}>保存并启用</Button>
          </div>
        </div>
      </div>
    </SystemAppWindowShell>
  )
}
