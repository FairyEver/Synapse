import { Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { formatEntryTime } from "../utils"

function SessionTrailing({
  updatedAt,
  unread,
  canDelete,
  onDelete,
}: {
  readonly updatedAt?: string
  readonly unread: number
  readonly canDelete: boolean
  readonly onDelete: () => void
}) {
  return (
    <span className="flex items-center gap-1">
      {unread > 0 ? (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {unread}
          <span className="sr-only"> 条未读</span>
        </Badge>
      ) : null}
      {updatedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatEntryTime(updatedAt)}
        </span>
      ) : null}
      {canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              data-track="agent-session-delete-open"
              title="删除会话"
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              onClick={(event) => event.stopPropagation()}
            >
              <Trash2 className="size-3.5" />
              <span className="sr-only">删除会话</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除此会话？</AlertDialogTitle>
              <AlertDialogDescription>会话记录将被删除。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                data-track="agent-session-delete-confirm"
                onClick={onDelete}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </span>
  )
}

export { SessionTrailing }
