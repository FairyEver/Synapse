import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { userDashboardApi } from "@/lib/api"

type TeamInvitePageProps = {
  readonly token: string
}

export function TeamInvitePage({ token }: TeamInvitePageProps) {
  const [error, setError] = React.useState<string | null>(null)
  const [joined, setJoined] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  async function joinTeam() {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      await userDashboardApi.joinTeam(token)
      setJoined(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
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

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{joined ? "已加入团队" : "加入团队"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {joined ? (
            <Button asChild>
              <a href="/dashboard/#/teams">查看团队</a>
            </Button>
          ) : (
            <Button type="button" disabled={submitting} onClick={() => void joinTeam()}>
              {submitting ? "加入中" : "加入团队"}
            </Button>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  )
}
