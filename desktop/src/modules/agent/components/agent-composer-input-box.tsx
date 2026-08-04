import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type AgentComposerInputBoxProps = {
  readonly editor: ReactNode
  readonly leadingActions: ReactNode
  readonly trailingActions: ReactNode
  readonly multiline?: boolean
  readonly pendingMessages?: ReactNode
  readonly contextNotice?: ReactNode
  readonly slashMenu?: ReactNode
  readonly attachments?: ReactNode
  readonly dropActive?: boolean
}

function AgentComposerInputBox({
  editor,
  leadingActions,
  trailingActions,
  multiline,
  pendingMessages,
  contextNotice,
  slashMenu,
  attachments,
  dropActive,
}: AgentComposerInputBoxProps) {
  return (
    <div
      className={cn(
        "agent-composer-input-box rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
        dropActive && "border-ring ring-3 ring-ring/20",
      )}
      data-multiline={multiline || undefined}
      data-drop-active={dropActive || undefined}
    >
      {slashMenu}
      <div className="mx-auto flex min-w-0 max-w-4xl flex-col">
        {contextNotice ? (
          <div className="agent-composer-input-box__notice flex min-w-0 justify-center bg-muted/50 px-3 py-1 -mx-2 -mt-2 mb-1 rounded-t-2xl">
            {contextNotice}
          </div>
        ) : null}
        {pendingMessages ? (
          <div className="agent-composer-input-box__pending border-b border-border px-1 pb-1">
            {pendingMessages}
          </div>
        ) : null}
        {attachments ? (
          <div className="agent-composer-input-box__attachments px-1 pt-2">
            {attachments}
          </div>
        ) : null}
        <div className="agent-composer-input-box__editor min-h-0 flex-1">
          {editor}
        </div>
        <div className="agent-composer-input-box__toolbar flex items-center justify-between gap-2">
          <div
            className="agent-composer-input-box__leading-actions flex min-w-0 items-center gap-0"
            role="group"
            aria-label="输入工具"
          >
            {leadingActions}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {trailingActions}
          </div>
        </div>
      </div>
    </div>
  )
}

export { AgentComposerInputBox }
