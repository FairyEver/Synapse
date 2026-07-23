import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { VersionedDataMigrator } from "@synapse/shared/versioned-data-migrator"
import { z } from "zod"

import { terminalStoreStateSchema, type TerminalStore, type TerminalStoreState } from "./store"

const LEGACY_BASELINE_VERSION = "0.0.0"
const TARGET_VERSION = "2.0.0"

const legacyGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sortOrder: z.number().int(),
  settings: z.object({
    defaultCwd: z.string().min(1).optional(),
    commands: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      command: z.string().min(1),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
    })).optional(),
    startupCommand: z.string().min(1).optional(),
  }).optional(),
})

const legacySessionSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  shell: z.string().min(1),
  status: z.enum(["running", "exited", "killed", "failed", "lost"]),
  exitCode: z.number().int().optional(),
  signal: z.number().int().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  lastOutputSeq: z.number().int().nonnegative(),
})

const legacyOutputSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  data: z.string(),
  createdAt: z.string().min(1),
  source: z.literal("pty"),
})

const legacyDocumentSchema = z.object({
  groups: z.array(legacyGroupSchema),
  sessions: z.array(legacySessionSchema),
  output: z.array(legacyOutputSchema),
})

type MigratedDocument = {
  meta: { schemaVersion: string }
  state: TerminalStoreState
}

export async function migrateLegacyTerminalState(options: {
  readonly baseDir: string
  readonly target: TerminalStore
  readonly targetIsEmpty: () => Promise<boolean>
}): Promise<"absent" | "already_migrated" | "migrated"> {
  const sourcePath = path.join(options.baseDir, "terminal-state.json")
  const markerPath = path.join(options.baseDir, "terminal-migration-v2.complete.json")
  try {
    await readFile(markerPath)
    return "already_migrated"
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  }

  let sourceBytes: Buffer
  try {
    sourceBytes = await readFile(sourcePath)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "absent"
    throw error
  }
  const sourceSha256 = digest(sourceBytes)
  if (!(await options.targetIsEmpty())) {
    await writeMarker(markerPath, sourceSha256, "target_already_populated")
    return "already_migrated"
  }

  const legacy = legacyDocumentSchema.parse(JSON.parse(sourceBytes.toString("utf8")))
  const migrated = VersionedDataMigrator.migrate<MigratedDocument>({
    source: { state: legacy as unknown as TerminalStoreState } as Omit<MigratedDocument, "meta">,
    sourceVersion: LEGACY_BASELINE_VERSION,
    targetVersion: TARGET_VERSION,
    legacyBaselineVersion: LEGACY_BASELINE_VERSION,
    migrations: {
      [TARGET_VERSION]: (document) => ({
        ...document,
        state: mapLegacyState(legacy),
      }),
    },
    validate(value): asserts value is MigratedDocument {
      if (!value || typeof value !== "object" || !("state" in value)) throw new Error("Missing migrated Terminal state")
      terminalStoreStateSchema.parse((value as { state: unknown }).state)
    },
  })

  await mkdir(options.baseDir, { recursive: true })
  const backupPath = path.join(options.baseDir, `terminal-state.${sourceSha256}.migration-v2.bak`)
  await copyFile(sourcePath, backupPath)
  const currentBytes = await readFile(sourcePath)
  if (digest(currentBytes) !== sourceSha256) throw new Error("Terminal legacy source changed during migration")
  await options.target.saveState(migrated.state)
  await writeMarker(markerPath, sourceSha256, "migrated")
  return "migrated"
}

export function withLegacyTerminalMigration(options: {
  readonly baseDir: string
  readonly target: TerminalStore
  readonly targetIsEmpty: () => Promise<boolean>
}): TerminalStore {
  return {
    async loadState() {
      await migrateLegacyTerminalState(options)
      return options.target.loadState()
    },
    saveState: (state) => options.target.saveState(state),
    get persistenceProtection() { return options.target.persistenceProtection },
  }
}

function mapLegacyState(legacy: z.infer<typeof legacyDocumentSchema>): TerminalStoreState {
  const groups = legacy.groups.map((group) => {
    const commands = [...(group.settings?.commands ?? [])].map((command) => ({
      ...command,
      commandRevision: 1,
    }))
    if (group.settings?.startupCommand && commands.length === 0) {
      commands.push({
        id: randomUUID(),
        name: "Legacy startup command",
        command: group.settings.startupCommand,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        commandRevision: 1,
      })
    }
    return {
      id: group.id,
      name: group.name,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      sortOrder: group.sortOrder,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
      settings: {
        ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
        ...(commands.length ? { commands } : {}),
      },
    }
  })
  const sessions = legacy.sessions.map((session) => {
    const mapped = mapLegacyLifecycle(session.status)
    return {
      ...session,
      status: mapped.lifecycle,
      endCause: mapped.cause,
      endTimeUnknown: !session.endedAt,
      metadataRevision: 1,
      stateRevision: 1,
      inputRevision: 0,
      inputHistoryBeforeBaselineUnknown: true,
      sizeRevision: 1,
      creationSource: "legacy_unknown" as const,
      launchRevisionApplied: null,
      discardedOutputBytes: 0,
      discardedOutputChunks: 0,
      attention: {
        state: "unknown" as const,
        kind: "unknown" as const,
        reason: "legacy_unclassified",
        confidence: 0,
        detectedAt: session.updatedAt,
        throughOutputSeq: session.lastOutputSeq,
        sizeRevision: 1,
        detectorId: "legacy-none",
        detectorVersion: "0.0.0",
      },
    }
  })
  return terminalStoreStateSchema.parse({
    groups,
    sessions,
    output: legacy.output,
    terminalDomainRevision: 1,
    operations: [],
    idempotency: [],
  })
}

function mapLegacyLifecycle(status: z.infer<typeof legacySessionSchema>["status"]): {
  lifecycle: "ended" | "failed" | "lost"
  cause: string
} {
  switch (status) {
    case "running": return { lifecycle: "lost", cause: "legacy_runtime_unrecoverable_after_restart" }
    case "exited": return { lifecycle: "ended", cause: "legacy_process_exit" }
    case "killed": return { lifecycle: "ended", cause: "legacy_killed_unclassified" }
    case "failed": return { lifecycle: "failed", cause: "legacy_infrastructure_failure_unclassified" }
    case "lost": return { lifecycle: "lost", cause: "legacy_runtime_lost" }
  }
}

async function writeMarker(filePath: string, sourceSha256: string, outcome: string): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, sourceSha256, outcome, completedAt: new Date().toISOString() }), { mode: 0o600 })
  await rename(temporary, filePath)
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
