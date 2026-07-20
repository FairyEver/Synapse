#!/usr/bin/env node
/**
 * Phase 0.3 — CI gate for IPC codegen drift.
 * SPEC §6.
 *
 * 1. Runs `generate:ipc` to regenerate the file.
 * 2. Runs `git diff --quiet` against the generated file.
 * 3. Exits non-zero with a helpful message if the working tree shows a diff.
 *
 * Add this to CI after typecheck. Local devs see the same error early.
 */

import { execFile as execFileCb } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"
import { fileURLToPath } from "node:url"

const execFile = promisify(execFileCb)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, "../..")

const GENERATED_FILE = "electron/generated/ipc-channels.generated.ts"

async function run() {
  const generatedPath = path.resolve(desktopRoot, GENERATED_FILE)
  const before = await readFile(generatedPath, "utf8")
  await execFile(process.execPath, ["scripts/build/generate-ipc.mjs"], { cwd: desktopRoot })
  const after = await readFile(generatedPath, "utf8")
  if (before !== after) {
    console.error(
      `IPC codegen output (${GENERATED_FILE}) differs from the committed file.`,
    )
    console.error(`Run \`pnpm --filter @synapse/desktop run generate:ipc\` and commit the result.`)
    process.exit(1)
  }
  console.log(`IPC codegen output is in sync with ${GENERATED_FILE}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
