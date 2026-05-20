#!/usr/bin/env node

import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const VERSION = "2026-05-20.1"
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DEPTH = 8
const REPORT_TOP_N = 25

const home = os.homedir()
let args
let now
let targetDate
let targetStart
let targetEnd
let since7d
let claudeProjectsRoot
let outDir

function main() {
  args = parseArgs(process.argv.slice(2))
  now = new Date()
  targetDate = args.date || localDateKey(now.getTime())
  targetStart = new Date(`${targetDate}T00:00:00`)
  targetEnd = new Date(targetStart.getTime() + DAY_MS - 1)
  since7d = new Date(targetStart.getTime() - 6 * DAY_MS)
  claudeProjectsRoot = args.claudeRoot || path.join(home, ".claude", "projects")
  outDir = args.out || defaultOutputDir()

  const report = {
    meta: {
      version: VERSION,
      generatedAt: now.toISOString(),
      targetDate,
      localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      hostnameHash: hash(os.hostname()),
    },
    inputs: {
      claudeProjectsRootExists: existsDir(claudeProjectsRoot),
      claudeProjectsRoot: redactHome(claudeProjectsRoot),
      synapseUsageDbCandidates: [],
    },
    rawClaudeLogs: null,
    synapseUsageDb: null,
    notes: [
      "This report is metadata-only. It does not include user/assistant message text, tool input, tool output, or file contents.",
      "Token total in Synapse currently means input + output + cacheRead + cacheWrite + reasoning.",
    ],
  }

  const raw = scanClaudeLogs(claudeProjectsRoot)
  report.rawClaudeLogs = summarizeRaw(raw)

  const dbCandidates = findUsageDbCandidates()
  report.inputs.synapseUsageDbCandidates = dbCandidates.map((candidate) => ({
    path: redactHome(candidate),
    exists: existsFile(candidate),
    sizeBytes: existsFile(candidate) ? fs.statSync(candidate).size : 0,
  }))
  report.synapseUsageDb = inspectSynapseDb(dbCandidates)

  fs.mkdirSync(outDir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(outDir, `synapse-cc-usage-diagnostic-${stamp}.json`)
  const txtPath = path.join(outDir, `synapse-cc-usage-diagnostic-${stamp}.txt`)

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(txtPath, renderTextReport(report))

  console.log(`Wrote JSON report: ${jsonPath}`)
  console.log(`Wrote TXT report:  ${txtPath}`)
  console.log("Please send both files back for analysis.")
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--date") parsed.date = argv[++index]
    else if (arg === "--out") parsed.out = argv[++index]
    else if (arg === "--claude-root") parsed.claudeRoot = argv[++index]
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: node diagnose-cc-usage.mjs [--date YYYY-MM-DD] [--out DIR] [--claude-root DIR]",
        "",
        "Default date is today in local time. Default output directory is Desktop if available.",
      ].join("\n"))
      process.exit(0)
    }
  }
  if (parsed.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    throw new Error("--date must be YYYY-MM-DD")
  }
  return parsed
}

