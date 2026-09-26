#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RISK_PATTERNS = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "DELETE FROM", pattern: /\bDELETE\s+FROM\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "DROP TYPE", pattern: /\bDROP\s+TYPE\b/i },
  { label: "ALTER TABLE DROP", pattern: /\bALTER\s+TABLE\b.*\bDROP\b/i },
  { label: "CREATE UNIQUE INDEX", pattern: /\bCREATE\s+UNIQUE\s+INDEX\b/i },
  { label: "ADD UNIQUE CONSTRAINT", pattern: /\bADD\s+CONSTRAINT\b.*\bUNIQUE\b/i },
  { label: "SET NOT NULL", pattern: /\bALTER\s+COLUMN\b.*\bSET\s+NOT\s+NULL\b/i },
  { label: "ADD NOT NULL COLUMN", pattern: /\bADD\s+COLUMN\b.*\bNOT\s+NULL\b/i },
]

function usage() {
  console.error("Usage: node scripts/deploy/check-prisma-migration-risk.mjs --migrations-dir <dir> --applied-file <file>")
}

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) {
      usage()
      process.exit(2)
    }
    args.set(key, value)
  }
  return {
    migrationsDir: args.get("--migrations-dir"),
    appliedFile: args.get("--applied-file"),
  }
}

function readAppliedMigrations(appliedFile) {
  return new Set(
    readFileSync(appliedFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
}

function listPendingMigrationFiles(migrationsDir, appliedMigrations) {
  return readdirSync(migrationsDir)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .flatMap((entry) => {
      if (appliedMigrations.has(entry)) return []
      const migrationDir = join(migrationsDir, entry)
      if (!statSync(migrationDir).isDirectory()) return []
      return [{ name: entry, file: join(migrationDir, "migration.sql") }]
    })
}

function stripLineComment(line) {
  return line.replace(/--.*$/, "")
}

function collectStatements(lines) {
  const statements = []
  let current = []
  let startLine = 1

  lines.forEach((line, index) => {
    const sql = stripLineComment(line).trim()
    if (!sql && current.length === 0) return

    if (current.length === 0) {
      startLine = index + 1
    }

    if (sql) current.push(sql)

    if (sql.includes(";")) {
      statements.push({ line: startLine, sql: current.join(" ").replace(/\s+/g, " ").trim() })
      current = []
    }
  })

  if (current.length > 0) {
    statements.push({ line: startLine, sql: current.join(" ").replace(/\s+/g, " ").trim() })
  }

  return statements
}

function scanMigration(migration, migrationsDir) {
  const lines = readFileSync(migration.file, "utf8").split(/\r?\n/)
  const risks = []

  collectStatements(lines).forEach((statement) => {
    for (const rule of RISK_PATTERNS) {
      if (rule.pattern.test(statement.sql)) {
        risks.push({
          label: rule.label,
          location: `${relative(migrationsDir, migration.file)}:${statement.line}`,
          sql: statement.sql,
        })
      }
    }
  })

  return risks
}

function printPendingMigrations(log, pendingMigrations) {
  log(`Pending Prisma migrations (${pendingMigrations.length}):`)
  for (const migration of pendingMigrations) {
    log(`  - ${migration.name}`)
  }
}

const { migrationsDir, appliedFile } = parseArgs(process.argv.slice(2))

if (!migrationsDir || !appliedFile) {
  usage()
  process.exit(2)
}

const appliedMigrations = readAppliedMigrations(appliedFile)
const pendingMigrations = listPendingMigrationFiles(migrationsDir, appliedMigrations)
const risks = pendingMigrations.flatMap((migration) => scanMigration(migration, migrationsDir))

if (pendingMigrations.length === 0) {
  console.log("No pending Prisma migrations.")
  process.exit(0)
}

if (risks.length === 0) {
  printPendingMigrations(console.log, pendingMigrations)
  console.log(`Pending Prisma migrations passed risk scan (${pendingMigrations.length}).`)
  process.exit(0)
}

console.error("Risky Prisma migrations detected.")
printPendingMigrations(console.error, pendingMigrations)
console.error(`Risk count: ${risks.length}`)
for (const risk of risks) {
  console.error(`${risk.location}: ${risk.label}: ${risk.sql}`)
}

// 默认严格：检测到风险迁移就失败。
//
// 原来这里是默认放行、要显式设 STRICT_MIGRATION_RISK_SCAN=1 才失败。那个默认是错的：
// 部署流程里虽然会在临时库上预演迁移，但危险迁移（DROP COLUMN / SET NOT NULL 等）
// 在小库上跑通，不代表线上大表执行没风险——预演只能证明语法和依赖可行，
// 证明不了锁表时长与数据丢失。安全的方向是失败，而不是继续。
//
// ALLOW_RISKY_MIGRATIONS=1 是有意保留的例外出口，用之前必须逐条看过上面的风险清单。
if (process.env.ALLOW_RISKY_MIGRATIONS === "1") {
  console.error("Risk scan policy: continuing because ALLOW_RISKY_MIGRATIONS=1.")
  process.exit(0)
}

console.error("Risk scan policy: failing on risky migrations.")
console.error("Review each risk above, then set ALLOW_RISKY_MIGRATIONS=1 only to override deliberately.")
process.exit(1)
