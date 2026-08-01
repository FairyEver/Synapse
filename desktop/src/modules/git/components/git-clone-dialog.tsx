import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitEnvironmentState, SynapseGitOperationState, SynapseGitRemoteKind } from "@/types/git"
import type { GitOperationFailure } from "../hooks/use-git-operations"
import { canHandleGitFailureAction, getGitFailureActionLabel } from "../lib/git-failure-view"
import { CopySshPublicKeyButton } from "./git-environment-panel"

type CloneInput = {
  readonly remoteUrl: string
  readonly parentDirectory: string
  readonly directoryName: string
}

type AddLocalInput = {
  readonly localPath: string
  readonly name: string
}

type GitCloneDialogProps = {
  readonly open: boolean
  readonly busy: boolean
  readonly phase?: SynapseGitOperationState["status"] | null
  readonly environment: SynapseGitEnvironmentState | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: CloneInput) => Promise<string | { readonly error: string; readonly failure?: GitOperationFailure | null } | null>
  readonly onFailureAction?: (input: { readonly cloneInput: CloneInput; readonly failure: GitOperationFailure }) => void
  readonly onCancel?: () => void
}

type GitAddLocalDialogProps = {
  readonly open: boolean
  readonly busy: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: AddLocalInput) => Promise<string | null>
}

function basename(input: string): string {
  const normalized = input.trim().replace(/[\\/]+$/, "")
  const name = normalized.split(/[\\/]/).filter(Boolean).pop() ?? ""
  return name.replace(/\.git$/i, "") || "Git 仓库"
}

function joinDisplayPath(parentDirectory: string, directoryName: string): string {
  const parent = parentDirectory.trim().replace(/[\\/]+$/, "")
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/"
  return parent && directoryName ? `${parent}${separator}${directoryName}` : ""
}

