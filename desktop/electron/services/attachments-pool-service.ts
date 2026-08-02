import { isUtf8 } from "node:buffer"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathExists } from "./fs-utils"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentFile,
} from "../../src/types/content"
import { normalizeContentAttachmentPath } from "../../src/lib/content-attachments"
import { isPathInsideDirectory } from "../../src/lib/path-compare"
import { createMainLogger } from "./log-store"

const BLOBS_DIRECTORY_PATH = path.join("system", "blobs")
const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/iu
const logger = createMainLogger("service.blobs")

type AttachmentWriteInput = {
  originalName: string
  size: number
  bytes: Uint8Array
}

function normalizeOriginalName(originalName: string): string {
  return normalizeContentAttachmentPath(originalName)
}

function createAttachmentPoolPath(repositoryRootPath: string, sha256: string): string {
  const normalizedSha256 = normalizeAttachmentSha256(sha256)
  const blobsRootPath = path.join(repositoryRootPath, BLOBS_DIRECTORY_PATH)
  const attachmentPath = path.join(
    repositoryRootPath,
    BLOBS_DIRECTORY_PATH,
    normalizedSha256.slice(0, 2),
    normalizedSha256.slice(2, 4),
    normalizedSha256,
  )

  assertPathInsideDirectory(attachmentPath, blobsRootPath)
  return attachmentPath
}

function normalizeAttachmentSha256(sha256: string): string {
  const normalizedSha256 = sha256.trim().toLowerCase()

  if (!SHA256_DIGEST_PATTERN.test(normalizedSha256)) {
    throw new Error("附件摘要无效。")
  }

  return normalizedSha256
}

function assertPathInsideDirectory(targetPath: string, directoryPath: string): void {
  if (!isPathInsideDirectory(directoryPath, targetPath, { resolvePath: path.resolve })) {
    throw new Error("附件路径越界。")
  }
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

class AttachmentsPoolService {
  async writeAttachments(
    repositoryRootPath: string,
    files: AttachmentWriteInput[],
    options: {
      readonly beforeCreate?: (targetPath: string) => Promise<void>
    } = {},
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
        await options.beforeCreate?.(targetPath)
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, Buffer.from(file.bytes))
        createdPaths.push(targetPath)
        logger.info("Stored attachment in pool.", {
          originalName,
          sha256: reference.sha256,
          pathLength: targetPath.length,
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
    try {
      const targetPath = this.resolveAttachmentPath(repositoryRootPath, attachment.sha256)
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
  ): Promise<boolean> {
    let sourcePath: string

    try {
      sourcePath = this.resolveAttachmentPath(repositoryRootPath, attachment.sha256)
    } catch (error) {
      logger.warn("Attachment digest is invalid, skipping copy.", {
        attachment,
        error,
        targetPath,
      })
      return false
    }

    if (!await pathExists(sourcePath)) {
      logger.warn("Attachment blob missing from pool, skipping copy.", {
        originalName: attachment.originalName,
        sha256: attachment.sha256,
        sourcePath,
        targetPath,
      })
      return false
    }

    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    logger.info("Copied attachment to path.", {
      originalName: attachment.originalName,
      sha256: attachment.sha256,
      targetPath,
    })
    return true
  }
}

export { attachmentsPoolService, normalizeAttachmentSha256, normalizeOriginalName }

const attachmentsPoolService = new AttachmentsPoolService()
