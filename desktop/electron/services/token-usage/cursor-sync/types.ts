export interface CursorAccount {
  sessionToken: string
  userId?: string
  createdAt: string
  expiresAt?: string
  label?: string
}

export interface CursorCredentialStore {
  version: 1
  activeAccountId: string
  accounts: Record<string, CursorAccount>
}

export interface CursorSyncResult {
  synced: boolean
  rows: number
  error?: string
}

export interface CursorValidateResult {
  valid: boolean
  membershipType?: string
  error?: string
}

export interface CursorAccountStatus {
  id: string
  label?: string
  userId?: string
  active: boolean
  createdAt: string
  lastSyncAt?: string
}
