/**
 * Phase 0.1 — Stale singleton lock cleanup.
 *
 * Electron's `requestSingleInstanceLock()` writes lock files to userData; if the
 * previous run crashed without releasing them, a fresh start would be falsely
 * treated as a "second instance". This helper detects a stale lock by reading
 * the symlink target's PID and verifying the process no longer exists.
 *
 * Extracted from `main.ts` verbatim — Phase 0.6 may re-home this under
 * `runtime/` if other entry points need it, but for now it's main-only.
 */

import { app } from "electron"
import { existsSync, readlinkSync, rmSync } from "node:fs"
import path from "node:path"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("bootstrap.singleton-lock")

export function clearStaleSingletonLock(): boolean {
  const lockPath = path.join(app.getPath("userData"), "SingletonLock")

  if (!existsSync(lockPath)) {
    return false
  }

  try {
    const target = readlinkSync(lockPath)
    const match = target.match(/-(\d+)$/)

    if (!match) {
      return false
    }

    const pid = Number.parseInt(match[1], 10)

    try {
      process.kill(pid, 0)
      return false
    } catch {
      // Process doesn't exist — lock is stale.
    }
  } catch {
    // Not a symlink or unreadable — treat as stale.
  }

  const userData = app.getPath("userData")

  for (const file of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      rmSync(path.join(userData, file), { force: true })
    } catch {
      // Best-effort cleanup.
    }
  }

  logger.warn("Cleared stale singleton lock files from a previous crash.")
  return true
}
