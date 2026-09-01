import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { copyToEditor, resolveEditorCopyTarget } from "@/app-shell/editor-copy"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
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
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "@/modules/content/components/editor-write-target-selector"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import { installFormDefinitionByEditorId } from "@/definitions/generated/renderer-registry"
import { createCopySource } from "@/modules/editor-scan/lib/editor-copy-source"
import type { SynapseEditorAdapterSummary, SynapseEditorInstallFormValues } from "@/types/editor"
import type { ScanItemForDetail } from "@/types/editor-scan"

type EditorCopyDialogProps = {
  content: string | null
  item: ScanItemForDetail | null
  onCopied?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
}

const logger = createRendererLogger("editor-scan.copy")

function EditorCopyDialog({
  content,
  item,
  onCopied,
  onOpenChange,
  open,
}: EditorCopyDialogProps) {
  const { config } = useAppConfig()
  const { promise } = useAppNotifications()
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [isCopying, setIsCopying] = useState(false)
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false)
  const [isRuleProjectInstallFormOpen, setIsRuleProjectInstallFormOpen] = useState(false)

  const {
    error: adaptersError,
    filteredAdapters,
    isLoading: isLoadingAdapters,
    load: loadEditors,
  } = useEditorAdaptersForContentType({
    contentType: item?.type ?? "rule",
    enabled: Boolean(item),
    loggerName: "editor-scan.copy",
  })

  const source = useMemo(
    () => item ? createCopySource(item, content) : null,
    [content, item],
  )
  const activeTarget = selection?.activeTarget ?? null
  const scope = selection?.scope ?? "global"
  const projectPath = selection?.projectPath ?? ""
  const canCopy = Boolean(activeTarget?.status === "ready" && selectedEditor && source) && !isCopying
  const installFormDefinition = selectedEditor ? installFormDefinitionByEditorId.get(selectedEditor.id) : undefined
  const RuleProjectInstallForm = installFormDefinition?.RuleProjectInstallForm

  useEffect(() => {
    if (!open) {
      setSelectedEditor(null)
      setSelection(null)
      setCopyError(null)
      setIsCopying(false)
      setOverwriteConfirmed(false)
      setIsOverwriteConfirmOpen(false)
      setIsRuleProjectInstallFormOpen(false)
      return
    }

    loadEditors()
  }, [loadEditors, open])

  const resolveTarget = useCallback((input: ResolveEditorTargetInput) => {
    if (!source) {
      throw new Error("当前没有可复制的内容。")
    }

    return resolveEditorCopyTarget({
      source,
      targetEditorId: input.editorId,
      targetProjectPath: input.scope === "project" ? input.projectPath : undefined,
      targetScope: input.scope,
    })
  }, [source])

  const runCopy = async (
    installFormValues?: SynapseEditorInstallFormValues,
    overwriteConfirmed?: boolean,
  ) => {
    if (!source || !selectedEditor) {
      return
    }

    if (scope === "project" && !projectPath) {
      setCopyError("先选择一个项目目录。")
      return
    }

    if (!activeTarget || activeTarget.status !== "ready") {
      setCopyError("当前还没有可用的复制目标。")
      return
    }

    setCopyError(null)
    setIsCopying(true)

    try {
      const result = await promise(
        () => copyToEditor({
          installFormValues,
          overwriteConfirmed,
          source,
          targetEditorId: selectedEditor.id,
          targetProjectPath: scope === "project" ? projectPath : undefined,
          targetScope: scope,
        }),
        {
          trackingName: "editor-scan.item.copy",
          loading: `正在复制到 ${selectedEditor.label}...`,
          success: () => `已复制到 ${selectedEditor.label}`,
          error: (error) => error instanceof Error ? error.message : "复制失败。",
        },
      )

      logger.info("Scan item copied to editor.", {
        sourceEditorId: source.editorId,
        sourcePath: source.itemPath,
        targetEditorId: selectedEditor.id,
        targetPath: result.targetPath,
        targetScope: scope,
      })
      setIsRuleProjectInstallFormOpen(false)
      setOverwriteConfirmed(false)
      onOpenChange(false)
      try {
        await onCopied?.()
      } catch (refreshError) {
        logger.warn("Scan refresh after copy failed.", { error: refreshError })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "复制失败。"
      logger.error("Failed to copy scan item to editor.", {
        error,
        sourcePath: source.itemPath,
        targetEditorId: selectedEditor.id,
      })
      setCopyError(message)
    } finally {
      setIsCopying(false)
    }
  }

  const handleCopy = async () => {
    if (!item || !activeTarget || activeTarget.status !== "ready") {
      setCopyError("当前还没有可用的复制目标。")
      return
    }

    if (activeTarget.targetExists) {
      setIsOverwriteConfirmOpen(true)
      return
    }

    if (item.type === "rule" && scope === "project" && RuleProjectInstallForm) {
      setCopyError(null)
      setIsRuleProjectInstallFormOpen(true)
      return
    }

    await runCopy()
  }

  if (!item || !source) {
    return null
  }

  return (
    <>
      {RuleProjectInstallForm && item.type === "rule" ? (
        <RuleProjectInstallForm
          editorId={selectedEditor?.id ?? ""}
          item={{ description: item.metadata?.description ?? item.preview }}
          isSubmitting={isCopying}
          onConfirm={(values) => {
            void runCopy(values, overwriteConfirmed)
          }}
          onError={setCopyError}
          onOpenChange={(next) => {
            if (isCopying) {
              return
            }
            if (!next) {
              setOverwriteConfirmed(false)
            }
            setIsRuleProjectInstallFormOpen(next)
          }}
          open={isRuleProjectInstallFormOpen}
          target={activeTarget?.status === "ready" ? activeTarget : null}
        />
      ) : null}

      <AlertDialog open={isOverwriteConfirmOpen} onOpenChange={setIsOverwriteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖目标？</AlertDialogTitle>
            <AlertDialogDescription>
              目标位置已有内容，复制后会被替换。
            </AlertDialogDescription>
            {activeTarget?.status === "ready" ? (
              <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                {activeTarget.targetPath}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCopying}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isCopying}
              onClick={() => {
                setIsOverwriteConfirmOpen(false)
                if (item.type === "rule" && scope === "project" && RuleProjectInstallForm) {
                  setOverwriteConfirmed(true)
                  setIsRuleProjectInstallFormOpen(true)
                  return
                }

                void runCopy(undefined, true)
              }}
            >
              覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={open && !selectedEditor}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onOpenChange(false)
          }
        }}
      >
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
                  onClick={() => {
                    setSelectedEditor(editor)
                  }}
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

      <Dialog
        open={open && Boolean(selectedEditor)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onOpenChange(false)
          }
        }}
        data-track="editor-copy-install-dialog"
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>复制到 {selectedEditor?.label}</DialogTitle>
          </DialogHeader>

          {selectedEditor ? (
            <div className="flex flex-col gap-5">
              <EditorWriteTargetSelector
                actionKind="copy"
                contentType={item.type}
                editor={selectedEditor}
                loggerName="editor-scan.copy"
                onError={setCopyError}
                onSelectionChange={setSelection}
                open={open}
                projects={config.global.projects}
                resolveTarget={resolveTarget}
              />

              {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!canCopy}
              onClick={() => {
                void handleCopy()
              }}
            >
              {isCopying ? <LoaderCircle className="animate-spin" /> : null}
              复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { EditorCopyDialog }
