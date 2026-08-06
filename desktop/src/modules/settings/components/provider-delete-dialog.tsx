import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ProviderModelSelection } from "@/types/provider-model"

const logger = createRendererLogger("settings.providers")

type ProviderDeleteDialogProps = {
  readonly provider: SynapseAgentProvider | null
  readonly onOpenChange: (open: boolean) => void
  readonly onDeleted: () => void
}

type ScanState =
  | { status: "loading" }
  | { status: "loaded"; workflowNodeCount: number; conversationCount: number; agentPersonaCount: number; references: Array<{ kind: string; entityId: string; entityName: string; projectId?: string; nodeId?: string; nodeName?: string }> }
  | { status: "error"; message: string }

export function ProviderDeleteDialog({ provider, onOpenChange, onDeleted }: ProviderDeleteDialogProps) {
  const [scan, setScan] = useState<ScanState>({ status: "loading" })
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deletingConversations, setDeletingConversations] = useState(false)
  const scanRequestIdRef = useRef(0)

  const runScan = useCallback(async () => {
    if (!provider) return
    const providerId = provider.id
    const requestId = ++scanRequestIdRef.current
    setScan({ status: "loading" })
    try {
      const result = await requireSynapseBridge().agent.scanProviderReferences({ providerId })
      if (scanRequestIdRef.current !== requestId) return
      setScan({
        status: "loaded",
        workflowNodeCount: result.workflowNodeCount,
        conversationCount: result.conversationCount,
        agentPersonaCount: result.agentPersonaCount,
        references: result.references.map((r) => ({
          kind: r.kind,
          entityId: r.entityId,
          entityName: r.entityName,
          projectId: r.projectId,
          nodeId: r.nodeId,
          nodeName: r.nodeName,
        })),
      })
    } catch {
      if (scanRequestIdRef.current !== requestId) return
      logger.error("Provider reference scan failed.", { boundary: "settings.providers.scan", providerId: provider.id })
      setScan({ status: "error", message: "扫描引用失败" })
    }
  }, [provider])

  useEffect(() => {
    if (!provider) return
    setScan({ status: "loading" })
    void runScan()
  }, [runScan])

  const handleDelete = useCallback(async () => {
    if (!provider) return
    setBusy(true)
    try {
      await requireSynapseBridge().agent.deleteProvider({ providerId: provider.id })
      toast("供应商已删除")
      onDeleted()
      onOpenChange(false)
    } catch {
      logger.error("Provider delete failed.", { boundary: "settings.providers.delete", providerId: provider.id })
      toast("删除失败")
    } finally {
      setBusy(false)
    }
  }, [provider, onDeleted, onOpenChange])

  const handleDeleteConversations = useCallback(async () => {
    if (!provider || scan.status !== "loaded") return
    const references = scan.references.filter((reference) => reference.kind === "conversation")
    if (references.length === 0) return

    setBusy(true)
    setDeletingConversations(true)
    try {
      let deletedCount = 0
      let failedCount = 0
      for (const reference of references) {
        if (!reference.projectId) {
          failedCount++
          continue
        }
        try {
          const result = await requireSynapseBridge().agent.deleteSession({
            projectId: reference.projectId,
            conversationId: reference.entityId,
          })
          if (result.ok) deletedCount++
          else failedCount++
        } catch {
          failedCount++
        }
      }

      if (failedCount > 0) {
        logger.error("Provider conversation reference deletion partially failed.", {
          boundary: "settings.providers.delete-conversations",
          providerId: provider.id,
          deletedCount,
          failedCount,
        })
        toast(deletedCount > 0
          ? `已删除 ${deletedCount} 个会话，${failedCount} 个删除失败`
          : `删除相关会话失败，共 ${failedCount} 个`)
      } else {
        toast(`已删除 ${deletedCount} 个相关会话`)
      }

      await runScan()
    } finally {
      setDeletingConversations(false)
      setBusy(false)
    }
  }, [provider, runScan, scan])

  const handleMigrate = useCallback(async (selection: ProviderModelSelection) => {
    if (!provider) return
    setBusy(true)
    try {
      const migrationResult = await requireSynapseBridge().agent.migrateProviderReferences({
        sourceProviderId: provider.id,
        targetProviderId: selection.providerId,
        targetModelTier: selection.modelTier,
        scope: ["workflow-node"],
      })
      if (migrationResult.errors.length > 0) {
        logger.error("Provider reference migration returned errors.", {
          boundary: "settings.providers.migrate",
          providerId: provider.id,
          errorCount: migrationResult.errors.length,
          migratedWorkflowNodes: migrationResult.migratedWorkflowNodes,
        })
        toast(`迁移失败 ${migrationResult.errors.length} 项，已停止删除`)
        return
      }
      toast("引用已迁移")
      await requireSynapseBridge().agent.deleteProvider({ providerId: provider.id })
      toast("供应商已删除")
      onDeleted()
      onOpenChange(false)
      setMigrationOpen(false)
    } catch {
      logger.error("Provider migrate+delete failed.", { boundary: "settings.providers.migrate", providerId: provider.id })
      toast("操作失败")
    } finally {
      setBusy(false)
    }
  }, [provider, onDeleted, onOpenChange])

  const hasReferences = scan.status === "loaded"
    && (scan.workflowNodeCount + scan.conversationCount + scan.agentPersonaCount) > 0
  const hasNonMigratableReferences = scan.status === "loaded"
    && (scan.conversationCount + scan.agentPersonaCount) > 0
  const excludedProviderIds = useMemo(() => provider ? [provider.id] : [], [provider])
  const deleteButtonLabel = scan.status === "error"
    ? "扫描失败"
    : hasNonMigratableReferences
      ? (scan.status === "loaded" && scan.agentPersonaCount === 0 ? "先删除会话" : "先处理引用")
      : hasReferences ? "先迁移引用" : "确认删除"

  return (
    <>
      <AlertDialog open={Boolean(provider)} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除供应商 &ldquo;{provider?.name}&rdquo;</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                {scan.status === "loading" && <p>正在扫描引用…</p>}
                {scan.status === "error" && (
                  <p className="text-destructive">
                    {scan.message}
                    <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={runScan}>重试</Button>
                  </p>
                )}
                {scan.status === "loaded" && !hasReferences && <p>该供应商未被任何内容引用，可以安全删除。</p>}
                {scan.status === "loaded" && hasReferences && (
                  <>
                    <p>该供应商被以下内容引用：</p>
                    {scan.workflowNodeCount > 0 && (
                      <div>
                        <p className="font-medium">工作流节点 ({scan.workflowNodeCount})</p>
                        <ul className="ml-4 list-disc text-sm text-muted-foreground">
                          {scan.references.filter((r) => r.kind === "workflow-node").map((r) => (
                            <li key={`${r.entityId}:${r.nodeId ?? "default"}`}>{r.entityName}{r.nodeName ? ` → ${r.nodeName}` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {scan.conversationCount > 0 && (
                      <div>
                        <p className="font-medium">Agent 会话 ({scan.conversationCount})</p>
                        <p className="ml-4 text-sm text-muted-foreground">可在此删除相关会话，删除后无法恢复。</p>
                      </div>
                    )}
                    {scan.agentPersonaCount > 0 && (
                      <div>
                        <p className="font-medium">智能体 ({scan.agentPersonaCount})</p>
                        <ul className="ml-4 list-disc text-sm text-muted-foreground">
                          {scan.references.filter((r) => r.kind === "agent-persona").map((r) => (
                            <li key={r.entityId}>{r.entityName}</li>
                          ))}
                        </ul>
                        <p className="ml-4 text-sm text-muted-foreground">请重新指定模型，或恢复为跟随对话。</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            {scan.status === "loaded" && scan.conversationCount > 0 && (
              <Button variant="destructive" disabled={busy} onClick={handleDeleteConversations}>
                {deletingConversations ? "正在删除会话…" : `删除 ${scan.conversationCount} 个会话`}
              </Button>
            )}
            {hasReferences && !hasNonMigratableReferences && (
              <Button variant="outline" disabled={busy} onClick={() => setMigrationOpen(true)}>
                迁移到其他供应商
              </Button>
            )}
            <Button variant="destructive" disabled={busy || scan.status === "loading" || scan.status === "error" || hasReferences} onClick={handleDelete}>
              {deleteButtonLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProviderModelSelectDialog
        open={migrationOpen}
        onOpenChange={setMigrationOpen}
        onSelect={handleMigrate}
        excludeProviderIds={excludedProviderIds}
      />
    </>
  )
}
