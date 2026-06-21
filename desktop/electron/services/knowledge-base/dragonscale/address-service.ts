import { createHash, randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { atomicWriteTextFile } from "../atomic-write"
import type { DragonScaleAddress, DragonScaleAddressServiceResult } from "./types"

const vaultLocks = new Map<string, Promise<void>>()
const LOCK_OWNER_FILE = "owner"

export interface DragonScaleAddressServiceOptions {
  readonly lockRoot?: string
  readonly lockTimeoutMs?: number
  readonly lockRetryMs?: number
}

export class DragonScaleAddressService {
  private readonly lockRoot: string | undefined
  private readonly lockTimeoutMs: number
  private readonly lockRetryMs: number

  constructor(options: DragonScaleAddressServiceOptions = {}) {
    this.lockRoot = options.lockRoot
    this.lockTimeoutMs = options.lockTimeoutMs ?? 30_000
    this.lockRetryMs = options.lockRetryMs ?? 50
  }

  async allocate(vaultPath: string): Promise<DragonScaleAddressServiceResult> {
    return this.withVaultLock(vaultPath, async () => {
      const counterPath = await this.ensureCounter(vaultPath)
      const current = await this.readCounter(counterPath)
      await atomicWriteTextFile(counterPath, `${current + 1}\n`)
      return { address: formatAddress(current), counterPath }
    })
  }

  async peek(vaultPath: string): Promise<number> {
    return this.withVaultLock(vaultPath, async () => {
      const counterPath = path.join(vaultPath, ".vault-meta", "address-counter.txt")
      try {
        return await this.readCounter(counterPath)
      } catch (error) {
        if (isMissingPathError(error)) return this.recoverNextCounter(vaultPath)
        throw error
      }
    })
  }

  async rebuild(vaultPath: string): Promise<number> {
    return this.withVaultLock(vaultPath, async () => {
      const next = await this.recoverNextCounter(vaultPath)
      const metaPath = path.join(vaultPath, ".vault-meta")
      await mkdir(metaPath, { recursive: true })
      await atomicWriteTextFile(path.join(metaPath, "address-counter.txt"), `${next}\n`)
      return next
    })
  }

  private async ensureCounter(vaultPath: string): Promise<string> {
    const metaPath = path.join(vaultPath, ".vault-meta")
    const counterPath = path.join(metaPath, "address-counter.txt")
    await mkdir(metaPath, { recursive: true })
    try {
      await readFile(counterPath, "utf8")
      return counterPath
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
    const next = await this.recoverNextCounter(vaultPath)
    await atomicWriteTextFile(counterPath, `${next}\n`)
    return counterPath
  }

  private async readCounter(counterPath: string): Promise<number> {
    const raw = (await readFile(counterPath, "utf8")).trim()
    if (!/^[0-9]+$/.test(raw)) {
      throw new Error("DragonScale address counter is corrupt.")
    }
    return Number(raw)
  }

  private async recoverNextCounter(vaultPath: string): Promise<number> {
    const wikiPath = path.join(vaultPath, "wiki")
    const addresses = await scanMarkdownAddresses(wikiPath)
    const max = addresses.reduce((current, address) => Math.max(current, Number(address.slice(2))), 0)
    return max + 1
  }

  private async withVaultLock<T>(vaultPath: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(vaultPath)
    const previous = vaultLocks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    vaultLocks.set(key, queued)
    await previous.catch(() => undefined)
    let releaseFileLock: (() => Promise<void>) | undefined
    try {
      releaseFileLock = await acquireDragonScaleAddressFileLock(vaultPath, {
        lockRoot: this.lockRoot,
        timeoutMs: this.lockTimeoutMs,
        retryMs: this.lockRetryMs,
      })
      return await work()
    } finally {
      try {
        await releaseFileLock?.()
      } finally {
        release()
        if (vaultLocks.get(key) === queued) {
          vaultLocks.delete(key)
        }
      }
    }
  }
}

export function dragonScaleAddressLockPath(
  vaultPath: string,
  options: { readonly lockRoot?: string } = {},
): string {
  if (!options.lockRoot) {
    return path.join(vaultPath, ".vault-meta", ".address.lock.d")
  }
  const lockRoot = options.lockRoot
  const key = createHash("sha256").update(path.resolve(vaultPath)).digest("hex")
  return path.join(lockRoot, `${key}.lock`)
}

class DragonScaleAddressLockTimeoutError extends Error {
  constructor(vaultPath: string) {
    super(`Timed out waiting for DragonScale address lock: ${vaultPath}`)
    this.name = "DragonScaleAddressLockTimeoutError"
  }
}

export async function acquireDragonScaleAddressFileLock(
  vaultPath: string,
  options: {
    readonly lockRoot?: string
    readonly ownerId?: string
    readonly timeoutMs: number
    readonly retryMs: number
  },
): Promise<() => Promise<void>> {
  const lockPath = dragonScaleAddressLockPath(vaultPath, { lockRoot: options.lockRoot })
  await mkdir(path.dirname(lockPath), { recursive: true })
  const startedAt = Date.now()
  const ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`
  while (true) {
    try {
      await mkdir(lockPath)
      try {
        await writeFile(path.join(lockPath, LOCK_OWNER_FILE), `${ownerId}\n`, { flag: "wx" })
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true })
        throw error
      }
      return async () => {
        const lockOwner = await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8")
          .catch((error) => {
            if (isMissingPathError(error)) return null
            throw error
          })
        if (lockOwner?.trim() !== ownerId) return
        await rm(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      if (!isPathExistsError(error)) throw error
      if (await removeStaleDragonScaleAddressFileLock(lockPath)) {
        continue
      }
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new DragonScaleAddressLockTimeoutError(vaultPath)
      }
      await delay(options.retryMs)
    }
  }
}

async function removeStaleDragonScaleAddressFileLock(lockPath: string): Promise<boolean> {
  const lockOwner = await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8")
    .catch((error) => {
      if (isMissingPathError(error)) return null
      throw error
    })
  const ownerPid = parseLockOwnerPid(lockOwner)
  if (ownerPid === null || isProcessAlive(ownerPid)) return false
  await rm(lockPath, { recursive: true, force: true })
  return true
}

function parseLockOwnerPid(owner: string | null): number | null {
  const match = owner?.trim().match(/^([1-9][0-9]*):/u)
  if (!match?.[1]) return null
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) ? pid : null
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { readonly code?: unknown }).code === "ESRCH") {
      return false
    }
    return true
  }
}

function isPathExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "EEXIST"
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function scanMarkdownAddresses(directoryPath: string): Promise<DragonScaleAddress[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const addresses: DragonScaleAddress[] = []
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      addresses.push(...await scanMarkdownAddresses(entryPath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const frontmatter = firstFrontmatterBlock(await readFile(entryPath, "utf8"))
    const match = frontmatter.match(/^address:\s+(c-[0-9]{6})\s*$/m)
    if (match?.[1]) addresses.push(match[1] as DragonScaleAddress)
  }
  return addresses
}

function firstFrontmatterBlock(content: string): string {
  if (!content.startsWith("---\n")) return ""
  const end = content.indexOf("\n---", 4)
  return end === -1 ? "" : content.slice(4, end)
}

function formatAddress(value: number): DragonScaleAddress {
  return `c-${String(value).padStart(6, "0")}` as DragonScaleAddress
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
