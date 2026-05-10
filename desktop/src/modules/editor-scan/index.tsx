import { useCallback, useMemo, useState } from "react"
import { LoaderCircle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { useAppNotifications } from "@/app-shell/notifications"
import type { SynapseEditorId } from "@/types/editor"
import { EDITOR_ORDER } from "@/lib/editor-registry"
import type {
  EditorScanRuleItem,
  EditorScanScope,
  EditorScanSkillItem,
  ScanItemForDetail,
} from "@/types/editor-scan"
import { useEditorScan } from "./hooks/use-editor-scan"
import { EditorScanSidebar } from "./components/editor-scan-sidebar"
import { GlobalOverview } from "./components/global-overview"
import { ProjectOverview } from "./components/project-overview"
import { EmptyScanState } from "./components/empty-scan-state"
import { ScanItemDetailDialog } from "./components/scan-item-detail-dialog"

type ContentTab = "skill" | "rule"
type ScopeTab = "global" | "project"

function EditorScanModule() {
  const { data, loading, error, refresh } = useEditorScan()
  const { success: showSuccess, error: showError } = useAppNotifications()
  const [selectedEditorId, setSelectedEditorId] =
    useState<SynapseEditorId>(EDITOR_ORDER[0] ?? "")
  const [contentTab, setContentTab] = useState<ContentTab>("skill")
  const [scopeTab, setScopeTab] = useState<ScopeTab>("global")
  const [detailItem, setDetailItem] = useState<ScanItemForDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const handleRefresh = useCallback(async () => {
    try {
      await refresh()
      showSuccess("扫描结果已刷新")
    } catch {
      showError("刷新失败，请稍后重试。")
    }
  }, [refresh, showSuccess, showError])

  const handleItemClick = useCallback(
    (
      item: EditorScanSkillItem | EditorScanRuleItem,
      type: "skill" | "rule",
      context: {
        editorId: SynapseEditorId
        editorLabel: string
        scope: EditorScanScope
        projectName?: string
        projectPath?: string
      },
    ) => {
      setDetailItem({
        type,
        name: item.name,
        path: item.path,
        source: item.source,
        preview: item.preview,
        fileCount: "fileCount" in item ? item.fileCount : undefined,
        metadata: "metadata" in item ? item.metadata : undefined,
        synapseContentId: item.synapseContentId,
        editorId: context.editorId,
        editorLabel: context.editorLabel,
        scope: context.scope,
        projectName: context.projectName,
        projectPath: context.projectPath,
        content: "content" in item ? item.content : undefined,
        trash: item.trash,
      })
      setDetailOpen(true)
    },
    [],
  )

  const globalResult = useMemo(
    () => data?.global.find((g) => g.editorId === selectedEditorId) ?? null,
    [data, selectedEditorId],
  )

  const isEditorEmpty = useMemo(() => {
    if (!globalResult) return true
    if (globalResult.skills.length > 0 || globalResult.rules.length > 0) return false
    if (!data) return true
    return !data.projects.some((p) => {
      const entry = p.editors.find((e) => e.editorId === selectedEditorId)
      return entry && (entry.skills.length > 0 || entry.rules.length > 0)
    })
  }, [globalResult, data, selectedEditorId])

  const sidebar = (
    <EditorScanSidebar
      data={data}
      selectedEditorId={selectedEditorId}
      onSelect={setSelectedEditorId}
    />
  )

  const renderContent = () => {
    if (!data && loading) {
      return (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      )
    }

    if (error && !data) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()}>
            重试
          </Button>
        </div>
      )
    }

    if (!globalResult) return null

    if (isEditorEmpty && globalResult.status === "not-detected") {
      return (
        <EmptyScanState
          message={`未检测到 ${globalResult.editorLabel} 的配置目录`}
        />
      )
    }

    if (isEditorEmpty) {
      return (
        <EmptyScanState
          message={`未检测到 ${globalResult.editorLabel} 的 skill 或规则`}
        />
      )
    }

    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-6">
          {scopeTab === "global" ? (
            <GlobalOverview result={globalResult} contentTab={contentTab} onItemClick={handleItemClick} />
          ) : (
            <ProjectOverview
              projects={data?.projects ?? []}
              selectedEditorId={selectedEditorId}
              selectedEditorLabel={globalResult.editorLabel}
              contentTab={contentTab}
              onItemClick={handleItemClick}
            />
          )}
        </div>
      </ScrollArea>
    )
  }

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false} contentClassName="bg-surface">
      <div className="flex h-full flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {globalResult?.editorLabel ?? "IDE"}
            </h2>
            <Tabs
              value={contentTab}
              onValueChange={(v) => setContentTab(v as ContentTab)}
            >
              <TabsList>
                <TabsTrigger value="skill">Skill</TabsTrigger>
                <TabsTrigger value="rule">Rule</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={scopeTab}
              onValueChange={(v) => setScopeTab(v as ScopeTab)}
            >
              <TabsList>
                <TabsTrigger value="global">全局</TabsTrigger>
                <TabsTrigger value="project">项目</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => void handleRefresh()}
            disabled={loading}
            title="刷新"
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          {renderContent()}
        </div>
      </div>

      <ScanItemDetailDialog
        item={detailItem}
        onChanged={refresh}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </SidebarContentLayout>
  )
}

export { EditorScanModule }
