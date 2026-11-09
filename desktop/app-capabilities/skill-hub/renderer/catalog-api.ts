import { createRendererLogger } from "@/app-shell/logging"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SkillHubTeam, SkillHubTeamPage } from "@synapse/shared/skill-hub-contracts"
import type { HubCatalogResult } from "../shared/ipc-result"

const logger = createRendererLogger("skill-hub.catalog")
const iconQueue: Array<() => void> = []
let activeIcons = 0

export class CatalogError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export function catalogErrorMessage(error: unknown, fallback: string) {
  if (error instanceof CatalogError) {
    if (error.code === "HUB_CONNECTION_ERROR") return "连接失败，请重试。"
    if (error.code === "HUB_ACCOUNT_CHANGED") return "账号已切换，请重试。"
    return error.message
  }
  logger.warn("SkillHub catalog request failed.", error)
  return fallback
}

async function unwrap<T>(request: Promise<HubCatalogResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new CatalogError(result.code, result.message)
  return result.value
}

function drainIconQueue() {
  while (activeIcons < 4 && iconQueue.length) iconQueue.shift()?.()
}

function readIcon(skillId: string, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    iconQueue.push(() => {
      if (signal.aborted) {
        resolve(undefined)
        return
      }
      activeIcons++
      void Promise.resolve().then(() => {
        if (!signal.aborted) return unwrap(requireBridgeDomain("skillHub").catalogIcon({ skillId }))
      }).then(resolve, reject).finally(() => {
        activeIcons--
        drainIconQueue()
      })
    })
    drainIconQueue()
  })
}

export const catalog = {
  list: (query: string, teamId?: string, cursor?: string) => unwrap(requireBridgeDomain("skillHub").catalogList({
    ...(query ? { query } : {}),
    ...(teamId ? { teamId } : {}),
    ...(cursor ? { cursor } : {}),
  })),
  detail: (skillId: string) => unwrap(requireBridgeDomain("skillHub").catalogDetail({ skillId })),
  icon: readIcon,
  install: (skillId: string) => unwrap(requireBridgeDomain("skillHub").catalogOpenInstaller({ skillId })),
  async teams(signal: AbortSignal): Promise<{
    items: SkillHubTeam[]
    selectionState: SkillHubTeamPage["selectionState"]
  }> {
    const bridge = requireBridgeDomain("skillHub")
    const items = new Map<string, SkillHubTeam>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      signal.throwIfAborted()
      const page = await unwrap(bridge.catalogTeams(cursor ? { cursor } : {}))
      for (const team of page.items) items.set(team.id, team)
      if (!page.nextCursor) return { items: Array.from(items.values()), selectionState: page.selectionState }
      if (cursors.has(page.nextCursor)) throw new CatalogError("HUB_INVALID_CURSOR", "无法加载团队，请刷新重试。")
      cursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
  },
}
