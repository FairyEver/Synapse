import type { ReactNode } from "react"

type AgentComposerInputBoxProps = {
  readonly editor: ReactNode
  readonly leadingActions: ReactNode
  readonly trailingActions: ReactNode
  readonly multiline?: boolean
  readonly pendingMessages?: ReactNode
  readonly contextNotice?: ReactNode
  readonly slashMenu?: ReactNode
  readonly attachments?: ReactNode
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
}: AgentComposerInputBoxProps) {
  return (
    <div
      className="agent-composer-input-box rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
      data-multiline={multiline || undefined}
    >
      {slashMenu}
      {pendingMessages ? (
        <div className="agent-composer-input-box__pending border-b border-border px-1 pb-1">
          {pendingMessages}
        </div>
      ) : null}
      <div className="mx-auto flex min-w-0 max-w-4xl flex-col">
        {contextNotice ? (
          <div className="agent-composer-input-box__notice flex min-w-0 justify-center bg-muted/50 px-3 py-1 -mx-2 -mt-2 mb-1 rounded-t-2xl">
            {contextNotice}
          </div>
        ) : null}
        {attachments ? (
          <div className="agent-composer-input-box__attachments border-b border-border px-1 pb-2">
            {attachments}
          </div>
        ) : null}
        <div className="agent-composer-input-box__editor min-h-0 flex-1">
          {editor}
        </div>
        <div className="agent-composer-input-box__toolbar flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
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
