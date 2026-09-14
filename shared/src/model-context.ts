/**
 * Claude Code reads a trailing `[1m]` on a model id as a 1M-context declaration. The suffix is
 * matched case-insensitively and is part of the model id the user configures, so the tools here
 * are the only place that should decide how it is spelled or stripped.
 */
const ONE_M_MARKER_PATTERN = /\[1m\]$/i

export const ONE_M_CONTEXT_TOKENS = 1_000_000
export const ONE_M_CONTEXT_MARKER = "[1M]"

/** True when the model declares a 1M context window through a trailing `[1m]`. */
export function hasOneMMarker(model: string): boolean {
  return ONE_M_MARKER_PATTERN.test(model.trimEnd())
}

/** The model id without any trailing `[1m]` markers, as an upstream request must see it. */
export function stripOneMMarker(model: string): string {
  let next = model.trimEnd()
  while (ONE_M_MARKER_PATTERN.test(next)) {
    next = next.replace(ONE_M_MARKER_PATTERN, "").trimEnd()
  }
  return next
}

/** The model id with the marker added or removed. An empty model stays empty. */
export function setOneMMarker(model: string, enabled: boolean): string {
  const base = stripOneMMarker(model)
  if (!enabled || base.length === 0) return base
  return `${base}${ONE_M_CONTEXT_MARKER}`
}
