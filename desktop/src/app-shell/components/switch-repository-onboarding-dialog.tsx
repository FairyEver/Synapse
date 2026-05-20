import { useEffect, useRef, useState } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const logger = createRendererLogger("app.switch-onboarding")

function SwitchRepositoryOnboardingDialog() {
  const {
    pendingSwitchOnboarding,
    completePendingSwitchOnboarding,
    cancelPendingSwitchOnboarding,
  } = useActiveRepositorySwitch()
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isOpen = pendingSwitchOnboarding !== null

  const prevIsOpenRef = useRef(isOpen)
  useEffect(() => {
    if (prevIsOpenRef.current !== isOpen) {
      logger.info("Switch onboarding dialog visibility changed.", {
        open: isOpen,
        repositoryUuid: pendingSwitchOnboarding?.repositoryUuid ?? null,
      })
      prevIsOpenRef.current = isOpen
    }
  }, [isOpen, pendingSwitchOnboarding?.repositoryUuid])

  useEffect(() => {
    if (!isOpen) {
      setDisplayName("")
      setError(null)
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!pendingSwitchOnboarding) {
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

    logger.info("Switch onboarding submitted.", {
      displayNameLength: nextDisplayName.length,
      repositoryUuid: pendingSwitchOnboarding.repositoryUuid,
    })

    void completePendingSwitchOnboarding(nextDisplayName)
      .then(() => {
        logger.info("Switch onboarding completed.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          repositoryUuid: pendingSwitchOnboarding.repositoryUuid,
        })
      })
      .catch((submitError) => {
        logger.error("Switch onboarding failed.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          error: submitError,
          repositoryUuid: pendingSwitchOnboarding.repositoryUuid,
        })
        setError(submitError instanceof Error ? submitError.message : "保存显示名称失败。")
        setIsSubmitting(false)
      })
  }

  return (
    <Dialog
      open={isOpen}
      data-track="switch-repository-onboarding-dialog"
      onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          cancelPendingSwitchOnboarding()
        }
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>设置你在”{pendingSwitchOnboarding.repositoryName}”里的显示名</DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-2">
          <Field>
            <FieldLabel htmlFor="switch-onboarding-user-id">用户 ID</FieldLabel>
            <Input
              id="switch-onboarding-user-id"
              readOnly
              value={pendingSwitchOnboarding.userId}
              className="font-mono"
            />
          </Field>

          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="switch-onboarding-display-name">显示名称</FieldLabel>
            <FieldContent>
              <Input
                id="switch-onboarding-display-name"
                value={displayName}
                aria-invalid={error ? true : undefined}
                disabled={isSubmitting}
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

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => cancelPendingSwitchOnboarding()}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || displayName.trim().length === 0}
            onClick={handleSubmit}
          >
            {isSubmitting ? "正在保存..." : "确定并切换"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { SwitchRepositoryOnboardingDialog }