function scanClaudeLogs(root) {
  const files = collectJsonlFiles(root)
  const totals = zeroStats()
  const today = zeroStats()
  const last7d = zeroStats()
  const byHour = new Map()
  const byDate = new Map()
  const byModelToday = new Map()
  const byWorkspaceToday = new Map()
  const byFileToday = new Map()
  const bySessionToday = new Map()
  const topEventsToday = new TopList(REPORT_TOP_N, (item) => item.tokens.total)
  const topEventsAll = new TopList(REPORT_TOP_N, (item) => item.tokens.total)
  const duplicateIds = new Map()
  const seenIds = new Map()
  const lineShape = {
    files: files.length,
    lines: 0,
    jsonParseErrors: 0,
    userLines: 0,
    assistantLines: 0,
    assistantUsageLines: 0,
    assistantUsageMissingTimestamp: 0,
    assistantUsageInvalidTimestamp: 0,
    assistantUsageFutureTimestamp: 0,
    assistantUsageWithoutMessageId: 0,
    toolUseBlocks: 0,
  }

  for (const file of files) {
    let content = ""
    let stat
    try {
      stat = fs.statSync(file)
      content = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    const workspace = workspaceFromClaudePath(file)
    const fileKey = hash(file)
    const lines = content.split(/\n/)

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line.trim()) continue
      lineShape.lines += 1

      let raw
      try {
        raw = JSON.parse(line)
      } catch {
        lineShape.jsonParseErrors += 1
        continue
      }

      if (raw?.type === "user") {
        lineShape.userLines += 1
        continue
      }
      if (raw?.type !== "assistant") continue
      lineShape.assistantLines += 1

      const message = asRecord(raw.message)
      const usage = asRecord(message?.usage)
      const model = typeof message?.model === "string" && message.model ? message.model : ""
      if (!usage || !model) continue
      lineShape.assistantUsageLines += 1

      const parsedTimestamp = parseTimestamp(raw.timestamp, stat.mtimeMs)
      if (typeof raw.timestamp !== "string") lineShape.assistantUsageMissingTimestamp += 1
      if (typeof raw.timestamp === "string" && !Number.isFinite(Date.parse(raw.timestamp))) lineShape.assistantUsageInvalidTimestamp += 1
      if (parsedTimestamp > now.getTime() + 60_000) lineShape.assistantUsageFutureTimestamp += 1

      const contentBlocks = Array.isArray(message.content) ? message.content : []
      const toolUseCount = contentBlocks.filter((block) => asRecord(block)?.type === "tool_use").length
      lineShape.toolUseBlocks += toolUseCount

      const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : path.basename(file, ".jsonl")
      const messageId = typeof message.id === "string" && message.id ? message.id : ""
      if (!messageId) lineShape.assistantUsageWithoutMessageId += 1
      const eventId = `${sessionId}:usage:${messageId || `line-${index + 1}`}`
      const previous = seenIds.get(eventId)
      if (previous) {
        duplicateIds.set(eventId, {
          idHash: hash(eventId),
          first: previous,
          second: { fileHash: fileKey, line: index + 1 },
        })
      } else {
        seenIds.set(eventId, { fileHash: fileKey, line: index + 1 })
      }

      const tokens = {
        input: positiveNumber(usage.input_tokens),
        output: positiveNumber(usage.output_tokens),
        cacheRead: positiveNumber(usage.cache_read_input_tokens),
        cacheWrite: positiveNumber(usage.cache_creation_input_tokens),
        reasoning: extractReasoningTokens(contentBlocks),
      }
      tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning
      tokens.nonCacheReadTotal = tokens.input + tokens.output + tokens.cacheWrite + tokens.reasoning

      const event = {
        timestamp: new Date(parsedTimestamp).toISOString(),
        date: localDateKey(parsedTimestamp),
        hour: localHourKey(parsedTimestamp),
        model,
        workspaceHash: workspace.keyHash,
        workspaceBasename: workspace.basename,
        sessionHash: hash(sessionId),
        fileHash: fileKey,
        fileMtime: new Date(stat.mtimeMs).toISOString(),
        line: index + 1,
        tokens,
        toolUseCount,
      }

      addStats(totals, event)
      addStats(getOrCreateStats(byDate, event.date), event)
      addStats(getOrCreateStats(byHour, event.hour), event)
      topEventsAll.add(redactEvent(event))

      if (parsedTimestamp >= since7d.getTime() && parsedTimestamp <= targetEnd.getTime()) {
        addStats(last7d, event)
      }
      if (event.date === targetDate && parsedTimestamp <= now.getTime()) {
        addStats(today, event)
        addStats(getOrCreateStats(byModelToday, model), event)
        addStats(getOrCreateStats(byWorkspaceToday, `${workspace.keyHash}:${workspace.basename}`), event)
        addStats(getOrCreateStats(byFileToday, fileKey), event)
        addStats(getOrCreateStats(bySessionToday, hash(sessionId)), event)
        topEventsToday.add(redactEvent(event))
      }
    }
  }

  return {
    lineShape,
    totals,
    today,
    last7d,
    byDate,
    byHour,
    byModelToday,
    byWorkspaceToday,
    byFileToday,
    bySessionToday,
    topEventsToday,
    topEventsAll,
    duplicateIds,
  }
}

