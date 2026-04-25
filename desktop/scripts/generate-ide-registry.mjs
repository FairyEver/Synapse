import { access, mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "..")
const definitionsRoot = path.join(packageRoot, "src", "ide-definitions")
const rendererGeneratedDir = path.join(definitionsRoot, "generated")
const mainGeneratedDir = path.join(packageRoot, "electron", "services", "ide-definitions", "generated")

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function listDefinitionDirectories() {
  const entries = await readdir(definitionsRoot, { withFileTypes: true })
  const dirs = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "generated") continue
    if (await pathExists(path.join(definitionsRoot, entry.name, "ide.ts"))) {
      dirs.push(entry.name)
    }
  }

  return dirs.sort((left, right) => left.localeCompare(right))
}

function toIdentifier(value) {
  return value.replace(/[^a-zA-Z0-9]+(.)?/g, (_, next = "") => next.toUpperCase())
}

function renderRendererRegistry(definitionDirs, cliDirs, mcpDirs, formDirs) {
  const ideImports = definitionDirs.map((dir) => {
    const name = `${toIdentifier(dir)}IdeDefinition`
    return `import { ideDefinition as ${name} } from "../${dir}/ide"`
  })
  const cliImports = cliDirs.map((dir) => {
    const name = `${toIdentifier(dir)}CliDefinition`
    return `import { cliDefinition as ${name} } from "../${dir}/cli"`
  })
  const mcpImports = mcpDirs.map((dir) => {
    const name = `${toIdentifier(dir)}McpDefinition`
    return `import { mcpDefinition as ${name} } from "../${dir}/mcp"`
  })
  const formImports = formDirs.map((dir) => {
    const name = `${toIdentifier(dir)}InstallFormDefinition`
    return `import { installFormDefinition as ${name} } from "../${dir}/forms"`
  })

  return `${ideImports.join("\n")}
${cliImports.join("\n")}
${mcpImports.join("\n")}
${formImports.join("\n")}
import type { SynapseCliDefinition, SynapseIdeDefinition, SynapseInstallFormDefinition, SynapseRendererMcpDefinition } from "../types"

export const ideDefinitions = [
${definitionDirs.map((dir) => `  ${toIdentifier(dir)}IdeDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseIdeDefinition[]

export const cliDefinitions = [
${cliDirs.map((dir) => `  ${toIdentifier(dir)}CliDefinition,`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseCliDefinition[]

export const mcpDefinitions = [
${mcpDirs.map((dir) => `  { ...${toIdentifier(dir)}McpDefinition, icon: ${toIdentifier(dir)}IdeDefinition.icon },`).join("\n")}
].sort((left, right) => left.order - right.order) satisfies SynapseRendererMcpDefinition[]

export const installFormDefinitionByEditorId = new Map<string, SynapseInstallFormDefinition>([
${formDirs.map((dir) => `  ["${dir}", ${toIdentifier(dir)}InstallFormDefinition],`).join("\n")}
])
`
}

function renderMainRegistry(adapterDirs, cliDirs, mcpDirs) {
  const adapterImports = adapterDirs.map((dir) => {
    const name = `${toIdentifier(dir)}EditorAdapter`
    return `import { editorAdapter as ${name} } from "../../../../src/ide-definitions/${dir}/adapter"`
  })
  const cliImports = cliDirs.map((dir) => {
    const name = `${toIdentifier(dir)}CliDefinition`
    return `import { cliDefinition as ${name} } from "../../../../src/ide-definitions/${dir}/cli"`
  })
  const mcpImports = mcpDirs.map((dir) => {
    const name = `${toIdentifier(dir)}McpDefinition`
    return `import { mcpDefinition as ${name} } from "../../../../src/ide-definitions/${dir}/mcp"`
  })
  const installImports = adapterDirs.map((dir) => {
    const name = `${toIdentifier(dir)}InstallStrategy`
    return `import { installStrategy as ${name} } from "../../../../src/ide-definitions/${dir}/install"`
  })
  const scanImports = adapterDirs.map((dir) => {
    const name = `${toIdentifier(dir)}ScanStrategy`
    return `import { scanStrategy as ${name} } from "../../../../src/ide-definitions/${dir}/scan"`
  })

  return `${adapterImports.join("\n")}
${cliImports.join("\n")}
${mcpImports.join("\n")}
${installImports.join("\n")}
${scanImports.join("\n")}
import type { EditorAdapter, EditorInstallStrategy, EditorScanStrategy } from "../../../../src/ide-definitions/main-types"
import type { SynapseMcpDefinition } from "../../../../src/ide-definitions/types"

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
  const definitionDirs = await listDefinitionDirectories()
  const adapterDirs = []
  const importableCliDirs = []
  const importableMcpDirs = []
  const importableFormDirs = []

  for (const dir of definitionDirs) {
    if (await pathExists(path.join(definitionsRoot, dir, "adapter.ts"))) adapterDirs.push(dir)
    if (await pathExists(path.join(definitionsRoot, dir, "cli.ts"))) importableCliDirs.push(dir)
    if (await pathExists(path.join(definitionsRoot, dir, "mcp.ts"))) importableMcpDirs.push(dir)
    if (
      await pathExists(path.join(definitionsRoot, dir, "forms.ts"))
      || await pathExists(path.join(definitionsRoot, dir, "forms.tsx"))
    ) {
      importableFormDirs.push(dir)
    }
  }

  await mkdir(rendererGeneratedDir, { recursive: true })
  await mkdir(mainGeneratedDir, { recursive: true })

  await writeFile(path.join(rendererGeneratedDir, "renderer-registry.ts"), renderRendererRegistry(definitionDirs, importableCliDirs, importableMcpDirs, importableFormDirs), "utf8")
  await writeFile(path.join(mainGeneratedDir, "main-registry.ts"), renderMainRegistry(adapterDirs, importableCliDirs, importableMcpDirs), "utf8")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
