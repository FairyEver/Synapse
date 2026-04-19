import { type ReactNode, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { useLocalIdentity } from "@/app-shell/identity-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function normalizeUserIdInput(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "")
}

function validateUserIdInput(value: string): string | null {
  const normalizedValue = normalizeUserIdInput(value)

  if (!normalizedValue) {
    return "ID 格式不对，应为 32 位十六进制字符。"
  }

  return /^[0-9a-f]{32}$/.test(normalizedValue)
    ? null
    : "ID 格式不对，应为 32 位十六进制字符。"
}

function IdentityScreenShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-xl flex-col gap-6 rounded-xl border border-border bg-card p-6">
        {children}
      </div>
    </main>
  )
}

function IdentityGate({ children }: { children: ReactNode }) {
  const { activeRepository } = useAppConfig()
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
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          正在读取身份信息
        </div>
      </IdentityScreenShell>
    )
  }

  if (error) {
    return (
      <IdentityScreenShell>
        <div className="flex flex-col gap-3">
          <h1 className="text-lg font-medium text-foreground">无法读取身份信息</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </IdentityScreenShell>
    )
  }

  if (localIdentityState?.status === "needs-recovery") {
    return (
      <IdentityScreenShell>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-medium text-foreground">身份 ID 无法读取</h1>
            <p className="text-sm text-muted-foreground">
              如果你备份过旧 ID，可以在当前目录里接续；否则可以生成一个新 ID。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="identity-recovery-input">身份 ID</Label>
            <Input
              id="identity-recovery-input"
              value={recoveryValue}
              className="font-mono"
              aria-invalid={recoveryError ? true : undefined}
              onChange={(event) => {
                setRecoveryValue(event.target.value)
                setRecoveryError(validateUserIdInput(event.target.value))
              }}
            />
            {recoveryError ? <p className="text-sm text-destructive">{recoveryError}</p> : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setIsSubmitting(true)
                void generateNewId().finally(() => {
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
                  setRecoveryError("先选择当前目录，再接续已有身份。")
                  return
                }

                setIsSubmitting(true)
                void adoptExistingUserId(normalizedRecoveryValue, activeRepository.uuid)
                  .catch((recoveryFailure) => {
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
            <p className="text-sm text-muted-foreground">当前没有激活目录，只能先生成新 ID。</p>
          ) : null}
        </div>
      </IdentityScreenShell>
    )
  }

  return <>{children}</>
}

export { IdentityGate }
