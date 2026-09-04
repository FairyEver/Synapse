export type WorkspaceFileTreeEntryKind = "directory" | "file" | "symbolic-link"

export type WorkspaceFileTreeScope = {
  readonly scopeId: string
  readonly rootName: string
  readonly revision: number
}

export type WorkspaceFileTreeEntry = {
  readonly relativePath: string
  readonly name: string
  readonly kind: WorkspaceFileTreeEntryKind
}

export type WorkspaceFileTreeDirectoryResult = {
  readonly scopeId: string
  readonly relativePath: string
  readonly revision: number
  readonly entries: readonly WorkspaceFileTreeEntry[]
}

export type WorkspaceFileTreeResolvePathsInput = {
  readonly scopeId: string
  readonly relativePaths: readonly string[]
}

export type WorkspaceFileTreeResolvePathsResult = {
  readonly scopeId: string
  readonly paths: readonly string[]
}

export type WorkspaceFileTreeChangedEvent = {
  readonly scopeId: string
  readonly relativePath: string
  readonly revision: number
}

export type WorkspaceFileTreeDataSource = {
  readonly open: () => Promise<WorkspaceFileTreeScope>
  readonly list: (input: {
    readonly scopeId: string
    readonly relativePath: string
  }) => Promise<WorkspaceFileTreeDirectoryResult>
  readonly close: (input: { readonly scopeId: string }) => Promise<void>
  readonly onChanged: (
    listener: (event: WorkspaceFileTreeChangedEvent) => void,
  ) => () => void
}
