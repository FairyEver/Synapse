import { BookOpen, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type KnowledgeBaseComposerAction = {
  readonly label: string
  readonly action: "send" | "insert"
  readonly commandText: string
}

type KnowledgeBaseActionMenuProps = {
  readonly actions: readonly KnowledgeBaseComposerAction[]
  readonly disabled?: boolean
  readonly onSend: (commandText: string) => void
  readonly onInsert: (commandText: string) => void
}

export function KnowledgeBaseActionMenu({
  actions,
  disabled,
  onSend,
  onInsert,
}: KnowledgeBaseActionMenuProps) {
  if (actions.length === 0) return null

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
          <BookOpen />
          <span>知识库</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {actions.map((item) => (
          <DropdownMenuItem
            key={`${item.action}:${item.commandText}`}
            onSelect={() => {
              if (item.action === "insert") {
                onInsert(item.commandText)
                return
              }
              onSend(item.commandText)
            }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
