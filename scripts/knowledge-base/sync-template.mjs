import { existsSync } from "node:fs"
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  SYNAPSE_KB_TEMPLATE_DIR,
  SYNAPSE_KB_TEMPLATE_NAME,
  rewriteTemplateFiles,
  validateTemplateBranding,
} from "./template-branding.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "../..")
const repoUrl = "https://github.com/AgriciDaniel/claude-obsidian.git"
const sourceRepoUrl = "https://github.com/AgriciDaniel/claude-obsidian"
const templateDir = path.resolve(repoRoot, SYNAPSE_KB_TEMPLATE_DIR)
const preservedFiles = new Set(["SOURCE.json"])

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`)
  }
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

async function emptyTemplateDir() {
  await mkdir(templateDir, { recursive: true })
  const entries = await readdir(templateDir)
  await Promise.all(entries
    .filter((entry) => !preservedFiles.has(entry))
    .map((entry) => rm(path.join(templateDir, entry), { recursive: true, force: true })))
}

async function preserveLicenseIfPresent(sourceDir) {
  for (const name of ["LICENSE", "LICENSE.md", "NOTICE", "NOTICE.md"]) {
    const sourcePath = path.join(sourceDir, name)
    if (existsSync(sourcePath)) {
      await cp(sourcePath, path.join(templateDir, name), { recursive: true, force: true })
    }
  }
}

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), "synapse-knowledge-base-"))
  try {
    run("git", ["clone", "--depth", "1", repoUrl, tmp])
    const commit = output("git", ["rev-parse", "HEAD"], { cwd: tmp })
    const syncedAt = new Date().toISOString().slice(0, 10)

    await emptyTemplateDir()
    await cp(tmp, templateDir, {
      recursive: true,
      force: true,
      filter: (source) => {
        const relative = path.relative(tmp, source)
        return relative !== ".git" && !relative.startsWith(`.git${path.sep}`)
      },
    })
    await preserveLicenseIfPresent(tmp)
    await rewriteTemplateFiles(templateDir)

    await writeFile(path.join(templateDir, "SOURCE.json"), `${JSON.stringify({
      templateName: SYNAPSE_KB_TEMPLATE_NAME,
      repo: sourceRepoUrl,
      commit,
      syncedAt,
      notes: "Upstream source metadata for developer sync and attribution only.",
    }, null, 2)}\n`, "utf8")
    await validateTemplateBranding(templateDir)

    const source = await readFile(path.join(templateDir, "SOURCE.json"), "utf8")
    console.log(source)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
