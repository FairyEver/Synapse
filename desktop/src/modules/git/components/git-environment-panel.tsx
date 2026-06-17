import { useState, type FormEvent } from "react"
import { AlertCircle, CheckCircle2, Copy, RefreshCw } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitEnvironmentState } from "@/types/git"

type GitEnvironmentPanelProps = {
  readonly environment: SynapseGitEnvironmentState | null
  readonly loading: boolean
  readonly onRefresh: () => Promise<void>
}

function stateLabel(ok: boolean): string {
  return ok ? "正常" : "需要处理"
}

export function GitEnvironmentPanel({ environment, loading, onRefresh }: GitEnvironmentPanelProps) {
  const [userName, setUserName] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [pendingIdentity, setPendingIdentity] = useState<{ userName: string; userEmail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const identityReady = Boolean(environment?.userName && environment.userEmail)

  const submitIdentity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextUserName = userName.trim()
    const nextUserEmail = userEmail.trim()
    if (!nextUserName || !nextUserEmail) {
      setError("请输入用户名和邮箱。")
      return
    }
    setError(null)
    setPendingIdentity({ userName: nextUserName, userEmail: nextUserEmail })
  }

  const confirmIdentity = async () => {
    if (!pendingIdentity) return
    setBusy(true)
    setError(null)
    try {
      await requireSynapseBridge().git.configureIdentity(pendingIdentity)
      setPendingIdentity(null)
      setUserName("")
      setUserEmail("")
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存 Git 身份失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border bg-background p-4">
      <AlertDialog open={pendingIdentity !== null} onOpenChange={(open) => {
        if (!open && !busy) setPendingIdentity(null)
      }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存 Git 身份？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>将写入全局 Git 配置。</p>
                <p className="text-foreground">用户名：{pendingIdentity?.userName}</p>
                <p className="text-foreground">邮箱：{pendingIdentity?.userEmail}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirmIdentity()}>
              {busy ? "保存中" : "保存"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Git 环境</span>
          <Badge variant={environment?.gitAvailable ? "secondary" : "outline"}>Git {stateLabel(Boolean(environment?.gitAvailable))}</Badge>
          <Badge variant={identityReady ? "secondary" : "outline"}>身份 {stateLabel(identityReady)}</Badge>
          <Badge variant={environment?.sshAvailable ? "secondary" : "outline"}>SSH {stateLabel(Boolean(environment?.sshAvailable))}</Badge>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onRefresh()}>
          <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
          重新检测
        </Button>
      </div>

      {!environment?.gitAvailable ? (
        <Alert className="mt-3">
          <AlertCircle />
          <AlertTitle>未检测到 Git</AlertTitle>
          <AlertDescription>{environment?.installHint ?? "安装 Git 后重新检测。"}</AlertDescription>
        </Alert>
      ) : (
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{environment.gitVersion ?? "Git 可用"}</span>
            {identityReady ? <span>{environment.userName} · {environment.userEmail}</span> : null}
            {environment.commonSshKeyExists ? <span>已检测到 SSH 公钥</span> : <span>未检测到常见 SSH 公钥</span>}
          </div>
          {!identityReady ? (
            <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={submitIdentity}>
              <div className="grid gap-2">
                <Label htmlFor="git-identity-name">用户名</Label>
                <Input
                  id="git-identity-name"
                  value={userName}
                  onChange={(event) => setUserName(event.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="git-identity-email">邮箱</Label>
                <Input
                  id="git-identity-email"
                  value={userEmail}
                  onChange={(event) => setUserEmail(event.target.value)}
                  autoComplete="email"
                />
              </div>
              <Button type="submit" disabled={busy}>
                <CheckCircle2 data-icon="inline-start" />
                保存身份
              </Button>
            </form>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

export function CopySshPublicKeyButton() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const copy = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const key = await requireSynapseBridge().git.getSshPublicKey()
      if (!key) {
        setMessage("未找到 SSH 公钥。")
        return
      }
      await navigator.clipboard.writeText(key.content)
      setMessage("已复制公钥。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "复制失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void copy()}>
        <Copy data-icon="inline-start" />
        复制公钥
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </span>
  )
}
