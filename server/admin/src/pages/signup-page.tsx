import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { userAuthApi } from "@/lib/api"

type SignupPageProps = {
  readonly inviteToken: string
}

export function SignupPage({ inviteToken }: SignupPageProps) {
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [registered, setRegistered] = React.useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await userAuthApi.register({ invitationToken: inviteToken, email, password })
      setRegistered(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (!inviteToken) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>邀请链接无效</CardTitle>
          </CardHeader>
        </Card>
      </main>
    )
  }

  if (registered) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>注册成功</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/dashboard/login">去登录</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>注册账号</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="signup-email">邮箱</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="signup-password">密码</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? "注册中" : "注册"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
