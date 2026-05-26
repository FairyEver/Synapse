import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
  const directoryPath = path.dirname(filePath)
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  await mkdir(directoryPath, { recursive: true })
  try {
    await writeFile(temporaryPath, content, "utf8")
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}
