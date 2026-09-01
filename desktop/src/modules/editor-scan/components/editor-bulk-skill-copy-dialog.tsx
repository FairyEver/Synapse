import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { copyToEditor, resolveEditorCopyTarget } from "@/app-shell/editor-copy"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { EditorIcon } from "@/components/editor-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "@/modules/content/components/editor-write-target-selector"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import {
  buildBulkSkillCopySummary,
  classifyBulkSkillCopyPreflight,
  createBulkSkillCopyPayload,
  createUnavailablePreflightItem,
  isExecutablePreflightItem,
  type BulkSkillCopyPreflightItem,
  type BulkSkillCopyResultItem,
} from "@/modules/editor-scan/lib/bulk-skill-copy"
import { createCopySource, type EditorScanSkillCopyItem } from "@/modules/editor-scan/lib/editor-copy-source"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

type EditorBulkSkillCopyDialogProps = {
  items: EditorScanSkillCopyItem[]
  onCopied?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
}

const logger = createRendererLogger("editor-scan.bulk-copy")

function EditorBulkSkillCopyDialog({
  items,
  onCopied,
  onOpenChange,
  open,
}: EditorBulkSkillCopyDialogProps) {
  const { config } = useAppConfig()
  const { error: notifyError, promise, success, warning } = useAppNotifications()
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [preflightItems, setPreflightItems] = useState<BulkSkillCopyPreflightItem[]>([])
  const [results, setResults] = useState<BulkSkillCopyResultItem[]>([])
  const [isPreflighting, setIsPreflighting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const {
    error: adaptersError,
    filteredAdapters,
    isLoading: isLoadingAdapters,
    load: loadEditors,
  } = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: open,
    loggerName: "editor-scan.bulk-copy",
  })

  const scope = selection?.scope ?? "global"
  const projectPath = selection?.projectPath ?? ""
  const executableItems = preflightItems.filter(isExecutablePreflightItem)
  const overwriteCount = preflightItems.filter((item) => item.status === "overwrite").length
  const readyCount = preflightItems.filter((item) => item.status === "ready").length
  const unavailableCount = preflightItems.filter((item) => item.status === "unavailable").length
  const canCopy = Boolean(selectedEditor && executableItems.length > 0 && !isPreflighting && !isCopying)
  const resultSummary = useMemo(() => buildBulkSkillCopySummary(results), [results])

  useEffect(() => {
    if (!open) {
      setSelectedEditor(null)
      setSelection(null)
      setPreflightItems([])
      setResults([])
      setIsPreflighting(false)
      setIsCopying(false)
      setCopyError(null)
      return
    }

    loadEditors()
  }, [loadEditors, open])

  const resolveTarget = useCallback((input: ResolveEditorTargetInput) => {
    const firstItem = items[0]
    if (!firstItem) {
      throw new Error("当前没有可复制的 Skill。")
    }

    return resolveEditorCopyTarget({
      source: createCopySource(firstItem),
      targetEditorId: input.editorId,
      targetProjectPath: input.scope === "project" ? input.projectPath : undefined,
      targetScope: input.scope,
    })
  }, [items])

  const runPreflight = useCallback(async () => {
    if (!selectedEditor || !selection?.activeTarget || (scope === "project" && !projectPath)) {
      setPreflightItems([])
      return
    }

    setIsPreflighting(true)
    setCopyError(null)
    setResults([])

    const nextItems: BulkSkillCopyPreflightItem[] = []
    for (const item of items) {
      const source = createCopySource(item)
      try {
        const target = await resolveEditorCopyTarget({
          source,
          targetEditorId: selectedEditor.id,
          targetProjectPath: scope === "project" ? projectPath : undefined,
          targetScope: scope,
        })
        nextItems.push(classifyBulkSkillCopyPreflight(item, source, target))
      } catch (error) {
        logger.warn("Bulk Skill copy preflight item failed.", {
          editorId: selectedEditor.id,
          error,
          itemName: item.name,
          scope,
        })
        nextItems.push(createUnavailablePreflightItem(item, source, error))
      }
    }

    const preflightSummary = nextItems.reduce(
      (summary, item) => {
        summary.total += 1
        if (item.status === "ready") summary.ready += 1
        if (item.status === "overwrite") summary.overwrite += 1
        if (item.status === "unavailable") summary.unavailable += 1
        return summary
      },
      { overwrite: 0, ready: 0, total: 0, unavailable: 0 },
    )
    logger.info("Bulk Skill copy preflight completed.", {
      editorId: selectedEditor.id,
      scope,
      ...preflightSummary,
    })

    setPreflightItems(nextItems)
    setIsPreflighting(false)
  }, [items, projectPath, scope, selectedEditor, selection?.activeTarget])

  useEffect(() => {
    if (!open || !selectedEditor || !selection?.activeTarget) return
    void runPreflight()
  }, [open, runPreflight, selectedEditor, selection?.activeTarget])

  const runCopy = async () => {
    if (!selectedEditor || isCopying) return

    setIsCopying(true)
    setCopyError(null)
    const copyStartedAt = Date.now()
    const nextResults: BulkSkillCopyResultItem[] = preflightItems
      .filter((item): item is Extract<BulkSkillCopyPreflightItem, { status: "unavailable" }> => item.status === "unavailable")
      .map((item) => ({ status: "skipped", item: item.item, message: item.message }))

    logger.info("Bulk Skill copy started.", {
      editorId: selectedEditor.id,
      executable: executableItems.length,
      overwrite: overwriteCount,
      scope,
      skipped: nextResults.length,
      total: preflightItems.length,
    })

    for (const item of executableItems) {
      try {
        const result = await promise(
          () => copyToEditor(createBulkSkillCopyPayload(
            item,
            selectedEditor.id,
            scope,
            scope === "project" ? projectPath : undefined,
          )),
          {
            trackingName: "editor-scan.skill.bulk-copy",
            loading: `正在复制 ${item.item.name}...`,
            success: () => `已复制 ${item.item.name}`,
            error: (error) => error instanceof Error ? error.message : "复制失败。",
          },
        )
        nextResults.push({
          status: "copied",
          item: item.item,
          targetPath: result.targetPath,
          overwritten: item.status === "overwrite",
        })
      } catch (error) {
        logger.error("Bulk Skill copy item failed.", {
          editorId: selectedEditor.id,
          error,
          itemName: item.item.name,
          scope,
        })
        nextResults.push({
          status: "failed",
          item: item.item,
          message: error instanceof Error ? error.message : "复制失败。",
        })
      }
    }

    setResults(nextResults)
    const summary = buildBulkSkillCopySummary(nextResults)
    logger.info("Bulk Skill copy completed.", {
      copied: summary.copied,
      durationMs: Date.now() - copyStartedAt,
      editorId: selectedEditor.id,
      failed: summary.failed,
      scope,
      skipped: summary.skipped,
      total: summary.total,
    })
    try {
      await onCopied?.()
    } catch (error) {
      logger.warn("Scan refresh after bulk Skill copy failed.", { error })
      warning("复制完成，刷新失败")
    }

    if (summary.copied === items.length) {
      success(`已复制 ${summary.copied} 个 Skill`)
      onOpenChange(false)
    } else if (summary.copied > 0) {
      warning(`已复制 ${summary.copied}/${items.length} 个 Skill`)
    } else {
      notifyError("复制失败")
    }

    setIsCopying(false)
  }

  if (items.length === 0) return null

  return (
    <>
      <Dialog open={open && !selectedEditor} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>选择编辑器</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {isLoadingAdapters ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取编辑器
              </p>
            ) : adaptersError ? (
              <p className="text-sm text-destructive">{adaptersError}</p>
            ) : filteredAdapters.length > 0 ? (
              filteredAdapters.map((editor) => (
                <Button
                  key={editor.id}
                  type="button"
                  variant="ghost"
                  className="h-auto justify-start gap-2.5 bg-muted/30 p-2.5 hover:bg-muted/60"
                  onClick={() => setSelectedEditor(editor)}
                >
                  <EditorIcon editorId={editor.id} className="size-8" />
                  {editor.label}
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">当前没有可用的复制目标。</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open && Boolean(selectedEditor)} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>复制到 {selectedEditor?.label}</DialogTitle>
          </DialogHeader>
          {selectedEditor ? (
            <div className="flex flex-col gap-5">
              <EditorWriteTargetSelector
                actionKind="copy"
                contentType="skill"
                editor={selectedEditor}
                loggerName="editor-scan.bulk-copy"
                onError={setCopyError}
                onSelectionChange={setSelection}
                open={open}
                projects={config.global.projects}
                resolveTarget={resolveTarget}
              />

              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">可复制 {readyCount} 个</Badge>
                <Badge variant="secondary">将覆盖 {overwriteCount} 个</Badge>
                <Badge variant="secondary">不可用 {unavailableCount} 个</Badge>
              </div>

              {isPreflighting ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在检查目标
                </p>
              ) : null}

              {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}

              {preflightItems.length > 0 ? (
                <ScrollArea className="max-h-44 rounded-md border border-border">
                  <div className="flex flex-col gap-2 p-3 text-sm">
                    {preflightItems.map((item) => (
                      <div key={item.item.key} className="min-w-0">
                        <p className="truncate font-medium">{item.item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.status === "unavailable" ? item.message : item.targetPath}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : null}

              {results.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  已复制 {resultSummary.copied}/{items.length} 个 Skill
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isCopying} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!canCopy}
              onClick={() => {
                void runCopy()
              }}
            >
              {isCopying ? <LoaderCircle className="animate-spin" /> : null}
              {overwriteCount > 0 ? "复制并覆盖" : "复制"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { EditorBulkSkillCopyDialog }
export type { EditorBulkSkillCopyDialogProps }
