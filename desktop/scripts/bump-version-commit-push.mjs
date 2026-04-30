#!/usr/bin/env node
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "..")

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
    })

    let stdout = ""
    let stderr = ""

    if (options.capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8")
      })
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8")
      })
    }

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error(stderr.trim() || `${command} exited with ${String(code)}`))
    })
  })
}

async function bumpPackageVersion() {
  const packageJsonPath = path.join(packageRoot, "package.json")
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))
  const version = String(packageJson.version ?? "").trim()

  if (!version) {
    throw new Error("package.json is missing version")
  }

  const parts = version.split(".")
  const lastPart = Number.parseInt(parts[parts.length - 1] ?? "", 10)

  if (!Number.isInteger(lastPart)) {
    throw new Error(`package.json version must end with a number: ${version}`)
  }

  parts[parts.length - 1] = String(lastPart + 1)
  packageJson.version = parts.join(".")

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
  return packageJson.version
}

async function main() {
  const repoRootResult = await run("git", ["-C", packageRoot, "rev-parse", "--show-toplevel"], {
    capture: true,
  })
  const repoRoot = repoRootResult.stdout.trim()
  if (!repoRoot) {
    throw new Error("Unable to determine repository root.")
  }

  const newVersion = await bumpPackageVersion()

  await run("git", ["add", "-A"], { cwd: repoRoot })
  await run("git", ["commit", "-m", `chore: bump version to ${newVersion}`], { cwd: repoRoot })

  const branchResult = await run("git", ["branch", "--show-current"], {
    capture: true,
    cwd: repoRoot,
  })
  const currentBranch = branchResult.stdout.trim()
  if (!currentBranch) {
    throw new Error("Unable to determine current branch.")
  }

  await run("git", ["branch", `--set-upstream-to=origin/${currentBranch}`, currentBranch], {
    capture: true,
    cwd: repoRoot,
  }).catch(() => undefined)
  await run("git", ["push", "-u", "origin", currentBranch], { cwd: repoRoot })

  process.stdout.write(`Bumped version to ${newVersion} and pushed the current branch.\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
