import { useState, type RefObject } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { sessionLabel } from "../utils"

type AgentSessionDeleteRequest = {
  kind: "session" | "others"
  session: SynapseAgentSessionSummary
  groupSessions: readonly SynapseAgentSessionSummary[]
}

type AgentSessionDeleteDialogProps = {
  request: AgentSessionDeleteRequest | null
  onOpenChange: (open: boolean) => void
  onDelete: (session: SynapseAgentSessionSummary) => void | Promise<void>
  onDeleteOthers: (
    session: SynapseAgentSessionSummary,
    groupSessions: readonly SynapseAgentSessionSummary[],
  ) => void | Promise<void>
  returnFocusRef: RefObject<HTMLElement | null>
  successFocusRef: RefObject<HTMLElement | null>
}

function AgentSessionDeleteDialog({
  request,
  onOpenChange,
  onDelete,
  onDeleteOthers,
  returnFocusRef,
  successFocusRef,
}: AgentSessionDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)

  function handleOpenChange(open: boolean) {
    if (deleting) return
    onOpenChange(open)
    if (!open) {
      restoreFocusAfterClose(returnFocusRef.current)
    }
  }

  async function handleDelete() {
    if (!request || deleting) return
    setDeleting(true)
    try {
      if (request.kind === "others") {
        await onDeleteOthers(request.session, request.groupSessions)
      } else {
        await onDelete(request.session)
      }
      const successTarget = successFocusRef.current
      onOpenChange(false)
      restoreFocusAfterClose(successTarget)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={Boolean(request)}
      onOpenChange={handleOpenChange}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.kind === "others" ? "删除其他会话？" : "删除会话？"}</AlertDialogTitle>
          <AlertDialogDescription>
            {request?.kind === "others"
              ? `将保留“${sessionLabel(request.session)}”，永久删除同组其他 ${Math.max(0, request.groupSessions.length - 1)} 个会话。此操作无法撤销。`
              : `将永久删除“${request ? sessionLabel(request.session) : ""}”。此操作无法撤销。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus disabled={deleting}>取消</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? "正在删除" : "删除"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function restoreFocusAfterClose(target: HTMLElement | null) {
  window.setTimeout(() => target?.focus(), 50)
}

export { AgentSessionDeleteDialog }
export type { AgentSessionDeleteRequest }
