import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

export type KnowledgeBaseComposerAction = {
  readonly label: string
  readonly description?: string
  readonly action: "send" | "insert"
  readonly commandText: string
}

type KnowledgeBaseActionMenuProps = {
  readonly actions: readonly KnowledgeBaseComposerAction[]
  readonly disabled?: boolean
  readonly onSend: (commandText: string) => void
  readonly onInsert: (commandText: string) => void
  readonly onOpenSourceManager?: () => void
}

export function KnowledgeBaseActionMenu({
  actions,
  disabled,
  onSend,
  onInsert,
  onOpenSourceManager,
}: KnowledgeBaseActionMenuProps) {
  if (actions.length === 0 && !onOpenSourceManager) return null

  return (
    <DropdownMenu data-track="agent-knowledge-base-actions">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__knowledge-base-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="知识库"
          data-track="agent-knowledge-base-actions"
          disabled={disabled}
        >
          <span>知识库</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {onOpenSourceManager ? (
          <DropdownMenuItem onSelect={onOpenSourceManager}>
            <span className="min-w-0 flex-1 truncate">资料管理</span>
          </DropdownMenuItem>
        ) : null}
        {actions.map((item) => (
          <HoverCard key={`${item.action}:${item.commandText}`} openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <DropdownMenuItem
                onSelect={() => {
                  if (item.action === "insert") {
                    onInsert(item.commandText)
                    return
                  }
                  onSend(item.commandText)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </DropdownMenuItem>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="center">
              <div className="font-medium">{item.commandText.trim()}</div>
              {item.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
