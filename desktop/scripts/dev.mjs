/**
 * 作用：统一启动本地开发环境。
 * 它会先挑一个可用端口，然后并行拉起渲染端、Electron TypeScript watch、以及 Electron 应用进程。
 * 平时执行 `pnpm dev` 走的就是这个脚本，它是当前项目开发启动链路的总入口。
 */
import { spawn } from "node:child_process"
import { createServer } from "node:net"

const host = "127.0.0.1"
const requestedPort = process.env.SYNAPSE_DEV_PORT
const defaultPort = 5173
const startPort = Number.parseInt(requestedPort ?? String(defaultPort), 10)
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
let isStopping = false

if (!Number.isInteger(startPort) || startPort <= 0) {
  console.error("[dev] SYNAPSE_DEV_PORT must be a valid port number.")
  process.exit(1)
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()

    server.unref()
    server.once("error", () => resolve(false))
    server.listen({ host, port }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function resolvePort() {
  if (requestedPort) {
    return (await isPortAvailable(startPort)) ? startPort : null
  }

  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port
    }
  }

  return null
}

const port = await resolvePort()

if (!port) {
  if (requestedPort) {
    console.error(`[dev] Port ${startPort} is already in use.`)
  } else {
    console.error(`[dev] No free port found in ${startPort}-${startPort + 19}.`)
  }
  process.exit(1)
}

if (!requestedPort && port !== startPort) {
  console.log(`[dev] Port ${startPort} is busy, using ${port} instead.`)
}

const child = spawn(
  pnpmCommand,
  [
    "exec",
    "concurrently",
    "-k",
    "--names",
    "renderer,electron:build,electron:app",
    "--prefix-colors",
    "cyan,magenta,yellow",
    "pnpm dev:renderer",
    "pnpm dev:electron:build",
    "pnpm dev:electron:app",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SYNAPSE_DEV_PORT: String(port),
      VITE_DEV_SERVER_URL: `http://${host}:${port}`,
    },
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
  console.error("[dev] Failed to start dev processes.", error)
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
