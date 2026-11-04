const { createHash } = require("node:crypto")
const { constants } = require("node:fs")
const { open, realpath } = require("node:fs/promises")
const { join } = require("node:path")

const { SKILL_HUB_LIMITS } = require("@synapse/shared/skill-hub-contracts")

const manifestName = "skill-hub-objects.json"
const limits = { archive: SKILL_HUB_LIMITS.uploadBytes, main: SKILL_HUB_LIMITS.mainBytes, icon: SKILL_HUB_LIMITS.iconBytes }
const contentTypes = { archive: "application/zip", main: "text/plain; charset=utf-8", icon: "image/png" }
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")

async function readBackupFile(root, relativePath, max, expectedSize) {
  const target = join(root, relativePath)
  if (await realpath(target) !== target) throw new Error("Backup file has a link or noncanonical path")
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || (expectedSize !== undefined && stat.size !== expectedSize)) {
      throw new Error("Backup file size or type is invalid")
    }
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error("Backup file was truncated")
      offset += bytesRead
    }
    if ((await file.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) throw new Error("Backup file grew during verification")
    return bytes
  } finally {
    await file.close()
  }
}

async function restoreSkillHubObjects({ directory, storage, dryRun = true }) {
  const root = await realpath(directory)
  const backup = JSON.parse((await readBackupFile(root, "backup-manifest.json", 1024 * 1024)).toString("utf8"))
  if (backup.schemaVersion === 1 && !backup.skillHubObjectsIncluded) return { restored: 0, skipped: true }
  if (backup.schemaVersion !== 2 || backup.skillHubObjectsIncluded !== true) throw new Error("Unsupported backup manifest")
  const descriptor = backup.contents?.find((entry) => entry.path === manifestName)
  if (!descriptor) throw new Error("Skill Hub manifest is missing from this backup")
  const manifestBytes = await readBackupFile(root, manifestName, 32 * 1024 * 1024, descriptor.size)
  if (digest(manifestBytes) !== descriptor.sha256) throw new Error("Skill Hub manifest checksum mismatch")
  const manifest = JSON.parse(manifestBytes.toString("utf8"))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.objects)) throw new Error("Unsupported Skill Hub object manifest")

  const objects = []
  const keys = new Set()
  for (const entry of manifest.objects) {
    const matched = typeof entry.key === "string" && /^skill-hub\/([A-Za-z0-9_-]{1,128})\/(archive|main|icon)$/.exec(entry.key)
    if (!matched || entry.path !== `skill-hub-objects/${matched[1]}/${matched[2]}` || keys.has(entry.key)
      || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > limits[matched[2]]
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Invalid or duplicate Skill Hub object entry")
    }
    keys.add(entry.key)
    objects.push({ ...entry, kind: matched[2] })
  }
  const readVerified = async (object) => {
    const bytes = await readBackupFile(root, object.path, limits[object.kind], object.size)
    if (digest(bytes) !== object.sha256) throw new Error("Skill Hub object checksum mismatch")
    return bytes
  }
  // Verify the entire archive before writing any destination bytes.
  for (const object of objects) await readVerified(object)
  if (dryRun) return { verified: objects.length, restored: 0 }
  if (!storage) throw new Error("Dedicated Skill Hub restore destination is required")

  for (const object of objects) {
    const bytes = await readVerified(object)
    const previous = await storage.head(object.key)
    if (!previous) await storage.put(object.key, bytes, contentTypes[object.kind])
    const { stream, size } = await storage.open(object.key)
    const hash = createHash("sha256")
    let read = 0
    try {
      if (size !== object.size) throw new Error("Destination object size mismatch")
      for await (const chunk of stream) {
        read += chunk.length
        if (read > object.size) throw new Error("Destination object is too large")
        hash.update(chunk)
      }
      if (read !== object.size || hash.digest("hex") !== object.sha256) throw new Error("Destination object checksum mismatch")
    } finally {
      stream.destroy()
    }
  }
  return { verified: objects.length, restored: objects.length }
}

module.exports = { restoreSkillHubObjects }

if (require.main === module) {
  const [mode, directory, ...rest] = process.argv.slice(2)
  const deadline = setTimeout(() => {
    process.stderr.write("Skill Hub restore timed out; keep the destination offline.\n")
    process.exit(1)
  }, 30 * 60_000)
  ;(async () => {
    if (!directory || rest.length || !["--dry-run", "--execute"].includes(mode)) {
      throw new Error("Usage: restore-skill-hub-objects.cjs --dry-run|--execute <extracted-backup-directory>")
    }
    const dryRun = mode === "--dry-run"
    let storage
    if (!dryRun) {
      const { loadEnv } = require("../dist/config/env.js")
      const env = loadEnv(process.env)
      if (!env.skillHubCosBucket) throw new Error("The dedicated destination COS bucket must be configured")
      const { createSkillHubStorage } = require("../dist/skill-hub/skill-hub-storage.js")
      storage = createSkillHubStorage()
    }
    process.stdout.write(`${JSON.stringify(await restoreSkillHubObjects({ directory, storage, dryRun }))}\n`)
  })().catch(() => {
    process.stderr.write("Skill Hub object restore failed; check the backup, isolated destination configuration, and object integrity.\n")
    process.exitCode = 1
  }).finally(() => clearTimeout(deadline))
}
