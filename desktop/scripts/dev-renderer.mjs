/**
 * 作用：启动 Vite 渲染进程开发服务器。
 * 一般由 `pnpm dev` 或 `pnpm dev:renderer` 调用，负责提供 React 渲染端页面。
 * 它只做前端 dev server 启动和退出信号转发，不负责 Electron 主进程。
 */
import { spawn } from "node:child_process"

const port = process.env.SYNAPSE_DEV_PORT ?? "19731"
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
let isStopping = false

const child = spawn(
  pnpmCommand,
  ["exec", "vite", "--host", "127.0.0.1", "--port", port, "--strictPort"],
  {
    stdio: "inherit",
    env: process.env,
  },
)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    isStopping = true

    if (!child.killed) {
      child.kill(signal)
    }
  })
}

child.on("error", (error) => {
  console.error("[dev:renderer] Failed to start Vite.", error)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  if (isStopping) {
    process.exit(0)
  }

  if (signal) {
    process.exit(1)
  }

  process.exit(code ?? 0)
})