function summarizeRaw(raw) {
  const targetHours = mapToRows(raw.byHour, "hour")
    .filter((row) => row.hour.startsWith(`${targetDate} `))
    .sort((left, right) => left.hour.localeCompare(right.hour))
  const recentHour = [...targetHours].filter((row) => row.requests > 0).at(-1) || null

  return {
    lineShape: raw.lineShape,
    totals: finishStats(raw.totals),
    targetDate: finishStats(raw.today),
    last7d: finishStats(raw.last7d),
    recentActiveHour: recentHour,
    targetDateHours: targetHours,
    topHoursAllTime: mapToRows(raw.byHour, "hour").sort(byTokensDesc).slice(0, REPORT_TOP_N),
    last7dByDate: mapToRows(raw.byDate, "date")
      .filter((row) => row.date >= localDateKey(since7d.getTime()) && row.date <= targetDate)
      .sort((left, right) => left.date.localeCompare(right.date)),
    targetDateTopModels: mapToRows(raw.byModelToday, "model").sort(byTokensDesc).slice(0, REPORT_TOP_N),
    targetDateTopWorkspaces: mapToRows(raw.byWorkspaceToday, "workspace").sort(byTokensDesc).slice(0, REPORT_TOP_N),
    targetDateTopFiles: mapToRows(raw.byFileToday, "fileHash").sort(byTokensDesc).slice(0, REPORT_TOP_N),
    targetDateTopSessions: mapToRows(raw.bySessionToday, "sessionHash").sort(byTokensDesc).slice(0, REPORT_TOP_N),
    targetDateTopEvents: raw.topEventsToday.values().sort((a, b) => b.tokens.total - a.tokens.total),
    allTimeTopEvents: raw.topEventsAll.values().sort((a, b) => b.tokens.total - a.tokens.total),
    duplicateUsageEventIds: {
      count: raw.duplicateIds.size,
      samples: [...raw.duplicateIds.values()].slice(0, REPORT_TOP_N),
    },
  }
}

