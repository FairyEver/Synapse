import { DatabaseSync } from "node:sqlite"
import type { AgentParser, UnifiedMessage } from "./types"
import { parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function normalizeCrushTimestampMs(raw: number): number | null {
  if (raw <= 0) return null
  if (raw >= 100_000_000_000) return raw
  return raw * 1000
}

export const crushParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const db = new DatabaseSync(filePath, { open: true, readOnly: true })
      try {
        const sessions = db.prepare(`
          SELECT id, cost, created_at, updated_at
          FROM sessions
          WHERE parent_session_id IS NULL
            AND (COALESCE(message_count, 0) > 0 OR COALESCE(cost, 0) > 0)
          ORDER BY created_at ASC
        `).all() as Record<string, unknown>[]

        const buckets = db.prepare(`
          WITH RECURSIVE session_tree(root_session_id, session_id) AS (
            SELECT id, id FROM sessions WHERE parent_session_id IS NULL
            UNION ALL
            SELECT st.root_session_id, s.id
            FROM sessions s JOIN session_tree st ON s.parent_session_id = st.session_id
          )
          SELECT st.root_session_id, m.created_at
          FROM session_tree st
          JOIN messages m ON m.session_id = st.session_id
          WHERE m.role = 'assistant'
          ORDER BY st.root_session_id ASC, m.created_at ASC
        `).all() as Record<string, unknown>[]

        const bucketsBySession = new Map<string, Map<string, { count: number; earliestTs: number }>>()
        for (const b of buckets) {
          const rootId = String(b.root_session_id)
          const rawTs = b.created_at as number
          const ts = normalizeCrushTimestampMs(rawTs)
          if (ts === null) continue

          const date = timestampToLocalDate(ts)

          if (!bucketsBySession.has(rootId)) bucketsBySession.set(rootId, new Map())
          const dayMap = bucketsBySession.get(rootId)!
          const existing = dayMap.get(date)
          if (existing) {
            existing.count += 1
            existing.earliestTs = Math.min(existing.earliestTs, ts)
          } else {
            dayMap.set(date, { count: 1, earliestTs: ts })
          }
        }

        for (const session of sessions) {
          const sessionId = String(session.id)
          const cost = Math.max(0, typeof session.cost === "number" ? session.cost : 0)

          const dayMap = bucketsBySession.get(sessionId)
          if (!dayMap || dayMap.size === 0) {
            const ts = fallbackSessionTimestamp(session.updated_at, session.created_at)
            if (ts === null) continue
            messages.push({
              client: "crush",
              modelId: "session-total",
              providerId: "crush",
              sessionId: `${filePath}:${sessionId}`,
              timestamp: ts,
              date: timestampToLocalDate(ts),
              tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
              cost,
              messageCount: 0,
              isTurnStart: false,
            })
            continue
          }

          const totalMsgs = Array.from(dayMap.values()).reduce((a, b) => a + b.count, 0)
          const days = Array.from(dayMap.entries())
          let allocated = 0

          for (let i = 0; i < days.length; i++) {
            const [date, bucket] = days[i]
            const isLast = i === days.length - 1
            const dayCost = isLast ? Math.max(0, cost - allocated) : (cost * bucket.count) / totalMsgs
            allocated += dayCost

            messages.push({
              client: "crush",
              modelId: "session-total",
              providerId: "crush",
              sessionId: `${filePath}:${sessionId}`,
              timestamp: bucket.earliestTs,
              date,
              tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
              cost: dayCost,
              messageCount: bucket.count,
              isTurnStart: false,
            })
          }
        }
      } finally {
        db.close()
      }
    } catch { /* skip */ }

    return messages
  },
}

function fallbackSessionTimestamp(updatedAt: unknown, createdAt: unknown): number | null {
  const updated = parseTimestamp(updatedAt)
  if (updated) {
    const normalized = normalizeCrushTimestampMs(updated)
    if (normalized !== null) return normalized
  }
  const created = parseTimestamp(createdAt)
  if (created) {
    const normalized = normalizeCrushTimestampMs(created)
    if (normalized !== null) return normalized
  }
  return null
}
