import type { Dirent } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { DragonScaleAddress, DragonScaleAddressServiceResult } from "./types"

export class DragonScaleAddressService {
  private readonly locks = new Map<string, Promise<void>>()

  async allocate(vaultPath: string): Promise<DragonScaleAddressServiceResult> {
    return this.withVaultLock(vaultPath, async () => {
      const counterPath = await this.ensureCounter(vaultPath)
      const current = await this.readCounter(counterPath)
      await writeFile(counterPath, `${current + 1}\n`, "utf8")
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
      await writeFile(path.join(metaPath, "address-counter.txt"), `${next}\n`, "utf8")
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
    await writeFile(counterPath, `${next}\n`, "utf8")
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
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    this.locks.set(key, queued)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.locks.get(key) === queued) {
        this.locks.delete(key)
      }
    }
  }
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