function detectRemoteKind(remoteUrl: string): SynapseGitRemoteKind {
  const value = remoteUrl.trim()
  if (/^http:\/\//i.test(value)) return "http"
  if (/^https:\/\//i.test(value)) return "https"
  if (/^(ssh:\/\/|[^@\s]+@[^:\s]+:.+)/i.test(value)) return "ssh"
  return "unknown"
}

function remoteKindLabel(kind: SynapseGitRemoteKind): string {
  if (kind === "http") return "HTTP"
  if (kind === "https") return "HTTPS"
  if (kind === "ssh") return "SSH"
  return "无法识别"
}

function hostFromRemoteUrl(remoteUrl: string): string | null {
  try {
    const url = new URL(remoteUrl)
    return url.hostname.toLowerCase() || null
  } catch {
    const match = remoteUrl.match(/^[^@\s]+@([^:\s]+):/)
    return match?.[1]?.toLowerCase() ?? null
  }
}

function inferCloneAccessFailure(error: string, remoteUrl: string): GitOperationFailure | null {
  const kind = detectRemoteKind(remoteUrl)
  const host = hostFromRemoteUrl(remoteUrl)
  if (kind === "ssh" && /publickey|permission denied|could not read from remote repository/i.test(error)) {
    return {
      category: "ssh-auth",
      detail: error,
      globalOperation: "clone",
      host,
      message: "请检查 SSH Key 或远程仓库访问权限。",
      primaryAction: "handle-ssh",
      protocol: "ssh",
      title: "SSH 访问失败",
    }
  }
  if ((kind === "http" || kind === "https") && /authentication failed|could not read username|invalid username or password|access denied|terminal prompts disabled|认证失败/i.test(error)) {
    const github = host === "github.com"
    return {
      category: github ? "github-auth" : "https-auth",
      detail: error,
      globalOperation: "clone",
      host,
      message: github ? "请登录 GitHub 后重试。" : `${host ?? "仓库"} 需要登录。`,
      primaryAction: github ? "handle-github-auth" : "login-host",
      protocol: kind,
      title: github ? "GitHub 需要登录" : "认证失败",
    }
  }
  return null
}

export function GitCloneDialog({ open, busy, phase, environment, onOpenChange, onSubmit, onFailureAction, onCancel }: GitCloneDialogProps) {
  const [remoteUrl, setRemoteUrl] = useState("")
  const [parentDirectory, setParentDirectory] = useState("")
  const [directoryName, setDirectoryName] = useState("")
  const [directoryNameTouched, setDirectoryNameTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)
  const finalPath = useMemo(
    () => joinDisplayPath(parentDirectory, directoryName),
    [directoryName, parentDirectory],
  )
  const remoteKind = useMemo(() => detectRemoteKind(remoteUrl), [remoteUrl])
  const failureActionLabel = canHandleGitFailureAction(failure) ? getGitFailureActionLabel(failure) : null

  useEffect(() => {
    if (!open) {
      setRemoteUrl("")
      setParentDirectory("")
      setDirectoryName("")
      setDirectoryNameTouched(false)
      setError(null)
      setFailure(null)
    }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setFailure(null)
    if (!remoteUrl.trim()) {
      setError("请输入仓库地址。")
      return
    }
    if (!parentDirectory.trim()) {
      setError("请输入保存位置。")
      return
    }
    if (!directoryName.trim()) {
      setError("请输入仓库目录名。")
      return
    }
    const cloneInput = {
      remoteUrl: remoteUrl.trim(),
      parentDirectory: parentDirectory.trim(),
      directoryName: directoryName.trim(),
    }
    const submitError = await onSubmit(cloneInput)
    if (!submitError) return
    if (typeof submitError === "string") {
      setError(submitError)
      return
    }
    const nextFailure = submitError.failure ?? inferCloneAccessFailure(submitError.error, cloneInput.remoteUrl)
    setError(nextFailure?.message ?? submitError.error)
    setFailure(nextFailure)
  }

  const chooseTargetPath = async () => {
    setError(null)
    setFailure(null)
    try {
      const selectedPath = await getSynapseBridge()?.settings.repository?.chooseDirectory()

      if (selectedPath) {
        setParentDirectory(selectedPath)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择目录失败。")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="git-clone-dialog">
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>克隆仓库</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="git-clone-remote-url">仓库地址</Label>
            <Input
              id="git-clone-remote-url"
              value={remoteUrl}
              onChange={(event) => {
                const value = event.target.value
                setRemoteUrl(value)
                if (!directoryNameTouched) setDirectoryName(basename(value))
              }}
              autoComplete="off"
            />
            {remoteUrl.trim() ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>认证方式：{remoteKindLabel(remoteKind)}</span>
                {remoteKind === "ssh" ? (
                  <>
                    <span>{environment?.sshAvailable ? "SSH 可用" : "未检测到 SSH"}</span>
                    <span>{environment?.commonSshKeyExists ? "已检测到 SSH 公钥" : "未检测到常见 SSH 公钥"}</span>
                    {environment?.commonSshKeyExists ? <CopySshPublicKeyButton /> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="git-clone-parent-directory">父目录</Label>
            <div className="flex gap-2">
              <Input
                id="git-clone-parent-directory"
                value={parentDirectory}
                onChange={(event) => setParentDirectory(event.target.value)}
                autoComplete="off"
              />
              <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseTargetPath()}>
                选择文件夹
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="git-clone-directory-name">仓库目录名</Label>
            <Input
              id="git-clone-directory-name"
              value={directoryName}
              onChange={(event) => {
                setDirectoryNameTouched(true)
                setDirectoryName(event.target.value)
              }}
              autoComplete="off"
            />
            {finalPath ? <p className="break-all text-xs text-muted-foreground">{finalPath}</p> : null}
          </div>
          {error ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-destructive">{error}</p>
              {failure && failureActionLabel ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => onFailureAction?.({
                    cloneInput: {
                      remoteUrl: remoteUrl.trim(),
                      parentDirectory: parentDirectory.trim(),
                      directoryName: directoryName.trim(),
                    },
                    failure,
                  })}
                >
                  {failureActionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => busy ? onCancel?.() : onOpenChange(false)}>
              {busy ? "取消克隆" : "取消"}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (phase === "queued" ? "等待中" : "克隆中") : "开始克隆"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function GitAddLocalDialog({ open, busy, onOpenChange, onSubmit }: GitAddLocalDialogProps) {
  const [localPath, setLocalPath] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const resolvedName = name.trim() || basename(localPath)

  useEffect(() => {
    if (!open) {
      setLocalPath("")
      setName("")
      setError(null)
    }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!localPath.trim()) {
      setError("请输入本地路径。")
      return
    }
    const submitError = await onSubmit({ localPath: localPath.trim(), name: resolvedName })
    if (submitError) setError(submitError)
  }

  const chooseLocalPath = async () => {
    setError(null)
    try {
      const selectedPath = await getSynapseBridge()?.settings.repository?.chooseDirectory()

      if (selectedPath) {
        setLocalPath(selectedPath)
        setName(basename(selectedPath))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择目录失败。")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="git-add-local-dialog">
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>添加本地仓库</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="git-add-local-path">本地路径</Label>
            <div className="flex gap-2">
              <Input
                id="git-add-local-path"
                value={localPath}
                readOnly
                autoComplete="off"
              />
              <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseLocalPath()}>
                选择文件夹
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="git-add-local-name">仓库名称</Label>
            <Input
              id="git-add-local-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "添加中" : "添加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
