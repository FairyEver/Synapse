import archiver from "archiver"
import { createHash } from "node:crypto"
import { PassThrough } from "node:stream"
import type { ContentStoreInstallManifest } from "@synapse/shared"
import type { ContentStorePackageInput } from "./content-store.types"

export async function buildContentStorePackage(input: ContentStorePackageInput): Promise<{
  readonly bytes: Buffer
  readonly sha256: string
  readonly manifest: ContentStoreInstallManifest
}> {
  const mainFile = input.type === "skill" ? "content/SKILL.md" : "content/RULE.md"
  const manifest: ContentStoreInstallManifest = {
    schemaVersion: 1,
    contentId: input.contentId,
    versionId: input.versionId,
    type: input.type,
    title: input.title,
    mainFile,
    files: input.files.map((file) => ({
      path: `content/${file.path}`,
      size: file.size,
      sha256: file.sha256,
      kind: file.kind,
    })),
  }

  const archive = archiver("zip", { zlib: { level: 9 } })
  const output = new PassThrough()
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    output.on("end", () => resolve(Buffer.concat(chunks)))
    output.on("error", reject)
    archive.on("error", reject)
  })

  archive.pipe(output)
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" })
  for (const file of input.files) {
    archive.append(file.bytes, { name: `content/${file.path}` })
  }
  await archive.finalize()

  const bytes = await done
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    manifest,
  }
}
