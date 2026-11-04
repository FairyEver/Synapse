import { assertSafeArchivePath, decodeUtf8, readZipEntries, sha256 } from "./archive-package-node.js"
import { SKILL_HUB_LIMITS as limits, type SkillHubManifest, type SkillHubPackageInfo } from "./skill-hub-contracts.js"
import { readHubSkillFrontmatter } from "./skill-hub-frontmatter.js"

type HubFile = { path: string; bytes: Buffer }
type PathEntry = { path: string; directory?: true }

export type SkillHubInspectedPackage = {
  package: SkillHubPackageInfo
  files: HubFile[]
  manifest: SkillHubManifest
  main: Buffer
  contentFingerprint: string
  excludedPaths: string[]
  totalBytes: number
}

function pathIdentity(path: string): string {
  return path.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC")
}

function assertTree(entries: PathEntry[], maxDepth: number): void {
  const paths = new Map<string, { spelling: string; directory: boolean; explicit: boolean }>()
  for (const entry of entries) {
    assertSafeArchivePath(entry.path)
    const parts = entry.path.split("/")
    if (parts.length - (entry.directory ? 0 : 1) > maxDepth || entry.path.length > 1024
      || parts.some((part) => Buffer.byteLength(part) > 255 || /^(?:com|lpt)[¹²³](?:\.|$)/iu.test(part))) {
      throw new Error("Skill package exceeds path limits")
    }
    for (let i = 0; i < parts.length; i++) {
      const spelling = parts.slice(0, i + 1).join("/")
      const key = pathIdentity(spelling)
      const explicit = i === parts.length - 1
      const directory = !explicit || Boolean(entry.directory)
      const prior = paths.get(key)
      if (prior && (prior.spelling !== spelling || prior.directory !== directory || (prior.explicit && explicit))) {
        throw new Error("Skill package has conflicting paths")
      }
      if (!prior || explicit) paths.set(key, { spelling, directory, explicit })
    }
  }
}

export function hubPathDisposition(path: string): "include" | "system" | "excluded" {
  const parts = path.split("/")
  if (parts.some((part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"))) return "system"
  if (path === ".env.example") return "include"
  return parts.some((part) => part.startsWith(".") || part.toLowerCase() === "node_modules") ? "excluded" : "include"
}

function ordered<T extends { path: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
}

export function fingerprintHubFiles(files: readonly SkillHubManifest[number][]): string {
  const records = ordered(files).map(({ path, size, sha256: digest }) => [path, size, digest])
  return `sha256:${sha256(Buffer.from(JSON.stringify(records)))}`
}

export function inspectHubSkillFiles(files: readonly HubFile[], excludedPaths: string[] = []): SkillHubInspectedPackage {
  if (files.length > limits.attachments + 1) throw new Error("Skill package has too many attachments")
  assertTree([...files], limits.directoryDepth)
  const sorted = ordered(files)
  const main = sorted.find(({ path }) => path === "SKILL.md")?.bytes
  if (!main) throw new Error("Skill package is missing root SKILL.md")
  let totalBytes = 0
  for (const { path, bytes } of sorted) {
    if (hubPathDisposition(path) !== "include") throw new Error("Skill package contains a hidden or runtime file")
    if (path !== "SKILL.md" && pathIdentity(path.split("/").at(-1)!) === "skill.md") {
      throw new Error("Skill package contains more than one SKILL.md")
    }
    const maxBytes = path === "SKILL.md" ? limits.mainBytes : limits.attachmentBytes
    totalBytes += bytes.length
    if (bytes.length > maxBytes || totalBytes > limits.packageBytes) throw new Error("Skill package exceeds file size budget")
  }
  const info = readHubSkillFrontmatter(decodeUtf8(main))
  const manifest = sorted.map(({ path, bytes }) => ({ path, size: bytes.length, sha256: sha256(bytes) }))
  return { package: info, files: sorted, manifest, main, contentFingerprint: fingerprintHubFiles(manifest), excludedPaths, totalBytes }
}

export function inspectHubSkillPackage(input: { format: "markdown" | "zip"; bytes: Uint8Array }): SkillHubInspectedPackage {
  if (input.bytes.length > (input.format === "markdown" ? limits.mainBytes : limits.uploadBytes)) {
    throw new Error("Skill upload exceeds size budget")
  }
  const archive = Buffer.from(input.bytes)
  if (input.format === "markdown") return inspectHubSkillFiles([{ path: "SKILL.md", bytes: archive }])

  const parsed = readZipEntries(archive, {
    maxCompressedBytes: limits.uploadBytes,
    maxEntries: limits.archiveEntries,
    maxFileBytes: limits.attachmentBytes,
    maxManifestBytes: limits.mainBytes,
    maxUncompressedBytes: limits.packageBytes,
    maxParseTimeMs: limits.parseTimeMs,
    strict: {
      maxDirectories: limits.archiveDirectories, maxDepth: limits.directoryDepth + 1,
      checkPath(path, directory) {
        if (hubPathDisposition(path) === "system") return
        const parts = path.split("/")
        const possibleRootEnvExample = !directory && parts.length <= 2 && parts.at(-1) === ".env.example"
          && (parts.length === 1 || hubPathDisposition(parts[0]) === "include")
        if (!possibleRootEnvExample && hubPathDisposition(path) === "excluded") {
          throw new Error("Skill package contains a hidden or runtime entry")
        }
      },
    },
  })
  const all = [...parsed.values()].map(({ name, bytes, directory }) => ({
    path: directory ? name.slice(0, -1) : name, bytes, directory,
  }))
  assertTree(all, limits.directoryDepth + 1)
  const entries = all.filter(({ path }) => hubPathDisposition(path) !== "system")
  const root = entries.some(({ path, directory }) => path === "SKILL.md" && !directory)
  const firstSegment = entries[0]?.path.split("/")[0]
  if (!root && (!firstSegment || !entries.every(({ path, directory }) => path.startsWith(`${firstSegment}/`) || (directory && path === firstSegment)))) {
    throw new Error("Skill ZIP must contain SKILL.md at its root or inside one wrapper directory")
  }
  if (!root && hubPathDisposition(firstSegment) !== "include") throw new Error("Skill ZIP has a forbidden wrapper directory")
  const normalized = root ? entries : entries
    .filter(({ path }) => path !== firstSegment)
    .map((entry) => ({ ...entry, path: entry.path.slice(firstSegment.length + 1) }))
  assertTree(normalized, limits.directoryDepth)
  if (normalized.some(({ path, directory }) => hubPathDisposition(path) === "excluded" || (directory && path === ".env.example"))) {
    throw new Error("Skill package contains a hidden or runtime entry")
  }
  return inspectHubSkillFiles(normalized.filter(({ directory }) => !directory), all
    .filter(({ path }) => hubPathDisposition(path) === "system").map(({ path }) => path))
}
