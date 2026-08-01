import { useEffect, useMemo, useRef, useState } from "react"
import { Copy, ExternalLinkIcon, KeyRound, RefreshCw, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseGitAccessHostState,
  SynapseGitAccessState,
  SynapseGitGenerateSshKeyInput,
  SynapseGitProviderLinks,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitSshHostKeyCandidate,
  SynapseGitSshTestResult,
  SynapseGitTestSshConnectionInput,
} from "@/types/git"
import type { PendingGitAction } from "../hooks/use-pending-git-action"
import { GitCredentialDialog, type GitCredentialDialogMode } from "./git-credential-dialog"
import { GitSshKeyDialog } from "./git-ssh-key-dialog"

type GitAccessPanelProps = {
  readonly access: SynapseGitAccessState | null
  readonly loading: boolean
  readonly error: string | null
  readonly pendingAction: PendingGitAction | null
  readonly platform?: string | null
  readonly userEmail?: string | null
  readonly onRefresh: () => Promise<void>
  readonly onConfigureCredentialHelper: (input: { readonly helper: string }) => Promise<boolean>
  readonly onSaveHttpsCredential: (input: SynapseGitSaveHttpsCredentialInput) => Promise<boolean>
  readonly onClearHttpsCredential: (input: { readonly host: string; readonly port?: number | null; readonly protocol: "http" | "https" }) => Promise<boolean>
  readonly onGenerateSshKey: (input: SynapseGitGenerateSshKeyInput) => Promise<boolean>
  readonly onTestSshConnection: (input: SynapseGitTestSshConnectionInput) => Promise<SynapseGitSshTestResult | null>
  readonly retrying: boolean
  readonly onRetryPendingAction: () => Promise<void>
}

function fallbackValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "未检测到"
}

function recommendedCredentialHelper(platform: string | null | undefined): string | null {
  if (platform === "darwin") return "osxkeychain"
  if (platform === "win32") return "manager-core"
  return null
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase()
}

function providerFromHost(host: string): SynapseGitAccessHostState["provider"] {
  if (host === "github.com") return "github"
  if (host === "gitee.com") return "gitee"
  if (host === "gitlab.com") return "gitlab"
  return "generic"
}

function hostFromPendingAction(pendingAction: PendingGitAction | null): SynapseGitAccessHostState | null {
  if (!pendingAction) return null
  return {
    host: pendingAction.host,
    lastFailure: null,
    port: pendingAction.port ?? null,
    protocol: pendingAction.protocol,
    provider: pendingAction.provider,
  }
}

function retryLabel(pendingAction: PendingGitAction | null): string {
  if (!pendingAction) return "重试"
  if (pendingAction.type === "clone") return "重试克隆"
  if (pendingAction.type === "pull") return "重试拉取"
  if (pendingAction.type === "push") return "重试推送"
  return "重试同步"
}

function providerLinks(access: SynapseGitAccessState | null, host: SynapseGitAccessHostState | null): SynapseGitProviderLinks | null {
  if (!access || !host) return null
  return access.providerLinks[host.provider] ?? null
}

function FieldRow({ label, value, mono = false }: {
  readonly label: string
  readonly value: string | null | undefined
  readonly mono?: boolean
}) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)] md:gap-3">
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

