import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { registerNavigationGuard } from "@/app-shell/navigation-guard"
import { holdBeforeUnloadForCustomDialog } from "@/lib/before-unload"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { sanitizeError } from "@/lib/error-sanitize"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { AutomationItem } from "@/types/automation"
import type { AutomationEditorDraft, AutomationEditorLoadState, AutomationEditorMode } from "../types"
import { validateAutomationDraftFields, type AutomationFieldErrors } from "../editor/validation"
import { stopAutomationRun } from "./use-automation"
import { buildAutomationCreateInputFromDraft, buildAutomationUpdateInputFromDraft, createAutomationDraftFromItem, createDefaultAutomationDraft, generateAutomationDraftName, validateChangedTriggerVariables } from "../utils"

const logger = createRendererLogger("automation.editor")
type LeaveKind = "back" | "navigation" | "close"
type EditorOptions = {
  readonly mode: AutomationEditorMode
  readonly onBack: () => void
  readonly onSaved?: (item: AutomationItem) => void
}

function saveErrorMessage(error: unknown): string {
  const fieldLabels: Record<string, string> = { projectId: "请选择项目", providerId: "请选择供应商 + 模型", modelTier: "请选择模型", prompt: "请填写提示词", command: "请填写命令", script: "请填写脚本", url: "请填写 URL", expr: "请填写 Cron 表达式", everyMinutes: "请填写大于 0 的间隔分钟", conditions: "请检查附加条件", webhookPublicId: "请选择 Webhook" }
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] } | null)?.issues
  if (Array.isArray(issues)) return [...new Set(issues.map(issue => fieldLabels[String(issue.path?.at(-1))] ?? issue.message).filter(Boolean))].join("、") || "请检查配置"
  return sanitizeError(error instanceof Error ? error.message : String(error)) || "保存失败"
}

