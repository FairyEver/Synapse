import { MessageSquare, Send } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

function AgentSessionsModule() {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="agent-sessions">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">会话</h1>
          <p className="text-sm text-muted-foreground">项目会话和消息历史。</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
        <Card className="min-h-72">
          <CardHeader>
            <CardTitle>会话列表</CardTitle>
            <CardDescription>暂无会话</CardDescription>
          </CardHeader>
          <CardContent>
            <Empty className="min-h-48">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquare />
                </EmptyMedia>
                <EmptyTitle>暂无会话</EmptyTitle>
                <EmptyDescription>从连接进入项目会话。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent />
            </Empty>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-rows-[minmax(220px,1fr)_auto]">
          <Card className="min-h-72">
            <CardHeader>
              <CardTitle>消息</CardTitle>
              <CardDescription>当前会话无消息</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed">
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <Send className="size-4" />
                  <span>选择会话后发送消息。</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}

export { MessageRenderer } from "./components/message-renderer"
export {
  collectRichCardInteractions,
  renderRichCardFallback,
  resolveInteractionDispatch,
  richCardHasInteractions,
  toRenderableMessage,
} from "./message-interactions"
export { AgentSessionsModule }
