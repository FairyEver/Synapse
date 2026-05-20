import { type ReactNode, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normalizeUserIdInput, validateUserIdInput } from "@/lib/user-id-input"

const logger = createRendererLogger("app.identity-gate")

function IdentityScreenShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-xl flex-col gap-6 rounded-lg border border-border bg-card p-6">
        {children}
      </div>
    </main>
  )
}

function IdentityGate({ children }: { children: ReactNode }) {
  const activeRepository = useActiveRepository()
  const {
    adoptExistingUserId,
    error,
    generateNewId,
    localIdentityState,
    isReady,
  } = useLocalIdentity()
  const [recoveryValue, setRecoveryValue] = useState("")
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const normalizedRecoveryValue = useMemo(
    () => normalizeUserIdInput(recoveryValue),
    [recoveryValue],
  )

  if (!isReady) {
    return (
      <IdentityScreenShell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          正在读取身份信息
        </div>
      </IdentityScreenShell>
    )
  }

  if (error) {
    return (
      <IdentityScreenShell>
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-medium text-foreground">无法读取身份信息</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              重试
            </Button>
          </div>
        </div>
      </IdentityScreenShell>
    )
  }

  if (localIdentityState?.status === "needs-recovery") {
    return (
      <IdentityScreenShell>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-medium text-foreground">身份 ID 无法读取</h1>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="identity-recovery-input">身份 ID</Label>
            <Input
              id="identity-recovery-input"
              value={recoveryValue}
              className="font-mono"
              aria-invalid={recoveryError ? true : undefined}
              onChange={(event) => {
                const v = event.target.value
                setRecoveryValue(v)
                if (recoveryError) setRecoveryError(validateUserIdInput(v))
              }}
              onBlur={() => setRecoveryError(validateUserIdInput(recoveryValue))}
            />
            {recoveryError ? <p className="text-sm text-destructive">{recoveryError}</p> : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                const startedAt = performance.now()
                logger.info("Generate new identity requested from gate.", {
                  hasActiveRepository: Boolean(activeRepository),
                })
                setIsSubmitting(true)
                void generateNewId()
                  .then(() => {
                    logger.info("Generated new identity from gate.", {
                      elapsedMs: Math.round(performance.now() - startedAt),
                    })
                  })
                  .catch((generationError) => {
                    logger.error("Failed to generate new identity from gate.", {
                      elapsedMs: Math.round(performance.now() - startedAt),
                      error: generationError,
                    })
                    setRecoveryError(generationError instanceof Error ? generationError.message : "生成新 ID 失败，请重试。")
                  })
                  .finally(() => {
                    setIsSubmitting(false)
                  })
              }}
            >
              生成新 ID
            </Button>
            <Button
              type="button"
              disabled={isSubmitting || Boolean(validateUserIdInput(recoveryValue))}
              onClick={() => {
                if (!activeRepository) {
                  logger.warn("Attempted to adopt existing identity without an active repository.")
                  setRecoveryError("先选择当前目录，再接续已有身份。")
                  return
                }

                const startedAt = performance.now()
                logger.info("Adopt existing identity requested from gate.", {
                  repositoryUuid: activeRepository.uuid,
                  userIdLength: normalizedRecoveryValue.length,
                })
                setIsSubmitting(true)
                void adoptExistingUserId(normalizedRecoveryValue, activeRepository.uuid)
                  .then(() => {
                    logger.info("Adopted existing identity from gate.", {
                      elapsedMs: Math.round(performance.now() - startedAt),
                      repositoryUuid: activeRepository.uuid,
                    })
                  })
                  .catch((recoveryFailure) => {
                    logger.error("Failed to adopt existing identity from gate.", {
                      elapsedMs: Math.round(performance.now() - startedAt),
                      repositoryUuid: activeRepository.uuid,
                      error: recoveryFailure,
                    })
                    setRecoveryError(recoveryFailure instanceof Error ? recoveryFailure.message : "恢复身份失败。")
                  })
                  .finally(() => {
                    setIsSubmitting(false)
                  })
              }}
            >
              接续已有身份
            </Button>
          </div>

          {!activeRepository ? (
            <p className="text-sm text-muted-foreground">当前没有选中的目录，只能先生成新 ID。</p>
          ) : null}
        </div>
      </IdentityScreenShell>
    )
  }

  return <>{children}</>
}

export { IdentityGate }
