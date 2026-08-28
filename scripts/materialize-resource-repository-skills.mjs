import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const [sourceRoot, outputRoot] = process.argv.slice(2)

if (!sourceRoot || !outputRoot) {
  throw new Error("Usage: node scripts/materialize-resource-repository-skills.mjs <resource-repository> <output-directory>")
}

await ensureEmptyOutputDirectory(outputRoot)

const skillsRoot = path.join(sourceRoot, "skills")
const blobRoot = path.join(sourceRoot, "system", "blobs")
const skillIds = await directoryNames(skillsRoot)
const activeSkills = []

for (const skillId of skillIds) {
  const historyRoot = path.join(skillsRoot, skillId, "history")
  const historyNames = (await directoryNames(historyRoot)).sort().reverse()
  if (historyNames.length === 0) continue

  const historyDirectory = path.join(historyRoot, historyNames[0])
  const snapshot = await readJson(path.join(historyDirectory, "snapshot.json"))
  if (snapshot.deleted === true) continue

  const legacyName = requireString(snapshot.name, `${skillId} name`)
  const name = toCloudSkillName(legacyName)
  const title = requireString(snapshot.title, `${skillId} title`)
  const description = requireString(snapshot.description, `${skillId} description`)
  validateSkillName(name)

  const targetDirectory = path.join(outputRoot, name)
  await mkdir(targetDirectory)

  const body = await readFile(path.join(historyDirectory, "main.md"), "utf8")
  const skillMarkdown = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`
  await writeFile(path.join(targetDirectory, "SKILL.md"), skillMarkdown, "utf8")

  const attachments = await readJson(path.join(historyDirectory, "attachments.json"))
  const files = Array.isArray(attachments.files) ? attachments.files : []
  const seenPaths = new Set(["skill.md"])
  for (const attachment of files) {
    const relativePath = requireString(attachment.originalName, `${name} attachment path`)
    const sha256 = requireSha256(attachment.sha256, `${name}/${relativePath} sha256`)
    validateAttachmentPath(relativePath)
    const pathKey = relativePath.toLowerCase()
    if (seenPaths.has(pathKey)) throw new Error(`Duplicate attachment path: ${name}/${relativePath}`)
    seenPaths.add(pathKey)

    const blobPath = path.join(blobRoot, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
    const bytes = await readVerifiedBlob(blobPath, sha256, `${name}/${relativePath}`)
    if (Number.isSafeInteger(attachment.size) && bytes.length !== attachment.size) {
      throw new Error(`Blob size mismatch: ${name}/${relativePath}`)
    }

    const targetPath = path.join(targetDirectory, ...relativePath.split("/"))
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, bytes)
  }

  activeSkills.push({
    id: skillId,
    name,
    legacyName,
    title,
    description,
    latestHistoryDirname: historyNames[0],
    sourceDirectoryPath: targetDirectory,
    attachmentCount: files.length,
  })
}

activeSkills.sort((left, right) => left.name.localeCompare(right.name))
for (let index = 1; index < activeSkills.length; index += 1) {
  if (activeSkills[index - 1].name === activeSkills[index].name) {
    throw new Error(`Duplicate active Skill name: ${activeSkills[index].name}`)
  }
}

await writeFile(
  path.join(outputRoot, "migration-manifest.json"),
  `${JSON.stringify({ sourceRoot, count: activeSkills.length, skills: activeSkills }, null, 2)}\n`,
  "utf8",
)

process.stdout.write(`${JSON.stringify({ outputRoot, count: activeSkills.length })}\n`)

async function ensureEmptyOutputDirectory(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0) throw new Error(`Output directory must be empty: ${directory}`)
}

async function directoryNames(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"))
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}`)
  return value
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

async function readVerifiedBlob(blobPath, expectedSha256, label) {
  const bytes = await readFile(blobPath)
  if (sha256(bytes) === expectedSha256) return bytes

  const crlfBytes = Buffer.from(bytes.toString("binary").replaceAll("\n", "\r\n"), "binary")
  if (sha256(crlfBytes) === expectedSha256) return crlfBytes

  const lfBytes = Buffer.from(bytes.toString("binary").replaceAll("\r\n", "\n"), "binary")
  if (sha256(lfBytes) === expectedSha256) return lfBytes

  throw new Error(`Blob hash mismatch: ${label}`)
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function validateSkillName(name) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(name)) {
    throw new Error(`Invalid cloud Skill name: ${name}`)
  }
}

function toCloudSkillName(name) {
  const normalized = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
  validateSkillName(normalized)
  return normalized
}

function validateAttachmentPath(relativePath) {
  if (relativePath.includes("\\") || path.posix.isAbsolute(relativePath)) {
    throw new Error(`Invalid attachment path: ${relativePath}`)
  }
  const segments = relativePath.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid attachment path: ${relativePath}`)
  }
}
