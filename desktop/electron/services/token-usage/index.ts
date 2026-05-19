import fs from "node:fs"
import path from "node:path"
import { scanAllClients } from "./scanner"
import { getDb, getFingerprint, upsertFingerprint, upsertDailyUsage, upsertHourlyUsage, clearDailyUsageForClient, clearHourlyUsageForClient, clearFingerprintsForClient, clearAllData, setScanMeta } from "./db"
import { getGraphResult, getModelReport, getDailyReport, getAgentReport, getHourlyReport, getHourlyProfile } from "./aggregator"
import { claudeParser } from "./parsers/claude"
import { codexParser } from "./parsers/codex"
import { piParser } from "./parsers/pi"
import { qwenParser } from "./parsers/qwen"
import { kimiParser } from "./parsers/kimi"
import { copilotParser } from "./parsers/copilot"
import { geminiParser } from "./parsers/gemini"
import { ampParser } from "./parsers/amp"
import { roocodeParser, kilocodeParser } from "./parsers/roocode"
import { muxParser } from "./parsers/mux"
import { openclawParser } from "./parsers/openclaw"
import { droidParser } from "./parsers/droid"
import { codebuffParser } from "./parsers/codebuff"
import { hermesParser } from "./parsers/hermes"
import { gooseParser } from "./parsers/goose"
import { opencodeParser, kiloDbParser } from "./parsers/opencode"
import { crushParser } from "./parsers/crush"
import { syntheticParser } from "./parsers/synthetic"
import { antigravityParser } from "./parsers/antigravity"
import type { AgentParser, ScanProgress } from "./parsers/types"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("token-usage")

const PARSERS: Record<string, AgentParser> = {
  claude: claudeParser,
  codex: codexParser,
  pi: piParser,
  qwen: qwenParser,
  kimi: kimiParser,
  antigravity: antigravityParser,
  copilot: copilotParser,
  gemini: geminiParser,
  amp: ampParser,
  roocode: roocodeParser,
  kilocode: kilocodeParser,
  mux: muxParser,
  openclaw: openclawParser,
  droid: droidParser,
  codebuff: codebuffParser,
  hermes: hermesParser,
  goose: gooseParser,
  opencode: opencodeParser,
  kilo: kiloDbParser,
  crush: crushParser,
  synthetic: syntheticParser,
}

function getParser(clientId: string): AgentParser | null {
  return PARSERS[clientId] || null
}

let scanInProgress = false

export async function scanTokenUsage(): Promise<ScanProgress> {
  if (scanInProgress) {
    throw new Error("SCAN_ALREADY_IN_PROGRESS")
  }
  scanInProgress = true
  try {
    return await doScan()
  } finally {
    scanInProgress = false
  }
}

async function doScan(): Promise<ScanProgress> {
  const start = Date.now()
  const scanResults = scanAllClients()

  const progress: ScanProgress = {
    totalClients: scanResults.length,
    scannedClients: 0,
    totalFiles: scanResults.reduce((sum, r) => sum + r.files.length, 0),
    parsedFiles: 0,
    newMessages: 0,
    elapsedMs: 0,
  }

  for (const result of scanResults) {
    const parser = getParser(result.clientId)
    if (!parser) {
      progress.scannedClients++
      continue
    }

    // Phase 1: detect whether any file needs re-parsing (fingerprint changed)
    let anyDirty = false
    for (const filePath of result.files) {
      try {
        const stat = fs.statSync(filePath)
        const fp = getFingerprint(filePath)
        if (fp && fp.size === stat.size && fp.mtimeMs === stat.mtimeMs) {
          continue
        }
        anyDirty = true
        break
      } catch (error) {
        logger.error("Failed to stat file", { fileName: path.basename(filePath), pathLength: filePath.length, error: String(error) })
      }
    }

    if (!anyDirty) {
      progress.scannedClients++
      continue
    }

    // Phase 2: parse ALL files and cache results.
    // Only clear + upsert if every file succeeds, so a single bad file
    // doesn't wipe previously aggregated data for this client.
    const parsed: Array<{ messages: Awaited<ReturnType<AgentParser["parseFile"]>>; stat: fs.Stats }> = []
    let parseAborted = false
    for (const filePath of result.files) {
      try {
        const stat = fs.statSync(filePath)
        const messages = await parser.parseFile(filePath)
        parsed.push({ messages, stat })
      } catch (error) {
        logger.error("Failed to parse file, preserving old data for client", {
          clientId: result.clientId, fileName: path.basename(filePath), pathLength: filePath.length, error: String(error),
        })
        parseAborted = true
        break
      }
    }

    if (parseAborted) {
      // Keep old data intact — clear did not run, old upserts survive.
      progress.scannedClients++
      continue
    }

    // Phase 3: all files parsed successfully → clear old data, upsert fresh.
    // Wrapped in a transaction so a crash between DELETE and UPSERT cannot lose data.
    const commitClientData = getDb().transaction(() => {
      clearDailyUsageForClient(result.clientId)
      clearHourlyUsageForClient(result.clientId)
      clearFingerprintsForClient(result.clientId)

      for (let i = 0; i < result.files.length; i++) {
        const { messages, stat } = parsed[i]
        if (messages.length > 0) {
          upsertDailyUsage(messages)
          upsertHourlyUsage(messages)
          progress.newMessages += messages.length
        }
        upsertFingerprint({
          filePath: result.files[i],
          clientId: result.clientId,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          bytesParsed: stat.size,
        })
        progress.parsedFiles++
      }
    })
    commitClientData()

    progress.scannedClients++
  }

  progress.elapsedMs = Date.now() - start
  setScanMeta("lastScanAt", new Date().toISOString())
  setScanMeta("lastScanMs", String(progress.elapsedMs))
  logger.info("Scan complete", {
    clients: progress.scannedClients,
    files: progress.parsedFiles,
    messages: progress.newMessages,
    elapsedMs: progress.elapsedMs,
  })

  return progress
}

export { getGraphResult, getModelReport, getDailyReport, getAgentReport, getHourlyReport, getHourlyProfile, clearAllData }
