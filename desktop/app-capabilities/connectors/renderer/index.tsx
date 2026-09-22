import { ExternalLink } from "lucide-react"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { ConnectorItem } from "../shared/schema"
import figmaIcon from "./assets/figma.png"
import connectorIcon from "./assets/connector.png"
import { useConnectors } from "./hooks/use-connectors"

export function ConnectorsModule() {
  const { items, loading, busyIds, toggle, reconnect, retry, openDocumentation } = useConnectors()

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0" viewportClassName="min-w-0">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          <div className="flex flex-col gap-3">
            {loading ? <ConnectorCardSkeleton /> : null}
            {!loading && items.length === 0 ? <p className="px-1 py-6 text-sm text-muted-foreground">暂无连接器</p> : null}
            {!loading ? items.map((item) => <ConnectorCard key={item.id} item={item} busy={busyIds.has(item.id)} onAction={toggle} onReconnect={reconnect} onRetry={retry} openDocumentation={openDocumentation} />) : null}
          </div>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

const connectionLabels = {
  disconnected: "未连接", connecting: "连接中", verifying: "验证中", connected: "已连接",
  reconnect_required: "需重新连接", failed: "连接失败",
} as const

function ConnectorCard({ item, busy, onAction, onReconnect, onRetry, openDocumentation }: {
  readonly item: ConnectorItem
  readonly busy: boolean
  readonly onAction: (item: ConnectorItem) => void
  readonly onReconnect: (item: ConnectorItem) => void
  readonly onRetry: (item: ConnectorItem) => void
  readonly openDocumentation: (url: string) => Promise<void>
}) {
  const connecting = busy || item.probeStatus === "checking"
  const stateLabel = item.connectionStatus ? connectionLabels[item.connectionStatus]
    : connecting ? "检测中" : item.enabled ? "已激活" : item.probeStatus === "error" ? "连接失败" : "未激活"
  const accountLabel = item.account ? [item.account.displayName ?? item.account.portalUserId, item.account.tenantName ?? item.account.tenantId].join(" · ") : undefined

  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-4 py-1">
        <img src={item.connectionStatus ? connectorIcon : figmaIcon} alt="" className="size-12 shrink-0 rounded-xl object-contain" />
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base">{item.name}</CardTitle>
          {item.documentationUrl ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto p-0 text-xs font-normal text-muted-foreground"
              data-track="connectors.connector.documentation"
              onClick={() => void openDocumentation(item.documentationUrl!)}
            >
              更多信息
              <ExternalLink data-icon="inline-end" />
            </Button>
          ) : null}
          {accountLabel ? <p className="mt-1 text-xs text-muted-foreground">{accountLabel}</p> : null}
          {item.probeStatus === "error" && item.errorMessage ? <p className="mt-1 text-xs text-destructive">{item.errorMessage}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.canRetry ? <Button variant="ghost" size="sm" data-track="connectors.connector.retry" onClick={() => onRetry(item)}>重试验证</Button> : null}
          {item.connectionStatus && item.connectionStatus !== "disconnected" ? <Button variant="ghost" size="sm" data-track="connectors.connector.reconnect" onClick={() => onReconnect(item)}>重新连接</Button> : null}
          {connecting ? <Spinner className="size-3.5" aria-hidden="true" /> : null}
          <span className="text-sm text-muted-foreground">{stateLabel}</span>
          <Switch
            checked={item.enabled}
            disabled={!item.connectionStatus && connecting}
            aria-busy={busy}
            aria-label={`${item.name}${stateLabel}`}
            data-track="connectors.connector.toggle"
            onCheckedChange={() => onAction(item)}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function ConnectorCardSkeleton() {
  return (
    <Card size="sm" aria-label="加载连接器">
      <CardHeader className="pb-0"><Skeleton className="h-5 w-28" /></CardHeader>
      <CardContent className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-48" /><Skeleton className="h-7 w-16" /></CardContent>
    </Card>
  )
}
