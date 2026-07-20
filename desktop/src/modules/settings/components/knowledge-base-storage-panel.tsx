import { useCallback, useEffect, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SettingsSectionHeading } from "@/modules/settings/components/settings-section-heading"
import type {
  SynapseKnowledgeBaseStorageMigrationPayload,
  SynapseKnowledgeBaseStorageStatus,
} from "@/types/knowledge-base"

type PendingTarget = SynapseKnowledgeBaseStorageMigrationPayload["target"] | null

function KnowledgeBaseStoragePanel() {
  const [status, setStatus] = useState<SynapseKnowledgeBaseStorageStatus | null>(null)
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    const nextStatus = await requireBridgeDomain("knowledgeBase").getStorageStatus()
    setStatus(nextStatus)
    return nextStatus
  }, [])

  useEffect(() => {
    void loadStatus().catch((loadError) => {
      setError(errorMessage(loadError, "读取知识库存储失败。"))
    })
  }, [loadStatus])

  const unavailable = status?.mode === "custom" && !status.available

  const handleRecheck = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await requireBridgeDomain("knowledgeBase").recheckStorage())
    } catch (recheckError) {
      setError(errorMessage(recheckError, "重新检测失败。"))
    } finally {
      setBusy(false)
    }
  }, [])

  const handleChangeLocation = useCallback(async () => {
    const selectedPath = await requireBridgeDomain("settings").repository.chooseDirectory()
    if (!selectedPath) return
    setPendingTarget({ mode: "custom", rootPath: selectedPath })
  }, [])

  const handleConfirmMigration = useCallback(async () => {
    if (!pendingTarget) return
    setBusy(true)
    setError(null)
    try {
      await requireBridgeDomain("knowledgeBase").startStorageMigration({
        target: pendingTarget,
      })
      await loadStatus()
    } catch (migrationError) {
      setError(errorMessage(migrationError, "迁移失败。"))
    } finally {
      setBusy(false)
      setPendingTarget(null)
    }
  }, [loadStatus, pendingTarget])

  if (!status) {
    return (
      <>
        <SettingsSectionHeading>知识库存储</SettingsSectionHeading>
        <SettingsGroup>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : (
            <div className="space-y-2" role="status" aria-label="正在读取知识库存储">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-full max-w-md" />
            </div>
          )}
        </SettingsGroup>
      </>
    )
  }

  return (
    <>
      <SettingsSectionHeading>知识库存储</SettingsSectionHeading>
      <SettingsGroup>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">当前位置</p>
                <Badge variant={status.available ? "secondary" : "destructive"}>
                  {status.available ? storageModeText(status.mode) : "不可用"}
                </Badge>
              </div>
              <p
                className="mt-1 break-all text-sm text-muted-foreground sm:truncate"
                title={status.rootPath}
                data-allow-select="true"
              >
                {status.rootPath}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {unavailable ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleRecheck()}
                >
                  重新检测
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleChangeLocation()}
                  >
                    更改位置
                  </Button>
                  {status.mode === "custom" ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setPendingTarget({ mode: "default" })}
                    >
                      恢复默认
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {status.unavailableReason ? (
            <p className="text-sm text-destructive" role="alert">{status.unavailableReason}</p>
          ) : null}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
      </SettingsGroup>
      <AlertDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>迁移知识库存储</AlertDialogTitle>
            <AlertDialogDescription>
              将迁移所有知识库，迁移期间不能使用知识库。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void handleConfirmMigration()}
            >
              开始迁移
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function storageModeText(mode: SynapseKnowledgeBaseStorageStatus["mode"]): string {
  return mode === "custom" ? "自定义" : "默认"
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export { KnowledgeBaseStoragePanel }
