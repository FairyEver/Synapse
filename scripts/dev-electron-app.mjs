import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import path from "node:path"

const port = process.env.SYNAPSE_DEV_PORT ?? "5173"
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${port}`
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const electronBuildDir = path.resolve("dist-electron")
const electronEntryFiles = ["main.js", "preload.js"]

let activeChild = null
let isStopping = false

function stopChild(signal) {
  isStopping = true

  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal)
  }
}

function runPnpm(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, args, {
      stdio: "inherit",
      env,
    })

    activeChild = child
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (activeChild === child) {
        activeChild = null
      }

      if (signal) {
        resolve(1)
        return
      }

      resolve(code ?? 0)
    })
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopChild(signal))
}

await Promise.all(
  electronEntryFiles.map((file) =>
    rm(path.join(electronBuildDir, file), { force: true }),
  ),
)

const waitCode = await runPnpm([
  "exec",
  "wait-on",
  `tcp:127.0.0.1:${port}`,
  "file:dist-electron/main.js",
  "file:dist-electron/preload.js",
])

if (isStopping) {
  process.exit(0)
}

if (waitCode !== 0) {
  process.exit(waitCode)
}

const nodemon = spawn(pnpmCommand, ["exec", "nodemon"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
  },
})

activeChild = nodemon
nodemon.on("error", (error) => {
  console.error("[dev:electron:app] Failed to start Electron app.", error)
  process.exit(1)
})

nodemon.on("exit", (code, signal) => {
  if (isStopping) {
    process.exit(0)
  }

  if (signal) {
    process.exit(1)
  }

  process.exit(code ?? 0)
})
