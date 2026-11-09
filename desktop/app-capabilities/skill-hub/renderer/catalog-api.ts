import { createRendererLogger } from "@/app-shell/logging"
import { requireBridgeDomain } from "@/lib/electron-bridge"
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
  list: (query: string, cursor?: string) => unwrap(requireBridgeDomain("skillHub").catalogList({
    ...(query ? { query } : {}),
    ...(cursor ? { cursor } : {}),
  })),
  detail: (skillId: string) => unwrap(requireBridgeDomain("skillHub").catalogDetail({ skillId })),
  icon: readIcon,
  install: (skillId: string) => unwrap(requireBridgeDomain("skillHub").catalogOpenInstaller({ skillId })),
}
