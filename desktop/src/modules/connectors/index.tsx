import { Cable, KeyRound, Plug, Plus, QrCode, Webhook } from "lucide-react"
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

const connectorSections = [
  { title: "平台连接", description: "Feishu、Telegram、Slack、Weixin 等平台。", icon: Plug },
  { title: "Webhook", description: "外部请求触发 prompt 或 exec。", icon: Webhook },
  { title: "Bridge", description: "外部 adapter 和 Web chat 会话。", icon: Cable },
  { title: "QR 绑定", description: "Feishu/Lark 和 Weixin 扫码接入。", icon: QrCode },
] as const

function ConnectorsModule() {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="connectors">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">连接</h1>
          <p className="text-sm text-muted-foreground">平台、Webhook 和 Bridge。</p>
        </div>
        <Button size="sm" variant="outline">
          <Plus />
          添加连接
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {connectorSections.map(({ title, description, icon: Icon }) => (
          <Card key={title} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="size-4" />
                {title}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="min-h-96">
        <CardHeader>
          <CardTitle>连接列表</CardTitle>
          <CardDescription>暂无连接</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plug />
              </EmptyMedia>
              <EmptyTitle>暂无连接</EmptyTitle>
              <EmptyDescription>添加平台连接或启用 Webhook。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm">
                <Plus />
                添加连接
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" />
              凭证
            </CardTitle>
            <CardDescription>密钥以 secretRef 保存。</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>能力</CardTitle>
            <CardDescription>图片、文件、语音、卡片和按钮。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">image</Badge>
              <Badge variant="outline">file</Badge>
              <Badge variant="outline">audio</Badge>
              <Badge variant="outline">card</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export { ConnectorsModule }
