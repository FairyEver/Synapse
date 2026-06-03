import { useEffect, useMemo, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"

import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { sanitizeError } from "@/lib/error-sanitize"
import type { AutomationEditorDraft, AutomationEditorLoadState, AutomationEditorMode } from "../types"
import {
  buildAutomationCreateInputFromDraft,
  buildAutomationUpdateInputFromDraft,
  createAutomationDraftFromItem,
  createDefaultAutomationDraft,
} from "../utils"
import { TriggerExecutorBuilder } from "./trigger-executor-builder"

const logger = createRendererLogger("automation.editor")

type AutomationEditorFormProps = {
  readonly mode: AutomationEditorMode
}

function visibleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeError(message) || "保存失败"
}

export function AutomationEditorForm({ mode }: AutomationEditorFormProps) {
  const [loadState, setLoadState] = useState<AutomationEditorLoadState>(() => (
    mode.mode === "create"
      ? { status: "ready", draft: createDefaultAutomationDraft() }
      : { status: "loading" }
  ))
  const [dirty, setDirty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const automationBridge = useMemo(() => requireBridgeDomain("automation"), [])

  useEffect(() => {
    if (mode.mode === "create") {
      setLoadState({ status: "ready", draft: createDefaultAutomationDraft() })
      setDirty(false)
      return
    }

    let cancelled = false
    setLoadState({ status: "loading" })
    void automationBridge.getItem(mode.automationId)
      .then((item) => {
        if (cancelled) return
        if (!item) {
          setLoadState({ status: "error", message: "自动化不存在" })
          return
        }
        setLoadState({ status: "ready", item, draft: createAutomationDraftFromItem(item) })
        setDirty(false)
      })
      .catch((loadError) => {
        if (cancelled) return
        logger.warn("Automation editor load failed.", {
          boundary: "renderer.automation.editor.load",
          automationId: mode.automationId,
          errorName: loadError instanceof Error ? loadError.name : typeof loadError,
          errorLength: loadError instanceof Error ? loadError.message.length : String(loadError).length,
        })
        setLoadState({ status: "error", message: "加载失败" })
      })

    return () => {
      cancelled = true
    }
  }, [automationBridge, mode, reloadKey])

  useEffect(() => {
    if (!dirty) return undefined
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [dirty])

  function updateDraft(updater: (draft: AutomationEditorDraft) => AutomationEditorDraft) {
    setLoadState((current) => {
      if (current.status !== "ready") return current
      return { ...current, draft: updater(current.draft) }
    })
    setDirty(true)
    setError(null)
  }

  async function handleSave(enableAfterSave: boolean) {
    if (loadState.status !== "ready") return
    const { draft, item } = loadState
    const enabled = enableAfterSave ? true : item?.enabled ?? false
    setSaving(true)
    setError(null)
    try {
      if (mode.mode === "edit" && item) {
        const updated = await automationBridge.updateItem({
          id: item.id,
          patch: buildAutomationUpdateInputFromDraft(draft, enabled),
        })
        setLoadState({ status: "ready", item: updated, draft: createAutomationDraftFromItem(updated) })
      } else {
        const created = await automationBridge.createItem(buildAutomationCreateInputFromDraft(draft, enabled))
        setLoadState({ status: "ready", item: created, draft: createAutomationDraftFromItem(created) })
      }
      setDirty(false)
      window.close()
    } catch (saveError) {
      logger.warn("Automation editor save failed.", {
        boundary: "renderer.automation.editor.save",
        mode: mode.mode,
        ...(mode.mode === "edit" ? { automationId: mode.automationId } : {}),
        errorName: saveError instanceof Error ? saveError.name : typeof saveError,
        errorLength: saveError instanceof Error ? saveError.message.length : String(saveError).length,
      })
      setError(visibleError(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (loadState.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        加载中
      </div>
    )
  }

  if (loadState.status === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <p>{loadState.message}</p>
        {mode.mode === "edit" ? (
          <Button size="sm" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw />
            重试
          </Button>
        ) : null}
      </div>
    )
  }

  const { draft } = loadState

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="border-b border-border px-8 py-6">
        <Input
          className="h-11 max-w-md text-lg font-semibold"
          aria-label="自动化标题"
          value={draft.name}
          onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-8">
        <TriggerExecutorBuilder
          triggerType={draft.triggerType}
          triggerConfig={draft.triggerConfig}
          executorType={draft.executorType}
          executorConfig={draft.executorConfig}
          onTriggerChange={(triggerType, triggerConfig) =>
            updateDraft((current) => ({ ...current, triggerType, triggerConfig }))}
          onExecutorChange={(executorType, executorConfig) =>
            updateDraft((current) => ({ ...current, executorType, executorConfig }))}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-8 py-4">
        {error ? <p className="mr-auto text-sm text-destructive">{error}</p> : null}
        <Button variant="outline" disabled={saving} onClick={() => { void handleSave(false) }}>
          仅保存
        </Button>
        <Button disabled={saving} onClick={() => { void handleSave(true) }}>
          保存并启用
        </Button>
      </div>
    </div>
  )
}
