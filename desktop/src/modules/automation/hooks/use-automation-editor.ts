import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { registerNavigationGuard } from "@/app-shell/navigation-guard"
import { holdBeforeUnloadForCustomDialog } from "@/lib/before-unload"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { sanitizeError } from "@/lib/error-sanitize"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { AutomationItem } from "@/types/automation"
import type { AutomationEditorDraft, AutomationEditorLoadState, AutomationEditorMode, AutomationEditorSession, AutomationEditorStep } from "../types"
import { stopAutomationRun } from "./use-automation"
import { buildAutomationCreateInputFromDraft, buildAutomationUpdateInputFromDraft, createAutomationDraftFromItem, createDefaultAutomationDraft, generateAutomationDraftName, validateChangedTriggerVariables } from "../utils"

const logger = createRendererLogger("automation.editor")
type LeaveKind = "back" | "navigation" | "close"
type EditorOptions = {
  readonly mode: AutomationEditorMode
  readonly initialSession?: AutomationEditorSession
  readonly initialStep?: AutomationEditorStep
  readonly onBack: (session?: AutomationEditorSession) => void
  readonly onSaved?: (item: AutomationItem) => void
}

function saveErrorMessage(error: unknown): string {
  const fieldLabels: Record<string, string> = { projectId: "请选择项目", providerId: "请选择供应商 + 模型", modelTier: "请选择模型", prompt: "请填写提示词", command: "请填写命令", script: "请填写脚本", url: "请填写 URL", expr: "请填写 Cron 表达式", everyMinutes: "请填写大于 0 的间隔分钟", activeDays: "请至少选择一个活跃日", webhookPublicId: "请选择 Webhook" }
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] } | null)?.issues
  if (Array.isArray(issues)) return [...new Set(issues.map(issue => fieldLabels[String(issue.path?.at(-1))] ?? issue.message).filter(Boolean))].join("、") || "请检查配置"
  return sanitizeError(error instanceof Error ? error.message : String(error)) || "保存失败"
}

export function useAutomationEditor({ mode, initialSession, initialStep, onBack, onSaved }: EditorOptions) {
  const bridge = useMemo(() => requireBridgeDomain("automation"), [])
  const [loadState, setLoadState] = useState<AutomationEditorLoadState>(() => initialSession
    ? { status: "ready", draft: initialSession.draft, item: initialSession.item }
    : mode.mode === "create" ? { status: "ready", draft: createDefaultAutomationDraft(generateAutomationDraftName([])) } : { status: "loading" })
  const baseline = useRef(JSON.stringify(initialSession?.savedDraft ?? (loadState.status === "ready" ? loadState.draft : null)))
  const [saving, setSaving] = useState(false)
  const [step] = useState<AutomationEditorStep>(initialSession?.step ?? initialStep ?? "trigger")
  const [choosingType, setChoosingType] = useState(false)
  const [previousTriggerTypes, setPreviousTriggerTypes] = useState<readonly string[]>(initialSession?.previousTriggerTypes ?? [])
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  const revision = useRef(0)
  const mounted = useRef(true)
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
    if (initialSession && reloadKey === 0) return
    let cancelled = false
    const version = revision.current
    if (modeId) {
      setLoadState({ status: "loading" })
      void bridge.item.get(modeId).then(item => {
        if (cancelled) return
        if (item) installItem(item)
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
  }, [bridge, initialSession, installItem, modeId, reloadKey])

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
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setLeaveKind(kind)
  }, [])

  useEffect(() => registerNavigationGuard(() => {
    if (savingRef.current) return false
    if (!dirtyRef.current) return true
    navigationReply.current?.(false)
    requestLeave("navigation")
    return new Promise<boolean>(resolve => { navigationReply.current = resolve })
  }), [requestLeave])

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

  async function save(enable: boolean) {
    if (savingRef.current || choosingType || loadState.status !== "ready") return
    const { draft, item } = loadState
    revision.current += 1
    const finish = startTrackedOperation({ component: "automation", eventKey: item ? "automation.editor.save" : "automation.editor.create" })
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      validateChangedTriggerVariables(draft, previousTriggerTypes)
      const saved = item
        ? await bridge.item.update({ id: item.id, patch: buildAutomationUpdateInputFromDraft(draft, enable ? true : undefined) })
        : await bridge.item.create(buildAutomationCreateInputFromDraft(draft, enable))
      if (mounted.current) {
        installItem(saved)
        setLeaveKind(null)
        navigationReply.current?.(false)
        navigationReply.current = null
        onSaved?.(saved)
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
  }

  function back() {
    if (savingRef.current) return
    if (dirtyRef.current) requestLeave("back")
    else onBack()
  }

  function resolveLeave(action: "continue" | "stash" | "discard") {
    if (savingRef.current) return
    const kind = leaveKind
    setLeaveKind(null)
    if (action === "continue") {
      navigationReply.current?.(false)
      navigationReply.current = null
      returnFocus.current?.focus()
      return
    }
    if (action === "stash" && kind === "back" && loadState.status === "ready") {
      onBack({ step, previousTriggerTypes, draft: loadState.draft, item: loadState.item, savedDraft: JSON.parse(baseline.current) as AutomationEditorDraft })
      return
    }
    dirtyRef.current = false
    if (loadState.status === "ready") baseline.current = JSON.stringify(loadState.draft)
    if (kind === "navigation") {
      navigationReply.current?.(true)
      navigationReply.current = null
    } else if (kind === "close") window.close()
    else onBack()
  }

  return { loadState, dirty, saving, error, leaveKind, step, choosingType, setChoosingType, changeTrigger, changeExecutor, stopRun, updateDraft, save, back, resolveLeave, retry: () => setReloadKey(key => key + 1) }
}
