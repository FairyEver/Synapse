import { TOKEN_USAGE_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { scanTokenUsage, getGraphResult, getModelReport, getDailyReport, getAgentReport, getHourlyReport, getHourlyProfile, clearAllData } from "../services/token-usage"
import type { GroupByMode } from "../services/token-usage/aggregator"
import { scanAllClients } from "../services/token-usage/scanner"
import { CLIENT_DEFS } from "../services/token-usage/clients"

let handlersRegistered = false

export function registerTokenUsageHandlers(): void {
  if (handlersRegistered) return

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.scan, async () => {
    return scanTokenUsage()
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getGraphResult, async (_event, options?: { since?: string; until?: string }) => {
    return getGraphResult(options)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getModelReport, async (_event, options?: { since?: string; until?: string; groupBy?: string }) => {
    return getModelReport(options ? { ...options, groupBy: options.groupBy as GroupByMode | undefined } : undefined)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getDailyReport, async (_event, options?: { since?: string; until?: string }) => {
    return getDailyReport(options)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getAgentReport, async (_event, options?: { since?: string; until?: string }) => {
    return getAgentReport(options)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getHourlyReport, async (_event, options?: { since?: string; until?: string }) => {
    return getHourlyReport(options)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getHourlyProfile, async (_event, options?: { since?: string; until?: string }) => {
    return getHourlyProfile(options)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getDetectedAgents, async () => {
    const results = scanAllClients()
    return results.map((r) => {
      const def = CLIENT_DEFS.find((d) => d.id === r.clientId)
      return { id: r.clientId, name: def?.name || r.clientId, fileCount: r.files.length }
    })
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.clearData, async () => {
    clearAllData()
  })

  handlersRegistered = true
}
