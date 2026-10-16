import { useRef, useState } from "react"
import type { DriveItemDto, DriveSyncBindingDto, DriveSyncBindingPreviewDto, DriveSyncCreateSafeBindingInput } from "@synapse/shared"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { DriveSyncController } from "./use-drive-sync"
import { localSyncBasename, syncRemotePath, syncWizardSteps, type SyncWizardEdit, type SyncWizardOperation, type SyncWizardScenario, type SyncWizardStep } from "./drive-sync-flow"

export type DriveSyncWizardEntry =
  | { readonly mode: "item"; readonly item: DriveItemDto; readonly drivePathHint: string | null }
  | { readonly mode: "local"; readonly targetParentId: string | null; readonly drivePathHint: string | null }
  | { readonly mode: "edit"; readonly binding: DriveSyncBindingDto }

export function useDriveSyncWizard(controller: DriveSyncController, entry: DriveSyncWizardEntry, onBindingCreated?: (binding: DriveSyncBindingDto) => void | Promise<void>) {
  const operation: SyncWizardOperation = entry.mode === "edit" ? "edit" : "create"
  const [step, setStep] = useState<SyncWizardStep>(entry.mode === "edit" ? "edit" : entry.mode === "item" ? "local" : "scenario")
  const binding = entry.mode === "edit" ? entry.binding : null
  const [edit, setEdit] = useState<SyncWizardEdit | "">("")
  const [kind, setKind] = useState<"file" | "folder" | "">(entry.mode === "edit" ? entry.binding.kind : entry.mode === "item" ? entry.item.type : "")
  const [scenario, setScenario] = useState<SyncWizardScenario | "">(entry.mode === "edit" ? "bind_existing" : "")
  const [localPath, setLocalPath] = useState(entry.mode === "edit" ? entry.binding.localPath : "")
  const [remote, setRemote] = useState<{ id: string; name: string; path: string } | null>(entry.mode === "edit"
    ? { id: entry.binding.driveItemId, name: entry.binding.driveItemName, path: entry.binding.drivePathHint ?? entry.binding.driveItemName }
    : entry.mode === "item" ? { id: entry.item.id, name: entry.item.name, path: entry.drivePathHint ?? entry.item.name } : null)
  const [parent, setParent] = useState<{ id: string | null; path: string }>({ id: null, path: "/" })
  const [name, setName] = useState("")
  const [authority, setAuthority] = useState<"local" | "remote" | "">("")
  const [defaults, setDefaults] = useState(entry.mode === "edit" ? entry.binding.excludeRules.defaults.length > 0 : true)
  const [importGitignore, setImportGitignore] = useState(false)
  const [rulesText, setRulesText] = useState(entry.mode === "edit" ? entry.binding.excludeRules.user.join("\n") : "")
  const [preview, setPreview] = useState<DriveSyncBindingPreviewDto | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ binding?: DriveSyncBindingDto; title: string; detail?: string } | null>(null)
  const steps = syncWizardSteps(operation, kind, scenario, edit, entry.mode === "item")
  const currentIndex = steps.findIndex((item) => item.id === step)
  const rules = rulesText.split("\n").filter((rule) => rule.trim().length > 0)
  const remotePath = scenario === "local_to_remote" ? syncRemotePath(parent.path, name) : remote?.path ?? ""
  function invalidate() { setPreview(null); setConfirmed(false); setError(null) }
  function chooseKind(value: "file" | "folder") {
    if (!canChoose || entry.mode !== "local") return
    setStep(scenario === "remote_to_local" ? "remote" : "local")
    if (value === kind) return
    invalidate(); setKind(value); setLocalPath(""); setRemote(null); setAuthority(""); setName("")
    setDefaults(true); setRulesText(""); setImportGitignore(false)
  }
  function chooseScenario(value: SyncWizardScenario) {
    if (!canChoose || entry.mode !== "local") return
    setStep("kind")
    if (value === scenario) return
    invalidate(); setScenario(value); setLocalPath(""); setAuthority(""); setName(""); setRemote(null)
    setParent({ id: entry.targetParentId, path: entry.drivePathHint ?? "/" })
  }
  function chooseEdit(value: SyncWizardEdit) {
    if (!canChoose || (value === "range" && kind !== "folder")) return
    setStep(value === "align" ? "authority" : value)
    invalidate(); setEdit(value); setAuthority("")
    if (binding) {
      setLocalPath(binding.localPath)
      setRemote({ id: binding.driveItemId, name: binding.driveItemName, path: binding.drivePathHint ?? binding.driveItemName })
      setRulesText(binding.excludeRules.user.join("\n"))
      setDefaults(binding.excludeRules.defaults.length > 0)
    }
  }
  function input(selectedAuthority = authority): DriveSyncCreateSafeBindingInput {
    if (!kind || !scenario) throw new Error("请先选择类型和起始情况")
    return {
      driveItemId: scenario === "local_to_remote" ? `local:${localPath}` : remote!.id,
      driveItemName: scenario === "local_to_remote" ? name : remote!.name,
      kind, localPath, drivePathHint: remotePath, direction: scenario,
      targetParentId: scenario === "local_to_remote" ? parent.id : undefined,
      authority: scenario === "bind_existing" ? selectedAuthority || undefined : undefined,
      replaceBindingId: operation === "edit" ? binding?.id : undefined,
      excludeRules: operation === "edit" && binding ? [...binding.excludeRules.defaults, ...binding.excludeRules.importedGitignore, ...rules] : rules,
      useDefaultExcludes: operation === "edit" ? false : kind === "folder" && defaults,
      importGitignore: operation === "create" && kind === "folder" && importGitignore,
      confirmationToken: preview?.confirmationToken,
    }
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试") }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function pickLocal(mode = scenario || "remote_to_local") {
    if (!canChoose) return
    await run(async () => {
      if (!kind) return
      const chosen = await controller.chooseLocalPath({ kind, mode, defaultName: remote?.name })
      if (!chosen) return
      invalidate(); setLocalPath(chosen); setScenario(mode)
      if (mode !== scenario || chosen !== localPath) setAuthority("")
      if (mode === "local_to_remote") setName(localSyncBasename(chosen))
    })
  }
  const canAssociateDestination = scenario === "remote_to_local" && preview?.status === "blocked" && preview.localKind === kind
  function associateDestination() {
    if (!canChoose || !canAssociateDestination) return
    invalidate(); setScenario("bind_existing"); setAuthority(""); setStep("authority")
  }
  function changeDestination() {
    if (!canChoose) return
    invalidate(); setStep("local")
  }
  async function check(selectedAuthority = authority) {
    invalidate()
    if (operation === "edit" && edit === "range") return
    const data = input(selectedAuthority)
    const response = await controller.preview({ ...data, remoteExists: scenario !== "local_to_remote", directionHint: data.direction })
    setPreview(response)
    if (response.status === "blocked") setError(response.reason)
  }
  async function submit() {
    if (controller.readOnly) throw new Error(controller.offline ? "联网后可管理同步" : "登录后可管理同步")
    if (operation === "edit" && edit === "range" && binding) {
      await controller.updateExcludes({ id: binding.id, defaults: defaults ? binding.excludeRules.defaults : [], importedGitignore: binding.excludeRules.importedGitignore, user: rules })
      setResult({ title: "已更新同步范围", binding })
    } else {
      if (!preview || preview.status !== "ready" || (preview.alignment?.changes.length && !confirmed)) return
      const created = await controller.createBinding(input())
      const failed = created.status === "error" || created.status === "conflict" || Boolean(created.lastError)
      setResult({ title: failed ? "同步需要处理" : created.status === "paused" ? "已保存，保持暂停" : "已开启同步", binding: created, detail: created.lastError ?? undefined })
      await controller.refresh()
      await onBindingCreated?.(created)
      return
    }
    await controller.refresh()
  }
  function next() {
    if (!canNext) return
    void run(async () => {
      if (step === "confirm") {
        const eventKey = operation === "edit" ? "drive.sync.binding.update" : "drive.sync.binding.create"
        const finish = startTrackedOperation({ component: "drive", eventKey })
        try { await submit(); finish("success") } catch (cause) { finish("failure"); invalidate(); throw cause }
        return
      }
      const nextStep = steps[currentIndex + 1]?.id
      if (!nextStep) return
      setStep(nextStep)
      if (nextStep === "confirm") await check()
    })
  }
  const canChoose = !busyRef.current && !controller.readOnly && !controller.loading && !controller.error
  function chooseAuthority(value: "local" | "remote") {
    if (!canChoose) return
    invalidate(); setAuthority(value)
    const nextStep = steps[currentIndex + 1]?.id
    if (!nextStep) return
    setStep(nextStep)
    if (nextStep === "confirm") void run(() => check(value))
  }
  const choiceStep = ["kind", "scenario", "edit", "authority"].includes(step)
  const canNext = canChoose && ({
    kind: Boolean(kind), scenario: Boolean(scenario), edit: Boolean(edit),
    local: Boolean(scenario && localPath.trim()), remote: scenario === "local_to_remote" ? Boolean(name.trim()) && !/[\\/]/.test(name) && name !== "." && name !== ".." : Boolean(remote),
    authority: Boolean(authority), range: true,
    confirm: operation === "edit" && edit === "range"
      ? Boolean(binding && controller.snapshot?.bindings.some((item) => item.id === binding.id && item.status !== "removed"))
      : preview?.status === "ready" && (!preview.alignment?.changes.length || confirmed),
  }[step])
  return { operation, step, kind, scenario, binding, edit, localPath, remote, parent, name, authority, defaults, importGitignore, rulesText,
    preview, confirmed, busy, error, result, steps, remotePath, canNext, canChoose, choiceStep, chooseAuthority, chooseKind, chooseScenario, chooseEdit, canAssociateDestination, associateDestination, changeDestination,
    next, pickLocal, recheck: () => { void run(() => check()) }, back: () => { invalidate(); setStep(steps[currentIndex - 1]?.id ?? steps[0].id) },
    setLocalPath: (value: string) => { invalidate(); setLocalPath(value) },
    setRemote: (item: DriveItemDto, itemPath: string) => { invalidate(); setRemote({ id: item.id, name: item.name, path: itemPath }); if (scenario === "remote_to_local") setLocalPath("") },
    setParent: (value: { id: string | null; path: string }) => { invalidate(); setParent(value) },
    setName: (value: string) => { invalidate(); setName(value) },
    setAuthority: (value: "local" | "remote") => { invalidate(); setAuthority(value) },
    setDefaults: (value: boolean) => { invalidate(); setDefaults(value) },
    setImportGitignore: (value: boolean) => { invalidate(); setImportGitignore(value) },
    setRulesText: (value: string) => { invalidate(); setRulesText(value) }, setConfirmed,
  }
}
