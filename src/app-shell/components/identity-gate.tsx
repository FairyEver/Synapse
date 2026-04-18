import { type ReactNode, useMemo, useState } from "react"
import { Copy, LoaderCircle } from "lucide-react"
import { useIdentity } from "@/app-shell/identity-context"
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
  const {
    error,
    generateNewId,
    identityState,
    isReady,
    replaceUserId,
    updateDisplayName,
  } = useIdentity()
  const [draftDisplayName, setDraftDisplayName] = useState("")
  const [hasCopied, setHasCopied] = useState(false)
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

  if (identityState?.status === "needs-recovery") {
    return (
      <IdentityScreenShell>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <h1 className="text-xl font-medium text-foreground">身份 ID 无法读取</h1>
            <p className="text-sm text-muted-foreground">
              检测到本地身份 ID 损坏。如果你之前备份过 ID，现在可以手动填回；否则可以生成一个新 ID 继续使用。
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
                setIsSubmitting(true)
                void replaceUserId(normalizedRecoveryValue)
                  .catch((recoveryFailure) => {
                    setRecoveryError(recoveryFailure instanceof Error ? recoveryFailure.message : "恢复身份失败。")
                  })
                  .finally(() => {
                    setIsSubmitting(false)
                  })
              }}
            >
              手动填入
            </Button>
          </div>
        </div>
      </IdentityScreenShell>
    )
  }

  if (identityState?.status === "needs-onboarding") {
    return (
      <IdentityScreenShell>
        <div className="flex flex-col gap-5">
          <div className="space-y-2">
            <h1 className="text-2xl font-medium text-foreground">欢迎使用 Synapse</h1>
            <p className="text-sm text-muted-foreground">这是你唯一的身份凭证，丢失后无法找回。</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="identity-user-id">身份 ID</Label>
            <div className="flex gap-2">
              <Input
                id="identity-user-id"
                readOnly
                value={identityState.identity.userId}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(identityState.identity.userId).then(() => {
                    setHasCopied(true)
                  })
                }}
              >
                <Copy />
                复制
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              请现在复制并备份到密码管理器或安全位置。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="identity-display-name">显示名称</Label>
            <Input
              id="identity-display-name"
              value={draftDisplayName}
              onChange={(event) => setDraftDisplayName(event.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!hasCopied || !draftDisplayName.trim() || isSubmitting}
              onClick={() => {
                setIsSubmitting(true)
                void updateDisplayName(draftDisplayName).finally(() => {
                  setIsSubmitting(false)
                })
              }}
            >
              我已经备份好了，继续使用
            </Button>
          </div>
        </div>
      </IdentityScreenShell>
    )
  }

  return <>{children}</>
}

export { IdentityGate }