function inspectSynapseDb(candidates) {
  const sqlite = findExecutable("sqlite3")
  const existing = candidates.find(existsFile)
  if (!existing) {
    return {
      available: false,
      reason: "usage.db not found in common Synapse app data paths",
      sqlite3Available: Boolean(sqlite),
    }
  }
  if (!sqlite) {
    return {
      available: false,
      reason: "sqlite3 command not found",
      sqlite3Available: false,
      path: redactHome(existing),
      sizeBytes: fs.statSync(existing).size,
    }
  }

  const queries = {
    tables: "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cc_%' ORDER BY name;",
    ccCounts: [
      "SELECT",
      "  (SELECT COUNT(*) FROM cc_usage_events) AS usage_events,",
      "  (SELECT COUNT(*) FROM cc_tool_events) AS tool_events,",
      "  (SELECT COUNT(*) FROM cc_sessions) AS sessions,",
      "  (SELECT COUNT(*) FROM cc_scan_files) AS scan_files;",
    ].join("\n"),
    targetDateTotals: usageTotalsSql("date = '" + escapeSql(targetDate) + "'"),
    targetDateHours: [
      "SELECT hour, COUNT(*) AS requests, COUNT(DISTINCT session_id) AS sessions,",
      "  SUM(input_tokens) AS input, SUM(output_tokens) AS output,",
      "  SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,",
      "  SUM(reasoning_tokens) AS reasoning,",
      "  SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,",
      "  SUM(input_tokens + output_tokens + cache_write_tokens + reasoning_tokens) AS nonCacheReadTotal",
      "FROM cc_usage_events",
      "WHERE date = '" + escapeSql(targetDate) + "'",
      "GROUP BY hour ORDER BY hour;",
    ].join("\n"),
    targetDateTopModels: [
      "SELECT model, provider, COUNT(*) AS requests,",
      "  SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,",
      "  SUM(input_tokens) AS input, SUM(output_tokens) AS output,",
      "  SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,",
      "  SUM(reasoning_tokens) AS reasoning",
      "FROM cc_usage_events",
      "WHERE date = '" + escapeSql(targetDate) + "'",
      "GROUP BY provider, model ORDER BY tokens DESC LIMIT 25;",
    ].join("\n"),
    targetDateTopEvents: [
      "SELECT timestamp_ms, date, hour, model, provider,",
      "  input_tokens AS input, output_tokens AS output, cache_read_tokens AS cacheRead,",
      "  cache_write_tokens AS cacheWrite, reasoning_tokens AS reasoning,",
      "  (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,",
      "  (input_tokens + output_tokens + cache_write_tokens + reasoning_tokens) AS nonCacheReadTotal",
      "FROM cc_usage_events",
      "WHERE date = '" + escapeSql(targetDate) + "'",
      "ORDER BY tokens DESC LIMIT 25;",
    ].join("\n"),
    aggregateDateTotals: [
      "SELECT date, SUM(requests) AS requests,",
      "  SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,",
      "  SUM(cache_read_tokens) AS cacheRead",
      "FROM cc_daily_usage",
      "WHERE model != '__synapse_tool_calls__'",
      "GROUP BY date ORDER BY date DESC LIMIT 14;",
    ].join("\n"),
  }

  const out = {
    available: true,
    sqlite3Available: true,
    path: redactHome(existing),
    sizeBytes: fs.statSync(existing).size,
    queries: {},
  }
  for (const [name, sql] of Object.entries(queries)) {
    try {
      out.queries[name] = runSqliteJson(sqlite, existing, sql)
    } catch (error) {
      out.queries[name] = {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return out
}

function usageTotalsSql(where) {
  return [
    "SELECT COUNT(*) AS requests, COUNT(DISTINCT session_id) AS sessions,",
    "  SUM(input_tokens) AS input, SUM(output_tokens) AS output,",
    "  SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,",
    "  SUM(reasoning_tokens) AS reasoning,",
    "  SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,",
    "  SUM(input_tokens + output_tokens + cache_write_tokens + reasoning_tokens) AS nonCacheReadTotal",
    "FROM cc_usage_events WHERE " + where + ";",
  ].join("\n")
}

function runSqliteJson(sqlite, dbPath, sql) {
  const stdout = execFileSync(sqlite, ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
  const trimmed = stdout.trim()
  return trimmed ? JSON.parse(trimmed) : []
}

function findUsageDbCandidates() {
  const explicit = process.env.SYNAPSE_USAGE_DB ? [process.env.SYNAPSE_USAGE_DB] : []
  const direct = [
    path.join(home, "Library", "Application Support", "Synapse", "usage.db"),
    path.join(home, "Library", "Application Support", "Synapse AI Studio", "usage.db"),
    path.join(home, "AppData", "Roaming", "Synapse", "usage.db"),
    path.join(home, ".config", "Synapse", "usage.db"),
  ]
  const discovered = []
  for (const root of [
    path.join(home, "Library", "Application Support"),
    path.join(home, "AppData", "Roaming"),
    path.join(home, ".config"),
  ]) {
    discoverUsageDb(root, discovered, 4)
  }
  return [...new Set([...explicit, ...direct, ...discovered])]
}

function discoverUsageDb(dir, out, depth) {
  if (depth <= 0 || !existsDir(dir)) return
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === "usage.db") {
      out.push(full)
      continue
    }
    if (entry.isDirectory() && /synapse/i.test(full)) {
      discoverUsageDb(full, out, depth - 1)
    }
  }
}

function collectJsonlFiles(root) {
  const out = []
  collectJsonlFilesFromDir(root, out, MAX_DEPTH)
  return [...new Set(out)].sort()
}

function collectJsonlFilesFromDir(dir, out, depth) {
  if (depth <= 0 || !existsDir(dir)) return
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFilesFromDir(full, out, depth - 1)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full)
  }
}

function zeroStats() {
  return {
    requests: 0,
    sessions: new Set(),
    files: new Set(),
    workspaces: new Set(),
    toolUseBlocks: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    tokens: 0,
    nonCacheReadTotal: 0,
    maxEventTokens: 0,
  }
}

function addStats(stats, event) {
  stats.requests += 1
  stats.sessions.add(event.sessionHash)
  stats.files.add(event.fileHash)
  stats.workspaces.add(event.workspaceHash)
  stats.toolUseBlocks += event.toolUseCount
  stats.input += event.tokens.input
  stats.output += event.tokens.output
  stats.cacheRead += event.tokens.cacheRead
  stats.cacheWrite += event.tokens.cacheWrite
  stats.reasoning += event.tokens.reasoning
  stats.tokens += event.tokens.total
  stats.nonCacheReadTotal += event.tokens.nonCacheReadTotal
  stats.maxEventTokens = Math.max(stats.maxEventTokens, event.tokens.total)
}

