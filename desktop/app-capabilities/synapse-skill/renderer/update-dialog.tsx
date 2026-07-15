import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { inspectGlobalSkillInstallations, installSourceToEditorTargets } from "../../../src/app-shell/installers"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { EditorIcon } from "../../../src/components/editor-icon"
import { Button } from "../../../src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type { SynapseEditorInstallStatusEntry } from "../../../src/types/editor-install-status"
import type { SynapseSkillInstallerSource } from "../../../src/types/installers"

const logger = createRendererLogger("synapse-skill.update-dialog")
const DISMISSED_SESSION_KEY = "synapse:synapse-skill-update-dismissed"

type UpdateFailure = {
  readonly editorId: SynapseEditorInstallStatusEntry["editorId"]
  readonly message: string
}

function wasDismissedForCurrentProcess(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_SESSION_KEY) === "true"
  } catch {
    return false
  }
}

function dismissForCurrentProcess(): void {
  try {
    window.sessionStorage.setItem(DISMISSED_SESSION_KEY, "true")
  } catch (error) {
    logger.warn("Failed to remember the Synapse Skill update prompt dismissal.", error)
  }
}

function SynapseSkillUpdateDialogHost({ enabled = true }: { readonly enabled?: boolean }) {
  const checkPromiseRef = useRef<Promise<{
    source: SynapseSkillInstallerSource
    targets: SynapseEditorInstallStatusEntry[]
  } | null> | null>(null)
  const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [targets, setTargets] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [failures, setFailures] = useState<UpdateFailure[]>([])
  const [warnings, setWarnings] = useState<UpdateFailure[]>([])
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (!enabled || wasDismissedForCurrentProcess()) return

    if (!checkPromiseRef.current) {
      checkPromiseRef.current = (async () => {
        try {
          const nextSource = await requireBridgeDomain("synapseSkill").prepareInstallSource()
          const result = await inspectGlobalSkillInstallations(nextSource)
          const nextTargets = result.entries.filter(
            (entry) => entry.scope === "global" && entry.status === "needs_update",
          )
          return nextTargets.length > 0 ? { source: nextSource, targets: nextTargets } : null
        } catch (error) {
          logger.error("Failed to inspect global Synapse Skill installations.", error)
          return null
        }
      })()
    }

    let cancelled = false
    void checkPromiseRef.current.then((result) => {
      if (cancelled || !result) return
      setSource(result.source)
      setTargets(result.targets)
      setOpen(true)
    })

    return () => {
      cancelled = true
    }
  }, [enabled])

  const closeDialog = () => {
    if (updating) return
    dismissForCurrentProcess()
    setOpen(false)
  }

  const updateTargets = async (
    requestedTargets: SynapseEditorInstallStatusEntry[] = targets,
    retainedWarnings: UpdateFailure[] = [],
  ) => {
    if (!source || requestedTargets.length === 0 || updating) return

    setUpdating(true)
    setFailures([])
    setWarnings(retainedWarnings)
    try {
      const result = await installSourceToEditorTargets({
        mode: "update",
        source,
        targets: requestedTargets.map((entry) => ({
          editorId: entry.editorId,
          scope: "global",
        })),
      })
      const nextFailures = result.results.flatMap((item) => item.status === "failed"
        ? [{ editorId: item.target.editorId, message: item.error ?? "更新失败" }]
        : [])
      const nextWarnings = [
        ...retainedWarnings,
        ...result.results.flatMap((item) => (
          item.status === "installed" && item.result?.warning
            ? [{ editorId: item.target.editorId, message: item.result.warning }]
            : []
        )),
      ]

      if (nextFailures.length === 0 && nextWarnings.length === 0) {
        setOpen(false)
        setTargets([])
        toast.success("Synapse Skill 已更新")
        return
      }

      const failedEditorIds = new Set(nextFailures.map((item) => item.editorId))
      const visibleEditorIds = new Set([...failedEditorIds, ...nextWarnings.map((item) => item.editorId)])
      setTargets((current) => current.filter((entry) => visibleEditorIds.has(entry.editorId)))
      setFailures(nextFailures)
      setWarnings(nextWarnings)
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新失败"
      logger.error("Failed to update global Synapse Skill installations.", error)
      setFailures(requestedTargets.map((entry) => ({ editorId: entry.editorId, message })))
    } finally {
      setUpdating(false)
    }
  }

  const failureByEditorId = new Map(failures.map((failure) => [failure.editorId, failure.message]))
  const warningByEditorId = new Map(warnings.map((warning) => [warning.editorId, warning.message]))
  const hasFailures = failures.length > 0
  const hasWarnings = warnings.length > 0

  const retryFailedTargets = () => {
    const failedEditorIds = new Set(failures.map((failure) => failure.editorId))
    return updateTargets(
      targets.filter((entry) => failedEditorIds.has(entry.editorId)),
      warnings,
    )
  }

  return (
    <Dialog
      open={open}
      data-track="synapse-skill-update-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog()
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!updating}
        onEscapeKeyDown={(event) => {
          if (updating) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (updating) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{hasFailures ? "部分更新失败" : hasWarnings ? "更新完成，需检查" : "Synapse Skill 可更新"}</DialogTitle>
          <DialogDescription>
            {hasFailures
              ? `${failures.length} 个全局安装需要重试。`
              : hasWarnings
                ? `${warnings.length} 个全局安装需要手动检查。`
              : `检测到 ${targets.length} 个全局安装需要更新。`}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border">
          {targets.map((entry) => {
            const failure = failureByEditorId.get(entry.editorId)
            const warning = warningByEditorId.get(entry.editorId)
            return (
              <div key={entry.editorId} className="flex items-start gap-3 py-3 first:pt-1 last:pb-1">
                <EditorIcon editorId={entry.editorId} className="mt-0.5 size-7 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{entry.editorLabel}</p>
                  {entry.targetPath ? (
                    <p className="truncate text-xs text-muted-foreground" title={entry.targetPath}>
                      {entry.targetPath}
                    </p>
                  ) : null}
                  {failure ? (
                    <p className="mt-1 text-xs text-destructive" role="alert">{failure}</p>
                  ) : null}
                  {warning ? <p className="mt-1 text-xs text-muted-foreground">{warning}</p> : null}
                </div>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={updating} onClick={closeDialog}>
            {hasFailures || hasWarnings ? "关闭" : "稍后"}
          </Button>
          {!hasWarnings || hasFailures ? <Button type="button" disabled={updating} onClick={() => void (hasFailures ? retryFailedTargets() : updateTargets())}>
            {updating ? <Spinner data-icon="inline-start" /> : null}
            {updating ? "正在更新" : hasFailures ? "重试失败项" : "更新"}
          </Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { SynapseSkillUpdateDialogHost }
