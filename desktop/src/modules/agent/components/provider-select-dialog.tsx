import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { track } from "@/lib/ui-tracking"
import type { SynapseAgentProvider } from "@/types/bridge"

const logger = createRendererLogger("agent")

type ProviderSelectDialogProps = {
  readonly open: boolean
  readonly projectId?: string
  readonly projectName?: string
  readonly onOpenChange: (open: boolean) => void
  readonly onCreate: (projectId: string, providerId: string) => void
}

function ProviderSelectDialog({
  open,
  projectId,
  projectName,
  onOpenChange,
  onCreate,
}: ProviderSelectDialogProps) {
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const autoCreateKeyRef = useRef<string | null>(null)

  const visibleProviders = useMemo(
    () => providers.filter((provider) => !provider.archived),
    [providers],
  )

  const loadProviders = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setLoaded(false)
    setError(null)
    setProviders([])
    setSelectedProviderId(undefined)
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders()
      if (requestId !== requestIdRef.current) return
      setProviders(nextProviders)
      const visible = nextProviders.filter((provider) => !provider.archived)
      setSelectedProviderId(visible.find((provider) => provider.active)?.id ?? visible[0]?.id)
      setLoaded(true)
    } catch (rawError) {
      if (requestId !== requestIdRef.current) return
      logger.warn("Agent provider list failed.", {
        boundary: "renderer.provider-select",
        projectId: projectId ?? null,
        hasProjectName: Boolean(projectName),
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      setProviders([])
      setSelectedProviderId(undefined)
      setError("读取 Provider 失败")
      setLoaded(true)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [projectId, projectName])

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1
      autoCreateKeyRef.current = null
      setLoaded(false)
      return
    }
    void loadProviders()
  }, [loadProviders, open])

  useEffect(() => {
    if (!open || !loaded || loading || error || !projectId || visibleProviders.length !== 1) return
    const providerId = visibleProviders[0]?.id
    if (!providerId) return
    const autoCreateKey = `${projectId}:${providerId}:${requestIdRef.current}`
    if (autoCreateKeyRef.current === autoCreateKey) return
    autoCreateKeyRef.current = autoCreateKey
    trackProviderCreate(projectId, providerId, visibleProviders.length, "auto")
    onCreate(projectId, providerId)
    onOpenChange(false)
  }, [error, loaded, loading, onCreate, onOpenChange, open, projectId, visibleProviders])

  const selectedProviderAvailable = Boolean(
    selectedProviderId && visibleProviders.some((provider) => provider.id === selectedProviderId),
  )

  const handleCreate = useCallback(() => {
    if (!projectId || !selectedProviderId || !selectedProviderAvailable || error || loading) return
    trackProviderCreate(projectId, selectedProviderId, visibleProviders.length, "manual")
    onCreate(projectId, selectedProviderId)
    onOpenChange(false)
  }, [error, loading, onCreate, onOpenChange, projectId, selectedProviderAvailable, selectedProviderId, visibleProviders.length])

  const shouldAutoCreate = Boolean(
    open && loaded && !loading && !error && projectId && visibleProviders.length === 1,
  )
  if (open && (!loaded || loading || shouldAutoCreate)) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>选择 Provider</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {projectName ? <Badge variant="secondary" className="w-fit">{projectName}</Badge> : null}
          {error ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadProviders()}>
                重试
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      正在加载
                    </TableCell>
                  </TableRow>
                ) : visibleProviders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      暂无 Provider
                    </TableCell>
                  </TableRow>
                ) : visibleProviders.map((provider) => {
                  const selected = provider.id === selectedProviderId
                  return (
                    <TableRow key={provider.id} data-state={selected ? "selected" : undefined}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">{provider.name}</span>
                          {provider.readonly ? <Badge variant="secondary">本机</Badge> : null}
                          {provider.active ? <Badge variant="secondary">默认</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>{provider.model || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant={selected ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setSelectedProviderId(provider.id)}
                        >
                          {selected ? "已选择" : `选择 ${provider.name}`}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!selectedProviderAvailable || loading || Boolean(error)}
            onClick={handleCreate}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorMessageLength(error: unknown): number {
  if (error instanceof Error) return error.message.length
  return String(error).length
}

function trackProviderCreate(
  projectId: string,
  providerId: string,
  providerCount: number,
  source: "auto" | "manual",
): void {
  track({
    component: "agent",
    name: "agent-provider-create",
    action: "submit",
    metadata: {
      boundary: "renderer.agent.provider-select",
      projectId,
      providerId,
      providerCount,
      source,
    },
  })
}

export { ProviderSelectDialog }
