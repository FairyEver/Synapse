import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ZipEntry } from "@synapse/shared/archive-package-node"

export {
  assertSafeArchivePath, decodeUtf8, parseContentLength, readZipEntries, sha256,
  type InstallPackageLimits, type ZipEntry,
} from "@synapse/shared/archive-package-node"

export async function materializeEntries(
  entries: Map<string, ZipEntry>,
  manifest: { readonly files: readonly { readonly path: string }[] },
  directoryPath: string,
): Promise<void> {
  for (const file of manifest.files) {
    const entry = entries.get(file.path)
    if (!entry) throw new Error("manifest file is missing from ZIP")
    const targetPath = path.join(directoryPath, ...file.path.split("/"))
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, entry.bytes, { flag: "wx" })
  }
}
