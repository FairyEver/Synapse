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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { RepoIdRecoveryDialog } from "@/app-shell/components/repo-id-recovery-dialog"

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
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false)
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
      setIsRecoveryOpen(false)
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
    <>
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
            <InputGroup>
              <InputGroupInput
                id="repo-onboarding-user-id"
                readOnly
                value={currentRepoProfileState.userId}
                className="font-mono"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    logger.info("Repo id recovery dialog opened.", {
                      repositoryUuid: activeRepository.uuid,
                    })
                    setIsRecoveryOpen(true)
                  }}
                >
                  通过 ID 恢复
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>

          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="repo-onboarding-display-name">显示名称</FieldLabel>
            <FieldContent>
              <Input
                id="repo-onboarding-display-name"
                value={displayName}
                aria-invalid={error ? true : undefined}
                autoFocus
                disabled={isSubmitting}
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
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                logger.info("Remove repository requested from onboarding.", {
                  repositoryUuid: activeRepository.uuid,
                })
                void manager.removeRepository(activeRepository.uuid)
              }}
            >
              移除此目录
            </Button>
          )}
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
    <RepoIdRecoveryDialog open={isRecoveryOpen} onOpenChange={setIsRecoveryOpen} />
    </>
  )
}

export { RepoOnboardingDialog }
