import archiver from "archiver"
import { BadRequestException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { buffer as readStreamBuffer } from "node:stream/consumers"
import { Transform } from "node:stream"
import {
  skillRepositoryMaxFileBytes,
  skillRepositoryMaxFileCount,
  skillRepositoryMaxTotalBytes,
  skillRepositoryRootFilePath,
  type SkillRepositoryInstallManifest,
} from "@synapse/shared"
import { normalizeSkillRepositoryPath } from "./skill-repository-file-rules"
import type { SkillRepositoryStoragePort } from "./skill-repository-storage"

export interface SkillRepositoryInstallPackageRepository {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly owner: {
    readonly handle: string | null
  } | null
  readonly ownerUserId: string
}

export interface SkillRepositoryInstallPackageFile {
  readonly path: string
  readonly kind: string
  readonly size: bigint | number
  readonly sha256: string
  readonly storageKey: string | null
}

export async function buildSkillRepositoryInstallPackage(input: {
  readonly repository: SkillRepositoryInstallPackageRepository
  readonly files: readonly SkillRepositoryInstallPackageFile[]
  readonly storage: SkillRepositoryStoragePort
}): Promise<{
  readonly packageBuffer: Buffer
  readonly packageSha256: string
  readonly packageSize: number
  readonly manifest: SkillRepositoryInstallManifest
}> {
  const files = [...input.files].sort((a, b) => a.path.localeCompare(b.path))
  if (files.length > skillRepositoryMaxFileCount) throw new BadRequestException("Skill 文件数量超过限制。")

  const rootFile = files.find((file) => normalizeSkillRepositoryPath(file.path) === skillRepositoryRootFilePath)
  if (!rootFile) throw new BadRequestException("Skill 必须包含 SKILL.md。")

  let totalSize = 0
  const packageFiles: Array<SkillRepositoryInstallPackageFile & { readonly bytes: Buffer; readonly sizeNumber: number }> = []
  for (const file of files) {
    const normalizedPath = normalizeSkillRepositoryPath(file.path)
    if (normalizedPath !== file.path) throw new BadRequestException("安装包文件路径不合法。")
    if (!file.storageKey) throw new BadRequestException("Skill 文件对象不存在。")
    const sizeNumber = numberFromSize(file.size)
    if (sizeNumber > skillRepositoryMaxFileBytes) throw new BadRequestException("Skill 文件大小超过限制。")
    totalSize += sizeNumber
    if (totalSize > skillRepositoryMaxTotalBytes) throw new BadRequestException("Skill 总大小超过限制。")

    const object = await input.storage.getObjectStream({ key: file.storageKey })
    const bytes = await readStreamBuffer(object.stream)
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (sha256 !== file.sha256) throw new BadRequestException("Skill 文件校验失败。")
    packageFiles.push({ ...file, bytes, sizeNumber })
  }

  const manifest: SkillRepositoryInstallManifest = {
    schemaVersion: 1,
    repositoryId: input.repository.id,
    repositoryName: input.repository.name,
    ownerHandle: input.repository.owner?.handle ?? input.repository.ownerUserId,
    title: input.repository.title,
    mainFile: "content/SKILL.md",
    files: packageFiles.map((file) => ({
      path: `content/${file.path}`,
      size: file.sizeNumber,
      sha256: file.sha256,
      kind: file.kind === "text" ? "text" : "binary",
    })),
  }

  const archive = archiver("zip", { zlib: { level: 9 } })
  const hash = createHash("sha256")
  let packageSize = 0
  const body = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      packageSize += chunk.length
      callback(null, chunk)
    },
  })
  const chunks: Buffer[] = []
  body.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
  const result = new Promise<void>((resolve, reject) => {
    body.on("finish", resolve)
    body.on("error", reject)
    archive.on("error", (error) => {
      body.destroy(error)
      reject(error)
    })
  })

  archive.pipe(body)
  const entryDate = new Date(0)
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json", date: entryDate })
  for (const file of packageFiles) {
    archive.append(file.bytes, { name: `content/${file.path}`, date: entryDate })
  }
  await archive.finalize()
  await result

  return {
    packageBuffer: Buffer.concat(chunks),
    packageSha256: hash.digest("hex"),
    packageSize,
    manifest,
  }
}

function numberFromSize(size: bigint | number): number {
  return typeof size === "bigint" ? Number(size) : size
}
