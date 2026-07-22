/**
 * Phase 0.3 — IPC codegen.
 *
 * Reads IpcModule descriptors from a known set of source files and emits:
 *
 *   desktop/electron/generated/ipc-channels.generated.ts
 *
 * The generated file contains a typed map of channel constants per module so
 * renderer + main both reference them through a single source of truth and
 * the CI codegen-diff gate catches drift.
 *
 * Phase 0.3 ships with NO IpcModule consumers (per Level 3 decision in
 * REPORT.md — full handler migration is a follow-up PR). The script still
 * runs end-to-end against an empty descriptor list so the wiring + CI gate
 * exists; future commits add modules to MODULE_SOURCES and re-run codegen.
 *
 * To extend:
 *   1. Add the new ipc.ts source path to MODULE_SOURCES.
 *   2. Run `pnpm --filter @synapse/desktop run generate:ipc`.
 *   3. Commit the regenerated file.
 *
 * Why not ts-morph: Phase 0 keeps dependency footprint small. The descriptor
 * is the source of truth — channels are plain strings and types live in the
 * descriptor's TypeScript declaration, which TS already cross-checks at build
 * time. Adding ts-morph + a 30+ MB transitive dep tree only buys us a marginal
 * extra check that's already covered by `tsc --noEmit`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, "../..")

/**
 * Add lines like { id: "content", importPath: "electron/modules/content/ipc.ts" }
 * once a module is migrated. The codegen accepts the source file (or a manifest
 * value) and pulls IpcModule from a default export named identically.
 */
const MODULE_SOURCES = [
  { id: "account", importPath: "electron/modules/account/ipc.ts" },
  { id: "live", importPath: "electron/modules/live/ipc.ts" },
  { id: "content", importPath: "electron/modules/content/ipc.ts" },
  { id: "skill-repository-install", importPath: "electron/modules/skill-repository-install/ipc.ts" },
  { id: "installers", importPath: "electron/modules/installers/ipc.ts" },
  { id: "synapseSkill", outputId: "synapse-skill", importPath: "app-capabilities/synapse-skill/main/ipc.ts" },
  { id: "skill-uninstaller", importPath: "app-capabilities/skill-uninstaller/main/ipc.ts" },
  { id: "config", importPath: "electron/modules/config/ipc.ts" },
  { id: "identity", importPath: "electron/modules/identity/ipc.ts" },
  { id: "user-profile", importPath: "electron/modules/user-profile/ipc.ts" },
  { id: "log", importPath: "electron/modules/log/ipc.ts" },
  { id: "editor-scan", importPath: "electron/modules/editor-scan/ipc.ts" },
  { id: "editor-copy", importPath: "electron/modules/editor-copy/ipc.ts" },
  { id: "editor-install-status", importPath: "electron/modules/editor-install-status/ipc.ts" },
  { id: "install-status", importPath: "electron/modules/install-status/ipc.ts" },
  { id: "knowledge-base", importPath: "electron/modules/knowledge-base/ipc.ts" },
  { id: "editor", importPath: "electron/modules/editor/ipc.ts" },
  { id: "shell", importPath: "electron/modules/shell/ipc.ts" },
  { id: "repository", importPath: "electron/modules/repository/ipc.ts" },
  { id: "update", importPath: "electron/modules/update/ipc.ts" },
  { id: "cheat-code", importPath: "electron/modules/cheat-code/ipc.ts" },
  { id: "agent", importPath: "electron/modules/agent/ipc.ts" },
  { id: "automation", importPath: "electron/modules/automation/ipc.ts" },
  { id: "apps", importPath: "electron/modules/apps/ipc.ts" },
  { id: "documentTemplate", importPath: "app-capabilities/document-template/main/ipc.ts" },
  { id: "textExtractor", importPath: "app-capabilities/text-extractor/main/ipc.ts" },
  { id: "textFileWriter", importPath: "app-capabilities/text-file-writer/main/ipc.ts" },
  { id: "fileOpener", importPath: "app-capabilities/file-opener/main/ipc.ts" },
  { id: "quick-input", outputId: "quickInput", importPath: "app-capabilities/quick-input/main/ipc.ts" },
  { id: "secrets", importPath: "app-capabilities/secrets/main/ipc.ts" },
  { id: "agentPersonas", importPath: "app-capabilities/agent-personas/main/ipc.ts" },
  { id: "driveSync", importPath: "electron/modules/drive-sync/ipc.ts" },
  { id: "soundNotifier", importPath: "app-capabilities/sound-notifier/main/ipc.ts" },
  { id: "terminal", importPath: "app-capabilities/terminal/main/ipc.ts" },
  { id: "git", importPath: "electron/modules/git/ipc.ts" },
  { id: "ops", importPath: "electron/modules/ops/ipc.ts" },
  { id: "workflow", importPath: "electron/modules/workflow/ipc.ts" },
]

