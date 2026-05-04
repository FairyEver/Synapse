import fs from "node:fs"
import { scanAllClients } from "./scanner"
import { getFingerprint, upsertFingerprint, upsertDailyUsage, upsertHourlyUsage, clearDailyUsageForClient, clearHourlyUsageForClient, clearFingerprintsForClient, clearAllData, setScanMeta } from "./db"
import { getGraphResult, getModelReport, getDailyReport, getAgentReport, getHourlyReport, getHourlyProfile } from "./aggregator"
import { claudeParser } from "./parsers/claude"
import { codexParser } from "./parsers/codex"
import { piParser, qwenParser, kimiParser, antigravityParser } from "./parsers/generic-agents"
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
import { cursorParser } from "./parsers/cursor"
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
  cursor: cursorParser,
}

function getParser(clientId: string): AgentParser | null {
  return PARSERS[clientId] || null
}

export async function scanTokenUsage(): Promise<ScanProgress> {
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

    for (const filePath of result.files) {
      try {
        const stat = fs.statSync(filePath)
        const fp = getFingerprint(filePath)

        if (fp && fp.size === stat.size && fp.mtimeMs === stat.mtimeMs) {
          continue
        }

        if (fp && (stat.size < fp.size || (stat.size === fp.size && stat.mtimeMs !== fp.mtimeMs))) {
          clearDailyUsageForClient(result.clientId)
          clearHourlyUsageForClient(result.clientId)
          clearFingerprintsForClient(result.clientId)
        }

        const messages = await parser.parseFile(filePath)
        if (messages.length > 0) {
          upsertDailyUsage(messages)
          upsertHourlyUsage(messages)
          progress.newMessages += messages.length
        }

        upsertFingerprint({
          filePath,
          clientId: result.clientId,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          bytesParsed: stat.size,
        })

        progress.parsedFiles++
      } catch (error) {
        logger.error("Failed to parse file", { filePath, error: String(error) })
      }
    }

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
