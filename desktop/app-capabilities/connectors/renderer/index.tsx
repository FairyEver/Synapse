import { useCallback, useEffect, useMemo, useState } from "react"
import { ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { ConnectorItem } from "../shared/schema"
import icon from "./assets/figma.png"

export function ConnectorsModule() {
  const bridge = useMemo(() => requireBridgeDomain("connectors"), [])
  const [items, setItems] = useState<ConnectorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setItems((await bridge.item.list()).items)
    } catch {
      toast.error("加载连接器失败")
    } finally {
      setLoading(false)
    }
  }, [bridge])

  useEffect(() => {
    void reload()
    return bridge.item.onChanged((event) => setItems(event.items))
  }, [bridge, reload])

  const handleAction = useCallback(async (item: ConnectorItem) => {
    setBusyId(item.id)
    try {
      if (item.enabled) {
        await bridge.item.disconnect({ id: item.id })
        setItems((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, enabled: false }
          : entry))
        toast.success(`${item.name} MCP 已停用`)
      } else {
        const connected = await bridge.item.connect({ id: item.id })
        setItems((current) => current.map((entry) => entry.id === connected.id ? connected : entry))
        toast.success(`${item.name} MCP 已激活`)
      }
    } catch (error) {
      await reload()
      toast.error(error instanceof Error ? error.message : "连接失败")
    } finally {
      setBusyId(null)
    }
  }, [bridge])

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0" viewportClassName="min-w-0">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          <div className="flex flex-col gap-3">
            {loading ? <ConnectorCardSkeleton /> : null}
            {!loading && items.length === 0 ? <p className="px-1 py-6 text-sm text-muted-foreground">暂无连接器</p> : null}
            {!loading ? items.map((item) => <ConnectorCard key={item.id} item={item} busy={busyId === item.id} onAction={handleAction} />) : null}
          </div>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function ConnectorCard({ item, busy, onAction }: { readonly item: ConnectorItem; readonly busy: boolean; readonly onAction: (item: ConnectorItem) => void }) {
  const connecting = busy || item.probeStatus === "checking"
  const stateLabel = connecting ? "检测中" : item.enabled ? "已激活" : item.probeStatus === "error" ? "连接失败" : "未激活"

  const openDocumentation = useCallback(async () => {
    if (!item.documentationUrl) return
    try {
      await requireBridgeDomain("shell").openExternal(item.documentationUrl)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法打开文档")
    }
  }, [item.documentationUrl])

  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-4 py-1">
        <img src={icon} alt="" className="size-12 shrink-0 rounded-xl object-contain" />
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base">{item.name}</CardTitle>
          {item.documentationUrl ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto p-0 text-xs font-normal text-muted-foreground"
              data-track="connectors.connector.documentation"
              onClick={() => void openDocumentation()}
            >
              更多信息
              <ExternalLink data-icon="inline-end" />
            </Button>
          ) : null}
          {item.probeStatus === "error" && item.errorMessage ? <p className="mt-1 text-xs text-destructive">{item.errorMessage}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy ? <Spinner className="size-3.5" aria-hidden="true" /> : null}
          <span className="text-sm text-muted-foreground">{stateLabel}</span>
          <Switch
            checked={item.enabled}
            disabled={connecting}
            aria-busy={busy}
            aria-label={`${item.name}${item.enabled ? "已激活" : item.probeStatus === "error" ? "连接失败" : "未激活"}`}
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
