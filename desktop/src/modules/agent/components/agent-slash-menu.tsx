import { Command } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  groupAgentSlashCandidates,
  type AgentSlashCandidate,
} from "../slash-menu"

type AgentSlashMenuProps = {
  readonly candidates: readonly AgentSlashCandidate[]
  readonly highlightedIndex: number
  readonly onHighlight: (index: number) => void
  readonly onSelect: (candidate: AgentSlashCandidate) => void
}

function AgentSlashMenu({
  candidates,
  highlightedIndex,
  onHighlight,
  onSelect,
}: AgentSlashMenuProps) {
  const groups = groupAgentSlashCandidates(candidates)
  let visibleIndex = 0

  return (
    <div
      className="absolute bottom-full left-2 z-20 mb-2 w-80 rounded-lg border border-border bg-popover p-1 text-popover-foreground"
      role="listbox"
      aria-label="Agent slash menu"
      data-track="agent-slash-menu"
    >
      {candidates.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground">No matches</div>
      ) : (
        <ScrollArea className="max-h-72">
          <div className="flex flex-col gap-1">
            {groups.map((group) => (
              <div key={group.kind} className="flex flex-col gap-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((candidate) => {
                  const index = visibleIndex
                  visibleIndex += 1
                  const selected = index === highlightedIndex
                  return (
                    <button
                      key={`${candidate.kind}:${candidate.name}`}
                      type="button"
                      className={cn(
                        "flex min-w-0 items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                        selected ? "bg-muted text-foreground" : "text-popover-foreground",
                      )}
                      role="option"
                      aria-selected={selected}
                      data-track="agent-slash-menu-item"
                      onMouseEnter={() => onHighlight(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelect(candidate)}
                    >
                      <Command className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">/{candidate.name}</span>
                        {candidate.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {candidate.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export { AgentSlashMenu }
