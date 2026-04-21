import { access, mkdir } from "node:fs/promises"
import { shell } from "electron"
import type { SynapseEditorGlobalDirectory } from "../../src/types/editor"
import { editorAdapters } from "../services/editor-adapters"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"

let handlersRegistered = false

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function getGlobalDirectories(): Promise<SynapseEditorGlobalDirectory[]> {
  const entries = editorAdapters.map((adapter) => {
    const paths = adapter.resolveGlobalDirectoryPaths()
    return { adapter, paths }
  })

  const checks = entries.flatMap(({ paths }) => [
    paths.rulesPath ? pathExists(paths.rulesPath) : Promise.resolve(false),
    paths.skillsPath ? pathExists(paths.skillsPath) : Promise.resolve(false),
  ])

  const results = await Promise.all(checks)

  return entries.map(({ adapter, paths }, index) => ({
    editorId: adapter.id,
    label: adapter.label,
    rulesPath: paths.rulesPath,
    rulesExists: results[index * 2],
    skillsPath: paths.skillsPath,
    skillsExists: results[index * 2 + 1],
  }))
}

async function createAndOpenDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
  shell.showItemInFolder(dirPath)
}

function registerEditorHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.editor.getGlobalDirectories,
    async () => getGlobalDirectories(),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.editor.createDirectory,
    async (_event, dirPath: string) => {
      await createAndOpenDirectory(dirPath)
    },
  )

  handlersRegistered = true
}

export { registerEditorHandlers }
