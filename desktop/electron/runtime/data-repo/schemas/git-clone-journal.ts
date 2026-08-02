import type { Migration, NamespaceSchema } from "../types"

export interface GitCloneJournalEntryV1 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly tempPath: string
  readonly targetPath: string
  readonly createdAt: string
}

const migrations: readonly Migration[] = []

export const gitCloneJournalSchema: NamespaceSchema<GitCloneJournalEntryV1> = {
  name: "git.clone-journal",
  backend: "sqlite",
  currentVersion: 1,
  migrations,
  validate: isGitCloneJournalEntryV1,
  encrypted: false,
}

function isGitCloneJournalEntryV1(value: unknown): value is GitCloneJournalEntryV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entry = value as Partial<GitCloneJournalEntryV1>
  return entry.schemaVersion === 1
    && typeof entry.id === "string"
    && typeof entry.tempPath === "string"
    && typeof entry.targetPath === "string"
    && typeof entry.createdAt === "string"
}
