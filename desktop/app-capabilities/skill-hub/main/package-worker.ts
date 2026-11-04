import { parentPort, workerData } from "node:worker_threads"
import path from "node:path"
import PizZip from "pizzip"
import { decodeUtf8 } from "@synapse/shared/archive-package-node"
import { SKILL_HUB_LIMITS as limits, type SkillHubManifest, type SkillHubPackageInfo } from "@synapse/shared/skill-hub-contracts"
import { inspectHubSkillFiles, inspectHubSkillPackage, type SkillHubInspectedPackage } from "@synapse/shared/skill-hub-package-node"

type Source = { format: "markdown" | "zip"; bytes: Uint8Array }
  | { format: "directory"; files: { path: string; bytes: Uint8Array }[]; excludedPaths: string[] }
export type HubWorkerInput = Source & { exportFiles?: boolean }

export type HubWorkerOutput = {
  bytes: Uint8Array
  package: SkillHubPackageInfo
  manifest: SkillHubManifest
  contentFingerprint: string
  totalBytes: number
  warnings: string[]
  excludedPaths: string[]
  files?: { path: string; bytes: Uint8Array }[]
}

function missingMarkdownLinks(result: SkillHubInspectedPackage): string[] {
  const known = new Set(result.manifest.map((entry) => entry.path))
  const missing = new Set<string>()
  for (const file of result.files) {
    if (!file.path.toLowerCase().endsWith(".md")) continue
    let text: string
    try { text = decodeUtf8(file.bytes) } catch { continue }
    for (const match of text.matchAll(/\]\(\s*(<[^>\n]+>|[^)\s]+)\s*(?:["'][^\n]*?["']\s*)?\)/g)) {
      const raw = match[1].replace(/^<|>$/g, "").split(/[?#]/, 1)[0]
      if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(raw)) continue
      let relative: string
      try { relative = decodeURIComponent(raw) } catch { continue }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), relative))
      if (!known.has(target)) missing.add(file.path)
      if (missing.size >= 30) break
    }
    if (missing.size >= 30) break
  }
  return [...missing].map((file) => `有本地链接未指向包内文件：${file}`)
}

export function encodeHubSnapshot(input: HubWorkerInput): HubWorkerOutput {
  const parsed = input.format === "directory"
    ? inspectHubSkillFiles(input.files.map(({ path, bytes }) => ({ path, bytes: Buffer.from(bytes) })), input.excludedPaths)
    : inspectHubSkillPackage(input)
  const zip = new PizZip()
  for (const file of parsed.files) zip.file(file.path, file.bytes, { date: new Date("1980-01-01T00:00:00Z"), unixPermissions: 0o100644 })
  const bytes = zip.generate({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" })
  if (bytes.length > limits.uploadBytes) throw new Error("Skill ZIP exceeds size limit")
  return {
    bytes, package: parsed.package, manifest: parsed.manifest, contentFingerprint: parsed.contentFingerprint,
    totalBytes: parsed.totalBytes, excludedPaths: parsed.excludedPaths, warnings: missingMarkdownLinks(parsed),
    ...(input.exportFiles ? { files: parsed.files.map((file) => ({ path: file.path, bytes: Uint8Array.from(file.bytes) })) } : {}),
  }
}

if (parentPort) {
  try {
    const result = encodeHubSnapshot(workerData as HubWorkerInput)
    const transfers = [result.bytes.buffer, ...result.files?.map((file) => file.bytes.buffer) ?? []] as ArrayBuffer[]
    parentPort.postMessage({ result }, transfers)
  } catch {
    parentPort.postMessage({ invalid: true })
  }
}
