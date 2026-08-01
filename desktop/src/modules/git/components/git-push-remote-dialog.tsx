import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitPushTarget, SynapseGitRepositorySnapshot } from "@/types/git"

type SelectionRequest = {
  readonly targets: readonly SynapseGitPushTarget[]
  readonly resolve: (remoteName: string | null) => void
}

export function useGitPushRemoteSelection() {
  const [request, setRequest] = useState<SelectionRequest | null>(null)
  const [selected, setSelected] = useState("")
  const activeRequest = useRef<SelectionRequest | null>(null)

  useEffect(() => () => activeRequest.current?.resolve(null), [])

  const choose = async (
    repositoryId: string,
    trackingStatus: SynapseGitRepositorySnapshot["trackingStatus"],
  ): Promise<string | null | undefined> => {
    if (trackingStatus !== "untracked") return undefined
    let targets: readonly SynapseGitPushTarget[]
    try {
      targets = await requireSynapseBridge().git.listPushTargets(repositoryId)
    } catch {
      return undefined
    }
    if (targets.length === 0) return undefined
    if (targets.length === 1) return targets[0]?.name
    return new Promise<string | null>((resolve) => {
      const nextRequest = { targets, resolve }
      activeRequest.current = nextRequest
      setSelected(targets.find((target) => target.preferred)?.name ?? targets[0]?.name ?? "")
      setRequest(nextRequest)
    })
  }

  const close = (value: string | null) => {
    const current = activeRequest.current
    activeRequest.current = null
    setRequest(null)
    current?.resolve(value)
  }

  return {
    choose,
    dialog: (
      <Dialog open={request !== null} onOpenChange={(open) => { if (!open) close(null) }}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>选择推送远端</DialogTitle>
          </DialogHeader>
          <RadioGroup value={selected} onValueChange={setSelected} className="grid gap-2">
            {request?.targets.map((target) => {
              const id = `git-push-remote-${target.name}`
              return (
                <Label key={target.name} htmlFor={id} className="flex min-w-0 items-center gap-3 rounded-md border p-3">
                  <RadioGroupItem id={id} value={target.name} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{target.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{target.url}</span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(null)}>取消</Button>
            <Button type="button" disabled={!selected} onClick={() => close(selected)}>推送</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
