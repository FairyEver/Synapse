/**
 * Phase 0.1 — Pending-pushes confirmation flow on app quit.
 *
 * Extracted from main.ts:251-325. Behaviour preserved verbatim. Phase 0.5+
 * may move this into a project-scoped service once the project container exists.
 */

import { app, dialog } from "electron"
import { configStore } from "../services/config-store"
import { createMainLogger, logStore } from "../services/log-store"
import type { RepositorySyncCoordinator } from "../services/repository-sync-coordinator"
import { updateService } from "../services/update-service"
import type { ServiceRegistryImpl } from "../runtime/service-registry"
import type { MainWindowState } from "./main-window"

const logger = createMainLogger("bootstrap.before-quit")
const QUIT_FLOW_TIMEOUT_MS = 15_000
const QUIT_PUSH_TIMEOUT_MS = 12_000
let pendingPushFlowRunning = false

export interface BeforeQuitDeps {
  readonly state: MainWindowState
  readonly registry: ServiceRegistryImpl
  readonly knowledgeBaseStorageMigration?: {
    isActive: () => boolean
    requiresRestartForRecovery?: () => boolean
    focusDialog: () => void
  }
  /** Mutable flag; set to true to allow app.quit() without re-entering this flow. */
  readonly setAllowQuit: (value: boolean) => void
  readonly isAllowedToQuit: () => boolean
}

export function attachBeforeQuitHandler(deps: BeforeQuitDeps): void {
  updateService.setInstallQuitHandlers({
    canQuit: () => {
      if (shouldBlockKnowledgeBaseStorageMigrationQuit(deps.knowledgeBaseStorageMigration)) {
        deps.knowledgeBaseStorageMigration.focusDialog()
        logger.info("Update install blocked by active Knowledge Base storage migration.")
        return false
      }
      return true
    },
    allowQuit: () => {
      logger.info("Native update handoff is ready. Allowing app to quit.")
      deps.setAllowQuit(true)
    },
  })

  app.on("before-quit", async (event) => {
    if (!deps.isAllowedToQuit()) {
      event.preventDefault()
    }

    // Cancel any in-flight update download. Best-effort, never blocks.
    try {
      await updateService.cancelDownload()
    } catch (error) {
      logger.warn("Failed to cancel in-flight update download.", { error })
    }

    if (deps.isAllowedToQuit()) {
      // We're already past the user prompt — let the registry tear down.
      try {
        await deps.registry.stopAll(15_000)
      } catch (error) {
        logger.error("Service registry stopAll() reported an error.", { error })
      }
      try {
        await logStore.dispose()
      } catch (error) {
        logger.error("logStore dispose failed.", { error })
      }
      return
    }

    if (deps.knowledgeBaseStorageMigration?.isActive()) {
      if (deps.knowledgeBaseStorageMigration.requiresRestartForRecovery?.()) {
        logger.info("App quit allowed to recover failed Knowledge Base storage migration on restart.")
        deps.setAllowQuit(true)
        app.quit()
        return
      }
      deps.knowledgeBaseStorageMigration.focusDialog()
      logger.info("App quit blocked by active Knowledge Base storage migration.")
      return
    }

    if (pendingPushFlowRunning) {
      return
    }

    pendingPushFlowRunning = true
    void runPendingPushFlow(deps).finally(() => {
      pendingPushFlowRunning = false
    })
  })
}

function shouldBlockKnowledgeBaseStorageMigrationQuit(
  migration: BeforeQuitDeps["knowledgeBaseStorageMigration"],
): migration is NonNullable<BeforeQuitDeps["knowledgeBaseStorageMigration"]> {
  return !!migration?.isActive() && !migration.requiresRestartForRecovery?.()
}

async function runPendingPushFlow(deps: BeforeQuitDeps): Promise<void> {
  let quitRequested = false
  let quitTimeout: ReturnType<typeof setTimeout> | null = null

  const clearQuitTimeout = () => {
    if (!quitTimeout) return
    clearTimeout(quitTimeout)
    quitTimeout = null
  }

  const requestQuit = () => {
    if (quitRequested) return
    quitRequested = true
    clearQuitTimeout()
    deps.setAllowQuit(true)
    app.quit()
  }

  try {
    quitTimeout = setTimeout(() => {
      logger.warn("Before-quit flow timed out after 15s. Force quitting.")
      requestQuit()
    }, QUIT_FLOW_TIMEOUT_MS)

    await logStore.flush()

    let coordinator: RepositorySyncCoordinator
    try {
      coordinator = deps.registry.get<RepositorySyncCoordinator>("repo.sync-coordinator")
    } catch (error) {
      logger.error("Repository sync coordinator is unavailable during before-quit flow.", error)
      clearQuitTimeout()
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "同步服务不可用",
        message: "无法检查未同步变更。",
        detail: "可以继续退出，未同步变更下次启动后仍可处理。",
        buttons: ["继续退出", "取消"],
        defaultId: 1,
        cancelId: 1,
      })

      if (result.response === 0) {
        requestQuit()
      }
      return
    }

    const pendingPushCount = await coordinator.countAllPending()

    if (pendingPushCount === 0) {
      requestQuit()
      return
    }

    const ownerWindow = deps.state.current

    if (ownerWindow && !ownerWindow.isVisible()) {
      ownerWindow.show()
    }

    const messageBoxOptions = {
      type: "warning" as const,
      title: "还有未同步的变更",
      message: `你有 ${pendingPushCount} 条变更未同步到仓库。`,
      detail: "下次启动时可以继续推送。",
      buttons: ["先同步", "继续退出"],
      defaultId: 0,
      cancelId: 1,
    }

    clearQuitTimeout()
    const result = ownerWindow
      ? await dialog.showMessageBox(ownerWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions)

    if (result.response === 0) {
      const config = await configStore.load()

      await Promise.allSettled(
        config.repositories.map(async (repository) => {
          try {
            await withTimeout(
              coordinator.requestPush(repository, "quit"),
              QUIT_PUSH_TIMEOUT_MS,
              `Repository push timed out during quit: ${repository.uuid}`,
            )
          } catch (error) {
            logger.error(`Failed to push repository ${repository.uuid} during quit.`, error)
          }
        }),
      )
    }

    requestQuit()
  } catch (error) {
    logger.error("Failed to resolve before-quit pending pushes flow.", error)
    requestQuit()
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}
