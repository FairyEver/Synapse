import { useEffect, useRef } from "react"
import { BookOpen, Command } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  groupAgentSlashCandidates,
  type AgentSlashCandidate,
} from "../slash-menu"

type AgentSlashMenuProps = {
  readonly candidates: readonly AgentSlashCandidate[]
  readonly recentSkillNames?: readonly string[]
  readonly highlightedIndex: number
  readonly onHighlight: (index: number) => void
  readonly onSelect: (candidate: AgentSlashCandidate) => void
}

function AgentSlashCandidateIcon({ kind }: { readonly kind: AgentSlashCandidate["kind"] }) {
  if (kind === "knowledgeBase") {
    return <BookOpen className="size-4 shrink-0 text-muted-foreground" />
  }
  return <Command className="size-4 shrink-0 text-muted-foreground" />
}

function AgentSlashMenu({
  candidates,
  recentSkillNames = [],
  highlightedIndex,
  onHighlight,
  onSelect,
}: AgentSlashMenuProps) {
  const groups = groupAgentSlashCandidates(candidates, recentSkillNames)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  let visibleIndex = 0

  useEffect(() => {
    const item = itemRefs.current[highlightedIndex]
    if (typeof item?.scrollIntoView !== "function") return
    item.scrollIntoView({ block: "nearest" })
  }, [highlightedIndex])

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-20 mb-2 w-full rounded-lg border border-border bg-popover p-1 text-popover-foreground"
      role="listbox"
      aria-label="Agent slash menu"
      data-track="agent-slash-menu"
    >
      {candidates.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground">No matches</div>
      ) : (
        <ScrollArea
          className="h-auto min-w-0 max-w-full max-h-72"
          viewportClassName="min-w-0 max-w-full max-h-72 overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
        >
          <div className="flex min-w-0 max-w-full flex-col gap-1">
            {groups.map((group) => (
              <div key={group.kind} className="flex min-w-0 max-w-full flex-col gap-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((candidate) => {
                  const index = visibleIndex
                  visibleIndex += 1
                  const selected = index === highlightedIndex
                  return (
                    <button
                      ref={(node) => {
                        itemRefs.current[index] = node
                      }}
                      key={`${candidate.kind}:${candidate.name}`}
                      type="button"
                      className={cn(
                        "flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-sm px-2 text-left text-sm",
                        selected ? "bg-muted text-foreground" : "text-popover-foreground",
                      )}
                      role="option"
                      aria-selected={selected}
                      data-track="agent-slash-menu-item"
                      data-slash-candidate-kind={candidate.kind}
                      onMouseEnter={() => onHighlight(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelect(candidate)}
                    >
                      <AgentSlashCandidateIcon kind={candidate.kind} />
                      <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap">
                        <span className="min-w-0 truncate font-medium">/{candidate.name}</span>
                        {candidate.description ? (
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
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
