import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate, inferProvider, normalizeWorkspaceKey, workspaceLabelFromKey } from "./utils"

function parseDataJson(data: string, fallbackTs: number, clientId: string, workspaceRoot?: string): UnifiedMessage | null {
  try {
    const obj = JSON.parse(data)
    if (obj.role !== "assistant") return null

    const tokens = obj.tokens as Record<string, unknown> | undefined
    if (!tokens) return null

    const modelId = (obj.modelID as string) || ""
    if (!modelId) return null

    const cache = tokens.cache as Record<string, unknown> | undefined
    const input = Math.max(0, extractI64(tokens.input))
    const output = Math.max(0, extractI64(tokens.output))
    const cacheRead = Math.max(0, extractI64(cache?.read))
    const cacheWrite = Math.max(0, extractI64(cache?.write))
    const reasoning = Math.max(0, extractI64(tokens.reasoning))

    const time = obj.time as Record<string, unknown> | undefined
    const ts = parseTimestamp(time?.created) || fallbackTs
    const cost = Math.max(0, typeof obj.cost === "number" ? obj.cost : 0)

    const providerId = (obj.providerID as string) || inferProvider(modelId, clientId)
    const agent = (obj.mode as string) || (obj.agent as string) || undefined

    const pathRoot = workspaceRoot || (obj.path as Record<string, unknown>)?.root as string | undefined
    const workspaceKey = pathRoot ? normalizeWorkspaceKey(pathRoot) : null
    const workspaceLabel = workspaceLabelFromKey(workspaceKey)

    return {
      client: clientId,
      modelId,
      providerId,
      sessionId: (obj.sessionID as string) || "unknown",
      timestamp: ts,
      date: timestampToLocalDate(ts),
      tokens: { input, output, cacheRead, cacheWrite, reasoning },
      cost,
      messageCount: 1,
      isTurnStart: false,
      agent,
      workspaceKey: workspaceKey ?? undefined,
      workspaceLabel: workspaceLabel ?? undefined,
    }
  } catch { return null }
}


function createSqliteMessageParser(clientId: string): AgentParser {
  return {
    async parseFile(filePath: string): Promise<UnifiedMessage[]> {
      const messages: UnifiedMessage[] = []
      const fallbackTs = fileModifiedMs(filePath)

      if (filePath.endsWith(".json")) {
        return parseLegacyJson(filePath, fallbackTs, clientId)
      }

      try {
        const db = new DatabaseSync(filePath, { open: true, readOnly: true })
        try {
          let hasSessionTable = false
          try {
            const check = db.prepare(`SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='session'`).get() as Record<string, unknown>
            hasSessionTable = (check?.cnt as number) > 0
          } catch { /* no session table */ }

          const query = hasSessionTable
            ? `SELECT m.id, m.session_id, m.data, s.directory as workspace_root
               FROM message m
               LEFT JOIN session s ON m.session_id = s.id
               WHERE json_extract(m.data, '$.role') = 'assistant'
                 AND json_extract(m.data, '$.tokens') IS NOT NULL
               ORDER BY m.id, m.session_id`
            : `SELECT m.id, m.session_id, m.data
               FROM message m
               WHERE json_extract(m.data, '$.role') = 'assistant'
                 AND json_extract(m.data, '$.tokens') IS NOT NULL
               ORDER BY m.id, m.session_id`

          const rows = db.prepare(query).all() as Record<string, unknown>[]

          const seen = new Map<string, number>()
          for (const row of rows) {
            const msg = parseDataJson(row.data as string, fallbackTs, clientId, row.workspace_root as string | undefined)
            if (!msg) continue

            if (row.session_id) msg.sessionId = row.session_id as string
            const dedupKey = (msg as { dedupKey?: string }).dedupKey || (row.id as string)

            const fingerprint = `${msg.timestamp}|${msg.modelId}|${msg.tokens.input}|${msg.tokens.output}|${msg.agent || ""}`
            const existing = seen.get(fingerprint)
            if (existing !== undefined) {
              if (msg.workspaceKey && !messages[existing].workspaceKey) {
                messages[existing].workspaceKey = msg.workspaceKey
                messages[existing].workspaceLabel = msg.workspaceLabel
              }
              continue
            }
            seen.set(fingerprint, messages.length)
            msg.dedupKey = dedupKey
            messages.push(msg)
          }
        } finally {
          db.close()
        }
      } catch { /* skip */ }

      return messages
    },
  }
}

function parseLegacyJson(filePath: string, fallbackTs: number, clientId: string): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    const dedupKey = (data.id as string) || path.basename(filePath, ".json")
    const msg = parseDataJson(JSON.stringify(data), fallbackTs, clientId)
    if (msg) {
      msg.dedupKey = dedupKey
      messages.push(msg)
    }
  } catch { /* skip */ }
  return messages
}

export const opencodeParser: AgentParser = createSqliteMessageParser("opencode")
export const kiloDbParser: AgentParser = createSqliteMessageParser("kilo")
