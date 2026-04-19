import { useEffect, useState } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppConfig } from "@/app-shell/config"
import { useCurrentRepoProfile, useLocalIdentity } from "@/app-shell/identity-context"
import { useRepositoryManager } from "@/app-shell/repository"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function RepoOnboardingDialog() {
  const { activeRepository, config } = useAppConfig()
  const { currentRepoProfileState, updateCurrentRepoDisplayName } = useCurrentRepoProfile()
  const { localIdentityState } = useLocalIdentity()
  const { refreshPendingPushes, states } = useRepositoryManager()
  const {
    isRepositorySwitchDialogOpen,
    openRepositorySwitchDialog,
    pendingSwitchOnboarding,
  } = useActiveRepositorySwitch()
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] ?? null : null
  const hasOtherRepositories = config.repositories.length > 1
  const isBlockedByOtherSwitchUi =
    isRepositorySwitchDialogOpen || pendingSwitchOnboarding !== null
  const isOpen =
    localIdentityState?.status === "ready"
    && activeRepository !== null
    && activeRepositoryState?.status === "ready"
    && currentRepoProfileState?.status === "needs-onboarding"
    && !isBlockedByOtherSwitchUi

  useEffect(() => {
    if (!isOpen) {
      setDisplayName("")
      setError(null)
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen || !activeRepository || currentRepoProfileState?.status !== "needs-onboarding") {
    return null
  }

  const handleSubmit = () => {
    const nextDisplayName = displayName.trim()

    if (!nextDisplayName) {
      setError("显示名称不能为空。")
      return
    }

    setIsSubmitting(true)
    setError(null)

    void updateCurrentRepoDisplayName(nextDisplayName)
      .then(async () => {
        await refreshPendingPushes(activeRepository.uuid)
      })
      .catch((submitError) => {
        setError(submitError instanceof Error ? submitError.message : "保存显示名称失败。")
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  return (
    <Dialog open={isOpen}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>设置你在“{activeRepository.name}”里的显示名</DialogTitle>
          <DialogDescription>
            这是你在当前目录里的显示名。不同目录可以使用不同名字。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="repo-onboarding-user-id">用户 ID</Label>
            <Input
              id="repo-onboarding-user-id"
              readOnly
              value={currentRepoProfileState.userId}
              className="font-mono"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="repo-onboarding-display-name">显示名称</Label>
            <Input
              id="repo-onboarding-display-name"
              value={displayName}
              aria-invalid={error ? true : undefined}
              autoFocus
              onChange={(event) => {
                setDisplayName(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {hasOtherRepositories ? (
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => openRepositorySwitchDialog()}
            >
              切换仓库
            </Button>
          ) : <span />}
          <Button
            type="button"
            disabled={isSubmitting || displayName.trim().length === 0}
            onClick={handleSubmit}
          >
            {isSubmitting ? "正在保存..." : "确定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { RepoOnboardingDialog }
