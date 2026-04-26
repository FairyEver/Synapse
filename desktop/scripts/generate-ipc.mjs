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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Add lines like { id: "content", importPath: "../electron/modules/content/ipc.ts" }
 * once a module is migrated. The codegen accepts the source file (or a manifest
 * value) and pulls IpcModule from a default export named identically.
 */
const MODULE_SOURCES = [
  { id: "content", importPath: "../electron/modules/content/ipc.ts" },
  { id: "cli", importPath: "../electron/modules/cli/ipc.ts" },
  { id: "config", importPath: "../electron/modules/config/ipc.ts" },
  { id: "identity", importPath: "../electron/modules/identity/ipc.ts" },
  { id: "user-profile", importPath: "../electron/modules/user-profile/ipc.ts" },
  { id: "log", importPath: "../electron/modules/log/ipc.ts" },
  { id: "editor-scan", importPath: "../electron/modules/editor-scan/ipc.ts" },
  { id: "editor", importPath: "../electron/modules/editor/ipc.ts" },
  { id: "shell", importPath: "../electron/modules/shell/ipc.ts" },
  { id: "repository", importPath: "../electron/modules/repository/ipc.ts" },
  { id: "update", importPath: "../electron/modules/update/ipc.ts" },
]

const OUTPUT_PATH = path.resolve(
  __dirname,
  "..",
  "electron",
  "generated",
  "ipc-channels.generated.ts",
)

async function loadModuleDescriptor(importPath) {
  const resolved = path.resolve(__dirname, importPath)
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
    methods: extractChannels(methods, sourceFile),
    events: extractChannels(events, sourceFile),
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

function extractChannels(objectLiteral, sourceFile) {
  const channels = {}

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
      continue
    }

    const name = getPropertyName(property.name, sourceFile)
    const channel = findObjectProperty(property.initializer, "channel", sourceFile)

    if (name && channel && ts.isStringLiteral(channel.initializer)) {
      channels[name] = {
        channel: channel.initializer.text,
      }
    }
  }

  return channels
}

function getPropertyName(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  return name.getText(sourceFile)
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
    descriptors.push(descriptor)
  }

  const out = []
  out.push("/**")
  out.push(" * AUTO-GENERATED FILE — DO NOT EDIT.")
  out.push(" * Source: scripts/generate-ipc.mjs")
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
    out.push(`  ${quote(descriptor.id)}: {`)
    for (const [methodName, method] of Object.entries(descriptor.methods)) {
      out.push(`    ${quote(methodName)}: ${quote(method.channel)},`)
    }
    for (const [eventName, event] of Object.entries(descriptor.events)) {
      out.push(`    ${quote(eventName)}: ${quote(event.channel)},`)
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

export { generate, MODULE_SOURCES, OUTPUT_PATH }
