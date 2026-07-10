import { realpath } from "node:fs/promises"
import path from "node:path"

import type { SynapseEditorId } from "../../src/types/editor"
import { editorAdapters } from "./editor-adapters"
import { configStore } from "./config-store"

export type TrustedSkillRoot = {
  readonly editors: readonly {
    readonly id: SynapseEditorId
    readonly label: string
  }[]
  readonly scope: "global" | "project"
  readonly projectId?: string
  readonly projectName?: string
  readonly path: string
}

type MutableTrustedSkillRoot = {
  editors: Array<{ id: SynapseEditorId; label: string }>
  scope: "global" | "project"
  projectId?: string
  projectName?: string
  path: string
}

async function physicalPath(candidate: string): Promise<string> {
  try {
    return await realpath(candidate)
  } catch {
    return path.resolve(candidate)
  }
}

function addEditor(
  roots: Map<string, MutableTrustedSkillRoot>,
  key: string,
  input: Omit<MutableTrustedSkillRoot, "editors">,
  editor: { id: SynapseEditorId; label: string },
): void {
  const existing = roots.get(key)
  if (existing) {
    if (!existing.editors.some(({ id }) => id === editor.id)) existing.editors.push(editor)
    return
  }
  roots.set(key, { ...input, editors: [editor] })
}

export async function listTrustedSkillRoots(): Promise<TrustedSkillRoot[]> {
  const roots = new Map<string, MutableTrustedSkillRoot>()

  for (const adapter of editorAdapters) {
    const scanConfig = adapter.getScanPathConfig()
    const configuredRoots = scanConfig.globalSkillPaths
      ?? (scanConfig.globalSkillsPath ? [scanConfig.globalSkillsPath] : [])
    for (const configuredRoot of configuredRoots) {
      const rootPath = await physicalPath(configuredRoot)
      addEditor(
        roots,
        `global::${rootPath}`,
        { scope: "global", path: rootPath },
        { id: adapter.id, label: adapter.label },
      )
    }
  }

  const config = await configStore.load()
  for (const project of config.global.projects) {
    for (const adapter of editorAdapters) {
      const configuredRoot = adapter.getScanPathConfig().projectPaths(project.path).skillsPath
      const rootPath = await physicalPath(configuredRoot)
      addEditor(
        roots,
        `project:${project.id}:${rootPath}`,
        {
          scope: "project",
          projectId: project.id,
          projectName: project.name,
          path: rootPath,
        },
        { id: adapter.id, label: adapter.label },
      )
    }
  }

  return Array.from(roots.values()).map((root) => ({
    ...root,
    editors: root.editors.slice().sort((left, right) => left.id.localeCompare(right.id)),
  }))
}
