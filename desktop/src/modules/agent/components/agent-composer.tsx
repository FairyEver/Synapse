import { type FormEvent, type KeyboardEvent, useRef, useEffect, useState } from "react"
import { ArrowUp, CornerDownRight, RotateCcw, ShieldCheck, Square, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Textarea } from "@/components/ui/textarea"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import type { PendingMessage } from "../pending-message-queue"

const SINGLE_LINE_HEIGHT = 28
const permissionModes: readonly SynapseAgentPermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]
const permissionModeLabels: Record<SynapseAgentPermissionMode, string> = {
  default: "默认",
  acceptEdits: "接受编辑",
  plan: "计划",
  auto: "自动",
  dontAsk: "不再询问",
  bypassPermissions: "跳过权限",
}
const permissionModeDescriptions: Record<SynapseAgentPermissionMode, string> = {
  default: "使用 Claude Code 默认权限策略。",
  acceptEdits: "自动接受文件编辑，其他工具仍按权限策略处理。",
  plan: "先制定计划，避免直接执行会修改环境的操作。",
  auto: "由 Claude Code 根据上下文自动判断工具权限。",
  dontAsk: "不再弹出权限询问，按当前会话策略继续执行。",
  bypassPermissions: "跳过所有权限确认。",
}
const providerAvailabilityNotes: Partial<Record<SynapseAgentPermissionMode, string>> = {
  auto: "部分服务不可用，切换失败时请换其他模式。",
}

function requiresModeConfirmation(mode: SynapseAgentPermissionMode): boolean {
  return mode === "auto" || mode === "bypassPermissions"
}

function confirmationText(mode: SynapseAgentPermissionMode | null): string {
  if (mode === "auto") return "将由模型自动判断工具权限。"
  if (mode === "bypassPermissions") return "将跳过工具权限确认。"
  return ""
}

function AgentComposer({
  draft,
  disabled,
  canSend,
  sending,
  cancelPhase,
  permissionMode = "default",
  onDraftChange,
  onInputKeyDown,
  onSubmit,
  onCancelTurn,
  onForceKillTurn,
  onPermissionModeChange = () => undefined,
  pendingMessages = [],
  onRemovePendingMessage,
  onRetryPendingMessage,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly permissionMode?: SynapseAgentPermissionMode
  readonly pendingMessages?: readonly PendingMessage[]
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancelTurn: () => void
  readonly onForceKillTurn: () => void
  readonly onPermissionModeChange?: (mode: SynapseAgentPermissionMode) => Promise<void> | void
  readonly onRemovePendingMessage?: (id: string) => void
  readonly onRetryPendingMessage?: (id: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const visiblePendingMessages = pendingMessages.filter((message) => message.status !== "sending")

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const scrollHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${scrollHeight}px`
    setMultiline(scrollHeight > SINGLE_LINE_HEIGHT)
  }, [draft])

  return (
    <>
      <form
        className="agent-composer absolute inset-x-4 bottom-5 z-10 mx-auto max-w-2xl md:inset-x-20"
        data-track="agent-composer"
        onSubmit={onSubmit}
      >
        <div
          className="agent-composer__container rounded-lg border border-border bg-background p-2"
          data-multiline={multiline || undefined}
        >
          {visiblePendingMessages.length > 0 ? (
            <div className="mb-2 flex max-h-40 flex-col overflow-y-auto">
              {visiblePendingMessages.map((message) => (
                <div
                  key={message.id}
                  className="flex min-w-0 items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                >
                  <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-muted-foreground">{message.content}</p>
                    {message.status === "failed" ? (
                      <p className="truncate text-xs text-destructive">{message.error ?? "发送失败"}</p>
                    ) : null}
                  </div>
                  {message.status === "failed" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="重试发送"
                      data-track="agent-pending-message-retry"
                      onClick={() => onRetryPendingMessage?.(message.id)}
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="删除待发送消息"
                    data-track="agent-pending-message-remove"
                    onClick={() => onRemovePendingMessage?.(message.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Textarea
              ref={textareaRef}
              className="agent-composer__input max-h-30 min-h-7 resize-none border-0 bg-transparent px-0 py-1 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="输入消息"
              disabled={disabled}
              rows={1}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="权限模式"
                  data-track="agent-permission-mode-select"
                  disabled={disabled}
                >
                  <ShieldCheck size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount>
                {permissionModes.map((mode) => (
                  <HoverCard key={mode} openDelay={100} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <DropdownMenuItem
                        data-mode={mode}
                        onSelect={(event) => {
                          event.preventDefault()
                          if (requiresModeConfirmation(mode)) {
                            setPendingMode(mode)
                            return
                          }
                          void onPermissionModeChange(mode)
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{permissionModeLabels[mode]}</span>
                        {mode === permissionMode ? (
                          <span className="text-xs text-muted-foreground">当前</span>
                        ) : null}
                      </DropdownMenuItem>
                    </HoverCardTrigger>
                    <HoverCardContent side="left" align="center">
                      <div className="font-medium">{mode}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{permissionModeDescriptions[mode]}</p>
                      {providerAvailabilityNotes[mode] ? (
                        <p className="mt-2 text-xs text-muted-foreground/70">{providerAvailabilityNotes[mode]}</p>
                      ) : null}
                    </HoverCardContent>
                  </HoverCard>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {sending || cancelPhase === "cancel_pending" ? (
              <Button
                type="button"
                className="agent-composer__stop rounded-full"
                size="icon-sm"
                onClick={cancelPhase === "cancel_pending" ? onForceKillTurn : onCancelTurn}
                aria-label={cancelPhase === "cancel_pending" ? "强制停止" : "停止"}
                data-track={cancelPhase === "cancel_pending" ? "agent-turn-force-stop" : "agent-turn-stop"}
              >
                <Square size={12} strokeWidth={0} fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="submit"
                className="agent-composer__send rounded-full"
                size="icon-sm"
                disabled={!canSend}
                aria-label="发送"
                data-track="agent-message-send"
              >
                <ArrowUp size={14} strokeWidth={2.5} />
              </Button>
            )}
          </div>
        </div>
      </form>
      <Dialog open={pendingMode !== null} onOpenChange={(open) => {
        if (!open) setPendingMode(null)
      }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切换权限模式</DialogTitle>
            <DialogDescription>{confirmationText(pendingMode)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingMode(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={pendingMode === "bypassPermissions" ? "destructive" : "default"}
              onClick={() => {
                const mode = pendingMode
                if (!mode) return
                setPendingMode(null)
                void onPermissionModeChange(mode)
              }}
            >
              继续切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { AgentComposer }
