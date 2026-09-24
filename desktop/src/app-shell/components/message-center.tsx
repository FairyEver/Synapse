import { Bell, Trash2 } from "lucide-react"
import { useMessageCenter, type MessageFilter } from "@/app-shell/hooks/use-message-center"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

function MessageCenter({ onOpenMeeting }: { onOpenMeeting?: (meetingId: string) => void }) {
  const center = useMessageCenter(onOpenMeeting)
  const selected = center.selected
  if (!center.authenticated) return null

  return (
    <Sheet open={center.open} onOpenChange={center.changeOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`消息，${center.unread} 条未读`} className="gap-1.5">
          <Bell className="size-4" />
          消息
          {center.unread > 0 && <Badge variant="secondary">{center.unread > 99 ? "99+" : center.unread}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md" onCloseAutoFocus={(event) => event.preventDefault()}>
        <SheetHeader className="flex-row items-center gap-2">
          <SheetTitle>消息</SheetTitle>
          <Button type="button" variant="ghost" size="sm" onClick={() => { void center.openApiGuide() }}>API</Button>
        </SheetHeader>
        <div className="flex items-center justify-between gap-2 px-4">
          <Tabs value={center.filter} onValueChange={(value) => center.changeFilter(value as MessageFilter)}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="unread">未读</TabsTrigger>
              <TabsTrigger value="pending">待处理</TabsTrigger>
            </TabsList>
          </Tabs>
          {center.filter === "all" && <Button variant="ghost" size="sm" onClick={() => { void center.deleteAll("all") }}>全部清空</Button>}
          {center.filter === "unread" && <Button variant="ghost" size="sm" onClick={() => { void center.markAllRead() }}>全部已读</Button>}
          {center.filter === "pending" && <Button variant="ghost" size="sm" onClick={() => { void center.deleteAll("pending") }}>全部忽略</Button>}
        </div>
        {center.error && <p role="alert" className="px-4 text-sm text-destructive">{center.error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {selected ? (
            <div className="space-y-3 py-3">
              <Button variant="ghost" size="sm" onClick={center.closeDetail}>返回</Button>
              <h3 className="text-base font-semibold">{selected.title}</h3>
              {selected.group && <p className="text-xs text-muted-foreground">{selected.group}</p>}
              <p className="whitespace-pre-wrap text-sm">{selected.body}</p>
              <p className="text-xs text-muted-foreground">{new Date(selected.createdAt).toLocaleString()}</p>
              <div className="flex gap-2">
                {(selected.url || selected.targetId) && <Button size="sm" onClick={() => { void center.navigate(selected) }}>打开</Button>}
                <Button variant="outline" size="sm" onClick={() => { void center.remove(selected) }}><Trash2 className="size-4" />删除</Button>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {center.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无消息</p>}
              {center.items.map((item) => (
                <div key={item.id} className="flex items-start gap-2 py-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { void center.openItem(item) }}>
                    <span className={item.readAt ? "text-sm" : "text-sm font-semibold"}>{item.title}</span>
                    {item.group && <span className="ml-2 text-xs text-muted-foreground">{item.group}</span>}
                    <p className="truncate text-sm text-muted-foreground">{item.body}</p>
                    <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                  </button>
                  <Button variant="ghost" size="icon-sm" aria-label="删除消息" onClick={() => { void center.remove(item) }}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              {center.cursor && <Button variant="ghost" className="w-full" onClick={() => { void center.loadMore() }}>加载更多</Button>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { MessageCenter }
