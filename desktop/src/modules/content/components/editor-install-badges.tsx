import { useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { toast } from "sonner"
import { installSourceToEditorTargets } from "@/app-shell/installers"
import { createRendererLogger } from "@/app-shell/logging"
import { EditorIcon } from "@/components/editor-icon"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { editorDefinitions } from "@/definitions/generated/renderer-registry"
import { useInstallStatus, useUninstallFromEditor } from "@/modules/content/contexts/install-status-context"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorAdapterSummary, SynapseEditorId } from "@/types/editor"
import type { InstallStatusEntry } from "@/types/install-status"
import type {
  SynapseInstallSourceTargetResult,
  SynapseSkillInstallerSource,
} from "@/types/installers"

const logger = createRendererLogger("content.skill-install-targets")

const editorLabelMap = new Map<string, string>(
  editorDefinitions.map((definition) => [definition.id, definition.label]),
)

type InstallFeedback = {
  editorId: SynapseEditorId
  message: string
}

function getEditorLabel(editorId: string): string {
  return editorLabelMap.get(editorId) ?? editorId
}

function createSkillInstallerSource(item: SynapseContentMeta<"skill">): SynapseSkillInstallerSource {
  return {
    description: item.description,
    kind: "skill",
    name: item.name ?? item.id,
    origin: "repository",
    repositoryContentId: item.id,
    sourceIdentity: item.id,
    title: item.title,
  }
}

function collectInstallFeedback(results: SynapseInstallSourceTargetResult[]): {
  failures: InstallFeedback[]
  warnings: InstallFeedback[]
} {
  return {
    failures: results.flatMap((result) => result.status === "failed"
      ? [{ editorId: result.target.editorId, message: result.error ?? "更新失败" }]
      : []),
    warnings: results.flatMap((result) => (
      result.status === "installed" && result.result?.warning
        ? [{ editorId: result.target.editorId, message: result.result.warning }]
        : []
    )),
  }
}