/**
 * Standalone channel maps that don't use the IpcModule pattern.
 * Each entry maps a module id to a source file exporting a `const` object
 * whose values are channel strings.
 */
const EXTRA_CHANNEL_SOURCES = [
  { id: "database", importPath: "electron/database/channels.ts", exportName: "DATABASE_IPC_CHANNELS" },
  { id: "usage-analysis", importPath: "electron/usage-analysis/channels.ts", exportName: "USAGE_ANALYSIS_CHANNELS" },
  { id: "model-price", importPath: "electron/model-price/channels.ts", exportName: "MODEL_PRICE_CHANNELS" },
]

const OUTPUT_PATH = path.resolve(
  desktopRoot,
  "electron",
  "generated",
  "ipc-channels.generated.ts",
)

const CANONICAL_IPC_OPERATION_PATTERN = /^app\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/
const CANONICAL_IPC_CHANNEL_PATTERN = /^synapse:app:[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*){2,}$/

function assertCanonicalIpcChannel(channel, sourcePath) {
  if (!CANONICAL_IPC_CHANNEL_PATTERN.test(channel)) {
    throw new Error(`Invalid canonical IPC channel "${channel}" in ${sourcePath}`)
  }
}

function operationIdToChannel(operationId, sourcePath) {
  if (!CANONICAL_IPC_OPERATION_PATTERN.test(operationId)) {
    throw new Error(`Invalid canonical IPC operation id "${operationId}" in ${sourcePath}`)
  }
  return `synapse:${operationId.replaceAll(".", ":")}`
}

async function loadModuleDescriptor(importPath) {
  const resolved = path.resolve(desktopRoot, importPath)
  const source = await readFile(resolved, "utf8")
  const sourceFile = ts.createSourceFile(
    resolved,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const descriptor = findIpcModuleObject(sourceFile, importPath)
  const id = readStringProperty(descriptor, "id", sourceFile, importPath)
  const methods = readObjectProperty(descriptor, "methods", sourceFile, importPath)
  const events = readObjectProperty(descriptor, "events", sourceFile, importPath)

  return {
    id,
    methods: extractChannels(methods, sourceFile, resolved),
    events: extractChannels(events, sourceFile, resolved),
  }
}

function findIpcModuleObject(sourceFile, importPath) {
  let descriptor = null

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.type?.getText(sourceFile) === "IpcModule" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      descriptor = node.initializer
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (!descriptor) {
    throw new Error(`No IpcModule declaration found in ${importPath}`)
  }

  return descriptor
}

function readStringProperty(objectLiteral, propertyName, sourceFile, importPath) {
  const property = findObjectProperty(objectLiteral, propertyName, sourceFile)
  if (!property || !ts.isStringLiteral(property.initializer)) {
    throw new Error(`Missing "${propertyName}" string property in ${importPath}`)
  }
  return property.initializer.text
}

function readObjectProperty(objectLiteral, propertyName, sourceFile, importPath) {
  const property = findObjectProperty(objectLiteral, propertyName, sourceFile)
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) {
    throw new Error(`Missing "${propertyName}" object property in ${importPath}`)
  }
  return property.initializer
}

function findObjectProperty(objectLiteral, propertyName, sourceFile) {
  return objectLiteral.properties.find((property) => {
    return ts.isPropertyAssignment(property) && getPropertyName(property.name, sourceFile) === propertyName
  })
}

function extractChannels(objectLiteral, sourceFile, resolvedFilePath) {
  const channels = {}

  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadChannels = resolveSpreadChannels(property, sourceFile, resolvedFilePath)
      Object.assign(channels, spreadChannels)
      continue
    }

    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
      continue
    }

    const name = getPropertyName(property.name, sourceFile)
    const operationId = findObjectProperty(property.initializer, "operationId", sourceFile)

    if (name && operationId && ts.isStringLiteral(operationId.initializer)) {
      channels[name] = {
        channel: operationIdToChannel(operationId.initializer.text, resolvedFilePath),
      }
    }
  }

  return channels
}

