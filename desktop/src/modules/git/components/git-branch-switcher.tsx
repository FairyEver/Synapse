import { useEffect, useState, type FormEvent } from "react"
import { GitBranch, Plus } from "lucide-react"
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitBranch, SynapseGitRepository } from "@/types/git"

type GitBranchSwitcherProps = {
  readonly repository: SynapseGitRepository
  readonly currentBranch: string | null
  readonly disabled?: boolean
  readonly onChanged: () => void | Promise<void>
}

export function GitBranchSwitcher({ repository, currentBranch, disabled, onChanged }: GitBranchSwitcherProps) {
  const [branches, setBranches] = useState<readonly SynapseGitBranch[]>([])
  const [open, setOpen] = useState(false)
  const [branchName, setBranchName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshBranches = async () => {
    try {
      setBranches(await requireSynapseBridge().git.listBranches(repository.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取分支失败。")
    }
  }

  useEffect(() => {
    void refreshBranches()
  }, [repository.id])

  const checkout = async (nextBranch: string) => {
    if (!nextBranch || nextBranch === currentBranch) return
    setBusy(true)
    setError(null)
    try {
      await requireSynapseBridge().git.checkoutBranch(repository.id, nextBranch)
      await refreshBranches()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换分支失败。")
    } finally {
      setBusy(false)
    }
  }

  const createBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = branchName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      await requireSynapseBridge().git.createBranch(repository.id, name)
      setBranchName("")
      setOpen(false)
      await refreshBranches()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建分支失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select
        value={currentBranch ?? ""}
        onValueChange={(value) => void checkout(value)}
        disabled={disabled || busy || branches.length === 0}
      >
        <SelectTrigger size="sm" aria-label="分支" className="w-40">
          <GitBranch data-icon="inline-start" />
          <SelectValue placeholder="无分支" />
        </SelectTrigger>
        <SelectContent>
          {branches.map((branch) => (
            <SelectItem key={branch.name} value={branch.name}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        新建分支
      </Button>
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
      {error && !open ? <span className="truncate text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
