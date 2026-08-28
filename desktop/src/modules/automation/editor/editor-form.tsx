import { useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle, Pencil, RefreshCw } from "lucide-react"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { holdBeforeUnloadForCustomDialog } from "@/lib/before-unload"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { sanitizeError } from "@/lib/error-sanitize"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { AutomationEditorDraft, AutomationEditorLoadState, AutomationEditorMode } from "../types"
import {
  buildAutomationCreateInputFromDraft,
  buildAutomationUpdateInputFromDraft,
  createAutomationDraftFromItem,
  createDefaultAutomationDraft,
  generateAutomationDraftName,
} from "../utils"
import { TriggerExecutorBuilder } from "./trigger-executor-builder"

const logger = createRendererLogger("automation.editor")

type AutomationEditorFormProps = {
  readonly mode: AutomationEditorMode
}

function visibleError(error: unknown): string {
  const validationMessage = readableValidationError(error)
  if (validationMessage) return validationMessage
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeError(message) || "保存失败"
}

function readableValidationError(error: unknown): string | null {
  const issues = extractValidationIssues(error)
  if (issues.length === 0) return null
  const messages = issues.map((issue) => validationIssueMessage(issue)).filter(Boolean)
  return [...new Set(messages)].join("、") || "请检查配置"
}

function extractValidationIssues(error: unknown): Array<{ readonly path?: readonly unknown[]; readonly message?: string }> {
  const directIssues = (error as { readonly issues?: unknown } | null)?.issues
  if (Array.isArray(directIssues)) return directIssues as Array<{ readonly path?: readonly unknown[]; readonly message?: string }>
  const message = error instanceof Error ? error.message : String(error)
  try {
    const parsed = JSON.parse(message)
    return Array.isArray(parsed) ? parsed as Array<{ readonly path?: readonly unknown[]; readonly message?: string }> : []
  } catch {
    return []
  }
}

function validationIssueMessage(issue: { readonly path?: readonly unknown[]; readonly message?: string }): string {
  const field = issue.path?.map(String).at(-1) ?? ""
  const labels: Record<string, string> = {
    projectId: "请选择项目",
    providerId: "请选择供应商 + 模型",
    modelTier: "请选择模型",
    prompt: "请填写提示词",
    command: "请填写命令",
    script: "请填写脚本",
    url: "请填写 URL",
    expr: "请填写 Cron 表达式",
  }
  return labels[field] ?? issue.message ?? ""
}

export function AutomationEditorForm({ mode }: AutomationEditorFormProps) {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const platform = getRendererPlatform()
  const [loadState, setLoadState] = useState<AutomationEditorLoadState>(() => (
    mode.mode === "create"
      ? { status: "ready", draft: createDefaultAutomationDraft(generateAutomationDraftName([])) }
      : { status: "loading" }
  ))
  const dirtyRef = useRef(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState("")
  const closeReturnFocusRef = useRef<HTMLElement | null>(null)
  const renameTriggerRef = useRef<HTMLButtonElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const automationBridge = useMemo(() => requireBridgeDomain("automation"), [])

  function setDirty(nextDirty: boolean) {
    dirtyRef.current = nextDirty
  }

  useEffect(() => {
    if (mode.mode === "create") {
      setLoadState({ status: "ready", draft: createDefaultAutomationDraft(generateAutomationDraftName([])) })
      setDirty(false)
      setShowCloseDialog(false)
      let cancelled = false
      void automationBridge.item.list()
        .then((items) => {
          if (cancelled || dirtyRef.current) return
          setLoadState({ status: "ready", draft: createDefaultAutomationDraft(
            generateAutomationDraftName(items.map((item) => item.name)),
          ) })
          setDirty(false)
        })
        .catch((loadError) => {
          logger.warn("Automation editor create name generation failed.", {
            boundary: "renderer.automation.editor.create-name",
            errorName: loadError instanceof Error ? loadError.name : typeof loadError,
            errorLength: loadError instanceof Error ? loadError.message.length : String(loadError).length,
          })
        })
      return () => {
        cancelled = true
      }
    }

    let cancelled = false
    setLoadState({ status: "loading" })
    void automationBridge.item.get(mode.automationId)
      .then((item) => {
        if (cancelled) return
        if (!item) {
          setLoadState({ status: "error", message: "自动化不存在" })
          return
        }
        setLoadState({ status: "ready", item, draft: createAutomationDraftFromItem(item) })
        setDirty(false)
        setShowCloseDialog(false)
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
    if (mode.mode !== "edit") return
    const handleFocus = () => {
      if (dirtyRef.current) return
      setReloadKey((current) => current + 1)
    }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [mode])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      holdBeforeUnloadForCustomDialog(event)
      closeReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      setShowCloseDialog(true)
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  function updateDraft(updater: (draft: AutomationEditorDraft) => AutomationEditorDraft) {
    setLoadState((current) => {
      if (current.status !== "ready") return current
      return { ...current, draft: updater(current.draft) }
    })
    setDirty(true)
    setError(null)
  }

  function openRenameDialog() {
    if (loadState.status !== "ready") return
    setRenameName(loadState.draft.name)
    setRenameOpen(true)
  }

  function handleRenameOpenAutoFocus(event: Event) {
    event.preventDefault()
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }

  function confirmRename() {
    const nextName = renameName.trim()
    if (!nextName) return
    updateDraft((current) => ({ ...current, name: nextName }))
    setRenameOpen(false)
  }

  async function handleSave(enableAfterSave: boolean) {
    if (loadState.status !== "ready") return
    const { draft, item } = loadState
    const enabled = enableAfterSave ? true : item?.enabled ?? false
    setSaving(true)
    setError(null)
    try {
      if (mode.mode === "edit" && item) {
        const updated = await automationBridge.item.update({
          id: item.id,
          patch: buildAutomationUpdateInputFromDraft(draft, enableAfterSave ? true : undefined),
        })
        setLoadState({ status: "ready", item: updated, draft: createAutomationDraftFromItem(updated) })
      } else {
        const created = await automationBridge.item.create(buildAutomationCreateInputFromDraft(draft, enabled))
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

  function handleDiscardAndClose() {
    setDirty(false)
    setShowCloseDialog(false)
    window.close()
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
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <Button
          ref={renameTriggerRef}
          type="button"
          variant="ghost"
          className="-ml-2 min-w-0 justify-start px-2 font-semibold"
          onClick={openRenameDialog}
        >
          <span className="truncate">{draft.name}</span>
          <Pencil />
          <span className="sr-only">重命名</span>
        </Button>
      </div>
      <div data-layout="automation-editor-body" className="min-h-0 flex-1 overflow-hidden">
        <TriggerExecutorBuilder
          triggerType={draft.triggerType}
          triggerConfig={draft.triggerConfig}
          executorType={draft.executorType}
          executorConfig={draft.executorConfig}
          projects={projects}
          platform={platform}
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
      <Dialog data-track="automation-editor-rename-dialog" open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="sm:max-w-sm"
          onOpenAutoFocus={handleRenameOpenAutoFocus}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            renameTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>重命名自动化</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="automation-editor-rename-name">名称</FieldLabel>
              <FieldContent>
                <Input
                  id="automation-editor-rename-name"
                  ref={renameInputRef}
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      confirmRename()
                    }
                  }}
                />
              </FieldContent>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={!renameName.trim()} onClick={confirmRename}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            closeReturnFocusRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>未保存的更改</AlertDialogTitle>
            <AlertDialogDescription>关闭后，未保存的修改会丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="ghost" onClick={handleDiscardAndClose}>放弃</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
