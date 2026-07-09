import type { MouseEvent, ReactNode } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { getCategoryLabel } from "@/lib/content-categories"
import { resolveDisplayName } from "@/lib/display-name"
import { useRepoProfileMap } from "@/app-shell/identity-context"
import { ContentDetailMenubar } from "@/modules/content/components/content-detail-menubar"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { ContentItemMeta } from "@/modules/content/components/content-item-meta"
import { useContentFavorites } from "@/modules/content/hooks/use-content-favorites"
import {
  buildSkillFileTree,
  MAIN_SKILL_FILE_PATH,
  normalizeSkillTreePath,
  SkillFileTree,
} from "@/modules/content/components/skill-file-tree"
import type { SynapseContentAttachmentRecord, SynapseContentDetail } from "@/types/content"

type ContentDetailWindowShellProps = {
  children: ReactNode
  summary: ReactNode
}

type ContentDetailWindowSummaryProps = {
  canDelete?: boolean
  canEdit?: boolean
  detail: SynapseContentDetail | null
  onDelete?: (event: MouseEvent<HTMLElement>) => void
  onEdit?: () => void
}

type ContentDetailWindowMainProps = {
  children: ReactNode
  fileSidebar?: ReactNode
}

type SkillFileSidebarProps = {
  activePath: string
  attachments: SynapseContentAttachmentRecord[]
  onSelectPath: (path: string) => void
}

function ContentDetailWindowShell({
  children,
  summary,
}: ContentDetailWindowShellProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-screen min-h-0 w-full overflow-hidden bg-background"
    >
      <ResizablePanel
        defaultSize={300}
        minSize={260}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
          {summary}
        </aside>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize={720}>
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function ContentDetailWindowSummary({
  canDelete = false,
  canEdit = false,
  detail,
  onDelete = () => undefined,
  onEdit = () => undefined,
}: ContentDetailWindowSummaryProps) {
  const repoProfileMap = useRepoProfileMap()
  const { isFavorite, toggleFavorite } = useContentFavorites()

  if (!detail) {
    return (
      <div className="flex h-full min-h-0 flex-col p-5">
        <p className="text-sm text-muted-foreground">正在读取内容</p>
      </div>
    )
  }

  const authorLabel = resolveDisplayName(
    detail.createdBy,
    repoProfileMap,
    detail.createdByDisplayName,
  )
  const categoryLabel = getCategoryLabel(detail.type, detail.category)
  const isItemFavorite = isFavorite(detail.type, detail.id)
  const usageContent = detail.usage?.trim() ?? ""

  return (
    <ScrollArea className="h-full min-w-0" viewportClassName="min-w-0">
      <div className="flex min-h-full min-w-0 max-w-full flex-col gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <ContentItemIcon
            contentId={detail.id}
            contentType={detail.type}
            icon={detail.icon}
            iconType={detail.iconType}
            iconImage={detail.iconImage}
            title={detail.title}
            tone={detail.iconBg}
          />
          <ContentItemMeta
            author={authorLabel}
            category={categoryLabel}
            className="flex-1"
            description={detail.name ?? detail.description}
            title={detail.title}
          />
        </div>

        <ContentDetailMenubar
          canDelete={canDelete}
          canEdit={canEdit}
          canOpenInNewWindow={false}
          isFavorite={isItemFavorite}
          isRepositoryInitializing={false}
          item={detail}
          onDelete={onDelete}
          onEdit={onEdit}
          onOpenInNewWindow={() => undefined}
          onToggleFavorite={() => toggleFavorite(detail.type, detail.id)}
        />

        <section className="flex min-w-0 max-w-full flex-col gap-2 overflow-hidden">
          <h2 className="text-sm font-medium text-foreground">使用说明</h2>
          {usageContent ? (
            <MarkdownViewer
              className="w-full"
              content={usageContent}
              mode="rendered"
              showTabs={false}
              surface="plain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">暂无使用说明</p>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function ContentDetailWindowMain({
  children,
  fileSidebar,
}: ContentDetailWindowMainProps) {
  if (fileSidebar) {
    return (
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full min-h-0 w-full overflow-hidden"
      >
        <ResizablePanel
          defaultSize={220}
          minSize={180}
          maxSize={320}
          groupResizeBehavior="preserve-pixel-size"
        >
          <aside className="h-full min-h-0 bg-muted/20">
            {fileSidebar}
          </aside>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel minSize={520}>
          <main className="h-full min-h-0">
            {children}
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  return (
    <main className="min-h-0">
      {children}
    </main>
  )
}

function SkillFileSidebar({
  activePath,
  attachments,
  onSelectPath,
}: SkillFileSidebarProps) {
  return (
    <SkillFileTree
      activePath={activePath}
      attachments={attachments}
      onSelectPath={onSelectPath}
    />
  )
}

export {
  buildSkillFileTree,
  ContentDetailWindowMain,
  ContentDetailWindowShell,
  ContentDetailWindowSummary,
  MAIN_SKILL_FILE_PATH,
  normalizeSkillTreePath,
  SkillFileSidebar,
}
export type { SkillFileTreeNode } from "@/modules/content/components/skill-file-tree"
