import type { ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"

type SkillFileTreeAttachment = {
  originalName: string
}

type SkillFileTreeNode = {
  children: SkillFileTreeNode[]
  name: string
  path: string
  type: "directory" | "file"
}

type SkillFileTreeProps = {
  activePath: string
  attachments: readonly SkillFileTreeAttachment[]
  getFileMeta?: (path: string) => ReactNode
  onSelectPath: (path: string) => void
  renderFileAction?: (path: string) => ReactNode
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

function buildSkillFileTree<T extends SkillFileTreeAttachment>(attachments: readonly T[]): SkillFileTreeNode[] {
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

function SkillFileTreeRow({
  activePath,
  getFileMeta,
  level,
  node,
  onSelectPath,
  renderFileAction,
}: {
  activePath: string
  getFileMeta?: (path: string) => ReactNode
  level: number
  node: SkillFileTreeNode
  onSelectPath: (path: string) => void
  renderFileAction?: (path: string) => ReactNode
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
            getFileMeta={getFileMeta}
            level={level + 1}
            node={child}
            onSelectPath={onSelectPath}
            renderFileAction={renderFileAction}
          />
        ))}
      </div>
    )
  }

  const fileMeta = getFileMeta?.(node.path)
  const fileAction = renderFileAction?.(node.path)

  return (
    <div className="group flex h-7 min-w-0 items-center gap-1">
      <button
        data-track="content.skill-file.select"
        data-track-native="true"
        type="button"
        className={isActive
          ? "flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-md bg-background px-2 text-left text-xs font-medium ring-1 ring-border"
          : "flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-background hover:text-foreground"}
        style={{ paddingLeft }}
        title={node.path}
        onClick={() => onSelectPath(node.path)}
      >
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {fileMeta ? (
          <span className="ml-2 shrink-0 text-muted-foreground">{fileMeta}</span>
        ) : null}
      </button>
      {fileAction ? <div className="shrink-0">{fileAction}</div> : null}
    </div>
  )
}

function SkillFileTree({
  activePath,
  attachments,
  getFileMeta,
  onSelectPath,
  renderFileAction,
}: SkillFileTreeProps) {
  const tree = buildSkillFileTree(attachments)

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex min-w-0 flex-col gap-0.5 p-2">
        {tree.map((node) => (
          <SkillFileTreeRow
            key={node.path}
            activePath={activePath}
            getFileMeta={getFileMeta}
            level={0}
            node={node}
            onSelectPath={onSelectPath}
            renderFileAction={renderFileAction}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

export {
  buildSkillFileTree,
  MAIN_SKILL_FILE_PATH,
  normalizeSkillTreePath,
  SkillFileTree,
}
export type { SkillFileTreeAttachment, SkillFileTreeNode }