export function GitAccessPanel({
  access,
  loading,
  error,
  pendingAction,
  platform,
  userEmail,
  onRefresh,
  onConfigureCredentialHelper,
  onSaveHttpsCredential,
  onClearHttpsCredential,
  onGenerateSshKey,
  onTestSshConnection,
  retrying,
  onRetryPendingAction,
}: GitAccessPanelProps) {
  const [credentialOpen, setCredentialOpen] = useState(false)
  const [sshKeyOpen, setSshKeyOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [sshTestResult, setSshTestResult] = useState<SynapseGitSshTestResult | null>(null)
  const [sshHostKeyCandidate, setSshHostKeyCandidate] = useState<SynapseGitSshHostKeyCandidate | null>(null)
  const [httpsHostInput, setHttpsHostInput] = useState("")
  const [clearCredentialHost, setClearCredentialHost] = useState<string | null>(null)
  const lastAutoCredentialKeyRef = useRef<string | null>(null)

  const pendingHost = hostFromPendingAction(pendingAction)
  const accessPendingHost = pendingHost
    ? access?.hosts.find((host) => (
      host.host === pendingHost.host
      && (host.port ?? null) === pendingHost.port
      && host.protocol === pendingHost.protocol
    )) ?? null
    : null
  const selectedHost = useMemo(() => (
    accessPendingHost
      ?? pendingHost
      ?? null
  ), [accessPendingHost, pendingHost])
  const selectedHttpsHost = selectedHost?.protocol === "http" || selectedHost?.protocol === "https" ? selectedHost : null
  const manualHttpsHost = normalizeHost(httpsHostInput)
  const activeHttpsHost = selectedHttpsHost ?? (manualHttpsHost ? {
    host: manualHttpsHost,
    lastFailure: null,
    port: null,
    protocol: "https" as const,
    provider: providerFromHost(manualHttpsHost),
  } : null)
  const httpsLinks = providerLinks(access, activeHttpsHost)
  const sshLinks = providerLinks(access, selectedHost)
  const credentialMode: GitCredentialDialogMode = activeHttpsHost?.provider === "github" ? "github-token" : "generic"
  const helper = recommendedCredentialHelper(platform)
  const helperManagement = access?.credentialHelper.management ?? "unconfigured"
  const helperStatus = helperManagement === "synapse-supported"
    ? "可用"
    : helperManagement === "external" ? "外部管理" : helperManagement === "insecure" ? "明文存储" : "未配置"
  const canUseHost = Boolean(selectedHost?.host)
  const canUseHttps = Boolean(activeHttpsHost?.host)
  const isGithubHttps = activeHttpsHost?.provider === "github"

  useEffect(() => {
    if (selectedHttpsHost?.host) setHttpsHostInput(selectedHttpsHost.host)
  }, [selectedHttpsHost?.host])

  useEffect(() => {
    if (!pendingAction) {
      lastAutoCredentialKeyRef.current = null
      return
    }
    if (!activeHttpsHost?.host || activeHttpsHost.provider === "github") return
    const credentialKey = `${pendingAction.type}:${activeHttpsHost.protocol}:${activeHttpsHost.host}:${String(activeHttpsHost.port ?? "")}`
    if (lastAutoCredentialKeyRef.current === credentialKey) return
    lastAutoCredentialKeyRef.current = credentialKey
    setCredentialOpen(true)
  }, [activeHttpsHost?.host, activeHttpsHost?.port, activeHttpsHost?.protocol, activeHttpsHost?.provider, pendingAction])

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label)
    setMessage(null)
    try {
      await action()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "操作失败。")
    } finally {
      setBusyAction(null)
    }
  }

  const openExternal = async (url: string | null | undefined) => {
    if (!url) return
    await runAction("open-link", async () => {
      await requireSynapseBridge().shell.openExternal(url)
    })
  }

  const copySshPublicKey = async () => {
    await runAction("copy-ssh", async () => {
      const key = await requireSynapseBridge().git.getSshPublicKey()
      if (!key) {
        setMessage("未找到 SSH 公钥。")
        return
      }
      await navigator.clipboard.writeText(key.content)
      setMessage("已复制公钥。")
    })
  }

  const testSshConnection = async () => {
    if (!selectedHost?.host) return
    await runAction("test-ssh", async () => {
      const result = await onTestSshConnection({
        host: selectedHost.host,
        port: pendingAction?.port,
        provider: selectedHost.provider,
        username: pendingAction?.username,
      })
      setSshTestResult(result)
      if (result && !result.ok && /host key verification failed|authenticity of host|no .* host key is known/i.test(result.detail ?? "")) {
        const candidate = await requireSynapseBridge().git.scanSshHostKey({
          host: selectedHost.host,
          port: pendingAction?.port,
          provider: selectedHost.provider,
          username: pendingAction?.username,
        })
        if (candidate.changed) {
          setMessage("SSH 主机密钥与 known_hosts 记录不一致，请人工核验；Synapse 不会覆盖现有记录。")
          return
        }
        if (!candidate.trusted) setSshHostKeyCandidate(candidate)
      }
    })
  }

  const configureCredentialHelper = async () => {
    if (!helper) return
    await runAction("credential-helper", async () => {
      await onConfigureCredentialHelper({ helper })
      setMessage("已配置凭据助手。")
    })
  }

  const clearCredential = async () => {
    const host = clearCredentialHost ?? activeHttpsHost?.host
    if (!host) return
    await runAction("clear-credential", async () => {
      await onClearHttpsCredential({
        host,
        port: activeHttpsHost?.host === host ? activeHttpsHost.port ?? null : null,
        protocol: activeHttpsHost?.host === host && activeHttpsHost.protocol === "http" ? "http" : "https",
      })
      setMessage("已清除凭据。")
    })
  }

  return (
    <ScrollArea className="h-full bg-surface">
      <div className="flex flex-col gap-4 p-4">
        <GitCredentialDialog
          open={credentialOpen}
          onOpenChange={setCredentialOpen}
          host={activeHttpsHost?.host ?? ""}
          provider={activeHttpsHost?.provider ?? "generic"}
          mode={credentialMode}
          tokenUrl={httpsLinks?.tokenUrl}
          onSubmit={async (input) => {
            if (!activeHttpsHost?.host) return "请输入主机。"
            await onSaveHttpsCredential({
              host: activeHttpsHost.host,
              password: input.password,
              port: activeHttpsHost.port ?? null,
              protocol: activeHttpsHost.protocol === "http" ? "http" : "https",
              username: input.username,
            })
            return null
          }}
        />
        <GitSshKeyDialog
          open={sshKeyOpen}
          onOpenChange={setSshKeyOpen}
          defaultEmail={userEmail}
          onGenerate={async (input) => {
            await onGenerateSshKey(input)
            return null
          }}
        />
        <AlertDialog
          open={sshHostKeyCandidate !== null}
          onOpenChange={(open) => { if (!open) setSshHostKeyCandidate(null) }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认 SSH 主机密钥</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="grid gap-2">
                  <span>{sshHostKeyCandidate ? `${sshHostKeyCandidate.host}:${String(sshHostKeyCandidate.port)}` : ""}</span>
                  {sshHostKeyCandidate?.fingerprints.map((fingerprint) => (
                    <span key={fingerprint} className="break-all font-mono text-xs" data-allow-select="true">{fingerprint}</span>
                  ))}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                const candidate = sshHostKeyCandidate
                if (!candidate) return
                void runAction("trust-ssh-host", async () => {
                  await requireSynapseBridge().git.trustSshHostKey({
                    fingerprints: candidate.fingerprints,
                    host: candidate.host,
                    port: candidate.port,
                  })
                  setSshHostKeyCandidate(null)
                  if (pendingAction) {
                    await onRetryPendingAction()
                  } else {
                    setMessage("已信任 SSH 主机密钥。")
                  }
                })
              }}>
                信任
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={clearCredentialHost !== null}
          onOpenChange={(open) => {
            if (!open && busyAction !== "clear-credential") setClearCredentialHost(null)
          }}
          data-track="git-clear-credential-dialog"
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清除凭据？</AlertDialogTitle>
              <AlertDialogDescription>
                {clearCredentialHost ? `主机：${clearCredentialHost}` : "当前主机"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busyAction === "clear-credential"}>取消</AlertDialogCancel>
              <AlertDialogAction disabled={busyAction === "clear-credential"} onClick={() => void clearCredential()}>
                清除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {pendingAction ? (
          <Alert>
            <AlertTitle>{selectedHost?.lastFailure?.title ?? selectedHost?.host ?? "待处理访问"}</AlertTitle>
            <AlertDescription>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={retrying} onClick={() => void onRetryPendingAction()}>
                  {retrying ? "重试中" : retryLabel(pendingAction)}
                </Button>
                {(pendingAction.protocol === "http" || pendingAction.protocol === "https") && activeHttpsHost && !isGithubHttps ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCredentialOpen(true)}>
                    登录仓库
                  </Button>
                ) : null}
                {pendingAction.protocol === "ssh" ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setSshKeyOpen(true)}>
                    生成 SSH 密钥
                  </Button>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>访问检测失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <AlertTitle>Git 访问</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {sshTestResult ? (
          <Alert variant={sshTestResult.ok ? "default" : "destructive"}>
            <AlertTitle>{sshTestResult.title}</AlertTitle>
            {sshTestResult.detail ? <AlertDescription>{sshTestResult.detail}</AlertDescription> : null}
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>凭据助手</CardTitle>
            <CardAction>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onRefresh()}>
                <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
                重新检测
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={access?.credentialHelper.safe ? "secondary" : "outline"}>
                {helperStatus}
              </Badge>
              <span className="text-sm text-muted-foreground">{fallbackValue(access?.credentialHelper.helper)}</span>
            </div>
            <div>
              <FieldRow label="helper" value={access?.credentialHelper.helper} />
              <FieldRow label="来源" value={access?.credentialHelper.source} />
            </div>
            {(helperManagement === "unconfigured" || helperManagement === "insecure") && helper ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyAction === "credential-helper"}
                  onClick={() => void configureCredentialHelper()}
                >
                  <ShieldCheck data-icon="inline-start" />
                  配置凭据助手
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>HTTPS 访问</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <div className="grid gap-2 py-2">
                <Label htmlFor="git-access-https-host">主机</Label>
                <Input
                  id="git-access-https-host"
                  value={httpsHostInput}
                  onChange={(event) => setHttpsHostInput(event.target.value)}
                  autoComplete="off"
                  placeholder="git.company.com"
                />
              </div>
              <FieldRow label="提供方" value={activeHttpsHost?.provider} />
            </div>
            <div className="flex flex-wrap gap-2">
              {canUseHttps && isGithubHttps && httpsLinks?.credentialHelpUrl ? (
                <Button type="button" variant="outline" onClick={() => void openExternal(httpsLinks.credentialHelpUrl)}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  浏览器登录
                </Button>
              ) : null}
              {canUseHttps && isGithubHttps ? (
                <Button type="button" onClick={() => setCredentialOpen(true)}>
                  使用访问令牌
                </Button>
              ) : null}
              {canUseHttps && isGithubHttps && httpsLinks?.sshKeysUrl ? (
                <Button type="button" variant="outline" onClick={() => void openExternal(httpsLinks.sshKeysUrl)}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  改用 SSH
                </Button>
              ) : null}
              {canUseHttps && !isGithubHttps ? (
                <Button type="button" onClick={() => setCredentialOpen(true)}>
                  登录仓库
                </Button>
              ) : null}
              {canUseHttps && !isGithubHttps && httpsLinks?.tokenUrl ? (
                <Button type="button" variant="outline" onClick={() => void openExternal(httpsLinks.tokenUrl)}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  打开令牌页面
                </Button>
              ) : null}
              {canUseHttps && !isGithubHttps && httpsLinks?.credentialHelpUrl ? (
                <Button type="button" variant="outline" onClick={() => void openExternal(httpsLinks.credentialHelpUrl)}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  打开帮助
                </Button>
              ) : null}
              {canUseHttps ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeHttpsHost?.host || busyAction === "clear-credential"}
                  onClick={() => setClearCredentialHost(activeHttpsHost?.host ?? null)}
                >
                  清除凭据
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SSH 公钥</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={access?.ssh.available ? "secondary" : "outline"}>
                {access?.ssh.available ? "可用" : "未检测到"}
              </Badge>
              <span className="text-sm text-muted-foreground">{fallbackValue(access?.ssh.publicKeyFingerprint)}</span>
            </div>
            <div>
              <FieldRow label="路径" value={access?.ssh.publicKeyPath} mono />
              <FieldRow label="类型" value={access?.ssh.publicKeyType} />
              <FieldRow label="备注" value={access?.ssh.publicKeyComment} />
              <FieldRow label="指纹" value={access?.ssh.publicKeyFingerprint} mono />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setSshKeyOpen(true)}>
                <KeyRound data-icon="inline-start" />
                生成 SSH 密钥
              </Button>
              <Button type="button" variant="outline" disabled={busyAction === "copy-ssh"} onClick={() => void copySshPublicKey()}>
                <Copy data-icon="inline-start" />
                复制公钥
              </Button>
              {sshLinks?.sshKeysUrl ? (
                <Button type="button" variant="outline" onClick={() => void openExternal(sshLinks.sshKeysUrl)}>
                  <ExternalLinkIcon data-icon="inline-start" />
                  打开 SSH 设置
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={!canUseHost || busyAction === "test-ssh"}
                onClick={() => void testSshConnection()}
              >
                测试 SSH
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
