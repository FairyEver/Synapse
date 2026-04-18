import { isUtf8 } from "node:buffer"
import { createHash } from "node:crypto"
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentFile,
} from "../../src/types/content"
import { createMainLogger } from "./log-store"

const ATTACHMENTS_POOL_DIRECTORY_NAME = "attachments-pool"
const logger = createMainLogger("service.attachments-pool")

type AttachmentWriteInput = {
  originalName: string
  size: number
  bytes: Uint8Array
}

function normalizeOriginalName(originalName: string): string {
  return path.basename(originalName.trim())
}

function createAttachmentPoolPath(repositoryRootPath: string, sha256: string): string {
  return path.join(
    repositoryRootPath,
    ATTACHMENTS_POOL_DIRECTORY_NAME,
    sha256.slice(0, 2),
    sha256.slice(2, 4),
    sha256,
  )
}

function createAttachmentReference(file: AttachmentWriteInput): SynapseContentAttachmentRecord {
  const sha256 = createHash("sha256").update(file.bytes).digest("hex")

  return {
    originalName: normalizeOriginalName(file.originalName),
    sha256,
    size: file.size,
  }
}

function looksBinaryFile(fileBuffer: Buffer): boolean {
  if (fileBuffer.length === 0) {
    return false
  }

  if (fileBuffer.includes(0)) {
    return true
  }

  return !isUtf8(fileBuffer)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

class AttachmentsPoolService {
  async writeAttachments(
    repositoryRootPath: string,
    files: AttachmentWriteInput[],
  ): Promise<{
    createdPaths: string[]
    records: SynapseContentAttachmentRecord[]
  }> {
    const references: SynapseContentAttachmentRecord[] = []
    const createdPaths: string[] = []
    const seenNames = new Set<string>()

    for (const file of files) {
      const originalName = normalizeOriginalName(file.originalName)

      if (!originalName) {
        throw new Error("附件文件名不能为空。")
      }

      if (seenNames.has(originalName)) {
        throw new Error(`附件文件名重复：${originalName}`)
      }

      seenNames.add(originalName)

      if (file.bytes.byteLength !== file.size) {
        throw new Error(`附件大小校验失败：${originalName}`)
      }

      const reference = createAttachmentReference({
        ...file,
        originalName,
      })
      const targetPath = createAttachmentPoolPath(repositoryRootPath, reference.sha256)

      if (!(await pathExists(targetPath))) {
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, Buffer.from(file.bytes))
        createdPaths.push(targetPath)
        logger.info("Stored attachment in pool.", {
          originalName,
          sha256: reference.sha256,
        })
      }

      references.push(reference)
    }

    return {
      createdPaths,
      records: references,
    }
  }

  resolveAttachmentPath(repositoryRootPath: string, sha256: string): string {
    return createAttachmentPoolPath(repositoryRootPath, sha256)
  }

  async readAttachmentFile(
    repositoryRootPath: string,
    attachment: SynapseContentAttachmentRecord,
  ): Promise<SynapseContentFile | null> {
    const targetPath = this.resolveAttachmentPath(repositoryRootPath, attachment.sha256)

    try {
      const fileBuffer = await readFile(targetPath)
      const baseFile = {
        relativePath: attachment.originalName,
        name: attachment.originalName,
        size: attachment.size,
      }

      if (looksBinaryFile(fileBuffer)) {
        return {
          ...baseFile,
          kind: "binary",
        }
      }

      return {
        ...baseFile,
        kind: "text",
        content: fileBuffer.toString("utf8"),
      }
    } catch (error) {
      logger.warn("Attachment file is missing from pool.", {
        attachment,
        error,
      })
      return null
    }
  }

  async copyAttachmentToPath(
    repositoryRootPath: string,
    attachment: SynapseContentAttachmentRecord,
    targetPath: string,
  ): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(this.resolveAttachmentPath(repositoryRootPath, attachment.sha256), targetPath)
  }
}

export { attachmentsPoolService, normalizeOriginalName }

const attachmentsPoolService = new AttachmentsPoolService()
