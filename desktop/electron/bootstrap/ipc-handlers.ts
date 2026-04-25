/**
 * Phase 0.1 — IPC handler registration shim.
 *
 * Phase 0.3 (T3.4–T3.10) replaces all of these one-shot `register*Handlers()`
 * calls with codegen-driven IpcModule registrations. Until then we keep the
 * existing handler files and just call them from one place so `main.ts` stays
 * thin.
 */

import { registerCliHandlers } from "../ipc/cli-handlers"
import { registerConfigHandlers } from "../ipc/config-handlers"
import { registerContentHandlers } from "../ipc/content-handlers"
import { registerEditorHandlers } from "../ipc/editor-handlers"
import { registerEditorScanHandlers } from "../ipc/editor-scan-handlers"
import { registerIdentityHandlers } from "../ipc/identity-handlers"
import { registerLogHandlers } from "../ipc/log-handlers"
import { registerRepositoryHandlers } from "../ipc/repository-handlers"
import { registerShellHandlers } from "../ipc/shell-handlers"
import { registerUpdateHandlers } from "../ipc/update-handlers"
import { registerUserProfileHandlers } from "../ipc/user-profile-handlers"

export function registerAllIpcHandlers(): void {
  registerCliHandlers()
  registerContentHandlers()
  registerEditorHandlers()
  registerEditorScanHandlers()
  registerLogHandlers()
  registerConfigHandlers()
  registerIdentityHandlers()
  registerShellHandlers()
  registerUserProfileHandlers()
  registerRepositoryHandlers()
  registerUpdateHandlers()
}
