import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAppUpdateState } from "@/types/update"

type AppShellUpdateIndicatorProps = {
  readonly onOpen: () => void
}

const logger = createRendererLogger("app-shell.update-indicator")

function isVisibleUpdateStatus(status: SynapseAppUpdateState["status"]): boolean {
  return status === "available" || status === "downloading" || status === "downloaded"
}

function AppShellUpdateIndicator({ onOpen }: AppShellUpdateIndicatorProps) {
  const [updateState, setUpdateState] = useState<SynapseAppUpdateState | null>(null)

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

  const isDownloaded = updateState.status === "downloaded"
  const label = isDownloaded
    ? `新版本 v${updateState.releaseVersion ?? ""} 已准备安装`
    : updateState.status === "downloading"
      ? "正在下载更新..."
      : `发现新版本 v${updateState.releaseVersion ?? ""}`

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="max-w-full justify-start text-muted-foreground"
      onClick={onOpen}
      aria-label={label}
    >
      {isDownloaded ? <RefreshCwIcon /> : <DownloadIcon />}
      <span className="truncate">{label}</span>
    </Button>
  )
}

export { AppShellUpdateIndicator }
