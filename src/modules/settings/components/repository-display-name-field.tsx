import { useEffect, useState } from "react"
import { useCurrentRepoProfile, useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { readRepoProfileState, updateRepoDisplayName } from "@/app-shell/user-profile"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SynapseRepoProfileState } from "@/types/identity"

type RepositoryDisplayNameFieldProps = {
  repositoryUuid: string
  isActiveRepository: boolean
  disabled?: boolean
}

const logger = createRendererLogger("settings.repositories.display-name")

function getDisplayNameFromState(state: SynapseRepoProfileState | null): string {
  if (!state) {
    return ""
  }

  if (state.status === "ready") {
    return state.profile.displayName
  }

  return ""
}

function RepositoryDisplayNameField({
  repositoryUuid,
  isActiveRepository,
  disabled,
}: RepositoryDisplayNameFieldProps) {
  const { localIdentityState } = useLocalIdentity()
  const { refreshRepoProfileState } = useCurrentRepoProfile()
  const [profileState, setProfileState] = useState<SynapseRepoProfileState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const isLocalIdentityReady = localIdentityState?.status === "ready"

  useEffect(() => {
    if (!isLocalIdentityReady) {
      setProfileState(null)
      setIsLoading(false)
      return
    }

    let isCancelled = false

    setIsLoading(true)
    setLoadError(null)

    readRepoProfileState(repositoryUuid)
      .then((nextState) => {
        if (isCancelled) {
          return
        }

        setProfileState(nextState)
        const nextDisplayName = getDisplayNameFromState(nextState)
        setDraft(nextDisplayName)
      })
      .catch((readError: unknown) => {
        if (isCancelled) {
          return
        }

        logger.error("Failed to read repo profile state for settings card.", {
          error: readError,
          repositoryUuid,
        })
        setLoadError(readError instanceof Error ? readError.message : "读取仓库显示名失败。")
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [isLocalIdentityReady, repositoryUuid])

  const displayName = getDisplayNameFromState(profileState)
  const needsOnboarding = profileState?.status === "needs-onboarding"
  const isFieldDisabled = disabled || isLoading || !isLocalIdentityReady || loadError !== null

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      logger.info("Display name edit dialog opened.", { repositoryUuid })
      // 打开时重置为当前值
      setDraft(displayName)
      setSaveError(null)
    }
  }

  const handleSave = async () => {
    const nextDisplayName = draft.trim()

    if (!nextDisplayName) {
      setSaveError("作者署名不能为空。")
      return
    }

    if (nextDisplayName === displayName) {
      setIsOpen(false)
      return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const nextProfile = await updateRepoDisplayName(repositoryUuid, nextDisplayName)
      setProfileState({ status: "ready", profile: nextProfile })
      logger.info("Repository display name saved.", { repositoryUuid })

      if (isActiveRepository) {
        await refreshRepoProfileState()
      }

      setIsOpen(false)
    } catch (saveErrorValue: unknown) {
      logger.error("Failed to save repo display name from settings card.", {
        error: saveErrorValue,
        repositoryUuid,
      })
      setSaveError(saveErrorValue instanceof Error ? saveErrorValue.message : "保存显示名称失败。")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft(displayName)
    setSaveError(null)
    setIsOpen(false)
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm text-muted-foreground">作者署名</span>
          <span className="text-sm text-destructive">{loadError}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-sm text-muted-foreground">作者署名</span>
        <span className="text-sm font-medium">
          {isLoading ? "加载中..." : needsOnboarding ? "未设置" : displayName || "未设置"}
        </span>
      </div>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={isFieldDisabled}>
            {needsOnboarding ? "设置" : "修改"}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>设置作者署名</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`display-name-${repositoryUuid}`}>作者署名</Label>
              <Input
                id={`display-name-${repositoryUuid}`}
                value={draft}
                placeholder="输入作者署名"
                disabled={isSaving}
                aria-invalid={saveError ? true : undefined}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setSaveError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isSaving) {
                    void handleSave()
                  }
                }}
              />
              {saveError && (
                <p className="text-sm text-destructive">{saveError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                取消
              </Button>
            </DialogClose>
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { RepositoryDisplayNameField }
