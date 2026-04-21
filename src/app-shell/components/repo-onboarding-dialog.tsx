import { useEffect, useRef, useState } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useCurrentRepoProfile, useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import {
  useActiveRepository,
  useRepositoryList,
  useRepositoryManager,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const logger = createRendererLogger("app.repo-onboarding")

function RepoOnboardingDialog() {
  const activeRepository = useActiveRepository()
  const repositories = useRepositoryList()
  const { currentRepoProfileState, updateCurrentRepoDisplayName } = useCurrentRepoProfile()
  const { localIdentityState } = useLocalIdentity()
  const manager = useRepositoryManager()
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const {
    isRepositorySwitchDialogOpen,
    openRepositorySwitchDialog,
    pendingSwitchOnboarding,
  } = useActiveRepositorySwitch()
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hasOtherRepositories = repositories.length > 1
  const isBlockedByOtherSwitchUi =
    isRepositorySwitchDialogOpen || pendingSwitchOnboarding !== null
  const isOpen =
    localIdentityState?.status === "ready"
    && activeRepository !== null
    && activeRepositoryState?.status === "ready"
    && currentRepoProfileState?.status === "needs-onboarding"
    && !isBlockedByOtherSwitchUi

  const prevIsOpenRef = useRef(isOpen)
  useEffect(() => {
    if (prevIsOpenRef.current !== isOpen) {
      logger.info("Repo onboarding dialog visibility changed.", {
        open: isOpen,
        repositoryUuid: activeRepository?.uuid ?? null,
      })
      prevIsOpenRef.current = isOpen
    }
  }, [isOpen, activeRepository?.uuid])

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
    const startedAt = performance.now()

    logger.info("Repo onboarding submitted.", {
      displayNameLength: nextDisplayName.length,
      repositoryUuid: activeRepository.uuid,
    })

    void updateCurrentRepoDisplayName(nextDisplayName)
      .then(() => {
        logger.info("Repo onboarding completed.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          repositoryUuid: activeRepository.uuid,
        })
      })
      .catch((submitError) => {
        logger.error("Repo onboarding failed.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          error: submitError,
          repositoryUuid: activeRepository.uuid,
        })
        setError(submitError instanceof Error ? submitError.message : "保存显示名称失败。")
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  return (
    <Dialog open={isOpen} data-track="repo-onboarding-dialog">
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>设置你在”{activeRepository.name}”里的显示名</DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="repo-onboarding-user-id">用户 ID</FieldLabel>
            <Input
              id="repo-onboarding-user-id"
              readOnly
              value={currentRepoProfileState.userId}
              className="font-mono"
            />
          </Field>

          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="repo-onboarding-display-name">显示名称</FieldLabel>
            <FieldContent>
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
              <FieldError>{error}</FieldError>
            </FieldContent>
          </Field>
        </FieldGroup>

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
