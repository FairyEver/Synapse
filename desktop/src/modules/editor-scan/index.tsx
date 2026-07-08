import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, LoaderCircle, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { useAppNotifications } from "@/app-shell/notifications"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
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
import { EditorBulkSkillCopyDialog } from "./components/editor-bulk-skill-copy-dialog"
import { EditorBulkSkillTrashDialog } from "./components/editor-bulk-skill-trash-dialog"
import type { EditorScanSkillCopyItem } from "./lib/editor-copy-source"
import { EditorDirectoriesView } from "./components/editor-directories-view"

type AppViewTab = "content" | "directories"
type ContentTab = "skill" | "rule"
type ScopeTab = "global" | "project"

function EditorScanModule() {
  const { data, loading, error, refresh } = useEditorScan()
  const { success: showSuccess, error: showError } = useAppNotifications()
  const [selectedEditorId, setSelectedEditorId] =
    useState<SynapseEditorId>(EDITOR_ORDER[0] ?? "")
  const [appViewTab, setAppViewTab] = useState<AppViewTab>("content")
  const [contentTab, setContentTab] = useState<ContentTab>("skill")
  const [scopeTab, setScopeTab] = useState<ScopeTab>("global")
  const [detailItem, setDetailItem] = useState<ScanItemForDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedSkillMap, setSelectedSkillMap] = useState<Map<string, EditorScanSkillCopyItem>>(() => new Map())
  const [bulkCopyOpen, setBulkCopyOpen] = useState(false)
  const [bulkTrashOpen, setBulkTrashOpen] = useState(false)

  const selectedSkillKeys = useMemo(() => new Set(selectedSkillMap.keys()), [selectedSkillMap])
  const selectedSkills = useMemo(() => Array.from(selectedSkillMap.values()), [selectedSkillMap])

  const buildSkillKey = useCallback((input: {
    path: string
    scope: EditorScanScope
    projectPath?: string
  }) => `${input.scope}:${input.projectPath ?? "global"}:${input.path}`, [])

  const clearSkillSelection = useCallback(() => {
    setSelectedSkillMap(new Map())
    setBulkCopyOpen(false)
    setBulkTrashOpen(false)
  }, [])

  const removeSelectedSkills = useCallback((keys: readonly string[]) => {
    setSelectedSkillMap((current) => {
      const next = new Map(current)
      for (const key of keys) {
        next.delete(key)
      }
      return next
    })
  }, [])

  useEffect(() => {
    clearSkillSelection()
  }, [clearSkillSelection, selectedEditorId, contentTab, scopeTab])

  const handleRefresh = useCallback(async () => {
    try {
      await refresh()
      clearSkillSelection()
      showSuccess("扫描结果已刷新")
    } catch {
      showError("刷新失败，请稍后重试。")
    }
  }, [clearSkillSelection, refresh, showSuccess, showError])

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
        mainFileName: "mainFileName" in item ? item.mainFileName : undefined,
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

  const handleSkillSelectionChange = useCallback((
    item: EditorScanSkillItem,
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
      projectName?: string
      projectPath?: string
    },
    selected: boolean,
  ) => {
    const key = buildSkillKey({
      path: item.path,
      projectPath: context.projectPath,
      scope: context.scope,
    })

    setSelectedSkillMap((current) => {
      const next = new Map(current)
      if (!selected) {
        next.delete(key)
        return next
      }

      next.set(key, {
        key,
        name: item.name,
        path: item.path,
        source: item.source,
        preview: item.preview,
        fileCount: item.fileCount,
        synapseContentId: item.synapseContentId,
        editorId: context.editorId,
        editorLabel: context.editorLabel,
        scope: context.scope,
        projectName: context.projectName,
        projectPath: context.projectPath,
        trash: item.trash,
      })
      return next
    })
  }, [buildSkillKey])

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

  const appViewTabs = useMemo(
    () => [
      { id: "content", label: "内容" },
      { id: "directories", label: "目录" },
    ] as const,
    [],
  )
  const headerActions = (
    <SystemAppTopBarActionButton
      iconOnly
      type="button"
      onClick={() => void handleRefresh()}
      disabled={loading}
      aria-label="刷新"
      tooltip="刷新"
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <RotateCcw className="size-4" />
      )}
    </SystemAppTopBarActionButton>
  )
  const contentSidebarControls = (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">类型</span>
        <Tabs
          value={contentTab}
          onValueChange={(v) => setContentTab(v as ContentTab)}
        >
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="skill">Skill</TabsTrigger>
            <TabsTrigger className="flex-1" value="rule">Rule</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">范围</span>
        <Tabs
          value={scopeTab}
          onValueChange={(v) => setScopeTab(v as ScopeTab)}
        >
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="global">全局</TabsTrigger>
            <TabsTrigger className="flex-1" value="project">项目</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </>
  )
  const sidebar = (
    <EditorScanSidebar
      controls={appViewTab === "content" ? contentSidebarControls : undefined}
      data={data}
      selectedEditorId={selectedEditorId}
      onSelect={setSelectedEditorId}
    />
  )
  const selectionToolbar = contentTab === "skill" && selectedSkills.length > 0 ? (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b bg-background px-3 py-2">
      <span className="text-sm text-muted-foreground">已选 {selectedSkills.length} 个</span>
      <Button variant="outline" size="sm" onClick={clearSkillSelection}>
        <X data-icon="inline-start" />
        取消选择
      </Button>
      <Button variant="outline" size="sm" onClick={() => setBulkCopyOpen(true)}>
        <Copy data-icon="inline-start" />
        复制到...
      </Button>
      <Button variant="destructive" size="sm" onClick={() => setBulkTrashOpen(true)}>
        <Trash2 data-icon="inline-start" />
        移到废纸篓
      </Button>
    </div>
  ) : null

  const renderContent = () => {
    if (!data && loading) {
      return (
        <div className="flex flex-col gap-2">
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

    if (!globalResult) {
      return (
        <EmptyScanState message="未找到当前编辑器的扫描数据，请重新扫描。" />
      )
    }

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
      <div className="flex h-full flex-col">
        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>刷新失败，当前显示的可能是过期数据</AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={loading}>
                重试
              </Button>
            </AlertAction>
          </Alert>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2">
            {scopeTab === "global" ? (
              <GlobalOverview
                result={globalResult}
                contentTab={contentTab}
                selectedSkillKeys={selectedSkillKeys}
                buildSkillKey={buildSkillKey}
                onItemClick={handleItemClick}
                onSkillSelectionChange={handleSkillSelectionChange}
              />
            ) : (
              <ProjectOverview
                projects={data?.projects ?? []}
                selectedEditorId={selectedEditorId}
                selectedEditorLabel={globalResult.editorLabel}
                contentTab={contentTab}
                selectedSkillKeys={selectedSkillKeys}
                buildSkillKey={buildSkillKey}
                onItemClick={handleItemClick}
                onSkillSelectionChange={handleSkillSelectionChange}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <SystemAppWindowShell
      tabs={appViewTabs}
      value={appViewTab}
      onValueChange={setAppViewTab}
      actions={headerActions}
    >
      <SidebarContentLayout
        sidebar={sidebar}
        contentScrollable={false}
        contentClassName="bg-surface"
        sidebarResizable
        sidebarDefaultSize={250}
        sidebarMinSize={250}
      >
        {appViewTab === "content" ? (
          <div data-editor-scan-content-panel className="flex h-full flex-col">
            {selectionToolbar}
            <div className="min-h-0 flex-1 p-2">
              {renderContent()}
            </div>
          </div>
        ) : (
          <div data-editor-scan-content-panel className="h-full min-h-0">
            <EditorDirectoriesView selectedEditorId={selectedEditorId} />
          </div>
        )}
      </SidebarContentLayout>
      <ScanItemDetailDialog
        item={detailItem}
        onChanged={refresh}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <EditorBulkSkillCopyDialog
        items={selectedSkills}
        onCopied={async () => {
          await refresh()
          clearSkillSelection()
        }}
        open={bulkCopyOpen}
        onOpenChange={setBulkCopyOpen}
      />
      <EditorBulkSkillTrashDialog
        items={selectedSkills}
        onTrashed={async (trashedKeys) => {
          removeSelectedSkills(trashedKeys)
          await refresh()
        }}
        open={bulkTrashOpen}
        onOpenChange={setBulkTrashOpen}
      />
    </SystemAppWindowShell>
  )
}

export { EditorScanModule }
