import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { sessionLabel } from "../utils"

type AgentSessionRenameDialogProps = {
  readonly session: SynapseAgentSessionSummary | null
  readonly onOpenChange: (open: boolean) => void
  readonly onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}

function AgentSessionRenameDialog({
  session,
  onOpenChange,
  onRename,
}: AgentSessionRenameDialogProps) {
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!session) return
    setRenameValue(sessionLabel(session))
  }, [session])

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault()
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }

  async function handleConfirm() {
    const trimmed = renameValue.trim()
    if (!trimmed || !session) return
    try {
      await onRename(session, trimmed)
      onOpenChange(false)
    } catch {
      // Dialog stays open on failure for retry.
    }
  }

  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        aria-describedby={undefined}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
        </DialogHeader>
        <Input
          ref={renameInputRef}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") handleConfirm() }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!renameValue.trim()} onClick={handleConfirm}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AgentSessionRenameDialog }
