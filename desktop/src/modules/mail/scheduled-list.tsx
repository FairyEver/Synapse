import { useMemo, useState } from "react"
import { Paperclip } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import type { ScheduledSendState, ScheduledSendSummary } from "../../../app-capabilities/mail/shared/types"

export const scheduledStateMeta: Record<ScheduledSendState, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  pending: { label: "等待发送", variant: "secondary" },
  sending: { label: "发送中", variant: "secondary" },
  sent: { label: "已发送", variant: "outline" },
  missed: { label: "已错过", variant: "destructive" },
  failed: { label: "发送失败", variant: "destructive" },
  unknown: { label: "待核验", variant: "outline" },
  cancelled: { label: "已取消", variant: "outline" },
}

const ACTIVE_STATES = new Set<ScheduledSendState>(["pending", "sending", "missed", "failed", "unknown"])
const ATTENTION_STATES = new Set<ScheduledSendState>(["missed", "failed", "unknown"])

function statePriority(state: ScheduledSendState): number {
  if (ATTENTION_STATES.has(state)) return 0
  if (state === "sending" || state === "pending") return 1
  return 2
}

function shortReason(item: ScheduledSendSummary): string | null {
  if (item.state === "missed") return item.errorCode === "ACCOUNT_PAUSED" ? "邮箱已暂停" : "已超 30 分钟宽限期"
  if (item.state === "failed") {
    if (item.errorCode === "ACCOUNT_CHANGED") return "邮箱配置已变更"
    if (item.errorCode === "AUTH_FAILED") return "认证失败"
    if (item.errorCode === "RECIPIENTS_REJECTED") return "收件人被拒"
    return "发送失败，待处理"
  }
  if (item.state === "unknown") return "发送结果待核验"
  return null
}

export function MailScheduledList({
  items,
  selected,
  loading,
  more,
  onSelect,
  onMore,
}: {
  items: ScheduledSendSummary[]
  selected?: string
  loading: boolean
  more: boolean
  onSelect(id: string): void
  onMore(): void
}) {
  const [filter, setFilter] = useState<"active" | "all">("active")

  const sorted = useMemo(() => {
    const filtered = filter === "active" ? items.filter(item => ACTIVE_STATES.has(item.state)) : items
    return [...filtered].sort((a, b) => {
      const rankDiff = statePriority(a.state) - statePriority(b.state)
      if (rankDiff !== 0) return rankDiff
      if (statePriority(a.state) === 2) return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      return Date.parse(a.sendAt) - Date.parse(b.sendAt)
    })
  }, [items, filter])

  const activeCount = useMemo(() => items.filter(item => ACTIVE_STATES.has(item.state)).length, [items])
  const hasHistory = items.length > activeCount

  return (
    <section aria-label="定时发送列表" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex items-center gap-1" role="group" aria-label="状态筛选">
          <Button
            type="button"
            variant={filter === "active" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setFilter("active")}
            data-track="mail.scheduled.filter.active"
          >
            待处理{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
          <Button
            type="button"
            variant={filter === "all" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setFilter("all")}
            data-track="mail.scheduled.filter.all"
          >
            全部{items.length > 0 ? ` (${items.length})` : ""}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !items.length ? (
          <div className="space-y-3 p-4" aria-label="加载中">
            {[0, 1, 2].map(key => <Skeleton key={key} className="h-16 w-full" />)}
          </div>
        ) : sorted.length ? (
          sorted.map(item => {
            const meta = scheduledStateMeta[item.state]
            const recipients = [...item.to, ...item.cc].map(r => r.name || r.address).join(", ") || "未指定收件人"
            const reason = shortReason(item)
            return (
              <div key={item.id} className={cn("border-b px-3", selected === item.id ? "bg-selected" : "hover:bg-accent")}>
                <button
                  type="button"
                  data-track="mail.scheduled.open"
                  className="flex w-full min-w-0 flex-col gap-1 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelect(item.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{item.subject || "（无主题）"}</span>
                    <Badge variant={meta.variant} className="shrink-0">{meta.label}</Badge>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="truncate">{recipients}</span>
                    {item.attachmentCount > 0 && <Paperclip className="size-3 shrink-0" aria-label="含附件" />}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {item.state === "sent" && item.sentAt ? `已发：${formatDateTime(item.sentAt)}` : `预定：${formatDateTime(item.sendAt)}`}
                    </span>
                    {reason && <span className="truncate text-destructive">{reason}</span>}
                  </span>
                </button>
              </div>
            )
          })
        ) : (
          <div className="space-y-3 p-6 text-sm text-muted-foreground">
            <p>{filter === "active" ? "暂无待处理的定时邮件" : "暂无定时发送邮件"}</p>
            {filter === "active" && hasHistory && (
              <Button type="button" variant="outline" onClick={() => setFilter("all")}>查看全部记录</Button>
            )}
          </div>
        )}
        {more && (
          <div className="p-3">
            <Button variant="outline" className="w-full" disabled={loading} onClick={onMore}>加载更多</Button>
          </div>
        )}
      </div>
    </section>
  )
}
