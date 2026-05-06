import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import type { CursorSyncResult, CursorAccountStatus, CursorValidateResult } from "./types"
import { validateCursorSession, fetchCursorUsageCsv } from "./api-client"
import {
  loadCredentialStore,
  saveCredentialStore,
  saveAccount,
  removeAccount as removeCredential,
  setActiveAccount as setActiveCredential,
  hasAccounts as hasStoredAccounts,
  sanitizeAccountIdForFilename,
  listAccounts,
} from "./credential-store"
import { createMainLogger } from "../../log-store"

const logger = createMainLogger("cursor-sync")

function getCacheDir(): string {
  return path.join(os.homedir(), ".config", "tokscale", "cursor-cache")
}

function ensureCacheDir(): string {
  const dir = getCacheDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  return dir
}

function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  const tmpPath = path.join(dir, `.tmp-${path.basename(filePath)}-${process.pid}`)
  fs.writeFileSync(tmpPath, content, { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
}

function countCsvRows(csv: string): number {
  const lines = csv.split("\n")
  // Subtract header and empty trailing line
  return lines.filter((l, i) => i > 0 && l.trim().length > 0).length
}

let syncInProgress = false

export async function syncAll(): Promise<CursorSyncResult> {
  if (syncInProgress) {
    return { synced: false, rows: 0, error: "Sync already in progress" }
  }
  syncInProgress = true
  try {
    return await doSync()
  } finally {
    syncInProgress = false
  }
}

async function doSync(): Promise<CursorSyncResult> {
  const store = loadCredentialStore()
  if (!store || Object.keys(store.accounts).length === 0) {
    return { synced: false, rows: 0, error: "Not authenticated" }
  }

  const cacheDir = ensureCacheDir()
  let totalRows = 0
  let successCount = 0
  const errors: string[] = []

  for (const [accountId, credentials] of Object.entries(store.accounts)) {
    const isActive = accountId === store.activeAccountId

    try {
      const csvText = await fetchCursorUsageCsv(credentials.sessionToken)
      const rowCount = countCsvRows(csvText)

      const fileName = isActive
        ? "usage.csv"
        : `usage.${sanitizeAccountIdForFilename(accountId)}.csv`
      const filePath = path.join(cacheDir, fileName)

      atomicWriteFile(filePath, csvText)
      totalRows += rowCount
      successCount++

      logger.info("Synced cursor account", { accountId, rows: rowCount })
    } catch (error) {
      const msg = `${accountId}: ${String(error instanceof Error ? error.message : error)}`
      errors.push(msg)
      logger.warn("Failed to sync cursor account", { accountId, error: String(error) })
    }
  }

  if (successCount === 0) {
    return {
      synced: false,
      rows: 0,
      error: errors[0] || "Cursor sync failed",
    }
  }

  return {
    synced: true,
    rows: totalRows,
    error: errors.length > 0
      ? `Some accounts failed (${errors.length}/${Object.keys(store.accounts).length})`
      : undefined,
  }
}

export async function addAccount(sessionToken: string, label?: string): Promise<{ accountId: string; error?: string }> {
  const validation = await validateCursorSession(sessionToken)
  if (!validation.valid) {
    return { accountId: "", error: validation.error || "Invalid session token" }
  }

  const accountId = saveAccount(sessionToken, label)
  logger.info("Added cursor account", { accountId, label })

  // Initial sync for this account
  try {
    const csvText = await fetchCursorUsageCsv(sessionToken)
    const cacheDir = ensureCacheDir()
    const filePath = path.join(cacheDir, "usage.csv")
    atomicWriteFile(filePath, csvText)
  } catch (error) {
    logger.warn("Initial sync failed after adding account", { error: String(error) })
  }

  return { accountId }
}

export function removeAccount(accountId: string): void {
  const store = loadCredentialStore()
  const wasActive = store?.activeAccountId === accountId

  removeCredential(accountId)

  // Clean up cached CSV
  const cacheDir = getCacheDir()
  if (fs.existsSync(cacheDir)) {
    const perAccountFile = path.join(cacheDir, `usage.${sanitizeAccountIdForFilename(accountId)}.csv`)
    if (fs.existsSync(perAccountFile)) {
      try { fs.unlinkSync(perAccountFile) } catch {}
    }
    if (wasActive) {
      const activeFile = path.join(cacheDir, "usage.csv")
      if (fs.existsSync(activeFile)) {
        try { fs.unlinkSync(activeFile) } catch {}
      }
    }
  }
}

export function setActiveAccount(accountId: string): void {
  const store = loadCredentialStore()
  if (!store || !store.accounts[accountId]) return

  const oldActiveId = store.activeAccountId
  if (oldActiveId === accountId) return

  const cacheDir = getCacheDir()
  if (fs.existsSync(cacheDir)) {
    const activeFile = path.join(cacheDir, "usage.csv")
    const oldAccountFile = path.join(cacheDir, `usage.${sanitizeAccountIdForFilename(oldActiveId)}.csv`)
    const newAccountFile = path.join(cacheDir, `usage.${sanitizeAccountIdForFilename(accountId)}.csv`)

    // Move current active → old account file
    if (fs.existsSync(activeFile)) {
      try { fs.renameSync(activeFile, oldAccountFile) } catch {}
    }
    // Move new account file → active
    if (fs.existsSync(newAccountFile)) {
      try { fs.renameSync(newAccountFile, activeFile) } catch {}
    }
  }

  setActiveCredential(accountId)
}

export function getStatus(): CursorAccountStatus[] {
  const accounts = listAccounts()
  return accounts.map(({ id, account, active }) => ({
    id,
    label: account.label,
    userId: account.userId,
    active,
    createdAt: account.createdAt,
    lastSyncAt: undefined, // Could track this in store if needed
  }))
}

export async function validate(sessionToken: string): Promise<CursorValidateResult> {
  return validateCursorSession(sessionToken)
}

export function hasAccounts(): boolean {
  return hasStoredAccounts()
}

export function getCsvFiles(): string[] {
  const cacheDir = getCacheDir()
  if (!fs.existsSync(cacheDir)) return []

  try {
    return fs.readdirSync(cacheDir)
      .filter((name) => {
        if (!name.startsWith("usage") || !name.endsWith(".csv")) return false
        if (name.startsWith("usage.backup")) return false
        return true
      })
      .map((name) => path.join(cacheDir, name))
  } catch {
    return []
  }
}
