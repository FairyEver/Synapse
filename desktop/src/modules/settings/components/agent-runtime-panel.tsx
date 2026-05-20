import { Fragment, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { useAgentRuntimeStatus } from "@/modules/settings/hooks/use-agent-runtime-status"
import type { SynapseAgentRuntimeStatusItem } from "@/types/agent"

type AgentRuntimePanelProps = {
  readonly children?: ReactNode
  readonly projectId?: string
}

type AgentRuntimeRowProps = {
  readonly item: SynapseAgentRuntimeStatusItem
}

const agentIconById = new Map<string, string>(
  agentDefinitions.map((definition) => [definition.id, definition.icon]),
)

function formatIssueText(item: SynapseAgentRuntimeStatusItem): string | null {
  const issue = item.issues.find((value) =>
    value === "cli-not-installed" ||
    value === "provider-not-configured" ||
    value === "model-not-selected"
  )

  if (issue === "cli-not-installed") {
    return `未检测到 ${item.cli.binary ?? item.id}`
  }

  if (issue === "provider-not-configured") {
    return "未配置 provider"
  }

  if (issue === "model-not-selected") {
    return "未选择模型"
  }

  return null
}

function AgentRuntimeRow({ item }: AgentRuntimeRowProps) {
  const detail = formatIssueText(item) ?? item.provider?.activeModel ?? item.cli.path
  const icon = agentIconById.get(item.id)

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <img src={icon} alt="" className="size-10 shrink-0 rounded-lg" />
        ) : null}
        <div className="min-w-0">
          <div className="truncate font-medium">{item.label}</div>
          {detail ? (
            <div className="truncate text-sm text-muted-foreground" title={detail}>
              {detail}
            </div>
          ) : null}
        </div>
      </div>
      <Badge variant={item.ready ? "default" : "secondary"}>
        {item.ready ? "可用" : "未就绪"}
      </Badge>
    </div>
  )
}

function AgentRuntimePanel({ children, projectId }: AgentRuntimePanelProps) {
  const { status, loading, error } = useAgentRuntimeStatus(projectId)
  const agents = status?.agents ?? []

  return (
    <Card className="py-0">
      <CardContent className="p-0">
        {loading && agents.length === 0 ? (
          <div className="flex flex-col gap-2 px-4 py-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error && agents.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : agents.length === 0 && !loading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            未检测到模型运行时
          </div>
        ) : (
          agents.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <Separator /> : null}
              <AgentRuntimeRow item={item} />
            </Fragment>
          ))
        )}
        {children ? (
          <>
            {agents.length > 0 ? <Separator /> : null}
            <div className="px-4 py-4">
              {children}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export { AgentRuntimePanel, AgentRuntimeRow, formatIssueText }
