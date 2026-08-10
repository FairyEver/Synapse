import { useState, type FormEvent } from "react"
import { GitBranch, Plus, RefreshCw, X } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useGitBranches } from "../hooks/use-git-branches"
import type {
  SynapseGitRemoteBranch,
  SynapseGitRepository,
} from "@/types/git"

type GitBranchSwitcherProps = {
  readonly repository: SynapseGitRepository
  readonly currentBranch: string | null
  readonly disabled?: boolean
  readonly mode?: "full" | "select" | "create"
  readonly selectWidth?: "default" | "compact"
  readonly refreshKey?: number
  readonly onChanged: () => void | Promise<void>
}

export function GitBranchSwitcher({
  repository,
  currentBranch,
  disabled,
  mode = "full",
  selectWidth = "default",
  refreshKey = 0,
  onChanged,
}: GitBranchSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [branchName, setBranchName] = useState("")
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false)
  const [selectedRemote, setSelectedRemote] = useState<{
    readonly remoteName: string
    readonly branch: SynapseGitRemoteBranch
  } | null>(null)
  const [localBranchName, setLocalBranchName] = useState("")
  const gitBranches = useGitBranches({
    repositoryId: repository.id,
    loadEnabled: mode !== "create",
    refreshKey,
    onChanged,
  })
  const { branches, remoteBranchGroups, busy, fetchingRemote, error } = gitBranches

  const checkout = async (nextBranch: string) => {
    if (!nextBranch || nextBranch === currentBranch) return
    await gitBranches.checkoutLocal(nextBranch)
  }

  const selectBranch = (value: string) => {
    if (value.startsWith("local:")) {
      void checkout(value.slice("local:".length))
      return
    }
    if (!value.startsWith("remote:")) return
    const fullName = value.slice("remote:".length)
    for (const group of remoteBranchGroups) {
      const branch = group.branches.find((candidate) => candidate.fullName === fullName)
      if (!branch) continue
      setSelectedRemote({ remoteName: group.remoteName, branch })
      setLocalBranchName(branch.name)
      gitBranches.clearError()
      setRemoteDialogOpen(true)
      return
    }
  }

  const checkoutRemote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const localName = localBranchName.trim()
    if (!selectedRemote || !localName) return
    const completed = await gitBranches.checkoutRemote({
      remoteName: selectedRemote.remoteName,
      branchName: selectedRemote.branch.name,
      localBranchName: localName,
    })
    if (completed) {
      setRemoteDialogOpen(false)
      setSelectedRemote(null)
      setLocalBranchName("")
    }
  }

  const createBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = branchName.trim()
    if (!name) return
    const completed = await gitBranches.createBranch(name)
    if (completed) {
      setBranchName("")
      setOpen(false)
    }
  }

  const selectTriggerClassName = mode === "full"
    ? "w-40"
    : selectWidth === "compact"
      ? "w-56 max-w-full min-w-0 sm:w-72"
      : "w-full min-w-0"

  const selectControl = (
    <Select
      value={currentBranch ? `local:${currentBranch}` : ""}
      onValueChange={selectBranch}
      disabled={disabled || busy || fetchingRemote || (branches.length === 0 && remoteBranchGroups.length === 0)}
    >
      <SelectTrigger size="sm" aria-label="分支" className={selectTriggerClassName}>
        <GitBranch data-icon="inline-start" />
        <SelectValue placeholder="无分支" />
      </SelectTrigger>
      <SelectContent>
        {branches.length > 0 ? (
          <SelectGroup>
            <SelectLabel>本地分支</SelectLabel>
            {branches.map((branch) => (
              <SelectItem key={branch.name} value={`local:${branch.name}`}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
        {branches.length > 0 && remoteBranchGroups.length > 0 ? <SelectSeparator /> : null}
        {remoteBranchGroups.map((group) => (
          <SelectGroup key={group.remoteName}>
            <SelectLabel>{group.remoteName}</SelectLabel>
            {group.branches.map((branch) => (
              <SelectItem key={branch.fullName} value={`remote:${branch.fullName}`}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )

  const fetchRemoteButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => fetchingRemote ? void gitBranches.cancelRemoteFetch() : void gitBranches.fetchRemote()}
    >
      {fetchingRemote ? <X data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      {fetchingRemote ? "取消获取" : "获取远程分支"}
    </Button>
  )

  const createButton = (
    <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => setOpen(true)}>
      <Plus data-icon="inline-start" />
      新建分支
    </Button>
  )

  return (
    <div className="flex min-w-0 items-center gap-2">
      {mode !== "create" ? selectControl : null}
      {mode !== "create" ? fetchRemoteButton : null}
      {mode !== "select" ? createButton : null}
      <Dialog open={open} onOpenChange={setOpen} data-track="git-create-branch-dialog">
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <form className="grid gap-4" onSubmit={createBranch}>
            <DialogHeader>
              <DialogTitle>新建分支</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="git-create-branch-name">分支名称</Label>
              <Input
                id="git-create-branch-name"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                autoComplete="off"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy || !branchName.trim()}>
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={remoteDialogOpen} onOpenChange={setRemoteDialogOpen} data-track="git-checkout-remote-branch-dialog">
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <form className="grid gap-4" onSubmit={checkoutRemote}>
            <DialogHeader>
              <DialogTitle>检出远程分支</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="git-checkout-remote-branch">远程分支</Label>
              <Input
                id="git-checkout-remote-branch"
                value={selectedRemote?.branch.fullName ?? ""}
                disabled
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="git-checkout-local-branch-name">本地分支名称</Label>
              <Input
                id="git-checkout-local-branch-name"
                value={localBranchName}
                onChange={(event) => setLocalBranchName(event.target.value)}
                autoComplete="off"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRemoteDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy || !localBranchName.trim()}>
                检出
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {error && !open && !remoteDialogOpen ? <span className="truncate text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
