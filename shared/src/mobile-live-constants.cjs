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
 * Frames are self-bounded. The desktop→cloud socket rejects payloads above 16 KiB
 * at the `ws` layer by dropping the connection rather than returning an error, so
 * `maxPayloadBytes` deliberately leaves a factor of two of headroom.
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
 *   readonly maxIntentTextLength: number,
 *   readonly maxKeyActions: number,
 *   readonly maxTitleLength: number,
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
  maxIntentTextLength: 8 * 1024,
  maxKeyActions: 128,
  maxTitleLength: 200,
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
 * control bytes, so this list is the complete vocabulary of the accessory bar.
 *
 * @type {readonly ["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Ctrl+C", "Ctrl+D"]}
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
]
