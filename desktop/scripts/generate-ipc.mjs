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

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Add lines like { id: "content", importPath: "../electron/modules/content/ipc.ts" }
 * once a module is migrated. The codegen accepts the source file (or a manifest
 * value) and pulls IpcModule from a default export named identically.
 */
const MODULE_SOURCES = [
  { id: "shell", importPath: "../electron/modules/shell/ipc.ts" },
  { id: "cli", importPath: "../electron/modules/cli/ipc.ts" },
  { id: "identity", importPath: "../electron/modules/identity/ipc.ts" },
  { id: "user-profile", importPath: "../electron/modules/user-profile/ipc.ts" },
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
  const url = pathToFileURL(resolved).href
  const mod = await import(url)
  const candidate = mod.default ?? Object.values(mod).find(isIpcModuleShape)
  if (!candidate) {
    throw new Error(`No IpcModule export found in ${importPath}`)
  }
  return candidate
}

function isIpcModuleShape(value) {
  if (typeof value !== "object" || value === null) return false
  return typeof value.id === "string" && typeof value.methods === "object" && typeof value.events === "object"
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  generate().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

export { generate, MODULE_SOURCES, OUTPUT_PATH }
