import { Clock, HeartPulse, TerminalSquare, Webhook } from "lucide-react"
import type { ReactNode } from "react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

function AutomationModule() {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="automation">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">自动化</h1>
          <p className="text-sm text-muted-foreground">定时任务、Heartbeat 和 Hooks。</p>
        </div>
      </div>

      <Tabs defaultValue="cron" className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="cron">定时任务</TabsTrigger>
          <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
        </TabsList>

        <TabsContent value="cron" className="mt-4">
          <AutomationPanel
            title="定时任务"
            description="暂无任务"
            icon={<Clock />}
          />
        </TabsContent>
        <TabsContent value="heartbeat" className="mt-4">
          <AutomationPanel
            title="Heartbeat"
            description="暂无 Heartbeat"
            icon={<HeartPulse />}
          />
        </TabsContent>
        <TabsContent value="hooks" className="mt-4">
          <AutomationPanel
            title="Hooks"
            description="暂无 Hook"
            icon={<Webhook />}
          />
        </TabsContent>
      </Tabs>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4" />
            Exec
          </CardTitle>
          <CardDescription>执行前需要权限确认。</CardDescription>
        </CardHeader>
      </Card>
    </section>
  )
}

function AutomationPanel({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: ReactNode
}) {
  return (
    <Card className="min-h-96">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Empty className="min-h-64">
          <EmptyHeader>
            <EmptyMedia variant="icon">{icon}</EmptyMedia>
            <EmptyTitle>{description}</EmptyTitle>
            <EmptyDescription>项目数据接入后显示配置。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent />
        </Empty>
      </CardContent>
    </Card>
  )
}

export { AutomationModule }
