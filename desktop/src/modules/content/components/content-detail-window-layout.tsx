import type { ReactNode } from "react"
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
import type { SynapseContentAttachmentRecord, SynapseContentDetail } from "@/types/content"

type ContentDetailWindowShellProps = {
  children: ReactNode
  summary: ReactNode
}

type ContentDetailWindowSummaryProps = {
  canEdit?: boolean
  detail: SynapseContentDetail | null
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

type SkillFileTreeNode = {
  children: SkillFileTreeNode[]
  name: string
  path: string
  type: "directory" | "file"
}

const MAIN_SKILL_FILE_PATH = "SKILL.md"

function normalizeSkillTreePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/")
}

function sortSkillFileTreeNodes(nodes: SkillFileTreeNode[]): SkillFileTreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: sortSkillFileTreeNodes(node.children),
    }))
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })
}

function buildSkillFileTree(attachments: SynapseContentAttachmentRecord[]): SkillFileTreeNode[] {
  const roots: SkillFileTreeNode[] = [{
    children: [],
    name: MAIN_SKILL_FILE_PATH,
    path: MAIN_SKILL_FILE_PATH,
    type: "file",
  }]

  for (const attachment of attachments) {
    const normalizedPath = normalizeSkillTreePath(attachment.originalName)
    if (!normalizedPath) continue

    const parts = normalizedPath.split("/")
    let siblings = roots
    let currentPath = ""

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isFile = index === parts.length - 1
      let node = siblings.find((candidate) => candidate.name === part)

      if (!node) {
        node = {
          children: [],
          name: part,
          path: currentPath,
          type: isFile ? "file" : "directory",
        }
        siblings.push(node)
      }

      if (isFile) {
        node.type = "file"
        return
      }

      node.type = "directory"
      siblings = node.children
    })
  }

  return sortSkillFileTreeNodes(roots)
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
        <aside className="h-full min-h-0 bg-background">
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
  canEdit = false,
  detail,
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

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-full flex-col gap-4 p-4">
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
          canDelete={false}
          canEdit={canEdit}
          canOpenInNewWindow={false}
          isFavorite={isItemFavorite}
          isRepositoryInitializing={false}
          item={detail}
          onDelete={() => undefined}
          onEdit={onEdit}
          onOpenInNewWindow={() => undefined}
          onToggleFavorite={() => toggleFavorite(detail.type, detail.id)}
        />

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">介绍</h2>
          {detail.description.trim() ? (
            <MarkdownViewer
              content={detail.description}
              mode="rendered"
              showTabs={false}
              surface="plain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">暂无介绍</p>
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

function SkillFileTreeRow({
  activePath,
  node,
  level,
  onSelectPath,
}: {
  activePath: string
  level: number
  node: SkillFileTreeNode
  onSelectPath: (path: string) => void
}) {
  const isActive = node.type === "file" && activePath === node.path
  const paddingLeft = `${level * 0.75 + 0.5}rem`

  if (node.type === "directory") {
    return (
      <div className="min-w-0">
        <div
          className="flex h-6 min-w-0 items-center overflow-hidden rounded-md px-2 text-xs font-medium text-muted-foreground"
          style={{ paddingLeft }}
          title={node.path}
        >
          <span className="min-w-0 truncate">{node.name}</span>
        </div>
        {node.children.map((child) => (
          <SkillFileTreeRow
            key={child.path}
            activePath={activePath}
            level={level + 1}
            node={child}
            onSelectPath={onSelectPath}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={isActive
        ? "flex h-7 w-full min-w-0 items-center overflow-hidden rounded-md bg-background px-2 text-left text-xs font-medium ring-1 ring-border"
        : "flex h-7 w-full min-w-0 items-center overflow-hidden rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-background hover:text-foreground"}
      style={{ paddingLeft }}
      title={node.path}
      onClick={() => onSelectPath(node.path)}
    >
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
    </button>
  )
}

function SkillFileSidebar({
  activePath,
  attachments,
  onSelectPath,
}: SkillFileSidebarProps) {
  const tree = buildSkillFileTree(attachments)

  return (
    <ScrollArea className="h-full">
      <div className="flex min-w-0 flex-col gap-0.5 p-2">
        {tree.map((node) => (
          <SkillFileTreeRow
            key={node.path}
            activePath={activePath}
            level={0}
            node={node}
            onSelectPath={onSelectPath}
          />
        ))}
      </div>
    </ScrollArea>
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
export type { SkillFileTreeNode }
