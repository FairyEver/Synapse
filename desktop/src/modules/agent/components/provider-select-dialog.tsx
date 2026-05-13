import { useCallback, useEffect, useMemo, useState } from "react"
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
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentProvider } from "@/types/bridge"

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
  const [error, setError] = useState<string | null>(null)

  const visibleProviders = useMemo(
    () => providers.filter((provider) => !provider.archived),
    [providers],
  )

  const loadProviders = useCallback(async () => {
    if (!projectId) {
      setProviders([])
      setSelectedProviderId(undefined)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders(projectId)
      setProviders(nextProviders)
      const visible = nextProviders.filter((provider) => !provider.archived)
      setSelectedProviderId(visible.find((provider) => provider.active)?.id ?? visible[0]?.id)
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : "读取 Provider 失败")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    void loadProviders()
  }, [loadProviders, open])

  const handleCreate = useCallback(() => {
    if (!projectId || !selectedProviderId) return
    onCreate(projectId, selectedProviderId)
    onOpenChange(false)
  }, [onCreate, onOpenChange, projectId, selectedProviderId])

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
          <Button type="button" disabled={!selectedProviderId || loading} onClick={handleCreate}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ProviderSelectDialog }
