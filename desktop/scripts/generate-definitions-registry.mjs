import { access, mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "..")
const definitionsRoot = path.join(packageRoot, "src", "definitions")
const editorDefinitionsRoot = path.join(definitionsRoot, "editor")
const agentDefinitionsRoot = path.join(definitionsRoot, "agent")
const rendererGeneratedDir = path.join(definitionsRoot, "generated")
const mainGeneratedDir = path.join(packageRoot, "electron", "services", "definitions", "generated")

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function listEditorDefinitionDirectories() {
  const entries = await readdir(editorDefinitionsRoot, { withFileTypes: true })
  const dirs = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "__tests__") continue
    if (await pathExists(path.join(editorDefinitionsRoot, entry.name, "editor.ts"))) {
      dirs.push(entry.name)
    }
  }

  return dirs.sort((left, right) => left.localeCompare(right))
}

async function listAgentDefinitionDirectories() {
  if (!(await pathExists(agentDefinitionsRoot))) return []

  const entries = await readdir(agentDefinitionsRoot, { withFileTypes: true })
  const dirs = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "__tests__") continue
    if (await pathExists(path.join(agentDefinitionsRoot, entry.name, "agent.ts"))) {
      dirs.push(entry.name)
    }
  }

  return dirs.sort((left, right) => left.localeCompare(right))
}

function toIdentifier(value) {
  return value.replace(/[^a-zA-Z0-9]+(.)?/g, (_, next = "") => next.toUpperCase())
}

