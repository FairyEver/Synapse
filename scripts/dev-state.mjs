import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const devStatePath = path.resolve("node_modules/.cache/synapse/dev-processes.json")
let writeSerial = 0

function normalizeDevProcessEntries(entries) {
  if (!Array.isArray(entries)) return []

  return entries
    .filter((entry) => (
      entry
      && typeof entry === "object"
      && Number.isInteger(entry.pid)
      && entry.pid > 0
    ))
    .map((entry) => ({
      pid: entry.pid,
      processGroupPid: Number.isInteger(entry.processGroupPid) ? entry.processGroupPid : entry.pid,
      scriptName: typeof entry.scriptName === "string" ? entry.scriptName : undefined,
    }))
}

async function readDevProcessState(filePath = devStatePath) {
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw)
    return normalizeDevProcessEntries(parsed)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return []
    }
    return []
  }
}

async function writeDevProcessState(entries, filePath = devStatePath) {
  const stateDir = path.dirname(filePath)
  writeSerial += 1
  const tempPath = path.join(stateDir, `.dev-processes-${process.pid}-${Date.now()}-${writeSerial}.tmp`)
  const normalizedEntries = normalizeDevProcessEntries(entries)

  await mkdir(stateDir, { recursive: true })
  try {
    await writeFile(tempPath, `${JSON.stringify(normalizedEntries, null, 2)}\n`, "utf8")
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function clearDevProcessState(filePath = devStatePath) {
  await rm(filePath, { force: true })
}

export {
  clearDevProcessState,
  devStatePath,
  normalizeDevProcessEntries,
  readDevProcessState,
  writeDevProcessState,
}
