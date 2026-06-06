import { spawn } from "node:child_process"

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
      cwd: options.cwd,
    })

    child.on("error", reject)
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 0, signal })
    })
  })
}

async function runPnpm(args, options = {}) {
  return runCommand(pnpmCommand, args, options)
}

export { pnpmCommand, runCommand, runPnpm }
