import { useMemo, useState, type ComponentType, type FormEvent } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FolderGit2,
  KeyRound,
  RefreshCw,
  Terminal,
  UserRound,
} from "lucide-react"
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
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitEnvironmentState, SynapseGitRepositorySummary } from "@/types/git"
import { getGitActionPlan, needsGitAttention } from "../lib/git-status-view"

type GitEnvironmentPanelProps = {
  readonly environment: SynapseGitEnvironmentState | null
  readonly repositorySummaries: readonly SynapseGitRepositorySummary[]
  readonly loading: boolean
  readonly error?: string | null
  readonly onRefresh: () => Promise<void>
}

type StatusTone = "ready" | "attention" | "muted"

type StatusBlockProps = {
  readonly title: string
  readonly value: string
  readonly detail: string
  readonly tone: StatusTone
  readonly icon: ComponentType<{ className?: string }>
}

type FieldRowProps = {
  readonly label: string
  readonly value: string | null | undefined
  readonly mono?: boolean
}

function statusVariant(tone: StatusTone): "secondary" | "outline" {
  return tone === "ready" ? "secondary" : "outline"
}

function fallbackValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "未检测到"
}

function identityStatus(environment: SynapseGitEnvironmentState | null): { label: string; tone: StatusTone; detail: string } {
  if (!environment) return { label: "检测中", tone: "muted", detail: "等待环境检测" }
  if (environment.userName && environment.userEmail) {
    return { label: "已配置", tone: "ready", detail: `${environment.userName} · ${environment.userEmail}` }
  }
  if (!environment.userName && !environment.userEmail) return { label: "缺用户名和邮箱", tone: "attention", detail: "需要配置 Git 身份" }
  if (!environment.userName) return { label: "缺用户名", tone: "attention", detail: environment.userEmail ?? "需要配置用户名" }
  return { label: "缺邮箱", tone: "attention", detail: environment.userName }
}

function gitStatus(environment: SynapseGitEnvironmentState | null): { label: string; tone: StatusTone; detail: string } {
  if (!environment) return { label: "检测中", tone: "muted", detail: "等待环境检测" }
  if (!environment.gitAvailable) return { label: "未检测到", tone: "attention", detail: environment.installHint ?? "安装 Git 后重新检测" }
  return { label: "可用", tone: "ready", detail: environment.gitVersion ?? "Git 可用" }
}

function sshStatus(environment: SynapseGitEnvironmentState | null): { label: string; tone: StatusTone; detail: string } {
  if (!environment) return { label: "检测中", tone: "muted", detail: "等待环境检测" }
  if (!environment.sshAvailable) return { label: "不可用", tone: "attention", detail: "SSH 检测失败" }
  if (!environment.commonSshKeyExists) return { label: "无公钥", tone: "attention", detail: "未找到常见 SSH 公钥" }
  return { label: "可用", tone: "ready", detail: environment.sshPublicKeyType ?? "已检测到 SSH 公钥" }
}

function repositoryStatus(summaries: readonly SynapseGitRepositorySummary[]): { label: string; tone: StatusTone; detail: string } {
  if (summaries.length === 0) return { label: "无仓库", tone: "muted", detail: "尚未添加 Git 仓库" }
  const attentionCount = summaries.filter((summary) => needsGitAttention(summary.snapshot, summary.error)).length
  if (attentionCount > 0) return { label: "有问题", tone: "attention", detail: `${attentionCount}/${summaries.length} 个仓库需要处理` }
  return { label: "正常", tone: "ready", detail: `${summaries.length} 个仓库已同步` }
}

function buildIssueList(
  environment: SynapseGitEnvironmentState | null,
  summaries: readonly SynapseGitRepositorySummary[],
): string[] {
  const issues: string[] = []
  if (!environment) return ["环境检测未完成。"]
  if (!environment.gitAvailable) issues.push("未检测到 Git。")
  if (!environment.userName) issues.push("缺少 Git 用户名。")
  if (!environment.userEmail) issues.push("缺少 Git 用户邮箱。")
  if (!environment.sshAvailable) issues.push("SSH 检测失败。")
  if (environment.sshAvailable && !environment.commonSshKeyExists) issues.push("未找到常见 SSH 公钥。")

  for (const summary of summaries) {
    const actionPlan = getGitActionPlan(summary.snapshot, summary.error)
    if (needsGitAttention(summary.snapshot, summary.error)) {
      issues.push(`${summary.repository.name}：${actionPlan.statusText}。`)
    }
  }

  return issues
}