function RuleEditorBadge({
  contentId,
  editorId,
}: {
  contentId: string
  editorId: SynapseEditorId
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const uninstall = useUninstallFromEditor()
  const label = getEditorLabel(editorId)

  async function handleUninstall() {
    setBusy(true)
    try {
      const result = await uninstall(contentId, editorId)
      setOpen(false)
      if (result.warning) toast.warning(result.warning)
    } catch {
      toast.error("卸载失败，请重试。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded transition-opacity hover:opacity-80"
          title={label}
        >
          <EditorIcon editorId={editorId} className="size-5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <EditorIcon editorId={editorId} className="size-5" />
            <span>从 {label} 移到废纸篓？</span>
          </AlertDialogTitle>
          <AlertDialogDescription>可从系统废纸篓恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="gap-2"
            onClick={(event) => {
              event.preventDefault()
              void handleUninstall()
            }}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {busy ? "正在移到废纸篓..." : "移到废纸篓"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SkillInstallTargetButton({
  editorId,
  onClick,
  preparing,
  skillName,
}: {
  editorId: SynapseEditorId
  onClick: () => void
  preparing: boolean
  skillName: string
}) {
  const label = getEditorLabel(editorId)
  return (
    <button
      type="button"
      aria-label={`在 ${label} 中重新安装 ${skillName}`}
      className="flex size-5 items-center justify-center rounded transition-opacity hover:opacity-80 disabled:opacity-50"
      disabled={preparing}
      title={`在 ${label} 中重新安装`}
      onClick={onClick}
    >
      {preparing
        ? <LoaderCircle className="size-4 animate-spin" />
        : <EditorIcon editorId={editorId} className="size-5" />}
    </button>
  )
}

function SkillReinstallDialog({
  onOpenChange,
  source,
  target,
}: {
  onOpenChange: (open: boolean) => void
  source: SynapseSkillInstallerSource
  target: SynapseEditorAdapterSummary
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")

  async function reinstall() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const result = await installSourceToEditorTargets({
        mode: "reinstall",
        source,
        targets: [{ editorId: target.id, scope: "global" }],
      })
      const item = result.results[0]
      if (!item || item.status === "failed") {
        setError(item?.error ?? "重新安装失败")
        return
      }
      if (item.result?.warning) {
        setWarning(item.result.warning)
        return
      }
      onOpenChange(false)
      toast.success("Skill 已重新安装")
    } catch (installError) {
      const message = installError instanceof Error ? installError.message : "重新安装失败"
      logger.error("Failed to reinstall Skill target.", {
        editorId: target.id,
        errorName: installError instanceof Error ? installError.name : typeof installError,
      })
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      data-track="skill-reinstall-dialog"
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open)
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{warning ? "重新安装完成，需检查" : "重新安装 Skill"}</DialogTitle>
          <DialogDescription className="sr-only">
            在 {target.label} 中重新安装当前 Skill。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 py-2">
          <EditorIcon editorId={target.id} className="size-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex min-h-7 items-center text-sm font-medium">{target.label}</p>
            {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
            {warning ? <p className="mt-1 text-xs text-muted-foreground">{warning}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {warning ? "关闭" : "取消"}
          </Button>
          {!warning ? (
            <Button type="button" disabled={busy} onClick={() => void reinstall()}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? "正在重新安装" : error ? "重试" : "重新安装"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillUpdateDialog({
  initialTargets,
  onOpenChange,
  source,
}: {
  initialTargets: SynapseEditorAdapterSummary[]
  onOpenChange: (open: boolean) => void
  source: SynapseSkillInstallerSource
}) {
  const [targets, setTargets] = useState(initialTargets)
  const [selectedEditorIds, setSelectedEditorIds] = useState<Set<SynapseEditorId>>(
    () => new Set(initialTargets.map((target) => target.id)),
  )
  const [failures, setFailures] = useState<InstallFeedback[]>([])
  const [warnings, setWarnings] = useState<InstallFeedback[]>([])
  const [busy, setBusy] = useState(false)

  const failureByEditorId = useMemo(
    () => new Map(failures.map((failure) => [failure.editorId, failure.message])),
    [failures],
  )
  const warningByEditorId = useMemo(
    () => new Map(warnings.map((warning) => [warning.editorId, warning.message])),
    [warnings],
  )
  const hasFailures = failures.length > 0
  const hasWarnings = warnings.length > 0
  const selectableTargets = hasFailures || hasWarnings
    ? targets.filter((target) => failureByEditorId.has(target.id))
    : targets
  const selectableEditorIds = selectableTargets.map((target) => target.id)
  const selectedCount = selectableEditorIds.filter((editorId) => selectedEditorIds.has(editorId)).length
  const allChecked = selectableEditorIds.length > 0 && selectedCount === selectableEditorIds.length
  const allCheckState = selectedCount > 0 && !allChecked ? "indeterminate" : allChecked

  function updateSelection(editorId: SynapseEditorId, checked: boolean) {
    setSelectedEditorIds((current) => {
      const next = new Set(current)
      if (checked) next.add(editorId)
      else next.delete(editorId)
      return next
    })
  }

  function updateAllSelections(checked: boolean) {
    setSelectedEditorIds((current) => {
      const next = new Set(current)
      for (const editorId of selectableEditorIds) {
        if (checked) next.add(editorId)
        else next.delete(editorId)
      }
      return next
    })
  }

  async function updateSelectedTargets() {
    const requestedTargets = targets.filter((target) => selectedEditorIds.has(target.id))
    if (busy || requestedTargets.length === 0) return

    setBusy(true)
    setFailures([])
    try {
      const result = await installSourceToEditorTargets({
        mode: "update",
        source,
        targets: requestedTargets.map((target) => ({ editorId: target.id, scope: "global" })),
      })
      const feedback = collectInstallFeedback(result.results)
      const nextWarnings = [
        ...warnings,
        ...feedback.warnings,
      ].filter((warning, index, items) => (
        items.findIndex((candidate) => candidate.editorId === warning.editorId) === index
      ))

      if (feedback.failures.length === 0 && nextWarnings.length === 0) {
        onOpenChange(false)
        toast.success("Skill 已更新")
        return
      }

      const visibleEditorIds = new Set([
        ...feedback.failures.map((failure) => failure.editorId),
        ...nextWarnings.map((warning) => warning.editorId),
      ])
      setTargets((current) => current.filter((target) => visibleEditorIds.has(target.id)))
      setSelectedEditorIds(new Set(feedback.failures.map((failure) => failure.editorId)))
      setFailures(feedback.failures)
      setWarnings(nextWarnings)
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "更新失败"
      logger.error("Failed to update Skill targets.", {
        errorName: updateError instanceof Error ? updateError.name : typeof updateError,
        targetCount: requestedTargets.length,
      })
      setTargets(requestedTargets)
      setSelectedEditorIds(new Set(requestedTargets.map((target) => target.id)))
      setFailures(requestedTargets.map((target) => ({ editorId: target.id, message })))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      data-track="skill-update-dialog"
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open)
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{hasFailures ? "部分更新失败" : hasWarnings ? "更新完成，需检查" : "更新 Skill"}</DialogTitle>
          <DialogDescription className="sr-only">
            选择需要更新的安装目标。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto">
          <label
            className="flex items-center gap-3 rounded-md px-2 py-2 font-medium hover:bg-muted/50"
            htmlFor="skill-update-select-all"
          >
            <Checkbox
              aria-label="全选安装目标"
              checked={allCheckState}
              disabled={busy || selectableEditorIds.length === 0}
              id="skill-update-select-all"
              onCheckedChange={(checked) => updateAllSelections(checked === true)}
            />
            <span>全选</span>
          </label>
          {targets.map((target) => {
            const failure = failureByEditorId.get(target.id)
            const warning = warningByEditorId.get(target.id)
            const selectable = !hasFailures && !hasWarnings || Boolean(failure)
            return (
              <label
                key={target.id}
                className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                htmlFor={`skill-update-target-${target.id}`}
              >
                <Checkbox
                  aria-label={`更新 ${target.label}`}
                  checked={selectedEditorIds.has(target.id)}
                  className="mt-1"
                  disabled={busy || !selectable}
                  id={`skill-update-target-${target.id}`}
                  onCheckedChange={(checked) => updateSelection(target.id, checked === true)}
                />
                <EditorIcon editorId={target.id} className="size-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="flex min-h-6 items-center text-sm font-medium">{target.label}</p>
                  {failure ? <p className="mt-1 text-xs text-destructive" role="alert">{failure}</p> : null}
                  {warning ? <p className="mt-1 text-xs text-muted-foreground">{warning}</p> : null}
                </div>
              </label>
            )
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {hasFailures || hasWarnings ? "关闭" : "取消"}
          </Button>
          {selectableEditorIds.length > 0 ? (
            <Button
              type="button"
              disabled={busy || selectedCount === 0}
              onClick={() => void updateSelectedTargets()}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? "正在更新" : hasFailures ? "重试失败项" : "更新"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillInstallBadges({
  entries,
  item,
}: {
  entries: InstallStatusEntry[]
  item: SynapseContentMeta<"skill">
}) {
  const [preparingEditorId, setPreparingEditorId] = useState<SynapseEditorId | null>(null)
  const [reinstallTarget, setReinstallTarget] = useState<SynapseEditorAdapterSummary | null>(null)
  const [updateTargets, setUpdateTargets] = useState<SynapseEditorAdapterSummary[]>([])
  const source = useMemo(() => createSkillInstallerSource(item), [item])
  const { load } = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: true,
    loggerName: "content.skill-install-targets.adapters",
  })
  const globalEntries = entries.filter((entry) => entry.scope === "global")
  const updateEditorIds = new Set(
    globalEntries.filter((entry) => entry.status === "needs_update").map((entry) => entry.editorId),
  )

  async function loadGlobalTarget(editorId: SynapseEditorId): Promise<SynapseEditorAdapterSummary | null> {
    const adapters = await load()
    return adapters.find((adapter) => adapter.id === editorId && adapter.supportsGlobal) ?? null
  }

  async function openReinstallDialog(editorId: SynapseEditorId) {
    setPreparingEditorId(editorId)
    try {
      const target = await loadGlobalTarget(editorId)
      if (!target) {
        toast.error("当前安装目标不可用")
        return
      }
      setReinstallTarget(target)
    } finally {
      setPreparingEditorId(null)
    }
  }

  async function openUpdateDialog() {
    const adapters = await load()
    const targets = adapters.filter((adapter) => adapter.supportsGlobal && updateEditorIds.has(adapter.id))
    if (targets.length === 0) {
      toast.error("当前没有可更新的安装目标")
      return
    }
    setUpdateTargets(targets)
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        {entries.map((entry) => entry.scope === "global" ? (
          <SkillInstallTargetButton
            key={`${entry.scope}:${entry.editorId}`}
            editorId={entry.editorId}
            preparing={preparingEditorId === entry.editorId}
            skillName={source.name}
            onClick={() => void openReinstallDialog(entry.editorId)}
          />
        ) : (
          <ProjectEditorBadge
            key={`${entry.scope}:${entry.editorId}:${entry.projectPath ?? ""}`}
            entry={entry}
          />
        ))}
        {updateEditorIds.size > 0 ? (
          <Badge asChild variant="secondary">
            <button
              type="button"
              aria-label={`更新 ${source.name}`}
              title="更新 Skill"
              onClick={() => void openUpdateDialog()}
            >
              可更新
            </button>
          </Badge>
        ) : null}
      </div>
      {reinstallTarget ? (
        <SkillReinstallDialog
          key={reinstallTarget.id}
          source={source}
          target={reinstallTarget}
          onOpenChange={(open) => {
            if (!open) setReinstallTarget(null)
          }}
        />
      ) : null}
      {updateTargets.length > 0 ? (
        <SkillUpdateDialog
          initialTargets={updateTargets}
          source={source}
          onOpenChange={(open) => {
            if (!open) setUpdateTargets([])
          }}
        />
      ) : null}
    </>
  )
}

function EditorInstallBadges({ item }: { item: SynapseContentMeta }) {
  const entries = useInstallStatus(item.id)

  if (entries.length === 0) return null
  if (item.type === "skill") {
    return <SkillInstallBadges entries={entries} item={item} />
  }

  const hasUpdate = entries.some((entry) => entry.scope === "global" && entry.status === "needs_update")
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {entries.map((entry) => entry.scope === "global" ? (
        <RuleEditorBadge
          key={`${entry.scope}:${entry.editorId}`}
          contentId={item.id}
          editorId={entry.editorId}
        />
      ) : (
        <ProjectEditorBadge
          key={`${entry.scope}:${entry.editorId}:${entry.projectPath ?? ""}`}
          entry={entry}
        />
      ))}
      {hasUpdate ? (
        <Badge variant="secondary" title="已安装版本落后">可更新</Badge>
      ) : null}
    </div>
  )
}

function ProjectEditorBadge({ entry }: { entry: InstallStatusEntry }) {
  const label = getEditorLabel(entry.editorId)
  const projectName = entry.projectName ?? "项目"
  return (
    <span
      className="flex size-5 items-center justify-center rounded"
      title={`${label} · ${projectName}`}
    >
      <EditorIcon editorId={entry.editorId} className="size-5" />
    </span>
  )
}

export { EditorInstallBadges }