function finishStats(stats) {
  const cacheReadRatio = stats.tokens > 0 ? stats.cacheRead / stats.tokens : 0
  return {
    requests: stats.requests,
    sessions: stats.sessions.size,
    files: stats.files.size,
    workspaces: stats.workspaces.size,
    toolUseBlocks: stats.toolUseBlocks,
    input: stats.input,
    output: stats.output,
    cacheRead: stats.cacheRead,
    cacheWrite: stats.cacheWrite,
    reasoning: stats.reasoning,
    tokens: stats.tokens,
    nonCacheReadTotal: stats.nonCacheReadTotal,
    cacheReadRatio,
    maxEventTokens: stats.maxEventTokens,
  }
}

function getOrCreateStats(map, key) {
  const existing = map.get(key)
  if (existing) return existing
  const stats = zeroStats()
  map.set(key, stats)
  return stats
}

function mapToRows(map, keyName) {
  return [...map.entries()].map(([key, stats]) => ({
    [keyName]: key,
    ...finishStats(stats),
  }))
}

function byTokensDesc(left, right) {
  return right.tokens - left.tokens
}

function redactEvent(event) {
  return {
    timestamp: event.timestamp,
    date: event.date,
    hour: event.hour,
    model: event.model,
    workspaceHash: event.workspaceHash,
    workspaceBasename: event.workspaceBasename,
    sessionHash: event.sessionHash,
    fileHash: event.fileHash,
    fileMtime: event.fileMtime,
    line: event.line,
    tokens: event.tokens,
    toolUseCount: event.toolUseCount,
  }
}

function asRecord(value) {
  return typeof value === "object" && value !== null ? value : undefined
}

function positiveNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function parseTimestamp(value, fallback) {
  if (typeof value !== "string") return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function extractReasoningTokens(content) {
  return content.reduce((total, item) => {
    const block = asRecord(item)
    if (!block || block.type !== "thinking") return total
    return total + positiveNumber(block.tokens)
  }, 0)
}

function workspaceFromClaudePath(filePath) {
  const parts = filePath.split(path.sep)
  const projectIndex = parts.findIndex((part, index) => part === ".claude" && parts[index + 1] === "projects")
  const key = projectIndex >= 0 ? (parts[projectIndex + 2] || "") : ""
  const label = key ? key.replace(/^-Users-/, "/Users/").replaceAll("-", "/") : ""
  return {
    keyHash: hash(key || label || filePath),
    basename: label ? path.basename(label) : "",
  }
}

function localDateKey(timestampMs) {
  const date = new Date(timestampMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function localHourKey(timestampMs) {
  const date = new Date(timestampMs)
  return `${localDateKey(timestampMs)} ${pad2(date.getHours())}`
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12)
}

function redactHome(value) {
  return String(value).replace(home, "~")
}

function existsDir(value) {
  try {
    return fs.statSync(value).isDirectory()
  } catch {
    return false
  }
}

function existsFile(value) {
  try {
    return fs.statSync(value).isFile()
  } catch {
    return false
  }
}

function defaultOutputDir() {
  const desktop = path.join(home, "Desktop")
  return existsDir(desktop) ? desktop : process.cwd()
}

function findExecutable(name) {
  const paths = String(process.env.PATH || "").split(path.delimiter)
  for (const dir of paths) {
    const full = path.join(dir, name)
    if (existsFile(full)) return full
  }
  return null
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''")
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`
}

function number(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0)
}

function renderTextReport(data) {
  const raw = data.rawClaudeLogs
  const db = data.synapseUsageDb
  const lines = []
  lines.push("Synapse CC Usage Diagnostic")
  lines.push("===========================")
  lines.push(`Generated: ${data.meta.generatedAt}`)
  lines.push(`Target date: ${data.meta.targetDate}`)
  lines.push(`Timezone: ${data.meta.localTimezone}`)
  lines.push("")
  lines.push("Privacy")
  lines.push("- No prompt text, response text, tool input, tool output, or file contents are included.")
  lines.push("- Paths, sessions, and hostnames are hashed or home-redacted.")
  lines.push("")
  lines.push("Raw Claude Code logs")
  lines.push(`- Files: ${number(raw.lineShape.files)}`)
  lines.push(`- Lines: ${number(raw.lineShape.lines)}`)
  lines.push(`- Assistant usage lines: ${number(raw.lineShape.assistantUsageLines)}`)
  lines.push(`- Missing timestamps: ${number(raw.lineShape.assistantUsageMissingTimestamp)}`)
  lines.push(`- Invalid timestamps: ${number(raw.lineShape.assistantUsageInvalidTimestamp)}`)
  lines.push(`- Duplicate usage event ids: ${number(raw.duplicateUsageEventIds.count)}`)
  lines.push("")
  lines.push("Target date raw totals")
  pushStats(lines, raw.targetDate)
  lines.push("")
  lines.push("Recent active hour")
  if (raw.recentActiveHour) pushHour(lines, raw.recentActiveHour)
  else lines.push("- none")
  lines.push("")
  lines.push("Target date hourly raw totals")
  for (const row of raw.targetDateHours) pushHour(lines, row)
  lines.push("")
  lines.push("Top raw events on target date")
  for (const item of raw.targetDateTopEvents.slice(0, 10)) {
    lines.push(`- ${item.timestamp} ${item.model} total=${number(item.tokens.total)} cacheRead=${number(item.tokens.cacheRead)} input=${number(item.tokens.input)} output=${number(item.tokens.output)} line=${item.line} file=${item.fileHash} session=${item.sessionHash}`)
  }
  lines.push("")
  lines.push("Synapse usage.db")
  if (!db.available) {
    lines.push(`- unavailable: ${db.reason}`)
  } else {
    lines.push(`- path: ${db.path}`)
    lines.push(`- size: ${number(db.sizeBytes)} bytes`)
    const totals = db.queries.targetDateTotals?.[0]
    if (totals) {
      lines.push("- target date db totals:")
      pushDbStats(lines, totals)
    }
    const hours = db.queries.targetDateHours || []
    if (hours.length) {
      lines.push("- target date db hours:")
      for (const row of hours) {
        lines.push(`  - ${row.hour}: requests=${number(row.requests)} tokens=${number(row.tokens)} cacheRead=${number(row.cacheRead)} nonCacheRead=${number(row.nonCacheReadTotal)} cacheReadRatio=${percent((row.cacheRead || 0) / Math.max(1, row.tokens || 0))}`)
      }
    }
  }
  lines.push("")
  lines.push("Interpretation hint")
  lines.push("- If tokens are high but cacheReadRatio is also high, the spike is mostly prompt cache reads.")
  lines.push("- If raw logs and usage.db disagree for the same hour, the bug is likely in Synapse import/aggregation.")
  lines.push("- If raw logs already show hundreds of requests in that hour, investigate Claude Code session activity, not only Synapse UI.")
  lines.push("")
  return `${lines.join("\n")}\n`
}

function pushStats(lines, stats) {
  lines.push(`- requests: ${number(stats.requests)}`)
  lines.push(`- sessions: ${number(stats.sessions)}`)
  lines.push(`- files: ${number(stats.files)}`)
  lines.push(`- tokens: ${number(stats.tokens)}`)
  lines.push(`- nonCacheReadTotal: ${number(stats.nonCacheReadTotal)}`)
  lines.push(`- input: ${number(stats.input)}`)
  lines.push(`- output: ${number(stats.output)}`)
  lines.push(`- cacheRead: ${number(stats.cacheRead)} (${percent(stats.cacheReadRatio)})`)
  lines.push(`- cacheWrite: ${number(stats.cacheWrite)}`)
  lines.push(`- reasoning: ${number(stats.reasoning)}`)
}

function pushDbStats(lines, stats) {
  const ratio = (stats.cacheRead || 0) / Math.max(1, stats.tokens || 0)
  lines.push(`  requests=${number(stats.requests)} sessions=${number(stats.sessions)} tokens=${number(stats.tokens)} nonCacheRead=${number(stats.nonCacheReadTotal)} cacheRead=${number(stats.cacheRead)} cacheReadRatio=${percent(ratio)}`)
}

function pushHour(lines, row) {
  lines.push(`- ${row.hour}: requests=${number(row.requests)} sessions=${number(row.sessions)} files=${number(row.files)} tokens=${number(row.tokens)} nonCacheRead=${number(row.nonCacheReadTotal)} cacheRead=${number(row.cacheRead)} cacheReadRatio=${percent(row.cacheReadRatio)}`)
}

class TopList {
  constructor(limit, score) {
    this.limit = limit
    this.score = score
    this.items = []
  }

  add(item) {
    this.items.push(item)
    this.items.sort((left, right) => this.score(right) - this.score(left))
    if (this.items.length > this.limit) this.items.pop()
  }

  values() {
    return [...this.items]
  }
}

main()
