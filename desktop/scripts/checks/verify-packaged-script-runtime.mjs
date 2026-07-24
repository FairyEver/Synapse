#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const input = process.argv[2]
if (!input) {
  console.error("Usage: node scripts/checks/verify-packaged-script-runtime.mjs <release-dir-or-app-path>")
  process.exit(2)
}

const target = path.resolve(process.cwd(), input)
const executable = findPackagedExecutable(target)
if (!executable) {
  console.error(`No packaged Synapse executable found under ${target}`)
  process.exit(1)
}

const resultRoot = await mkdtemp(path.join(tmpdir(), "synapse-packaged-script-runtime-"))
const resultPath = path.join(resultRoot, "result.txt")
const child = spawn(executable, [], {
  env: {
    ...process.env,
    SYNAPSE_SCRIPT_RUNTIME_SMOKE: "1",
    SYNAPSE_SCRIPT_RUNTIME_SMOKE_RESULT: resultPath,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
})
let stdout = ""
let stderr = ""
child.stdout.setEncoding("utf8")
child.stderr.setEncoding("utf8")
child.stdout.on("data", (chunk) => { stdout += chunk })
child.stderr.on("data", (chunk) => { stderr += chunk })

const timer = setTimeout(() => {
  child.kill("SIGKILL")
}, 120_000)
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject)
  child.once("close", resolve)
}).finally(() => clearTimeout(timer))

const result = await readFile(resultPath, "utf8").catch(() => "")
await rm(resultRoot, { recursive: true, force: true })
if (
  exitCode !== 0
  || (
    !result.includes('"stage":"result_complete","reason":"ok"')
    && !stdout.includes("synapse-script-runtime-packaged-smoke-ok")
  )
) {
  console.error(result || stderr || stdout || `Packaged script runtime smoke exited with ${exitCode}`)
  process.exit(1)
}
process.stdout.write(`Verified packaged script runtime: ${executable}\n`)

function findPackagedExecutable(targetPath) {
  if (!existsSync(targetPath)) return null
  const stats = statSync(targetPath)
  if (stats.isFile()) {
    return isSynapseExecutable(targetPath) ? targetPath : null
  }
  if (targetPath.endsWith(".app")) {
    const binary = path.join(targetPath, "Contents", "MacOS", "Synapse")
    return existsSync(binary) ? binary : null
  }
  for (const name of readdirSync(targetPath)) {
    if (name === "node_modules" || name === "app.asar.unpacked") continue
    const match = findPackagedExecutable(path.join(targetPath, name))
    if (match) return match
  }
  return null
}

function isSynapseExecutable(filePath) {
  const name = path.basename(filePath).toLowerCase()
  return name === "synapse.exe"
}
