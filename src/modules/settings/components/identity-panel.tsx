import { useEffect, useRef, useState } from "react"
import { Copy } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import {
  useCurrentRepoProfile,
  useLocalIdentity,
} from "@/app-shell/identity-context"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdoptIdentityDialog } from "@/modules/settings/components/adopt-identity-dialog"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function IdentityPanel() {
  const { activeRepository } = useAppConfig()
  const { promise } = useAppNotifications()
  const { refreshPendingPushes } = useRepositoryManager()
  const { localIdentityState } = useLocalIdentity()
  const { currentRepoProfileState, updateCurrentRepoDisplayName } = useCurrentRepoProfile()
  const [isAdoptDialogOpen, setIsAdoptDialogOpen] = useState(false)
  const [draftDisplayName, setDraftDisplayName] = useState("")
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saved" | "saving">("idle")
  const lastSavedDisplayNameRef = useRef("")
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    if (currentRepoProfileState?.status === "ready") {
      setDraftDisplayName(currentRepoProfileState.profile.displayName)
      lastSavedDisplayNameRef.current = currentRepoProfileState.profile.displayName
    } else {
      setDraftDisplayName("")
      lastSavedDisplayNameRef.current = ""
    }

    setDisplayNameError(null)
    setSaveState("idle")
  }, [currentRepoProfileState, activeRepository?.uuid])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  if (!localIdentityState || localIdentityState.status !== "ready") {
    return null
  }

  const saveCurrentDisplayName = () => {
    const nextDisplayName = draftDisplayName.trim()

    if (!activeRepository) {
      return
    }

    if (!nextDisplayName) {
      setDisplayNameError("显示名称不能为空。")
      return
    }

    if (nextDisplayName === lastSavedDisplayNameRef.current) {
      return
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSaveState("saving")
    setDisplayNameError(null)

    saveTimerRef.current = window.setTimeout(() => {
      void updateCurrentRepoDisplayName(nextDisplayName)
        .then(async (nextProfile) => {
          lastSavedDisplayNameRef.current = nextProfile.displayName
          setDraftDisplayName(nextProfile.displayName)
          setSaveState("saved")

          await refreshPendingPushes(activeRepository.uuid)
        })
        .catch((saveError) => {
          setDisplayNameError(
            saveError instanceof Error ? saveError.message : "保存显示名称失败。",
          )
          setSaveState("idle")
        })
        .finally(() => {
          saveTimerRef.current = null
        })
    }, 800)
  }

  const saveHint = displayNameError
    ? null
    : saveState === "saving"
      ? "正在保存..."
      : saveState === "saved"
        ? "已保存。"
        : "失焦后自动保存。不同目录可以使用不同名字。"

  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="identity-user-id">用户 ID（本地）</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void promise(
                    () => navigator.clipboard.writeText(localIdentityState.identity.userId),
                    {
                      loading: "正在复制用户 ID...",
                      success: "已复制到剪贴板。",
                      error: (error) => error instanceof Error ? error.message : "复制失败。",
                    },
                  ).catch(() => {})
                }}
              >
                <Copy />
                复制
              </Button>
            </div>
            <Input
              id="identity-user-id"
              readOnly
              value={localIdentityState.identity.userId}
              className="font-mono"
            />
            <p className="text-sm text-muted-foreground">
              这是你在 Synapse 里的唯一身份凭证。请尽快备份到安全位置。
            </p>
          </div>

          <div className="flex justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAdoptDialogOpen(true)}
            >
              接续已有身份
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">当前目录</p>
            <p className="text-sm text-muted-foreground">
              {activeRepository ? activeRepository.name : "还没有选择本地目录"}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="identity-display-name">显示名称</Label>
            <Input
              id="identity-display-name"
              value={draftDisplayName}
              disabled={!activeRepository || currentRepoProfileState?.status !== "ready"}
              aria-invalid={displayNameError ? true : undefined}
              placeholder={activeRepository ? "输入当前目录里的显示名称" : "先选择本地目录"}
              onFocus={() => {
                if (saveTimerRef.current !== null) {
                  window.clearTimeout(saveTimerRef.current)
                  saveTimerRef.current = null
                }
              }}
              onBlur={saveCurrentDisplayName}
              onChange={(event) => {
                setDraftDisplayName(event.target.value)
                setDisplayNameError(null)
                setSaveState("idle")
              }}
            />
            {displayNameError ? (
              <p className="text-sm text-destructive">{displayNameError}</p>
            ) : saveHint ? (
              <p className="text-sm text-muted-foreground">{saveHint}</p>
            ) : null}
          </div>
        </div>
      </SettingsGroup>

      <AdoptIdentityDialog
        open={isAdoptDialogOpen}
        onOpenChange={setIsAdoptDialogOpen}
      />
    </>
  )
}

export { IdentityPanel }