function buildDiagnosticsText(
  environment: SynapseGitEnvironmentState | null,
  summaries: readonly SynapseGitRepositorySummary[],
): string {
  const lines = [
    "Git 环境诊断",
    `检测时间: ${environment?.checkedAt ?? "未检测"}`,
    `平台: ${environment?.platform ?? "未检测"}`,
    `用户目录: ${environment?.homeDir ?? "未检测"}`,
    "",
    "[Git]",
    `状态: ${environment?.gitAvailable ? "可用" : "不可用"}`,
    `版本: ${environment?.gitVersion ?? "未检测到"}`,
    `最终 git: ${environment?.effectiveGitPath ?? "未检测到"}`,
    `App PATH git: ${environment?.processGitPath ?? "未检测到"}`,
    `Login Shell git: ${environment?.shellGitPath ?? "未检测到"}`,
    `App PATH: ${environment?.processPath ?? "未检测到"}`,
    `Login Shell PATH: ${environment?.shellPath ?? "未检测到"}`,
    `最终 PATH: ${environment?.effectivePath ?? "未检测到"}`,
    "",
    "[身份]",
    `用户名: ${environment?.userName ?? "未配置"}`,
    `用户名来源: ${environment?.userNameSource ?? "未检测到"}`,
    `邮箱: ${environment?.userEmail ?? "未配置"}`,
    `邮箱来源: ${environment?.userEmailSource ?? "未检测到"}`,
    "",
    "[SSH]",
    `状态: ${environment?.sshAvailable ? "可用" : "不可用"}`,
    `公钥路径: ${environment?.sshPublicKeyPath ?? "未检测到"}`,
    `公钥类型: ${environment?.sshPublicKeyType ?? "未检测到"}`,
    `公钥备注: ${environment?.sshPublicKeyComment ?? "未检测到"}`,
    `公钥指纹: ${environment?.sshPublicKeyFingerprint ?? "未检测到"}`,
    "",
    "[仓库]",
  ]

  if (summaries.length === 0) {
    lines.push("无仓库")
  } else {
    for (const summary of summaries) {
      const { repository, snapshot } = summary
      const actionPlan = getGitActionPlan(snapshot, summary.error)
      lines.push([
        repository.name,
        repository.localPath,
        `分支=${snapshot?.currentBranch ?? "无分支"}`,
        `上游=${snapshot?.upstream ?? "无"}`,
        `ahead=${snapshot?.ahead ?? 0}`,
        `behind=${snapshot?.behind ?? 0}`,
        `改动=${snapshot?.changes.length ?? 0}`,
        `状态=${actionPlan.statusText}`,
        summary.error ? `错误=${summary.error}` : null,
      ].filter(Boolean).join(" | "))
    }
  }

  return lines.join("\n")
}

function StatusBlock({ title, value, detail, tone, icon: Icon }: StatusBlockProps) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Badge variant={statusVariant(tone)}>{value}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function FieldRow({ label, value, mono = false }: FieldRowProps) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-b-0 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-3">
      <div className="text-sm font-medium">{label}</div>
      <div
        className={mono ? "break-all font-mono text-xs text-muted-foreground" : "break-all text-sm text-muted-foreground"}
        data-allow-select="true"
      >
        {fallbackValue(value)}
      </div>
    </div>
  )
}

