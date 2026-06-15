import archiver from "archiver"
import { BadRequestException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Readable, Transform } from "node:stream"
import type { ContentStoreInstallManifest } from "@synapse/shared"
import type { ContentStorePackageInput, ContentStorePackageStreamFile } from "./content-store.types"
import { normalizeContentStorePath } from "./content-store-file-rules"

export async function buildContentStorePackage(input: ContentStorePackageInput): Promise<{
  readonly bytes: Buffer
  readonly sha256: string
  readonly manifest: ContentStoreInstallManifest
}> {
  const packageStream = createContentStorePackageStream({
    ...input,
    files: input.files.map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      kind: file.kind,
      mimeType: file.mimeType,
      text: file.text,
      stream: Readable.from([file.bytes]),
    })),
  })
  const bytes = await streamToBuffer(packageStream.body)
  const result = await packageStream.result
  return {
    bytes,
    sha256: result.sha256,
    manifest: result.manifest,
  }
}

export function createContentStorePackageStream(input: {
  readonly contentId: string
  readonly versionId: string
  readonly type: ContentStorePackageInput["type"]
  readonly title: string
  readonly files: readonly ContentStorePackageStreamFile[]
}): {
  readonly body: NodeJS.ReadableStream
  readonly result: Promise<{
    readonly sha256: string
    readonly size: bigint
    readonly manifest: ContentStoreInstallManifest
  }>
} {
  const mainFile = input.type === "skill" ? "content/SKILL.md" : "content/RULE.md"
  const files = input.files.map((file) => {
    const normalizedPath = normalizeContentStorePath(file.path)
    if (normalizedPath !== file.path) throw new BadRequestException("安装包文件路径不合法。")
    return file
  })
  const manifest: ContentStoreInstallManifest = {
    schemaVersion: 1,
    contentId: input.contentId,
    versionId: input.versionId,
    type: input.type,
    title: input.title,
    mainFile,
    files: files.map((file) => ({
      path: `content/${file.path}`,
      size: file.size,
      sha256: file.sha256,
      kind: file.kind,
    })),
  }

  const archive = archiver("zip", { zlib: { level: 9 } })
  const hash = createHash("sha256")
  let size = 0n
  const body = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      size += BigInt(chunk.length)
      callback(null, chunk)
    },
  })
  const result = new Promise<{
    readonly sha256: string
    readonly size: bigint
    readonly manifest: ContentStoreInstallManifest
  }>((resolve, reject) => {
    body.on("finish", () => resolve({
      sha256: hash.digest("hex"),
      size,
      manifest,
    }))
    body.on("error", reject)
    archive.on("error", (error) => {
      body.destroy(error)
      reject(error)
    })
  })

  archive.pipe(body)
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" })
  for (const file of files) {
    archive.append(file.stream, { name: `content/${file.path}` })
  }
  void archive.finalize().catch((error) => {
    body.destroy(error)
  })

  return {
    body,
    result,
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
