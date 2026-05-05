import { type FormEvent, type ReactNode, useState } from "react"
import { LoaderCircle } from "lucide-react"
import appIcon from "@/assets/icon.png"
import { formatLicenseErrorMessage, useLicense } from "@/app-shell/license"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function LicenseScreenShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {children}
      </div>
    </div>
  )
}

export function LicenseGate({ children }: { readonly children: ReactNode }) {
  const { activate, error, isReady, renew, status } = useLicense()
  const [email, setEmail] = useState("")
  const [activationCode, setActivationCode] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRenewing, setIsRenewing] = useState(false)

  if (!isReady) {
    return (
      <LicenseScreenShell>
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          正在读取授权
        </div>
      </LicenseScreenShell>
    )
  }

  if (status?.status === "active") {
    return <>{children}</>
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setFormError(null)
    try {
      const result = await activate({ email, activationCode })
      if (result.status !== "active") {
        setFormError(result.message ?? "授权未生效。")
      }
    } catch (caught) {
      setFormError(formatLicenseErrorMessage(caught, "激活失败。"))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRenew() {
    setIsRenewing(true)
    setFormError(null)
    try {
      const result = await renew()
      if (result.status !== "active") {
        setFormError(result.message ?? "续租失败。")
      }
    } catch (caught) {
      setFormError(formatLicenseErrorMessage(caught, "续租失败。"))
    } finally {
      setIsRenewing(false)
    }
  }

  return (
    <LicenseScreenShell>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
          <img src={appIcon} alt="Synapse" className="size-16 object-contain select-none" draggable={false} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">授权激活</h1>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="license-email">邮箱</Label>
          <Input
            id="license-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="license-code">激活码</Label>
          <Input
            id="license-code"
            placeholder="SYN-XXXX-XXXX-XXXX"
            value={activationCode}
            onChange={(event) => setActivationCode(event.target.value)}
            required
          />
        </div>

        {status?.message ? <p className="text-sm text-muted-foreground">{status.message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

        <div className="flex flex-col gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting || isRenewing}>
            {isSubmitting ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />激活中</> : "激活"}
          </Button>
          {status?.serverUrl && status.status !== "not_activated" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting || isRenewing}
              onClick={handleRenew}
            >
              续租当前授权
            </Button>
          ) : null}
        </div>

        {status?.expiresAt ? (
          <p className="text-center text-xs text-muted-foreground">到期：{formatDate(status.expiresAt)}</p>
        ) : null}
      </form>
    </LicenseScreenShell>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
