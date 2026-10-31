export type FileBrowserSourceFile = {
  readonly id: string
  readonly path: string
  readonly size: number
  readonly sha256?: string
  readonly updatedAt: string
  readonly kind: 'text' | 'binary'
  readonly mimeType?: string | null
}

export type FileBrowserBreadcrumb = {
  readonly name: string
  readonly path: string
}

export type FileBrowserFolderRow = {
  readonly type: 'folder'
  readonly path: string
  readonly name: string
  readonly childCount: number
}

export type FileBrowserFileRow = {
  readonly type: 'file'
  readonly file: FileBrowserSourceFile
  readonly name: string
}

export type FileBrowserRow = FileBrowserFolderRow | FileBrowserFileRow

export type FileBrowserTree = {
  readonly currentPath: string
  readonly breadcrumbs: readonly FileBrowserBreadcrumb[]
  readonly rows: readonly FileBrowserRow[]
}

export type BuildFileBrowserTreeOptions = {
  readonly rootLabel?: string
  readonly priorityFilePath?: string
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildFileBrowserTree(
  files: readonly FileBrowserSourceFile[],
  currentPath: string,
  options: BuildFileBrowserTreeOptions = {}
): FileBrowserTree {
  const normalizedCurrentPath = normalizeFolderPath(currentPath)
  assertUniquePaths(files)

  const folders = new Map<string, FileBrowserFolderRow>()
  const visibleFiles: FileBrowserFileRow[] = []
  const prefix = normalizedCurrentPath ? `${normalizedCurrentPath}/` : ''

  for (const file of files) {
    const normalizedFilePath = normalizeFilePath(file.path)
    if (normalizedCurrentPath && normalizedFilePath !== normalizedCurrentPath && !normalizedFilePath.startsWith(prefix)) {
      continue
    }

    const relativePath = normalizedCurrentPath
      ? normalizedFilePath.slice(prefix.length)
      : normalizedFilePath
    if (!relativePath) continue

    const [head, ...rest] = relativePath.split('/')
    if (rest.length > 0) {
      const folderPath = prefix ? `${normalizedCurrentPath}/${head}` : head
      const existing = folders.get(folderPath)
      folders.set(folderPath, {
        type: 'folder',
        path: folderPath,
        name: head,
        childCount: (existing?.childCount ?? 0) + 1,
      })
      continue
    }

    visibleFiles.push({
      type: 'file',
      file: { ...file, path: normalizedFilePath },
      name: head,
    })
  }

  const priorityPath = options.priorityFilePath ? normalizeFilePath(options.priorityFilePath) : null
  const rows = [
    ...Array.from(folders.values()),
    ...visibleFiles,
  ].sort((left, right) => compareRows(left, right, priorityPath))

  return {
    currentPath: normalizedCurrentPath,
    breadcrumbs: buildBreadcrumbs(normalizedCurrentPath, options.rootLabel ?? 'Root'),
    rows,
  }
}

function buildBreadcrumbs(currentPath: string, rootLabel: string): FileBrowserBreadcrumb[] {
  const breadcrumbs: FileBrowserBreadcrumb[] = [{ name: rootLabel, path: '' }]
  if (!currentPath) return breadcrumbs

  const segments = currentPath.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    breadcrumbs.push({
      name: segments[index],
      path: segments.slice(0, index + 1).join('/'),
    })
  }
  return breadcrumbs
}

function compareRows(left: FileBrowserRow, right: FileBrowserRow, priorityPath: string | null): number {
  const leftPath = left.type === 'file' ? left.file.path : left.path
  const rightPath = right.type === 'file' ? right.file.path : right.path
  if (priorityPath) {
    if (leftPath === priorityPath) return -1
    if (rightPath === priorityPath) return 1
  }
  if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
  return collator.compare(left.name, right.name)
}

function assertUniquePaths(files: readonly FileBrowserSourceFile[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    const normalizedPath = normalizeFilePath(file.path).toLowerCase()
    if (seen.has(normalizedPath)) throw new Error(`Duplicate file path: ${file.path}`)
    seen.add(normalizedPath)
  }
}

function normalizeFolderPath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '').replace(/\/+/gu, '/')
}

function normalizeFilePath(value: string): string {
  return normalizeFolderPath(value)
}
