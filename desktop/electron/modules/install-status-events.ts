import type { EventBus } from "../runtime/event-bus"
import { installStatusCacheService } from "../services/install-status-cache-service"

type WarnLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void
}

async function notifyInstallStatusChanged(
  eventBus: EventBus,
  contentId: string,
  options: {
    logger: WarnLogger
    warningMessage: string
  },
): Promise<void> {
  try {
    const entries = await installStatusCacheService.refresh(contentId)
    eventBus.emit({
      domain: "install-status",
      type: "install-status.changed",
      payload: { contentId, entries },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    options.logger.warn(options.warningMessage, { contentId, error })
  }
}

export { notifyInstallStatusChanged }
