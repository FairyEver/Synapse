import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import type { CursorAccount, CursorCredentialStore } from "./types"
import { createMainLogger } from "../../log-store"

const logger = createMainLogger("cursor-credentials")

function getCredentialsPath(): string {
  return path.join(os.homedir(), ".config", "tokscale", "cursor-credentials.json")
}

function getLegacyCredentialsPath(): string {
  return path.join(os.homedir(), ".tokscale", "cursor-credentials.json")
}

function extractUserIdFromToken(token: string): string | undefined {
  const trimmed = token.trim()
  if (trimmed.includes("%3A%3A")) {
    const userId = trimmed.split("%3A%3A")[0]?.trim()
    return userId || undefined
  }
  if (trimmed.includes("::")) {
    const userId = trimmed.split("::")[0]?.trim()
    return userId || undefined
  }
  return undefined
}

function deriveAccountId(sessionToken: string): string {
  const userId = extractUserIdFromToken(sessionToken)
  if (userId) return userId
  const hash = crypto.createHash("sha256").update(sessionToken).digest("hex")
  return `anon-${hash.slice(0, 12)}`
}

function sanitizeAccountIdForFilename(accountId: string): string {
  const sanitized = accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return sanitized || "account"
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

export function loadCredentialStore(): CursorCredentialStore | null {
  const mainPath = getCredentialsPath()
  const legacyPath = getLegacyCredentialsPath()
  const readPath = fs.existsSync(mainPath) ? mainPath : fs.existsSync(legacyPath) ? legacyPath : null

  if (!readPath) return null

  try {
    const content = fs.readFileSync(readPath, "utf-8")
    const parsed = JSON.parse(content)

    // v1 multi-account format
    if (parsed.version === 1 && parsed.accounts && typeof parsed.accounts === "object") {
      const store = parsed as CursorCredentialStore
      // Migrate from legacy path if needed
      if (readPath !== mainPath) {
        saveCredentialStore(store)
        try { fs.unlinkSync(readPath) } catch {}
      }
      return store
    }

    // Legacy single-account format (tokscale migration)
    if (parsed.sessionToken && typeof parsed.sessionToken === "string") {
      const accountId = deriveAccountId(parsed.sessionToken)
      const store: CursorCredentialStore = {
        version: 1,
        activeAccountId: accountId,
        accounts: {
          [accountId]: {
            sessionToken: parsed.sessionToken,
            userId: parsed.userId || extractUserIdFromToken(parsed.sessionToken),
            createdAt: parsed.createdAt || new Date().toISOString(),
            expiresAt: parsed.expiresAt,
            label: parsed.label,
          },
        },
      }
      saveCredentialStore(store)
      if (readPath !== mainPath) {
        try { fs.unlinkSync(readPath) } catch {}
      }
      return store
    }

    return null
  } catch (error) {
    logger.error("Failed to load cursor credentials", { error: String(error) })
    return null
  }
}

export function saveCredentialStore(store: CursorCredentialStore): void {
  const filePath = getCredentialsPath()
  atomicWriteFile(filePath, JSON.stringify(store, null, 2))
}

export function listAccounts(): Array<{ id: string; account: CursorAccount; active: boolean }> {
  const store = loadCredentialStore()
  if (!store) return []
  return Object.entries(store.accounts).map(([id, account]) => ({
    id,
    account,
    active: id === store.activeAccountId,
  }))
}

export function getActiveCredentials(): { id: string; account: CursorAccount } | null {
  const store = loadCredentialStore()
  if (!store) return null
  const account = store.accounts[store.activeAccountId]
  if (!account) return null
  return { id: store.activeAccountId, account }
}

export function saveAccount(sessionToken: string, label?: string): string {
  const accountId = deriveAccountId(sessionToken)
  const userId = extractUserIdFromToken(sessionToken)

  let store = loadCredentialStore()
  if (!store) {
    store = { version: 1, activeAccountId: accountId, accounts: {} }
  }

  store.accounts[accountId] = {
    sessionToken,
    userId,
    createdAt: new Date().toISOString(),
    label,
  }
  store.activeAccountId = accountId
  saveCredentialStore(store)
  return accountId
}

export function removeAccount(accountId: string): void {
  const store = loadCredentialStore()
  if (!store) return

  delete store.accounts[accountId]

  if (Object.keys(store.accounts).length === 0) {
    const filePath = getCredentialsPath()
    try { fs.unlinkSync(filePath) } catch {}
    return
  }

  if (store.activeAccountId === accountId) {
    store.activeAccountId = Object.keys(store.accounts)[0]!
  }
  saveCredentialStore(store)
}

export function setActiveAccount(accountId: string): void {
  const store = loadCredentialStore()
  if (!store || !store.accounts[accountId]) return
  store.activeAccountId = accountId
  saveCredentialStore(store)
}

export function hasAccounts(): boolean {
  const store = loadCredentialStore()
  return !!store && Object.keys(store.accounts).length > 0
}

export { sanitizeAccountIdForFilename, deriveAccountId }
