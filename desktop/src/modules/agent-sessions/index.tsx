import { Clock, FileText, MessageSquare, Plus, Radio, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

const sessionStatuses = [
  { label: "运行中", value: "0" },
  { label: "等待权限", value: "0" },
  { label: "错误", value: "0" },
] as const

function AgentSessionsModule() {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="agent-sessions">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">会话</h1>
          <p className="text-sm text-muted-foreground">连接消息、本地对话和运行事件。</p>
        </div>
        <Button size="sm" variant="outline">
          <Plus />
          新建会话
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {sessionStatuses.map((status) => (
          <Card key={status.label} size="sm">
            <CardHeader>
              <CardDescription>{status.label}</CardDescription>
              <CardTitle>{status.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
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
                <EmptyDescription>从连接进入会话，或新建本地会话。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm">
                  <Plus />
                  新建会话
                </Button>
              </EmptyContent>
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

          <div className="grid gap-4 md:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="size-4" />
                  事件
                </CardTitle>
                <CardDescription>流式输出和权限请求</CardDescription>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4" />
                  引用
                </CardTitle>
                <CardDescription>文件和附件</CardDescription>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="size-4" />
                  Relay
                </CardTitle>
                <CardDescription>多 agent 请求</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">agent</Badge>
        <Badge variant="outline">attachments</Badge>
        <Badge variant="outline">events</Badge>
        <Badge variant="outline">relay</Badge>
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
