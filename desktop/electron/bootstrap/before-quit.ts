/**
 * Phase 0.1 — Pending-pushes confirmation flow on app quit.
 *
 * Extracted from main.ts:251-325. Behaviour preserved verbatim. Phase 0.5+
 * may move this into a project-scoped service once the project container exists.
 */

import { app, dialog } from "electron"
import { configStore } from "../services/config-store"
import { contentSubmissionService } from "../services/content-submission-service"
import { createMainLogger, logStore } from "../services/log-store"
import { pendingPushesService } from "../services/pending-pushes-service"
import { updateService } from "../services/update-service"
import type { ServiceRegistryImpl } from "../runtime/service-registry"
import type { MainWindowState } from "./main-window"

const logger = createMainLogger("bootstrap.before-quit")

export interface BeforeQuitDeps {
  readonly state: MainWindowState
  readonly registry: ServiceRegistryImpl
  /** Mutable flag; set to true to allow app.quit() without re-entering this flow. */
  readonly setAllowQuit: (value: boolean) => void
  readonly isAllowedToQuit: () => boolean
}

export function attachBeforeQuitHandler(deps: BeforeQuitDeps): void {
  app.on("before-quit", async (event) => {
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

    event.preventDefault()

    void runPendingPushFlow(deps)
  })
}

async function runPendingPushFlow(deps: BeforeQuitDeps): Promise<void> {
  try {
    const quitTimeout = setTimeout(() => {
      logger.warn("Before-quit flow timed out after 15s. Force quitting.")
      deps.setAllowQuit(true)
      app.quit()
    }, 15_000)

    await logStore.flush()

    const config = await configStore.load()
    const pendingPushCount = await pendingPushesService.countAll(config.repositories)

    if (pendingPushCount === 0) {
      clearTimeout(quitTimeout)
      deps.setAllowQuit(true)
      app.quit()
      return
    }

    // Use main window from state; if not available, dialog will be shown without parent
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

    const result = ownerWindow
      ? await dialog.showMessageBox(ownerWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions)

    if (result.response === 0) {
      for (const repository of config.repositories) {
        await contentSubmissionService.flushPendingPushes(repository)
      }
    }

    clearTimeout(quitTimeout)
    deps.setAllowQuit(true)
    app.quit()
  } catch (error) {
    logger.error("Failed to resolve before-quit pending pushes flow.", error)
    deps.setAllowQuit(true)
    app.quit()
  }
}