function IdentityForm({
  busy,
  userName,
  userEmail,
  onNameChange,
  onEmailChange,
  onSubmit,
}: {
  readonly busy: boolean
  readonly userName: string
  readonly userEmail: string
  readonly onNameChange: (value: string) => void
  readonly onEmailChange: (value: string) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={onSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="git-identity-name">用户名</Label>
        <Input
          id="git-identity-name"
          value={userName}
          onChange={(event) => onNameChange(event.target.value)}
          autoComplete="name"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="git-identity-email">邮箱</Label>
        <Input
          id="git-identity-email"
          value={userEmail}
          onChange={(event) => onEmailChange(event.target.value)}
          autoComplete="email"
        />
      </div>
      <Button type="submit" disabled={busy}>
        <CheckCircle2 data-icon="inline-start" />
        保存身份
      </Button>
    </form>
  )
}

function RepositoryDiagnosticsTable({ summaries }: { readonly summaries: readonly SynapseGitRepositorySummary[] }) {
  if (summaries.length === 0) {
    return (
      <Item variant="muted">
        <ItemMedia variant="icon">
          <FolderGit2 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>无仓库</ItemTitle>
          <ItemDescription>尚未添加 Git 仓库</ItemDescription>
        </ItemContent>
      </Item>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>仓库</TableHead>
          <TableHead>分支</TableHead>
          <TableHead>上游</TableHead>
          <TableHead className="text-right">同步</TableHead>
          <TableHead className="text-right">改动</TableHead>
          <TableHead>状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summaries.map((summary) => {
          const snapshot = summary.snapshot
          const actionPlan = getGitActionPlan(snapshot, summary.error)
          const hasAttention = needsGitAttention(snapshot, summary.error)
          return (
            <TableRow key={summary.repository.id}>
              <TableCell className="min-w-52">
                <div className="font-medium">{summary.repository.name}</div>
                <div className="mt-1 max-w-96 break-all font-mono text-xs text-muted-foreground" data-allow-select="true">
                  {summary.repository.localPath}
                </div>
              </TableCell>
              <TableCell>{snapshot?.currentBranch ?? "无分支"}</TableCell>
              <TableCell>{snapshot?.upstream ?? "无"}</TableCell>
              <TableCell className="text-right">↑{snapshot?.ahead ?? 0} ↓{snapshot?.behind ?? 0}</TableCell>
              <TableCell className="text-right">{snapshot?.changes.length ?? 0}</TableCell>
              <TableCell>
                <Badge variant={hasAttention ? "outline" : "secondary"}>{actionPlan.statusText}</Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function GitEnvironmentPanel({
  environment,
  repositorySummaries,
  loading,
  error: environmentError,
  onRefresh,
}: GitEnvironmentPanelProps) {
  const [userName, setUserName] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [pendingIdentity, setPendingIdentity] = useState<{ userName: string; userEmail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  const identityReady = Boolean(environment?.userName && environment.userEmail)
  const issues = useMemo(() => buildIssueList(environment, repositorySummaries), [environment, repositorySummaries])
  const git = gitStatus(environment)
  const identity = identityStatus(environment)
  const ssh = sshStatus(environment)
  const repositories = repositoryStatus(repositorySummaries)

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

  const copyDiagnostics = async () => {
    setCopyMessage(null)
    try {
      await navigator.clipboard.writeText(buildDiagnosticsText(environment, repositorySummaries))
      setCopyMessage("已复制诊断信息。")
    } catch (err) {
      setCopyMessage(err instanceof Error ? err.message : "复制失败。")
    }
  }

  return (
    <ScrollArea className="h-full bg-surface">
      <div className="space-y-4 p-4">
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

        <Card>
          <CardHeader>
            <CardTitle>Git 环境</CardTitle>
            <CardAction>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onRefresh()}>
                  <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
                  重新检测
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void copyDiagnostics()}>
                  <ClipboardCheck data-icon="inline-start" />
                  复制诊断信息
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusBlock title="Git" value={git.label} detail={git.detail} tone={git.tone} icon={Terminal} />
              <StatusBlock title="身份" value={identity.label} detail={identity.detail} tone={identity.tone} icon={UserRound} />
              <StatusBlock title="SSH" value={ssh.label} detail={ssh.detail} tone={ssh.tone} icon={KeyRound} />
              <StatusBlock title="仓库" value={repositories.label} detail={repositories.detail} tone={repositories.tone} icon={FolderGit2} />
            </div>

            {issues.length > 0 ? (
              <Alert>
                <AlertCircle />
                <AlertTitle>需要处理</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {environmentError ? (
              <Alert variant="destructive">
                <AlertTitle>检测失败</AlertTitle>
                <AlertDescription>{environmentError}</AlertDescription>
              </Alert>
            ) : null}
            {copyMessage ? <p className="text-sm text-muted-foreground">{copyMessage}</p> : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Git 运行环境</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldRow label="版本" value={environment?.gitVersion} />
              <FieldRow label="最终 git" value={environment?.effectiveGitPath ?? environment?.gitPath} mono />
              <FieldRow label="App PATH git" value={environment?.processGitPath} mono />
              <FieldRow label="Login Shell git" value={environment?.shellGitPath} mono />
              <FieldRow label="App PATH" value={environment?.processPath} mono />
              <FieldRow label="Login Shell PATH" value={environment?.shellPath} mono />
              <FieldRow label="最终 PATH" value={environment?.effectivePath} mono />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Git 身份</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <FieldRow label="用户名" value={environment?.userName} />
                <FieldRow label="用户名来源" value={environment?.userNameSource} mono />
                <FieldRow label="邮箱" value={environment?.userEmail} />
                <FieldRow label="邮箱来源" value={environment?.userEmailSource} mono />
              </div>
              {!identityReady ? (
                <IdentityForm
                  busy={busy}
                  userName={userName}
                  userEmail={userEmail}
                  onNameChange={setUserName}
                  onEmailChange={setUserEmail}
                  onSubmit={submitIdentity}
                />
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>SSH</CardTitle>
            <CardAction>
              <CopySshPublicKeyButton />
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldRow label="状态" value={environment ? (environment.sshAvailable ? "可用" : "不可用") : null} />
            <FieldRow label="公钥路径" value={environment?.sshPublicKeyPath} mono />
            <FieldRow label="公钥类型" value={environment?.sshPublicKeyType} />
            <FieldRow label="公钥备注" value={environment?.sshPublicKeyComment} />
            <FieldRow label="公钥指纹" value={environment?.sshPublicKeyFingerprint} mono />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>仓库状态</CardTitle>
          </CardHeader>
          <CardContent>
            <RepositoryDiagnosticsTable summaries={repositorySummaries} />
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
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
