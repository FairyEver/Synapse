import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { runTrackedOperation } from "@/lib/ui-tracking"
import type { SynapseAppUpdateState } from "@/types/update"

const logger = createRendererLogger("app-shell.update-indicator")

function isVisibleUpdateStatus(status: SynapseAppUpdateState["status"]): boolean {
  return status === "available" || status === "downloading" || status === "downloaded"
}

function AppShellUpdateIndicator() {
  const [updateState, setUpdateState] = useState<SynapseAppUpdateState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isActionPending, setIsActionPending] = useState(false)

  useEffect(() => {
    const updater = getSynapseBridge()?.updater
    if (!updater) return

    let cancelled = false
    const unsubscribe = updater.onStateChanged((state) => {
      if (!cancelled) setUpdateState(state)
    })

    void updater.getState().then((state) => {
      if (!cancelled) setUpdateState(state)
    }).catch((error) => {
      logger.warn("Failed to read update state for the app shell.", error)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (!updateState || !isVisibleUpdateStatus(updateState.status)) {
    return null
  }

  const versionLabel = updateState.releaseVersion ? ` v${updateState.releaseVersion}` : ""

  if (updateState.status === "downloading") {
    const downloadPercent = Math.max(0, Math.min(100, updateState.downloadPercent ?? 0))

    return (
      <div className="flex w-full max-w-52 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <DownloadIcon className="size-3.5 shrink-0" />
          <span className="truncate">正在下载{versionLabel}</span>
          <span className="ml-auto tabular-nums">{Math.round(downloadPercent)}%</span>
        </div>
        <Progress
          value={downloadPercent}
          aria-label="更新下载进度"
          aria-valuenow={downloadPercent}
        />
      </div>
    )
  }

  const isDownloaded = updateState.status === "downloaded"
  const error = actionError ?? updateState.error
  const label = isActionPending
    ? isDownloaded ? "正在安装..." : "正在开始下载..."
    : error
      ? isDownloaded ? "安装失败，重试" : "下载失败，重试"
      : isDownloaded
        ? "安装并重启"
        : `发现新版本${versionLabel}`

  const handleAction = async () => {
    const updater = getSynapseBridge()?.updater
    if (!updater || isActionPending) return

    setActionError(null)
    setIsActionPending(true)

    try {
      if (isDownloaded) {
        await runTrackedOperation(
          { component: "update", eventKey: "update.install" },
          () => updater.installUpdate(),
        )
      } else {
        const state = await runTrackedOperation(
          { component: "update", eventKey: "update.download" },
          () => updater.downloadUpdate(),
        )
        setUpdateState(state)
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error
        ? caughtError.message
        : isDownloaded ? "安装更新失败。" : "下载更新失败。"
      logger.error("App shell update action failed.", {
        action: isDownloaded ? "install" : "download",
        error: caughtError,
      })
      setActionError(message)
    } finally {
      setIsActionPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant={isDownloaded ? "default" : "ghost"}
      size="sm"
      className={isDownloaded
        ? "max-w-full min-w-0 justify-start"
        : "max-w-full min-w-0 justify-start text-muted-foreground"}
      disabled={isActionPending}
      onClick={() => {
        void handleAction()
      }}
      aria-label={isDownloaded ? `${label}${versionLabel}` : label}
      title={error ?? undefined}
      data-track={isDownloaded ? "update.install" : "update.download"}
    >
      {isDownloaded ? <RefreshCwIcon /> : <DownloadIcon />}
      <span className="truncate">{label}</span>
    </Button>
  )
}

export { AppShellUpdateIndicator }
