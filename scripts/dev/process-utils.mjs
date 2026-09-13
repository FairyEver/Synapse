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
  const invocation = resolvePnpmInvocation(args, options.env ?? process.env)
  return runCommand(invocation.command, invocation.args, options)
}

// pnpm.cmd cannot be spawned as an executable on Windows. Root pnpm scripts
// supply their JS launcher; invoke it with Node and keep arguments out of cmd.exe.
function resolvePnpmInvocation(args, env = process.env, platform = process.platform, node = process.execPath) {
  const launcher = env.npm_execpath
  if (typeof launcher === "string" && /(?:^|[/\\])pnpm\.(?:c?js|mjs)$/i.test(launcher)) {
    return { command: node, args: [launcher, ...args] }
  }
  if (platform === "win32" && typeof launcher === "string" && /(?:^|[/\\])pnpm\.exe$/i.test(launcher)) {
    return { command: launcher, args }
  }
  if (platform === "win32") throw new Error("Windows cleanup must be started through the root pnpm run command.")
  return { command: "pnpm", args }
}

export { pnpmCommand, runCommand, runPnpm, resolvePnpmInvocation }
