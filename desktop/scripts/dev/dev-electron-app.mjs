/**
 * 作用：等待渲染端和 Electron 主进程编译产物就绪后，启动 Electron 桌面应用。
 * 一般由 `pnpm dev` 间接调用，也可以单独用在拆分调试 Electron 进程时。
 * 启动前会清理旧的 `dist-electron` 入口文件，随后用 nodemon 监听编译结果并自动重启应用。
 */
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, "../..")
const port = process.env.SYNAPSE_DEV_PORT ?? "19731"
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${port}`
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const electronBuildDir = path.join(desktopRoot, "dist-electron")
const electronEntryFiles = [
  "main.js",
  "preload.js",
  "electron/main.js",
  "electron/preload.js",
  "electron/generated/ipc-channels.generated.js",
]

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
      cwd: desktopRoot,
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
  "file:dist-electron/electron/main.js",
  "file:dist-electron/electron/preload.js",
  "file:dist-electron/electron/generated/ipc-channels.generated.js",
])

if (isStopping) {
  process.exit(0)
}

if (waitCode !== 0) {
  process.exit(waitCode)
}

// 等待 tsc --watch 完成所有文件的初始编译
await new Promise((resolve) => setTimeout(resolve, 2000))

if (isStopping) {
  process.exit(0)
}

const nodemon = spawn(pnpmCommand, ["exec", "nodemon"], {
  cwd: desktopRoot,
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
