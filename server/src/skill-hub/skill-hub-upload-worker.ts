import { parentPort, workerData } from "node:worker_threads"
import { SKILL_HUB_LIMITS as limits } from "@synapse/shared/skill-hub-contracts"
import { inspectHubSkillPackage } from "@synapse/shared/skill-hub-package-node"
import archiver from "archiver"
import type { HubUploadBytes, HubUploadCodecInput, HubUploadCodecResult } from "./skill-hub-upload-codec"
import { assertSkillHubIcon } from "./skill-hub-png"

async function standardArchive(files: { path: string; bytes: Buffer }[]): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  let size = 0
  const result = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > limits.uploadBytes) {
        archive.destroy(new Error("Normalized Skill ZIP exceeds upload budget"))
        return
      }
      chunks.push(chunk)
    })
    archive.once("error", reject)
    archive.once("end", () => resolve(Buffer.concat(chunks, size)))
  })
  for (const file of files) archive.append(file.bytes, { name: file.path, mode: 0o644, date: new Date("1980-01-01T00:00:00Z") })
  return (await Promise.all([result, archive.finalize()]))[0]
}

async function encode({ purpose, format, bytes }: HubUploadCodecInput): Promise<HubUploadBytes> {
  const buffer = Buffer.from(bytes)
  if (purpose === "icon") {
    assertSkillHubIcon(buffer)
    return { files: [{ kind: "icon", contentType: "image/png", bytes: buffer }] }
  }
  const result = inspectHubSkillPackage({ format: format!, bytes })
  const archive = await standardArchive(result.files)
  return {
    files: [
      { kind: "archive", contentType: "application/zip", bytes: archive },
      { kind: "main", contentType: "text/plain; charset=utf-8", bytes: result.main },
    ],
    package: { ...result.package, manifest: result.manifest, contentFingerprint: result.contentFingerprint },
  }
}

void encode(workerData as HubUploadCodecInput).then((data) => {
  const files = data.files.map((file) => ({ ...file, bytes: Uint8Array.from(file.bytes) }))
  parentPort!.postMessage({ data: { ...data, files } } satisfies HubUploadCodecResult, files.map((file) => file.bytes.buffer))
}, (error: unknown) => {
  const reason = error instanceof Error ? error.message : ""
  const invalid = /^(?:Skill (?:package|upload|ZIP)|ZIP |unsafe ZIP|invalid ZIP|multi-disk ZIP|unsupported ZIP|SKILL\.md|Normalized Skill ZIP)/.test(reason)
    ? reason.slice(0, 160)
    : "文件不是可用的 Skill Markdown、ZIP 或规范化 PNG。"
  parentPort!.postMessage({ invalid } satisfies HubUploadCodecResult)
})
