import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const devStatePath = path.resolve("node_modules/.cache/synapse/dev-processes.json")

async function readDevProcessState() {
  try {
    const raw = await readFile(devStatePath, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => (
      entry
      && typeof entry === "object"
      && Number.isInteger(entry.pid)
      && entry.pid > 0
    ))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return []
    }
    return []
  }
}

async function writeDevProcessState(entries) {
  await mkdir(path.dirname(devStatePath), { recursive: true })
  await writeFile(devStatePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8")
}

async function clearDevProcessState() {
  await rm(devStatePath, { force: true })
}

export { clearDevProcessState, devStatePath, readDevProcessState, writeDevProcessState }
