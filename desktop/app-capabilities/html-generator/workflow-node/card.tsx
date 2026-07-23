import { CopyIdButton } from "../../../src/modules/workflow/components/copy-id-button"
import { NodeProgressBar, useRunningTimer } from "../../../src/modules/workflow/runner/node-progress-bar"
import { cn } from "../../../src/lib/utils"
import { statusClass, type NodeStatus } from "../../../workflow-nodes/node-status-utils"
import { htmlGeneratorEjsFileNodeManifest, htmlGeneratorEjsNodeManifest } from "./manifest"
import type { HtmlGeneratorEjsFileNodeConfig, HtmlGeneratorEjsNodeConfig } from "./schema"

type CardProps<T> = {
  readonly config: T
  readonly name?: string
  readonly selected?: boolean
  readonly status?: NodeStatus
  readonly progressLabel?: string
  readonly startedAt?: number
  readonly nodeId?: string
}

export function HtmlGeneratorEjsNodeCard(props: CardProps<HtmlGeneratorEjsNodeConfig>) {
  const source = props.config.variables.find((binding) => binding.name === "data")?.source.node
  return <HtmlGeneratorCard {...props} manifest={htmlGeneratorEjsNodeManifest} subtitle={source ? `数据：${source}` : "未选择数据"} />
}

export function HtmlGeneratorEjsFileNodeCard(props: CardProps<HtmlGeneratorEjsFileNodeConfig>) {
  return <HtmlGeneratorCard {...props} manifest={htmlGeneratorEjsFileNodeManifest} subtitle={props.config.outputPath || "未设置输出文件"} />
}

function HtmlGeneratorCard<T>({ manifest, subtitle, config: _config, name, selected, status, progressLabel, startedAt, nodeId }: CardProps<T> & {
  readonly manifest: typeof htmlGeneratorEjsNodeManifest | typeof htmlGeneratorEjsFileNodeManifest
  readonly subtitle: string
}) {
  const Icon = manifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || manifest.title}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timer}</span> : null}
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{status === "running" && progressLabel ? progressLabel : subtitle}</p>
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
