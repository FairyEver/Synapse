import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const repositoryRoot = join(process.cwd(), "..")
const scriptPath = join(repositoryRoot, "scripts/deploy/check-prisma-migration-risk.mjs")

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeWorkspace(): { dir: string, migrationsDir: string, appliedFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "synapse-migration-risk-"))
  tempDirs.push(dir)
  const migrationsDir = join(dir, "migrations")
  const appliedFile = join(dir, "applied.txt")
  mkdirSync(migrationsDir, { recursive: true })
  writeFileSync(appliedFile, "")
  return { dir, migrationsDir, appliedFile }
}

function writeMigration(migrationsDir: string, name: string, sql: string): void {
  const migrationDir = join(migrationsDir, name)
  mkdirSync(migrationDir, { recursive: true })
  writeFileSync(join(migrationDir, "migration.sql"), sql)
}

function runRiskScan(
  migrationsDir: string,
  appliedFile: string,
  env: NodeJS.ProcessEnv = {},
): { status: number, output: string } {
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--migrations-dir", migrationsDir, "--applied-file", appliedFile],
    { env: { ...process.env, ...env }, encoding: "utf8" },
  )
  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}

describe("Prisma migration deployment risk scanner", () => {
  it("ignores already applied risky migrations", () => {
    const { migrationsDir, appliedFile } = makeWorkspace()
    writeMigration(migrationsDir, "20260601000000_drop_old_table", 'DROP TABLE "OldThing";')
    writeFileSync(appliedFile, "20260601000000_drop_old_table\n")

    const result = runRiskScan(migrationsDir, appliedFile)

    expect(result.status).toBe(0)
    expect(result.output).toContain("No pending Prisma migrations")
  })

  it("allows pending migrations without destructive SQL", () => {
    const { migrationsDir, appliedFile } = makeWorkspace()
    writeMigration(migrationsDir, "20260601000000_add_profile", 'ALTER TABLE "User" ADD COLUMN "displayName" TEXT;')

    const result = runRiskScan(migrationsDir, appliedFile)

    expect(result.status).toBe(0)
    expect(result.output).toContain("Pending Prisma migrations passed risk scan")
  })

  it("blocks destructive pending migrations by default with file and line details", () => {
    const { migrationsDir, appliedFile } = makeWorkspace()
    writeMigration(migrationsDir, "20260601000000_drop_old_table", [
      'ALTER TABLE "User" ADD COLUMN "nickname" TEXT;',
      'DROP TABLE "OldThing";',
    ].join("\n"))

    const result = runRiskScan(migrationsDir, appliedFile)

    expect(result.status).toBe(1)
    expect(result.output).toContain("Risky Prisma migrations detected")
    expect(result.output).toContain("20260601000000_drop_old_table/migration.sql:2")
    expect(result.output).toContain("DROP TABLE")
    expect(result.output).toContain("ALLOW_RISKY_MIGRATIONS=1")
  })

  it("blocks risky not-null column additions that span multiple lines", () => {
    const { migrationsDir, appliedFile } = makeWorkspace()
    writeMigration(migrationsDir, "20260601000000_add_required_name", [
      'ALTER TABLE "User"',
      '  ADD COLUMN "requiredName" TEXT',
      "  NOT NULL;",
    ].join("\n"))

    const result = runRiskScan(migrationsDir, appliedFile)

    expect(result.status).toBe(1)
    expect(result.output).toContain("20260601000000_add_required_name/migration.sql:1")
    expect(result.output).toContain("ADD NOT NULL COLUMN")
  })

  it("allows explicitly approved risky migrations while keeping the warning output", () => {
    const { migrationsDir, appliedFile } = makeWorkspace()
    writeMigration(migrationsDir, "20260601000000_unique_email", 'CREATE UNIQUE INDEX "User_email_key" ON "User"("email");')

    const result = runRiskScan(migrationsDir, appliedFile, { ALLOW_RISKY_MIGRATIONS: "1" })

    expect(result.status).toBe(0)
    expect(result.output).toContain("Risky Prisma migrations detected")
    expect(result.output).toContain("continuing because ALLOW_RISKY_MIGRATIONS=1")
  })
})