function renderRendererRegistry(definitionDirs, agentDirs, cliDirs, mcpDirs, formDirs) {
  const editorImports = definitionDirs.map((dir) => {
    const name = `${toIdentifier(dir)}EditorDefinition`
    return `import { editorDefinition as ${name} } from "../editor/${dir}/editor"`
  })
  const agentImports = agentDirs.map((dir) => {
    const name = `${toIdentifier(dir)}AgentDefinition`
    return `import { agentDefinition as ${name} } from "../agent/${dir}/agent"`
  })
  const cliImports = cliDirs.map((dir) => {
    const name = `${toIdentifier(dir)}CliDefinition`
    return `import { cliDefinition as ${name} } from "../editor/${dir}/cli"`
  })
  const mcpImports = mcpDirs.map((dir) => {
    const name = `${toIdentifier(dir)}McpDefinition`
    return `import { mcpDefinition as ${name} } from "../editor/${dir}/mcp"`
  })
  const formImports = formDirs.map((dir) => {
    const name = `${toIdentifier(dir)}InstallFormDefinition`
    return `import { installFormDefinition as ${name} } from "../editor/${dir}/forms"`
  })

  return `${editorImports.join("\n")}
${agentImports.join("\n")}
${cliImports.join("\n")}
${mcpImports.join("\n")}
${formImports.join("\n")}
import type {
  SynapseAgentDefinition,
  SynapseCliDefinition,
  SynapseEditorDefinition,
  SynapseInstallFormDefinition,
  SynapseRendererMcpDefinition,
} from "../types"

export const editorDefinitions = [
${definitionDirs.map((dir) => `  ${toIdentifier(dir)}EditorDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseEditorDefinition[]

export const agentDefinitions = [
${agentDirs.map((dir) => `  ${toIdentifier(dir)}AgentDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseAgentDefinition[]

export const cliDefinitions = [
${cliDirs.map((dir) => `  ${toIdentifier(dir)}CliDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseCliDefinition[]

export const mcpDefinitions = [
${mcpDirs.map((dir) => `  { ...${toIdentifier(dir)}McpDefinition, icon: ${toIdentifier(dir)}EditorDefinition.icon },`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseRendererMcpDefinition[]

export const installFormDefinitionByEditorId = new Map<string, SynapseInstallFormDefinition>([
${formDirs.map((dir) => `  ["${dir}", ${toIdentifier(dir)}InstallFormDefinition],`).join("\n")}
])
`
}

function renderMainRegistry(adapterDirs, cliDirs, mcpDirs) {
  const adapterImports = adapterDirs.map((dir) => {
    const name = `${toIdentifier(dir)}EditorAdapter`
    return `import { editorAdapter as ${name} } from "../../../../src/definitions/editor/${dir}/adapter"`
  })
  const cliImports = cliDirs.map((dir) => {
    const name = `${toIdentifier(dir)}CliDefinition`
    return `import { cliDefinition as ${name} } from "../../../../src/definitions/editor/${dir}/cli"`
  })
  const mcpImports = mcpDirs.map((dir) => {
    const name = `${toIdentifier(dir)}McpDefinition`
    return `import { mcpDefinition as ${name} } from "../../../../src/definitions/editor/${dir}/mcp"`
  })
  const installImports = adapterDirs.map((dir) => {
    const name = `${toIdentifier(dir)}InstallStrategy`
    return `import { installStrategy as ${name} } from "../../../../src/definitions/editor/${dir}/install"`
  })
  const scanImports = adapterDirs.map((dir) => {
    const name = `${toIdentifier(dir)}ScanStrategy`
    return `import { scanStrategy as ${name} } from "../../../../src/definitions/editor/${dir}/scan"`
  })

  return `${adapterImports.join("\n")}
${cliImports.join("\n")}
${mcpImports.join("\n")}
${installImports.join("\n")}
${scanImports.join("\n")}
import type {
  EditorAdapter,
  EditorInstallStrategy,
  EditorScanStrategy,
} from "../../../../src/definitions/main-types"
import type { SynapseMcpDefinition } from "../../../../src/definitions/types"

export const editorAdapters = [
${adapterDirs.map((dir) => `  ${toIdentifier(dir)}EditorAdapter,`).join("\n")}
] satisfies EditorAdapter[]

export const editorAdapterById = new Map(
  editorAdapters.map((adapter) => [adapter.id, adapter]),
)

export const cliDefinitions = [
${cliDirs.map((dir) => `  ${toIdentifier(dir)}CliDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order)

export const mcpDefinitions = [
${mcpDirs.map((dir) => `  ${toIdentifier(dir)}McpDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseMcpDefinition[]

export const editorInstallStrategyById = new Map<string, EditorInstallStrategy>([
${adapterDirs.map((dir) => `  [${toIdentifier(dir)}EditorAdapter.id, ${toIdentifier(dir)}InstallStrategy],`).join("\n")}
])

export const editorScanStrategyById = new Map<string, EditorScanStrategy>([
${adapterDirs.map((dir) => `  [${toIdentifier(dir)}EditorAdapter.id, ${toIdentifier(dir)}ScanStrategy],`).join("\n")}
])
`
}

async function main() {
  const definitionDirs = await listEditorDefinitionDirectories()
  const agentDirs = await listAgentDefinitionDirectories()
  const adapterDirs = []
  const importableCliDirs = []
  const importableMcpDirs = []
  const importableFormDirs = []

  for (const dir of definitionDirs) {
    if (await pathExists(path.join(editorDefinitionsRoot, dir, "adapter.ts"))) adapterDirs.push(dir)
    if (await pathExists(path.join(editorDefinitionsRoot, dir, "cli.ts"))) importableCliDirs.push(dir)
    if (await pathExists(path.join(editorDefinitionsRoot, dir, "mcp.ts"))) importableMcpDirs.push(dir)
    if (
      await pathExists(path.join(editorDefinitionsRoot, dir, "forms.ts"))
      || await pathExists(path.join(editorDefinitionsRoot, dir, "forms.tsx"))
    ) {
      importableFormDirs.push(dir)
    }
  }

  await mkdir(rendererGeneratedDir, { recursive: true })
  await mkdir(mainGeneratedDir, { recursive: true })

  await writeFile(path.join(rendererGeneratedDir, "renderer-registry.ts"), renderRendererRegistry(definitionDirs, agentDirs, importableCliDirs, importableMcpDirs, importableFormDirs), "utf8")
  await writeFile(path.join(mainGeneratedDir, "main-registry.ts"), renderMainRegistry(adapterDirs, importableCliDirs, importableMcpDirs), "utf8")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
