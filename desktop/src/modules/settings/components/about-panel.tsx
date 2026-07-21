import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatBytes as formatByteSize } from "@synapse/shared"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import {
  SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES,
  SETTINGS_CHEAT_CODE_TITLE,
  getSettingsTitleActiveColorClass,
  settingsCheatCodes,
  settingsTitleParts,
  type CheatCodeContext,
} from "@/modules/settings/cheat-codes"
import { useCheatCodeTitleSequence } from "@/modules/settings/hooks/use-cheat-code-title-sequence"
import { useAppUpdateController } from "@/modules/settings/hooks/use-app-update-controller"
import type { CheatCodeStateStore } from "@/lib/cheat-codes/manager"
import type { CheatCodeTriggerResult } from "@/types/cheat-code"
import type { SynapseAppUpdateState } from "@/types/update"
import synapseLogo from "@/assets/icon.png"

const logger = createRendererLogger("settings.about")

function formatBytes(value: number | null): string | null {
  return value === null || !Number.isFinite(value) || value < 0 ? null : formatByteSize(value)
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
    return "等待安装"
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
  const [installCountdown, setInstallCountdown] = useState<number | null>(null)
  const [isRestarting, setIsRestarting] = useState(false)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeTitleColorOffset, setActiveTitleColorOffset] = useState(0)
  const [hoveredTitleIndex, setHoveredTitleIndex] = useState<number | null>(null)
  const {
    actionError,
    automaticInstallArmed,
    cancelDownload,
    checkForUpdates,
    clearActionError,
    downloadUpdate,
    installArmVersion,
    installUpdate,
    setActionError,
    setAutomaticInstallArmed,
    updateState,
  } = useAppUpdateController()

  const isChecking = updateState.status === "checking"
  const isAvailable = updateState.status === "available"
  const isDownloading = updateState.status === "downloading"
  const isDownloaded = updateState.status === "downloaded"
  const actionLabel = isRestarting
    ? "安装中..."
    : installCountdown !== null
      ? `${installCountdown} 秒后安装`
      : isDownloaded
        ? "立即安装"
        : isAvailable
          ? "下载并安装"
          : isChecking
            ? "检查中..."
            : "检查更新"
  const actionDisabled = isRestarting
    || installCountdown !== null
    || (!isAvailable && !isDownloaded && (!updateState.canCheck || isChecking || isDownloading))
  const statusClassName = updateState.status === "error" || updateState.error || actionError
    ? "text-sm text-destructive"
    : "text-sm text-muted-foreground"
  const statusMessage = installCountdown !== null
    ? `下载完成，${installCountdown} 秒后自动安装。`
    : actionError ?? updateState.message
  const downloadDetails = getDownloadDetails(updateState)
  const downloadProgressValue = Math.max(0, Math.min(100, updateState.downloadPercent ?? 0))
  const currentVersionLabel = `v${updateState.currentVersion}`

  const installDownloadedUpdate = useCallback(async () => {
    clearActionError()
    setIsRestarting(true)

    try {
      await installUpdate()
    } catch (error) {
      const message = error instanceof Error ? error.message : "安装更新失败。"

      logger.error("Failed to install downloaded app update.", error)
      setActionError(message)
      setIsRestarting(false)
    }
  }, [clearActionError, installUpdate, setActionError])

  const clearInstallTimers = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (installTimeoutRef.current) {
      clearTimeout(installTimeoutRef.current)
      installTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isDownloaded || !automaticInstallArmed) {
      return
    }

    setInstallCountdown(3)
    countdownIntervalRef.current = setInterval(() => {
      setInstallCountdown((current) => current === null ? null : Math.max(1, current - 1))
    }, 1_000)
    installTimeoutRef.current = setTimeout(() => {
      setAutomaticInstallArmed(false)
      clearInstallTimers()
      setInstallCountdown(null)
      void installDownloadedUpdate()
    }, 3_000)

    return () => {
      clearInstallTimers()
    }
  }, [
    automaticInstallArmed,
    clearInstallTimers,
    installArmVersion,
    installDownloadedUpdate,
    isDownloaded,
    setAutomaticInstallArmed,
  ])

  const cheatCodeContext = useMemo<CheatCodeContext>(
    () => ({
      enableRepositoryMaintenance: () => {
        if (!isAdminMode) {
          onAdminModeChange(true)
        }
      },
    }),
    [isAdminMode, onAdminModeChange],
  )
  const cheatCodeStateStore = useMemo<CheatCodeStateStore | undefined>(
    () => window.synapse?.cheatCodes,
    [],
  )

  const handleCheatCodeTriggered = useCallback((result: CheatCodeTriggerResult) => {
    logger.info("Cheat code activated.", {
      name: result.name,
      ...(result.kind === "state" ? { active: result.active } : undefined),
    })
  }, [])

  const handleCheatCodeTriggerError = useCallback((name: string, error: unknown) => {
    logger.error("Cheat code activation failed.", {
      name,
      error,
    })
  }, [])

  const {
    handleLogoClick,
    handleTitleIndexClick,
    isArmed: isCheatCodeEntryArmed,
  } = useCheatCodeTitleSequence({
    cheatCodes: settingsCheatCodes,
    context: cheatCodeContext,
    onTriggered: handleCheatCodeTriggered,
    onTriggerError: handleCheatCodeTriggerError,
    stateStore: cheatCodeStateStore,
  })

  useEffect(() => {
    if (!isCheatCodeEntryArmed) {
      setActiveTitleColorOffset(0)
      setHoveredTitleIndex(null)
      return
    }

    const interval = setInterval(() => {
      setActiveTitleColorOffset(
        (current) => (current + 1) % SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.length,
      )
    }, 400)

    return () => {
      clearInterval(interval)
    }
  }, [isCheatCodeEntryArmed])

  const handleAction = async () => {
    clearActionError()
    logger.info("App update action triggered.", { currentStatus: updateState.status })

    try {
      if (isDownloaded) {
        setAutomaticInstallArmed(false)
        clearInstallTimers()
        setInstallCountdown(null)
        await installDownloadedUpdate()
        return
      }

      if (isAvailable) {
        setAutomaticInstallArmed(true)
        await downloadUpdate()
        return
      }

      await checkForUpdates()
    } catch (error) {
      const message = error instanceof Error ? error.message : "软件更新操作失败。"

      logger.error("App update action failed in settings.", error)
      setAutomaticInstallArmed(false)
      setActionError(message)
      setIsRestarting(false)
    }
  }

  const handleCancelDownload = async () => {
    logger.info("App update download cancelled.")
    setAutomaticInstallArmed(false)

    try {
      await cancelDownload()
    } catch (error) {
      logger.error("Failed to cancel download.", error)
      setActionError(error instanceof Error ? error.message : "取消下载失败。")
    }
  }

  const handlePostponeInstall = () => {
    logger.info("Automatic update install postponed.")
    setAutomaticInstallArmed(false)
    clearInstallTimers()
    setInstallCountdown(null)
  }

  const handleCopyCurrentVersion = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable")
      }

      await navigator.clipboard.writeText(currentVersionLabel)
      toast("版本号已复制")
    } catch (error) {
      logger.error("Failed to copy app version.", error)
      toast("复制失败")
    }
  }, [currentVersionLabel])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
        <img
          src={synapseLogo}
          alt="Synapse"
          draggable={false}
          onClick={handleLogoClick}
          className="size-24 shrink-0 object-contain select-none"
        />
        <div className="flex flex-col items-center gap-0.5">
          {/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <h1
            className={cn(
              "text-lg font-semibold transition-[letter-spacing] duration-300 ease-out",
              isCheatCodeEntryArmed ? "tracking-widest" : "tracking-tight",
            )}
            aria-label={SETTINGS_CHEAT_CODE_TITLE}
            data-settings-cheat-code-title
          >
            {settingsTitleParts.map((part) => (
              <span
                key={part.index}
                aria-hidden="true"
                className={
                  isCheatCodeEntryArmed && part.clickable
                    ? cn(
                        getSettingsTitleActiveColorClass(part.index, activeTitleColorOffset),
                        "inline-block origin-center transition-[color,transform,font-weight,opacity] duration-200 ease-out hover:scale-125 hover:font-bold",
                        hoveredTitleIndex !== null && hoveredTitleIndex !== part.index ? "opacity-30" : "opacity-100",
                      )
                    : undefined
                }
                data-settings-title-index={part.index}
                onClick={part.clickable ? () => handleTitleIndexClick(part.index) : undefined}
                onMouseEnter={part.clickable ? () => setHoveredTitleIndex(part.index) : undefined}
                onMouseLeave={part.clickable ? () => setHoveredTitleIndex(null) : undefined}
              >
                {part.char}
              </span>
            ))}
          </h1>
          {/* eslint-enable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        </div>
      </div>

      <SettingsGroup>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1" data-allow-select="true">
            <p className="text-sm font-medium">当前版本</p>
            <button
              type="button"
              aria-label={`复制当前版本 ${currentVersionLabel}`}
              onClick={() => {
                void handleCopyCurrentVersion()
              }}
              className="w-fit rounded-sm text-left text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {currentVersionLabel}
            </button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-col gap-1" data-allow-select="true">
              <p className="text-sm font-medium">软件更新</p>
              <p className={statusClassName}>{statusMessage}</p>
              {updateState.releaseVersion && updateState.releaseVersion !== updateState.currentVersion ? (
                <p className="text-xs text-muted-foreground">最新版本：v{updateState.releaseVersion}</p>
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
            ) : installCountdown !== null ? (
              <div className="flex items-center gap-2">
                <Button disabled>{actionLabel}</Button>
                <Button variant="outline" onClick={handlePostponeInstall}>
                  稍后安装
                </Button>
              </div>
            ) : (
              <Button
                variant={isAvailable || isDownloaded ? "default" : "outline"}
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
            <div className="flex min-w-0 flex-col gap-2 md:col-span-2" data-allow-select="true">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
