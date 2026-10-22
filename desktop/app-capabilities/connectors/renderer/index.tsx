import { useState } from "react"
import { ExternalLink, Mail } from "lucide-react"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../src/components/ui/dialog"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { ConnectorItem } from "../shared/schema"
import figmaIcon from "./assets/figma.png"
import portalHeadlessIcon from "./assets/portal-headless.png"
import { useConnectors } from "./hooks/use-connectors"
import { WecomMailDialog } from "./wecom-mail-dialog"

export function ConnectorsModule() {
  const { items, loading, busyIds, toggle, reconnect, retry, openDocumentation } = useConnectors()
  const [mailConnector, setMailConnector] = useState<ConnectorItem | null>(null)
  const activeMailConnector = mailConnector
    ? items.find((item) => item.id === mailConnector.id && item.connectionStatus === "connected") ?? null
    : null

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0" viewportClassName="min-w-0">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          <div className="flex flex-col gap-3">
            {loading ? <ConnectorCardSkeleton /> : null}
            {!loading && items.length === 0 ? <p className="px-1 py-6 text-sm text-muted-foreground">暂无连接器</p> : null}
            {!loading ? items.map((item) => <ConnectorCard key={item.id} item={item} busy={busyIds.has(item.id)} onAction={toggle} onReconnect={reconnect} onRetry={retry} openDocumentation={openDocumentation} onOpenMail={setMailConnector} onCancelConnect={toggle} />) : null}
          </div>
        </div>
      </ScrollArea>
      {activeMailConnector ? (
        <WecomMailDialog
          key={`${activeMailConnector.mailbox?.address ?? ""}:${activeMailConnector.mailbox?.connectedAt ?? ""}`}
          connector={activeMailConnector}
          open
          onOpenChange={(open) => { if (!open) setMailConnector(null) }}
        />
      ) : null}
    </SystemAppWindowShell>
  )
}

const connectionLabels = {
  disconnected: "未连接", connecting: "连接中", verifying: "验证中", connected: "已连接",
  reconnect_required: "需重新连接", failed: "连接失败",
} as const

function ConnectorCard({ item, busy, onAction, onReconnect, onRetry, openDocumentation, onOpenMail, onCancelConnect }: {
  readonly item: ConnectorItem
  readonly busy: boolean
  readonly onAction: (item: ConnectorItem) => void
  readonly onReconnect: (item: ConnectorItem) => void
  readonly onRetry: (item: ConnectorItem) => void
  readonly openDocumentation: (url: string) => Promise<void>
  readonly onOpenMail: (item: ConnectorItem) => void
  readonly onCancelConnect: (item: ConnectorItem) => void
}) {
  const connecting = busy || item.probeStatus === "checking"
  const stateLabel = item.connectionStatus ? connectionLabels[item.connectionStatus]
    : connecting ? "检测中" : item.enabled ? "已激活" : item.probeStatus === "error" ? "连接失败" : "未激活"
  const accountLabel = item.mailbox
    ? [item.mailbox.displayName, item.mailbox.address].filter(Boolean).join(" · ")
    : item.account
      ? [item.account.displayName ?? item.account.portalUserId, item.account.tenantName ?? item.account.tenantId].join(" · ")
      : undefined
  const reconnectLabel = item.kind === "wecom-mail" && item.warningMessage ? "重新检查" : "重新连接"

  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-4 py-1">
        <ConnectorIcon item={item} />
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
          {item.warningMessage ? <p className="mt-1 whitespace-pre-line text-xs text-destructive">{item.warningMessage}</p> : null}
          {item.helpUrl ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto p-0 text-xs font-normal"
              data-track="connectors.wecom-mail.permission.apply"
              onClick={() => void openDocumentation(item.helpUrl!)}
            >
              申请邮箱权限
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.kind === "wecom-mail" && item.connectionStatus === "connected" ? <Button variant="ghost" size="sm" data-track="connectors.connector.mail.open" onClick={() => onOpenMail(item)}>打开邮箱</Button> : null}
          {item.canRetry && item.kind !== "wecom-mail" ? <Button variant="ghost" size="sm" data-track="connectors.connector.retry" onClick={() => onRetry(item)}>重试验证</Button> : null}
          {item.connectionStatus && item.connectionStatus !== "disconnected" ? <Button variant="ghost" size="sm" data-track="connectors.connector.reconnect" onClick={() => onReconnect(item)}>{reconnectLabel}</Button> : null}
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
      {item.kind === "wecom-mail" ? (
        <Dialog open={Boolean(item.qrCodeDataUrl)} onOpenChange={(open) => { if (!open) onCancelConnect(item) }} data-track="connectors.wecom-mail.connect.dialog">
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>连接企业微信邮箱</DialogTitle>
              <DialogDescription>使用企业微信扫描二维码完成授权。</DialogDescription>
            </DialogHeader>
            {item.qrCodeDataUrl ? <img src={item.qrCodeDataUrl} alt="企业微信邮箱授权二维码" className="mx-auto size-64 rounded-lg border bg-background p-2" /> : null}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />等待扫码</div>
            <div className="flex justify-end"><Button type="button" variant="outline" data-track="connectors.wecom-mail.connect.cancel" onClick={() => onCancelConnect(item)}>取消</Button></div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}

function ConnectorIcon({ item }: { readonly item: ConnectorItem }) {
  if (item.kind === "wecom-mail") {
    return <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"><Mail className="size-6" aria-hidden="true" /></div>
  }
  return <img src={item.kind === "portal-session" ? portalHeadlessIcon : figmaIcon} alt="" className="size-12 shrink-0 rounded-xl object-contain" />
}

function ConnectorCardSkeleton() {
  return (
    <Card size="sm" aria-label="加载连接器">
      <CardHeader className="pb-0"><Skeleton className="h-5 w-28" /></CardHeader>
      <CardContent className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-48" /><Skeleton className="h-7 w-16" /></CardContent>
    </Card>
  )
}