function resolveSpreadChannels(spreadAssignment, sourceFile, resolvedFilePath) {
  const expr = spreadAssignment.expression
  if (!ts.isIdentifier(expr)) return {}

  const identifierName = expr.text
  const importSource = findImportSource(sourceFile, identifierName)
  if (!importSource) return {}

  const importedFilePath = resolveImportPath(importSource, resolvedFilePath)
  if (!importedFilePath) return {}

  const importedSource = ts.sys.readFile(importedFilePath)
  if (!importedSource) return {}

  const importedSourceFile = ts.createSourceFile(
    importedFilePath,
    importedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  const objectLiteral = findExportedVariable(importedSourceFile, identifierName)
  if (!objectLiteral) return {}

  return extractChannels(objectLiteral, importedSourceFile, importedFilePath)
}

function findImportSource(sourceFile, identifierName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const clause = statement.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
    for (const specifier of clause.namedBindings.elements) {
      if (specifier.name.text === identifierName) {
        return statement.moduleSpecifier.text
      }
    }
  }
  return null
}

function resolveImportPath(importSource, fromFilePath) {
  if (!importSource.startsWith(".")) return null
  const dir = path.dirname(fromFilePath)
  let resolved = path.resolve(dir, importSource)
  const extensions = [".ts", ".tsx", "/index.ts", "/index.tsx"]
  for (const ext of extensions) {
    const candidate = resolved + ext
    if (ts.sys.fileExists(candidate)) return candidate
  }
  if (ts.sys.fileExists(resolved)) return resolved
  return null
}

function findExportedVariable(sourceFile, variableName) {
  let result = null
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === variableName && decl.initializer) {
          let init = decl.initializer
          while (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init) || ts.isSatisfiesExpression(init)) {
            init = init.expression
          }
          if (ts.isObjectLiteralExpression(init)) {
            result = init
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

function getPropertyName(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  return name.getText(sourceFile)
}

async function loadExtraChannels(entry) {
  const resolved = path.resolve(desktopRoot, entry.importPath)
  const source = await readFile(resolved, "utf8")
  const sourceFile = ts.createSourceFile(resolved, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  let target = null
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === entry.exportName && decl.initializer) {
          let init = decl.initializer
          while (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init) || ts.isSatisfiesExpression(init)) {
            init = init.expression
          }
          if (ts.isObjectLiteralExpression(init)) {
            target = init
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (!target) {
    throw new Error(`No export "${entry.exportName}" found in ${entry.importPath}`)
  }

  const channels = {}
  for (const prop of target.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) {
      const name = getPropertyName(prop.name, sourceFile)
      assertCanonicalIpcChannel(prop.initializer.text, entry.importPath)
      channels[name] = prop.initializer.text
    }
  }
  return { id: entry.id, channels }
}

async function generate() {
  const descriptors = []
  for (const entry of MODULE_SOURCES) {
    const descriptor = await loadModuleDescriptor(entry.importPath)
    if (descriptor.id !== entry.id) {
      throw new Error(
        `Module id mismatch: expected "${entry.id}" but ${entry.importPath} exports "${descriptor.id}"`,
      )
    }
    descriptor.outputId = entry.outputId ?? descriptor.id
    descriptors.push(descriptor)
  }

  const extras = []
  for (const entry of EXTRA_CHANNEL_SOURCES) {
    extras.push(await loadExtraChannels(entry))
  }

  const out = []
  out.push("/**")
  out.push(" * AUTO-GENERATED FILE — DO NOT EDIT.")
  out.push(" * Source: scripts/build/generate-ipc.mjs")
  out.push(" * Run `pnpm --filter @synapse/desktop run generate:ipc` to regenerate.")
  out.push(" */")
  out.push("")
  out.push("/* eslint-disable */")
  out.push("")

  if (descriptors.length === 0) {
    out.push("// No IpcModule consumers registered yet — see REPORT.md Level 3 decision.")
    out.push("")
  }

  out.push("export const IPC_CHANNELS = {")
  for (const descriptor of descriptors) {
    out.push(`  ${quote(descriptor.outputId)}: {`)
    for (const [methodName, method] of Object.entries(descriptor.methods)) {
      out.push(`    ${quote(methodName)}: ${quote(method.channel)},`)
    }
    for (const [eventName, event] of Object.entries(descriptor.events)) {
      out.push(`    ${quote(eventName)}: ${quote(event.channel)},`)
    }
    out.push("  },")
  }
  for (const extra of extras) {
    out.push(`  ${quote(extra.id)}: {`)
    for (const [name, channel] of Object.entries(extra.channels)) {
      out.push(`    ${quote(name)}: ${quote(channel)},`)
    }
    out.push("  },")
  }
  out.push("} as const")
  out.push("")
  out.push("export type IpcChannelMap = typeof IPC_CHANNELS")
  out.push("")

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, out.join("\n"), "utf8")
  console.log(`generated ${path.relative(process.cwd(), OUTPUT_PATH)}`)
}

function quote(value) {
  return JSON.stringify(value)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generate().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

export { assertCanonicalIpcChannel, generate, MODULE_SOURCES, OUTPUT_PATH }
