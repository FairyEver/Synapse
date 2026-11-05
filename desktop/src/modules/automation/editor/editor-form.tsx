import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { GuidedFlow } from "@/components/guided-flow"
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

type AutomationEditorFormProps = {
  readonly mode: AutomationEditorMode
  readonly initialSession?: AutomationEditorSession
  readonly initialStep?: AutomationEditorStep
  readonly onBack: (session?: AutomationEditorSession) => void
  readonly onSaved?: (item: AutomationItem) => void
}

const steps = [{ id: "trigger", title: "触发条件" }, { id: "executor", title: "执行操作" }]

export function AutomationEditorForm(props: AutomationEditorFormProps) {
  const { config } = useAppConfig()
  const editor = useAutomationEditor(props)
  const { loadState, saving, error, leaveKind, step } = editor
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
          <ScrollArea className="min-h-0 flex-1" viewportClassName="overflow-x-hidden">
            <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8" data-layout="automation-editor-body">
              <GuidedFlow title={item ? "编辑自动化" : "新建自动化"} layout="page" step={step} steps={steps} busy={saving}
                canNext={Boolean(draft?.triggerType && !editor.choosingType)} onNext={editor.next} onBack={step === "executor" ? editor.previous : undefined} onCancel={editor.back}
                actions={step === "executor" ? <>
                  <Button variant={item?.enabled ? "default" : "outline"} disabled={!canSave} onClick={() => { void editor.save(false) }}>{item?.enabled ? "保存更改" : "仅保存"}</Button>
                  {!item?.enabled ? <Button disabled={!canSave} onClick={() => { void editor.save(true) }}>保存并启用</Button> : null}
                </> : undefined}>
                <fieldset disabled={saving} className="min-w-0 border-0 p-0">
                  <TriggerExecutorBuilder key={step} step={step} choosing={editor.choosingType} onChoosingChange={editor.setChoosingType} triggerType={loadState.draft.triggerType} triggerConfig={loadState.draft.triggerConfig}
                    executorType={loadState.draft.executorType} executorConfig={loadState.draft.executorConfig}
                    projects={config.global.projects} platform={getRendererPlatform()}
                    onTriggerChange={editor.changeTrigger}
                    onExecutorChange={(executorType, executorConfig) => editor.updateDraft(current => ({ ...current, executorType, executorConfig }))} />
                  {step === "executor" ? <Field className="mt-7 border-t pt-6">
                    <FieldLabel htmlFor="automation-name">自动化名称</FieldLabel>
                    <Input id="automation-name" aria-label="自动化名称" value={loadState.draft.name} maxLength={200}
                      onChange={event => editor.updateDraft(current => ({ ...current, name: event.target.value }))} />
                  </Field> : null}
                </fieldset>
                {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
                {saving ? <p role="status" className="mt-4 text-sm text-muted-foreground">保存中</p> : null}
              </GuidedFlow>
            </div>
          </ScrollArea>
        )}
      </div>
    </SystemAppWindowShell>
  )
}
