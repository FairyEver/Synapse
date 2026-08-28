import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AgentGitAction } from "../hooks/use-project-git-actions"

type AgentGitActionMenuProps = {
  readonly busyAction: AgentGitAction | null
  readonly disabled?: boolean
  readonly preparing?: boolean
  readonly onCancel: () => void
  readonly onOpenGit: () => void
  readonly onPrepareCommit: (action: "commit" | "commit-and-push") => void
  readonly onRunRemote: (action: "pull" | "push" | "sync") => void
}

const busyLabels: Record<AgentGitAction, string> = {
  commit: "提交",
  "commit-and-push": "提交并推送",
  pull: "拉取",
  push: "推送",
  sync: "同步",
}

export function AgentGitActionMenu({
  busyAction,
  disabled,
  preparing,
  onCancel,
  onOpenGit,
  onPrepareCommit,
  onRunRemote,
}: AgentGitActionMenuProps) {
  const operationDisabled = disabled || preparing || busyAction !== null

  return (
    <DropdownMenu data-track="agent-git-actions">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__git-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="Git"
          data-track="agent-git-actions"
          disabled={disabled}
        >
          <span>Git</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled={operationDisabled} onSelect={() => onPrepareCommit("commit")}>
          提交全部改动
        </DropdownMenuItem>
        <DropdownMenuItem disabled={operationDisabled} onSelect={() => onPrepareCommit("commit-and-push")}>
          提交并推送
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={operationDisabled} onSelect={() => onRunRemote("pull")}>
          拉取
        </DropdownMenuItem>
        <DropdownMenuItem disabled={operationDisabled} onSelect={() => onRunRemote("push")}>
          推送
        </DropdownMenuItem>
        <DropdownMenuItem disabled={operationDisabled} onSelect={() => onRunRemote("sync")}>
          同步
        </DropdownMenuItem>
        {busyAction ? (
          <DropdownMenuItem onSelect={onCancel}>
            取消{busyLabels[busyAction]}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenGit}>
          在 Git 中打开
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
