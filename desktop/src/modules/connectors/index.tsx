import { Plug } from "lucide-react"
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

function ConnectorsModule() {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="connectors">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">连接</h1>
          <p className="text-sm text-muted-foreground">项目和平台连接。</p>
        </div>
      </div>

      <Card className="min-h-96">
        <CardHeader>
          <CardTitle>项目列表</CardTitle>
          <CardDescription>暂无项目</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plug />
              </EmptyMedia>
              <EmptyTitle>暂无项目</EmptyTitle>
              <EmptyDescription>项目数据接入后显示平台连接。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        </CardContent>
      </Card>
    </section>
  )
}

export { ConnectorsModule }
