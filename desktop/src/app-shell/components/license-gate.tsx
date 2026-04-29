import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { KeyRound, LoaderCircle } from "lucide-react"
import { useLicense } from "@/app-shell/license"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const DEFAULT_LICENSE_SERVER_URL = "http://localhost:3000"

function LicenseScreenShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        {children}
      </Card>
    </main>
  )
}

export function LicenseGate({ children }: { readonly children: ReactNode }) {
  const { activate, error, isReady, renew, status } = useLicense()
  const [serverUrl, setServerUrl] = useState(DEFAULT_LICENSE_SERVER_URL)
  const [email, setEmail] = useState("")
  const [activationCode, setActivationCode] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRenewing, setIsRenewing] = useState(false)

  useEffect(() => {
    if (status?.serverUrl) setServerUrl(status.serverUrl)
    if (status?.email) setEmail(status.email)
  }, [status?.email, status?.serverUrl])

  if (!isReady) {
    return (
      <LicenseScreenShell>
        <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          正在读取授权
        </CardContent>
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
      const result = await activate({ serverUrl, email, activationCode })
      if (result.status !== "active") {
        setFormError(result.message ?? "授权未生效。")
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "激活失败。")
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
      setFormError(caught instanceof Error ? caught.message : "续租失败。")
    } finally {
      setIsRenewing(false)
    }
  }

  return (
    <LicenseScreenShell>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound />
          授权激活
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="license-server-url">服务器</Label>
            <Input
              id="license-server-url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="license-email">邮箱</Label>
            <Input
              id="license-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="license-code">激活码</Label>
            <Input
              id="license-code"
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value)}
              required
            />
          </div>
          {status?.message ? <p className="text-sm text-muted-foreground">{status.message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {status?.serverUrl && status.status !== "not_activated" ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting || isRenewing}
                onClick={handleRenew}
              >
                续租
              </Button>
            ) : null}
            <Button type="submit" disabled={isSubmitting || isRenewing}>
              激活
            </Button>
          </div>
          {status?.expiresAt ? (
            <p className="text-sm text-muted-foreground">到期：{formatDate(status.expiresAt)}</p>
          ) : null}
        </form>
      </CardContent>
    </LicenseScreenShell>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
