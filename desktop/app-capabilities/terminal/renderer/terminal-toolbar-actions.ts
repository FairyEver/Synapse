/**
 * The terminal toolbar's registry, now owned by `shared/`.
 *
 * It moved because the main process has to read the same list — a phone is shown
 * these built-ins too, and the projection runs where the socket is. This module stays
 * as the renderer's import path so the components that draw the toolbar are untouched.
 */
export {
  TERMINAL_TOOLBAR_ACTIONS,
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
} from "../shared/toolbar-actions"
export type {
  TerminalToolbarAction,
  TerminalToolbarAvailability,
  TerminalToolbarPlatform,
} from "../shared/toolbar-actions"
