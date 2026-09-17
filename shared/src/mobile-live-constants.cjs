/**
 * Wire constants for the mobile terminal relay, in CommonJS.
 *
 * The Electron main process is CommonJS and `@synapse/shared` is ESM-only, so the
 * constants the desktop gateway needs at runtime cannot be pulled from the package
 * entry point. This subpath exists for the same reason `drive-sync-constants` does:
 * one definition, consumable from both module systems.
 *
 * `mobile-live.ts` re-exports everything here, so this file is the single source of
 * truth and the ESM API stays unchanged.
 */

/** @type {1} */
exports.MOBILE_PROTOCOL_VERSION = 1

/**
 * Producers are self-bounded. `maxPayloadBytes` bounds one frame, which can be
 * split; `maxSummaryBytes` bounds one summary, which cannot, and the sockets'
 * `maxPayload` is sized above both — see the comments in `mobile-live.ts`.
 *
 * @type {{
 *   readonly maxPayloadBytes: number,
 *   readonly maxBytesPerSecond: number,
 *   readonly maxLinesPerFrame: number,
 *   readonly maxHistoryLines: number,
 *   readonly maxLineLength: number,
 *   readonly maxRunsPerLine: number,
 *   readonly maxSummarySessions: number,
 *   readonly maxSummaryGroups: number,
 *   readonly maxSummaryWorkspaces: number,
 *   readonly maxSummaryWorkspacePanes: number,
 *   readonly maxSummaryIdLength: number,
 *   readonly maxSummaryCwdLength: number,
 *   readonly maxSummaryLastLineLength: number,
 *   readonly maxSummaryStartedAtLength: number,
 *   readonly maxSummaryGroupNameLength: number,
 *   readonly maxSummaryGridOwnerIdLength: number,
 *   readonly maxSummaryAgentGroups: number,
 *   readonly maxSummaryAgentProviders: number,
 *   readonly maxSummaryAgentNameLength: number,
 *   readonly maxSummaryModelNameLength: number,
 *   readonly maxSummaryBytes: number,
 *   readonly maxIntentTextLength: number,
 *   readonly maxKeyActions: number,
 *   readonly maxTitleLength: number,
 *   readonly maxResizeCols: number,
 *   readonly maxResizeRows: number,
 *   readonly maxDeviceLabelLength: number,
 *   readonly maxRelayedFileBytes: number,
 *   readonly maxRelayedFileNameLength: number,
 *   readonly maxUploadDriveItemIdLength: number,
 *   readonly maxToolbarButtons: number,
 *   readonly maxToolbarButtonIdLength: number,
 *   readonly maxToolbarLabelLength: number,
 *   readonly maxToolbarTextLength: number,
 *   readonly maxToolbarBytes: number,
 * }}
 */
exports.MOBILE_FRAME_LIMITS = {
  maxPayloadBytes: 8 * 1024,
  maxBytesPerSecond: 64 * 1024,
  maxLinesPerFrame: 512,
  /** Upper bound for one history page; the client asks for less in practice. */
  maxHistoryLines: 500,
  maxLineLength: 8 * 1024,
  maxRunsPerLine: 256,
  maxSummarySessions: 256,
  maxSummaryGroups: 128,
  maxSummaryWorkspaces: 256,
  maxSummaryWorkspacePanes: 8,
  maxSummaryIdLength: 48,
  maxSummaryCwdLength: 128,
  maxSummaryLastLineLength: 120,
  maxSummaryStartedAtLength: 48,
  maxSummaryGroupNameLength: 80,
  maxSummaryGridOwnerIdLength: 48,
  /** The project and Provider directories a phone picks from; see `mobile-live.ts`. */
  maxSummaryAgentGroups: 32,
  maxSummaryAgentProviders: 12,
  /** One project or Provider name, which is what a picker row shows. */
  maxSummaryAgentNameLength: 80,
  /** One tier's model name as the Provider resolves it. */
  maxSummaryModelNameLength: 64,
  /** Bounds the widest *admissible* summary; see the arithmetic in `mobile-live.ts`. */
  maxSummaryBytes: 248 * 1024,
  maxIntentTextLength: 8 * 1024,
  maxKeyActions: 128,
  maxTitleLength: 200,
  /** Restated from the terminal capability's own resize ceiling; keep the two in step. */
  maxResizeCols: 500,
  maxResizeRows: 200,
  /** Display-only, for the desktop badge naming the phone that set the size. */
  maxDeviceLabelLength: 40,
  /** Relay ceilings for the file hand-off; the bytes travel over HTTP, not this socket. */
  maxRelayedFileBytes: 100 * 1024 * 1024,
  maxRelayedFileNameLength: 120,
  maxUploadDriveItemIdLength: 64,
  /** Restated from the terminal capability's own custom-action schema; see `mobile-live.ts`. */
  maxToolbarButtons: 64,
  maxToolbarButtonIdLength: 64,
  maxToolbarLabelLength: 32,
  maxToolbarTextLength: 4096,
  /** Bounds one serialized toolbar payload, which is trimmed button-by-button. */
  maxToolbarBytes: 64 * 1024,
}

/**
 * Style attribute bits packed into the fourth element of a run tuple.
 *
 * @type {{ readonly bold: number, readonly italic: number, readonly underline: number, readonly dim: number, readonly inverse: number }}
 */
exports.MOBILE_RUN_FLAGS = {
  bold: 1 << 0,
  italic: 1 << 1,
  underline: 1 << 2,
  dim: 1 << 3,
  inverse: 1 << 4,
}

/** `-1` for the terminal default, `0..255` for a palette index, `0x1000000 | rgb` for truecolor. */
exports.MOBILE_DEFAULT_COLOR = -1
exports.MOBILE_TRUECOLOR_BASE = 0x1000000

/**
 * The only keys the terminal service can encode. Clients cannot send arbitrary
 * control bytes, so this list is the complete vocabulary of the phone's panel.
 *
 * Append-only: each entry is an identifier the phone, the cloud and the desktop
 * all match by string, so reordering or removing one changes what an already
 * released client sends. `mobile-live.test.ts` keeps this identical to the ESM copy.
 *
 * @type {readonly [
 *   "Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
 *   "Backspace", "Ctrl+C", "Ctrl+D",
 *   "Home", "End", "PageUp", "PageDown", "Delete",
 *   "Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+K", "Ctrl+W", "Ctrl+L", "Ctrl+R", "Ctrl+Z"
 * ]}
 */
exports.MOBILE_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Ctrl+C",
  "Ctrl+D",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Delete",
  "Ctrl+A",
  "Ctrl+E",
  "Ctrl+U",
  "Ctrl+K",
  "Ctrl+W",
  "Ctrl+L",
  "Ctrl+R",
  "Ctrl+Z",
]
