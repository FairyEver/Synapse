import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type { SynapseAppUpdateState } from "@/types/update"
import synapseLogo from "@/assets/icon.png"

const logger = createRendererLogger("settings.about")

const ADMIN_CLICK_THRESHOLD = 10
const ADMIN_CLICK_RESET_DELAY = 2000

const INITIAL_UPDATE_STATE: SynapseAppUpdateState = {
  currentVersion: "0.0.0",
  releaseVersion: null,
  status: "idle",
  message: "正在读取更新信息...",
  error: null,
  downloadPercent: null,
  bytesPerSecond: null,
  transferredBytes: null,
  totalBytes: null,
  lastCheckedAt: null,
  canCheck: false,
  downloadedFilePath: null,
}

function formatBytes(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let nextValue = value
  let unitIndex = 0

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024
    unitIndex += 1
  }

  const digits = unitIndex === 0 ? 0 : nextValue >= 100 ? 0 : nextValue >= 10 ? 1 : 2

  return `${nextValue.toFixed(digits)} ${units[unitIndex]}`
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes < 60) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`
}

function getDownloadDetails(updateState: SynapseAppUpdateState): string | null {
  if (updateState.status === "downloaded") {
    return "已保存到下载目录"
  }

  if (updateState.status !== "downloading") {
    return null
  }

  const parts: string[] = []
  const transferred = formatBytes(updateState.transferredBytes)
  const total = formatBytes(updateState.totalBytes)
  const speed = formatBytes(updateState.bytesPerSecond)

  if (transferred && total) {
    parts.push(`已下载 ${transferred} / ${total}`)
  }

  if (speed) {
    parts.push(`${speed}/s`)
  }

  if (
    updateState.transferredBytes !== null
    && updateState.totalBytes !== null
    && updateState.bytesPerSecond
    && updateState.bytesPerSecond > 0
  ) {
    const remainingSeconds = Math.max(
      0,
      Math.round((updateState.totalBytes - updateState.transferredBytes) / updateState.bytesPerSecond),
    )

    parts.push(`剩余约 ${formatDuration(remainingSeconds)}`)
  }

  return parts.length > 0 ? parts.join(" · ") : null
}

type AboutPanelProps = {
  isAdminMode: boolean
  onAdminModeChange: (enabled: boolean) => void
}

function AboutPanel({ isAdminMode, onAdminModeChange }: AboutPanelProps) {
  const [updateState, setUpdateState] = useState<SynapseAppUpdateState>(INITIAL_UPDATE_STATE)
  const [actionError, setActionError] = useState<string | null>(null)
  const [clickCount, setClickCount] = useState(0)
  const [resetTimer, setResetTimer] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const bridge = window.synapse?.updater

    if (!bridge) {
      setUpdateState({
        ...INITIAL_UPDATE_STATE,
        status: "unsupported",
        message: "当前环境不支持自动更新。",
      })
      return
    }

    let cancelled = false

    void bridge.getState().then((state) => {
      if (!cancelled) {
        setUpdateState(state)
      }
    }).catch((error) => {
      logger.error("Failed to read initial app update state.", error)

      if (!cancelled) {
        const message = error instanceof Error ? error.message : "读取更新信息失败。"

        setUpdateState({
          ...INITIAL_UPDATE_STATE,
          status: "error",
          message,
          error: message,
        })
      }
    })

    const unsubscribe = bridge.onStateChanged((state) => {
      setUpdateState(state)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const isChecking = updateState.status === "checking"
  const isDownloading = updateState.status === "downloading"
  const isDownloaded = updateState.status === "downloaded"
  const actionLabel = isChecking ? "检查中..." : isDownloading ? "下载中..." : "检查更新"
  const actionDisabled = !updateState.canCheck || isChecking || isDownloading
  const statusClassName = updateState.status === "error" || actionError
    ? "text-sm text-destructive"
    : "text-sm text-muted-foreground"
  const downloadDetails = getDownloadDetails(updateState)
  const downloadProgressValue = Math.max(0, Math.min(100, updateState.downloadPercent ?? 0))

  const handleLogoClick = useCallback(() => {
    if (isAdminMode) {
      return
    }

    if (resetTimer) {
      clearTimeout(resetTimer)
    }

    const nextCount = clickCount + 1
    setClickCount(nextCount)

    if (nextCount >= ADMIN_CLICK_THRESHOLD) {
      logger.info("Admin mode activated via logo clicks.")
      onAdminModeChange(true)
      setClickCount(0)
    } else {
      const timer = setTimeout(() => {
        setClickCount(0)
      }, ADMIN_CLICK_RESET_DELAY)
      setResetTimer(timer)
    }
  }, [clickCount, isAdminMode, onAdminModeChange, resetTimer])

  useEffect(() => {
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [resetTimer])

  const handleAction = async () => {
    const bridge = window.synapse?.updater

    if (!bridge) {
      return
    }

    setActionError(null)
    logger.info("App update action triggered.", { currentStatus: updateState.status })

    try {
      const nextState = await bridge.checkForUpdates()
      setUpdateState(nextState)
    } catch (error) {
      const message = error instanceof Error ? error.message : "软件更新操作失败。"

      logger.error("App update action failed in settings.", error)
      setActionError(message)
    }
  }

  const handleCancelDownload = async () => {
    const bridge = window.synapse?.updater

    if (!bridge) {
      return
    }

    logger.info("App update download cancelled.")

    try {
      await bridge.cancelDownload()
    } catch (error) {
      logger.error("Failed to cancel download.", error)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
        <img
          src={synapseLogo}
          alt="Synapse"
          draggable={false}
          onClick={handleLogoClick}
          className="size-24 shrink-0 cursor-pointer object-contain select-none"
          title={isAdminMode ? "管理员模式已开启" : undefined}
        />
        <div className="flex flex-col items-center gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Synapse</h1>
          <p className="text-xs tracking-wide text-muted-foreground/70">Where Ideas Connect.</p>
        </div>
      </div>

      <SettingsGroup>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">当前版本</p>
            <p className="text-sm text-muted-foreground">v{updateState.currentVersion}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">软件更新</p>
              <p className={statusClassName}>{actionError ?? updateState.message}</p>
              {updateState.releaseVersion && updateState.releaseVersion !== updateState.currentVersion ? (
                <p className="text-xs text-muted-foreground">最新版本：v{updateState.releaseVersion}</p>
              ) : null}
              {isDownloaded ? (
                <p className="text-xs text-muted-foreground">退出后运行安装包。</p>
              ) : null}
              {updateState.downloadedFilePath ? (
                <p className="text-xs break-all text-muted-foreground">
                  下载位置：{updateState.downloadedFilePath}
                </p>
              ) : null}
            </div>

          </div>

          <div className="flex justify-start md:justify-end">
            {isDownloading ? (
              <Button
                variant="outline"
                onClick={() => {
                  void handleCancelDownload()
                }}
              >
                取消下载
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={actionDisabled}
                onClick={() => {
                  void handleAction()
                }}
              >
                {actionLabel}
              </Button>
            )}
          </div>

          {updateState.status === "downloading" || updateState.status === "downloaded" ? (
            <div className="flex min-w-0 flex-col gap-2 md:col-span-2">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{updateState.status === "downloaded" ? "下载完成" : "下载进度"}</span>
                {updateState.downloadPercent !== null ? (
                  <span>{Math.round(updateState.downloadPercent)}%</span>
                ) : null}
              </div>
              <Progress value={downloadProgressValue} className="h-2" />
              {downloadDetails ? <p className="text-xs text-muted-foreground">{downloadDetails}</p> : null}
            </div>
          ) : null}
        </div>
      </SettingsGroup>
    </div>
  )
}

export { AboutPanel, type AboutPanelProps }
