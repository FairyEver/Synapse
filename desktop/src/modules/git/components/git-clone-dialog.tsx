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

type CloneInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type AddLocalInput = {
  readonly localPath: string
  readonly name: string
}

type GitCloneDialogProps = {
  readonly open: boolean
  readonly busy: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: CloneInput) => Promise<void>
}

type GitAddLocalDialogProps = {
  readonly open: boolean
  readonly busy: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: AddLocalInput) => Promise<void>
}

function basename(input: string): string {
  const normalized = input.trim().replace(/[\\/]+$/, "")
  const name = normalized.split(/[\\/]/).filter(Boolean).pop() ?? ""
  return name.replace(/\.git$/i, "") || "Git 仓库"
}

export function GitCloneDialog({ open, busy, onOpenChange, onSubmit }: GitCloneDialogProps) {
  const [remoteUrl, setRemoteUrl] = useState("")
  const [targetPath, setTargetPath] = useState("")
  const [error, setError] = useState<string | null>(null)
  const name = useMemo(() => basename(targetPath || remoteUrl), [remoteUrl, targetPath])

  useEffect(() => {
    if (!open) {
      setRemoteUrl("")
      setTargetPath("")
      setError(null)
    }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!remoteUrl.trim()) {
      setError("请输入仓库地址。")
      return
    }
    if (!targetPath.trim()) {
      setError("请输入保存位置。")
      return
    }
    await onSubmit({ remoteUrl: remoteUrl.trim(), targetPath: targetPath.trim(), name })
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
              onChange={(event) => setRemoteUrl(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="git-clone-target-path">保存到</Label>
            <Input
              id="git-clone-target-path"
              value={targetPath}
              onChange={(event) => setTargetPath(event.target.value)}
              autoComplete="off"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "克隆中" : "开始克隆"}
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
    await onSubmit({ localPath: localPath.trim(), name: resolvedName })
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
            <Input
              id="git-add-local-path"
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              autoComplete="off"
            />
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