export function useAutomationEditor({ mode, onBack, onSaved }: EditorOptions) {
  const bridge = useMemo(() => requireBridgeDomain("automation"), [])
  const [loadState, setLoadState] = useState<AutomationEditorLoadState>(() => mode.mode === "create" ? { status: "ready", draft: createDefaultAutomationDraft(generateAutomationDraftName([])) } : { status: "loading" })
  const baseline = useRef(JSON.stringify(loadState.status === "ready" ? loadState.draft : null))
  const [saving, setSaving] = useState(false)
  const [choosingType, setChoosingType] = useState(false)
  const [previousTriggerTypes, setPreviousTriggerTypes] = useState<readonly string[]>([])
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  const revision = useRef(0)
  const mounted = useRef(true)
  const [fieldErrors, setFieldErrors] = useState<AutomationFieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [leaveKind, setLeaveKind] = useState<LeaveKind | null>(null)
  const navigationReply = useRef<((allowed: boolean) => void) | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dirty = loadState.status === "ready" && JSON.stringify(loadState.draft) !== baseline.current
  dirtyRef.current = dirty
  const modeId = mode.mode === "edit" ? mode.automationId : undefined

  const installItem = useCallback((item: AutomationItem) => {
    revision.current += 1
    const draft = createAutomationDraftFromItem(item)
    baseline.current = JSON.stringify(draft)
    dirtyRef.current = false
    setPreviousTriggerTypes([])
    setLoadState({ status: "ready", item, draft })
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; navigationReply.current?.(false); navigationReply.current = null }
  }, [])

  useEffect(() => {
    let cancelled = false
    const version = revision.current
    if (modeId) {
      setLoadState({ status: "loading" })
      void bridge.item.get(modeId).then(item => {
        if (cancelled) return
        if (item?.schemaVersion === 1) setLoadState({ status: "error", message: "旧版自动化不可编辑" })
        else if (item) installItem(item)
        else setLoadState({ status: "error", message: "自动化不存在" })
      }).catch(loadError => {
        if (cancelled) return
        logger.warn("Automation editor load failed.", { boundary: "renderer.automation.editor.load", automationId: modeId, errorName: loadError instanceof Error ? loadError.name : typeof loadError })
        setLoadState({ status: "error", message: "加载失败" })
      })
    } else {
      void bridge.item.list().then(items => {
        if (cancelled || version !== revision.current || dirtyRef.current || savingRef.current) return
        const draft = createDefaultAutomationDraft(generateAutomationDraftName(items.map(item => item.name)))
        baseline.current = JSON.stringify(draft)
        setLoadState({ status: "ready", draft })
      }).catch(loadError => {
        logger.warn("Automation draft name generation failed.", { boundary: "renderer.automation.editor.create-name", errorName: loadError instanceof Error ? loadError.name : typeof loadError })
      })
    }
    return () => { cancelled = true }
  }, [bridge, installItem, modeId, reloadKey])

  const itemId = loadState.status === "ready" ? loadState.item?.id : undefined
  useEffect(() => {
    if (!itemId) return
    let cancelled = false
    let request = 0
    const reload = () => {
      if (dirtyRef.current || savingRef.current) return
      const token = ++request
      const version = revision.current
      void bridge.item.get(itemId).then(item => {
        if (!cancelled && token === request && version === revision.current && item && !dirtyRef.current && !savingRef.current) installItem(item)
      }).catch(loadError => {
        logger.warn("Automation editor refresh failed.", { boundary: "renderer.automation.editor.refresh", automationId: itemId, errorName: loadError instanceof Error ? loadError.name : typeof loadError })
      })
    }
    window.addEventListener("focus", reload)
    return () => { cancelled = true; window.removeEventListener("focus", reload) }
  }, [bridge, installItem, itemId])

  const requestLeave = useCallback((kind: LeaveKind) => {
    navigationReply.current?.(false)
    navigationReply.current = null
    if (!returnFocus.current || !document.querySelector('[role="alertdialog"]')) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setLeaveKind(kind)
  }, [])

  useEffect(() => registerNavigationGuard(() => {
    if (savingRef.current) return false
    if (!dirtyRef.current) return true
    navigationReply.current?.(false)
    requestLeave("navigation")
    return new Promise<boolean>(resolve => { navigationReply.current = resolve })
  }, () => savingRef.current), [requestLeave])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return
      holdBeforeUnloadForCustomDialog(event)
      if (!savingRef.current) requestLeave("close")
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [requestLeave])

  function updateDraft(updater: (draft: AutomationEditorDraft) => AutomationEditorDraft) {
    if (savingRef.current) return
    revision.current += 1
    dirtyRef.current = true
    setLoadState(current => current.status === "ready" ? { ...current, draft: updater(current.draft) } : current)
    setError(null)
    setFieldErrors({})
  }

  function changeExecutor(executorType: string | null, executorConfig: Record<string, unknown>) {
    updateDraft(current => ({ ...current, executorType, executorConfig }))
  }

  async function stopRun(runId: string) {
    const result = await stopAutomationRun(runId)
    if (!result.stopped && !result.alreadyFinished && !result.stopRequested) throw new Error("自动化未在运行")
  }

  function changeTrigger(triggerType: string | null, triggerConfig: Record<string, unknown>) {
    if (savingRef.current || loadState.status !== "ready") return
    const previousType = loadState.draft.triggerType
    if (previousType && previousType !== triggerType) setPreviousTriggerTypes(current => [...new Set([...current, previousType])])
    updateDraft(current => ({ ...current, triggerType, triggerConfig }))
  }

  async function save(enable: boolean, leaveAfterSave = false) {
    if (savingRef.current || choosingType || loadState.status !== "ready") return
    const { draft, item } = loadState
    const errors = { ...validateAutomationDraftFields(draft) }
    try {
      validateChangedTriggerVariables(draft, previousTriggerTypes)
    } catch (variableError) {
      errors["executor.prompt"] = saveErrorMessage(variableError)
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length) { setError("请检查标出的配置"); return }
    const pendingLeave = leaveAfterSave ? leaveKind : null
    let savedItem: AutomationItem | undefined
    revision.current += 1
    const finish = item
      ? startTrackedOperation({ component: "automation", eventKey: "automation.editor.save" })
      : startTrackedOperation({ component: "automation", eventKey: "automation.editor.create" })
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const saved = item
        ? await bridge.item.update({ id: item.id, patch: buildAutomationUpdateInputFromDraft(draft, enable ? true : undefined) })
        : await bridge.item.create(buildAutomationCreateInputFromDraft(draft, enable))
      if (mounted.current) {
        installItem(saved)
        savedItem = saved
      }
      finish("success")
    } catch (saveError) {
      finish("failure")
      logger.warn("Automation editor save failed.", { boundary: "renderer.automation.editor.save", automationId: item?.id, errorName: saveError instanceof Error ? saveError.name : typeof saveError })
      if (mounted.current) setError(saveErrorMessage(saveError))
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
    if (savedItem && mounted.current) {
      if (pendingLeave) completeLeave(pendingLeave)
      else {
        setLeaveKind(null)
        navigationReply.current?.(false)
        navigationReply.current = null
        onSaved?.(savedItem)
      }
    }
  }

  function back() {
    if (savingRef.current) return
    if (dirtyRef.current) requestLeave("back")
    else onBack()
  }

  function completeLeave(kind: LeaveKind, discard = false) {
    dirtyRef.current = false
    if (discard && loadState.status === "ready") baseline.current = JSON.stringify(loadState.draft)
    setLeaveKind(null)
    const reply = navigationReply.current
    navigationReply.current = null
    reply?.(kind === "navigation")
    if (kind === "close") window.close()
    else if (kind === "back") onBack()
  }

  function resolveLeave(action: "continue" | "save" | "discard") {
    if (savingRef.current || !leaveKind) return
    if (action === "save") {
      void save(false, true)
      return
    }
    if (action === "continue") {
      setLeaveKind(null)
      navigationReply.current?.(false)
      navigationReply.current = null
      return
    }
    completeLeave(leaveKind, true)
  }

  return { loadState, dirty, saving, error, fieldErrors, leaveKind, choosingType, setChoosingType, changeTrigger, changeExecutor, stopRun, updateDraft, save, back, resolveLeave, restoreFocus: () => returnFocus.current?.focus(), retry: () => setReloadKey(key => key + 1) }
}
