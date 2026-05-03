#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SEARCH_ROOTS = [
  ".codex",
  ".config",
  ".cursor",
  ".continue",
  ".claude",
].map((entry) => path.join(os.homedir(), entry))

const OLD_NAMES = [
  "listTables",
  "createTable",
  "dropTable",
  "describeTable",
  "databaseOverview",
  "operationLog",
  "batchInsert",
  "updateWhere",
  "deleteWhere",
  "readSQL",
  "rawSQL",
  "list_tables",
  "create_table",
  "drop_table",
  "describe_table",
  "database_overview",
  "operation_log",
  "batch_insert",
  "update_where",
  "delete_where",
  "read_sql",
  "raw_sql",
  "schedulerTaskRunsList",
  "schedulerTaskRuntimeStatus",
  "schedulerActionTypesList",
  "scheduler_task_runs_list",
  "scheduler_task_runtime_status",
  "scheduler_action_types_list",
  "synapse tables",
  "synapse operation-log",
  "synapse scheduler runs",
  "synapse scheduler status",
  "synapse scheduler actions",
]

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".js",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
  ".toml",
  ".txt",
])

function isTextCandidate(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath))
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      yield* walk(entryPath)
      continue
    }
    if (entry.isFile() && isTextCandidate(entryPath)) yield entryPath
  }
}

function inspectFile(filePath) {
  let content
  try {
    content = fs.readFileSync(filePath, "utf8")
  } catch {
    return []
  }
  return OLD_NAMES
    .filter((name) => content.includes(name))
    .map((name) => ({ filePath, name }))
}

const matches = []
for (const root of SEARCH_ROOTS) {
  for (const filePath of walk(root)) {
    matches.push(...inspectFile(filePath))
  }
}

if (matches.length === 0) {
  console.log("No old capability names found in user-local config candidates.")
  process.exit(0)
}

console.log("Old capability names found. Review these files manually:")
for (const match of matches) {
  console.log(`${match.filePath}: ${match.name}`)
}
