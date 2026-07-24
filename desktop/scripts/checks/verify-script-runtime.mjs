import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"

import { app } from "electron"

const smokeRoot = await mkdtemp(join(tmpdir(), "synapse-script-runtime-check-"))
app.setPath("userData", smokeRoot)
app.on("window-all-closed", () => {})

const require = createRequire(import.meta.url)
const { runScriptRuntimeSmoke } = require("../../dist-electron/electron/script-runtime-smoke.js")

async function run() {
  await runScriptRuntimeSmoke(app.getPath("exe"))
  process.stdout.write("synapse-script-runtime-runtime-smoke-ok\n")
  await rm(smokeRoot, { recursive: true, force: true }).catch(() => undefined)
  app.exit(0)
}

async function handleFailure(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  await rm(smokeRoot, { recursive: true, force: true }).catch(() => undefined)
  app.exit(1)
}

void app.whenReady().then(run).catch(handleFailure)
