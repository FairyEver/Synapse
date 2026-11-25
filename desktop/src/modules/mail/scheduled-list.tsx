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
  return (
    <section aria-label="定时发送列表" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3 text-sm font-medium">
        <span>定时发送</span>
        {items.length > 0 && <span className="tabular-nums text-xs font-normal text-muted-foreground">{items.length} 封</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !items.length ? (
          <div className="space-y-3 p-4" aria-label="加载中">
            {[0, 1, 2].map(key => <Skeleton key={key} className="h-16 w-full" />)}
          </div>
        ) : items.length ? (
          items.map(item => {
            const meta = scheduledStateMeta[item.state]
            const recipients = [...item.to, ...item.cc].map(r => r.name || r.address).join(", ") || "未指定收件人"
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
                  <span className="tabular-nums text-xs text-muted-foreground">
                    预定：{formatDateTime(item.sendAt)}
                  </span>
                </button>
              </div>
            )
          })
        ) : (
          <p className="p-6 text-sm text-muted-foreground">暂无定时发送邮件</p>
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
