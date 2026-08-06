import { Inject, Injectable, Logger } from "@nestjs/common"
import type { DriveMarkdownProjectionDto } from "@synapse/shared"
import { createHash } from "node:crypto"
import { PrismaService } from "../prisma/prisma.service"
import type { DriveStoragePort } from "./drive-storage"
import { DRIVE_MARKDOWN_PARSER_VERSION, DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION } from "./drive-markdown-projection"

const projectionMaxBytes = 8 * 1024 * 1024

@Injectable()
export class DriveMarkdownProjectionService {
  private readonly logger = new Logger(DriveMarkdownProjectionService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
  ) {}

  async load(versionId: string): Promise<DriveMarkdownProjectionDto | null> {
    const record = await this.prisma.driveMarkdownProjection.findUnique({ where: { versionId } })
    if (!record || record.status !== "ready") return null
    if (record.parserVersion !== DRIVE_MARKDOWN_PARSER_VERSION || record.schemaVersion !== DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION) return null
    try {
      const object = await this.storage.getObjectStream({ key: record.storageKey })
      const body = await readStreamBuffer(object.stream, projectionMaxBytes)
      if (sha256(body) !== record.sha256) throw new Error("projection_hash_mismatch")
      return parseProjection(body)
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        itemId: record.itemId,
        versionId,
      }, "Drive Markdown projection read failed")
      await this.prisma.driveMarkdownProjection.updateMany({
        where: { versionId },
        data: { status: "unavailable" },
      })
      return null
    }
  }

  async loadPrevious(input: { readonly itemId: string; readonly versionId: string }): Promise<{
    readonly source: string
    readonly projection: DriveMarkdownProjectionDto
  } | null> {
    const current = await this.prisma.driveFileVersion.findUnique({
      where: { id: input.versionId },
      select: { versionNumber: true },
    })
    if (!current) return null
    const previous = await this.prisma.driveFileVersion.findFirst({
      where: {
        itemId: input.itemId,
        deletedAt: null,
        versionNumber: { lt: current.versionNumber },
        markdownProjection: { status: "ready" },
      },
      orderBy: { versionNumber: "desc" },
      select: { id: true, storageKey: true },
    })
    if (!previous) return null
    const [sourceObject, projection] = await Promise.all([
      this.storage.getObjectStream({ key: previous.storageKey }),
      this.load(previous.id),
    ])
    if (!projection) return null
    const source = (await readStreamBuffer(sourceObject.stream, projectionMaxBytes)).toString("utf8")
    return { source, projection }
  }

  async persist(input: {
    readonly itemId: string
    readonly versionId: string
    readonly projection: DriveMarkdownProjectionDto
  }): Promise<void> {
    const body = Buffer.from(JSON.stringify(input.projection), "utf8")
    if (body.byteLength > projectionMaxBytes) {
      this.logger.warn({ itemId: input.itemId, size: body.byteLength, versionId: input.versionId }, "Drive Markdown projection too large")
      return
    }
    const storageKey = `drive/${input.itemId}/projections/${input.versionId}.json`
    const hash = sha256(body)
    try {
      await this.storage.putObject({ key: storageKey, body, contentType: "application/json" })
      await this.prisma.driveMarkdownProjection.upsert({
        where: { versionId: input.versionId },
        create: {
          itemId: input.itemId,
          versionId: input.versionId,
          storageKey,
          sha256: hash,
          sourceSha256: input.projection.sourceSha256,
          parserVersion: input.projection.parserVersion,
          schemaVersion: input.projection.schemaVersion,
          status: "ready",
        },
        update: {
          storageKey,
          sha256: hash,
          sourceSha256: input.projection.sourceSha256,
          parserVersion: input.projection.parserVersion,
          schemaVersion: input.projection.schemaVersion,
          status: "ready",
        },
      })
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        itemId: input.itemId,
        versionId: input.versionId,
      }, "Drive Markdown projection persistence failed")
      try {
        await this.prisma.driveMarkdownProjection.updateMany({
          where: { versionId: input.versionId },
          data: { status: "unavailable" },
        })
      } catch (statusError) {
        this.logger.warn({
          errorName: statusError instanceof Error ? statusError.name : typeof statusError,
          itemId: input.itemId,
          versionId: input.versionId,
        }, "Drive Markdown projection unavailable status update failed")
      }
    }
  }
}

function parseProjection(body: Buffer): DriveMarkdownProjectionDto {
  const value: unknown = JSON.parse(body.toString("utf8"))
  if (!value || typeof value !== "object"
    || (value as { schemaVersion?: unknown }).schemaVersion !== DRIVE_MARKDOWN_PROJECTION_SCHEMA_VERSION
    || (value as { parserVersion?: unknown }).parserVersion !== DRIVE_MARKDOWN_PARSER_VERSION) {
    throw new Error("projection_schema_invalid")
  }
  return value as DriveMarkdownProjectionDto
}

async function readStreamBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) throw new Error("projection_too_large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
