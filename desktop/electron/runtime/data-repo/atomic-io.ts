/**
 * Phase 0.2 — Atomic JSON file IO helpers.
 *
 * SPEC §5: "先写临时文件 → validate 通过 → 原子替换".
 * Backends use these helpers to keep on-disk state consistent across crashes:
 *   - read returns null when the file does not exist.
 *   - write streams to `.tmp-<rand>` then `rename`s into place.
 *   - On rename failure the .tmp file is removed; the previous file stays valid.
 */

import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"

const TMP_SUFFIX_BYTES = 8

export interface AtomicWriteOptions {
  readonly mode?: number
  /** When true, fsync via copyFile dance for paranoid durability. Default false. */
  readonly fsyncDir?: boolean
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (err) {
    if (isFileNotFoundError(err)) return false
    throw err
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const text = await readFile(filePath, "utf8")
    return JSON.parse(text) as T
  } catch (err) {
    if (isFileNotFoundError(err)) return null
    throw err
  }
}

export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch (err) {
    if (isFileNotFoundError(err)) return null
    throw err
  }
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`
  await writeTextFileAtomic(filePath, text, options)
}

export async function writeTextFileAtomic(
  filePath: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const tmpName = `.${base}.tmp-${randomBytes(TMP_SUFFIX_BYTES).toString("hex")}`
  const tmpPath = path.join(dir, tmpName)

  try {
    await writeFile(tmpPath, text, { encoding: "utf8", mode: options.mode })
    await rename(tmpPath, filePath)
  } catch (err) {
    // Best effort: clean up the partial tmp file before re-throwing.
    try {
      await rm(tmpPath, { force: true })
    } catch {
      // ignore — original error matters more
    }
    throw err
  }
}

export async function writeBinaryFileAtomic(
  filePath: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const tmpName = `.${base}.tmp-${randomBytes(TMP_SUFFIX_BYTES).toString("hex")}`
  const tmpPath = path.join(dir, tmpName)

  try {
    await writeFile(tmpPath, bytes, { mode: options.mode })
    await rename(tmpPath, filePath)
  } catch (err) {
    try {
      await rm(tmpPath, { force: true })
    } catch {
      // ignore
    }
    throw err
  }
}

export async function readBinaryFile(filePath: string): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(filePath)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch (err) {
    if (isFileNotFoundError(err)) return null
    throw err
  }
}

export function isFileNotFoundError(value: unknown): boolean {
  return (
    typeof value === "object"
    && value !== null
    && (value as { code?: string }).code === "ENOENT"
  )
}

/**
 * Helper to copy a file before mutation when caller wants to keep a
 * timestamped backup alongside the live file (e.g. after detecting corruption).
 */
export async function copyToTimestampedBackup(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) return null
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const target = path.join(dir, `${base}.invalid-${stamp}${ext}`)
  await copyFile(filePath, target)
  return target
}
