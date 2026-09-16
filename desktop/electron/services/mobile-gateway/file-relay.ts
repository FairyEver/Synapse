import { access, mkdir } from "node:fs/promises"
import path from "node:path"

import { MOBILE_FRAME_LIMITS } from "@synapse/shared/mobile-live-constants"

/**
 * Everything a name that reaches a user's filesystem must survive.
 *
 * Anything outside this set becomes a `-`. That is deliberately aggressive,
 * because the path this produces is not just written to disk — it is typed into
 * the user's terminal to be pasted into a shell or handed to an agent. A name
 * holding `&`, `;` or a space would paste as two arguments or as a second
 * command, and the user would have no way to tell that the name was the reason.
 * Letters, digits, CJK and `._-` are what real file names use anyway.
 */
const UNSAFE_NAME_CHARS = /[^\p{L}\p{N}._-]+/gu

/** Distinguishes a second `report.png` from the first without overwriting it. */
const COLLISION_ATTEMPTS = 100

/**
 * Builds the relay the gateway runs on.
 *
 * A factory rather than a bare class because the two cloud calls are the only
 * thing that varies: a test wants to watch what lands on disk without an account
 * or a network behind it.
 */
export function createMobileFileRelay(deps: MobileFileRelayDeps): MobileFileRelay {
  return new MobileFileRelay(deps)
}

export type MobileFileRelayLogger = {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

export type MobileFileRelayDeps = {
  /** Streams the drive item to `outputPath`, writing atomically. */
  readonly downloadDriveFile: (input: {
    readonly itemId: string
    readonly outputPath: string
    readonly maxBytes?: number
  }) => Promise<{ readonly ok: true; readonly path: string }>
  /** Removes the cloud copy for good, bytes included. */
  readonly permanentlyDeleteDriveItem: (itemId: string) => Promise<{ readonly ok: true }>
  /** Where relayed files land. Created on demand. */
  readonly directory: string
  readonly logger: MobileFileRelayLogger
}

export class MobileFileRelayError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "MobileFileRelayError"
    this.code = code
  }
}

/**
 * Brings a phone's uploaded file down onto this computer.
 *
 * The bytes arrive over HTTP from the drive rather than through the live socket,
 * which is why this is its own unit: the intent executor above it only ever sees
 * a drive item id and a name, and everything that has to be careful about — where
 * the file may be written, what it may be called, what happens when the cloud copy
 * cannot be removed — is answered here.
 */
export class MobileFileRelay {
  private readonly deps: MobileFileRelayDeps

  constructor(deps: MobileFileRelayDeps) {
    this.deps = deps
  }

  /**
   * Writes the file and returns where it landed.
   *
   * A name that sanitizes away to nothing is refused rather than replaced with a
   * generated one: the phone is the only side that can tell the user what its file
   * became, and it named the file it is asking for.
   */
  async land(input: {
    readonly driveItemId: string
    readonly fileName: string
  }): Promise<{ readonly path: string; readonly fileName: string }> {
    const fileName = sanitizeRelayedFileName(input.fileName)
    if (!fileName) {
      throw new MobileFileRelayError("invalid_file_name", "这个文件名不能用。")
    }

    const directory = this.deps.directory
    await mkdir(directory, { recursive: true })
    const target = await this.availablePath(directory, fileName)

    try {
      await this.deps.downloadDriveFile({
        itemId: input.driveItemId,
        outputPath: target,
        // The phone enforces the same ceiling while picking; this is the second
        // line, because this is the side that owns the user's disk.
        maxBytes: MOBILE_FRAME_LIMITS.maxRelayedFileBytes,
      })
    } catch (error) {
      throw new MobileFileRelayError("download_failed", describeDownloadFailure(error))
    }

    return { path: target, fileName: path.basename(target) }
  }

  /**
   * Drops the cloud copy once the file is safely on disk.
   *
   * Best effort by design: the file is already local, so a failure here is a
   * cleanup problem rather than a delivery one, and it must not turn a successful
   * transfer into a failed one on the phone. The phone keeps the item id until it
   * hears otherwise, so a copy this misses is retried on the phone's next sweep.
   */
  async discardCloudCopy(driveItemId: string): Promise<boolean> {
    try {
      await this.deps.permanentlyDeleteDriveItem(driveItemId)
      return true
    } catch (error) {
      this.deps.logger.warn("Relayed file left a cloud copy behind.", {
        driveItemId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return false
    }
  }

  /** The first free `name`, `name-2`, `name-3` … so a repeat never overwrites. */
  private async availablePath(directory: string, fileName: string): Promise<string> {
    const { stem, extension } = splitFileName(fileName)
    for (let attempt = 1; attempt <= COLLISION_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 1 ? fileName : `${stem}-${attempt}${extension}`
      const full = path.join(directory, candidate)
      if (!isInsideDirectory(directory, full)) {
        throw new MobileFileRelayError("invalid_file_name", "这个文件名不能用。")
      }
      try {
        await access(full)
      } catch {
        return full
      }
    }
    throw new MobileFileRelayError("name_exhausted", "同名文件太多了，先清理一下目录。")
  }
}

/**
 * Reduces a wire-supplied name to one that is safe on disk and safe to paste.
 *
 * Exported for test: the properties it must hold — never a path, never empty,
 * never longer than the wire allows — are the whole reason it exists.
 */
export function sanitizeRelayedFileName(raw: string): string | null {
  // Take the last segment, so `../../etc/passwd` can only ever become `passwd`.
  const lastSegment = raw.split(/[\\/]/u).pop() ?? ""
  const cleaned = lastSegment
    .replace(UNSAFE_NAME_CHARS, "-")
    .replace(/-{2,}/gu, "-")
    // A leading dot hides the file; a leading dash reads as a flag to every shell.
    .replace(/^[.-]+/u, "")
    .replace(/[ .-]+$/u, "")
  if (!cleaned) return null

  const { stem, extension } = splitFileName(cleaned)
  const room = MOBILE_FRAME_LIMITS.maxRelayedFileNameLength - extension.length
  if (room <= 0) return null
  const trimmed = stem.slice(0, room).replace(/[ .-]+$/u, "")
  return trimmed ? `${trimmed}${extension}` : null
}

function splitFileName(fileName: string): { readonly stem: string; readonly extension: string } {
  const dot = fileName.lastIndexOf(".")
  // A leading dot is part of a hidden name, not an extension separator — and
  // `sanitizeRelayedFileName` has already removed those.
  if (dot <= 0 || dot === fileName.length - 1) return { stem: fileName, extension: "" }
  const extension = fileName.slice(dot)
  // A "extension" of a dozen characters is part of the name, not a suffix worth
  // protecting from truncation.
  if (extension.length > 12) return { stem: fileName, extension: "" }
  return { stem: fileName.slice(0, dot), extension }
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function describeDownloadFailure(error: unknown): string {
  if (error instanceof Error && error.name === "DriveDownloadMaxBytesExceededError") {
    return "这个文件超过了 100 MB 上限。"
  }
  return "从云端取文件失败。"
}
