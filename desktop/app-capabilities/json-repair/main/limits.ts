import { JsonRepairError } from "../shared/errors"
import {
  JSON_REPAIR_MAX_DEPTH,
  JSON_REPAIR_OUTPUT_MAX_BYTES,
  utf8ByteLength,
} from "../shared/schema"

export function exceedsJsonNestingLimit(
  text: string,
  maxDepth = JSON_REPAIR_MAX_DEPTH,
): boolean {
  let depth = 0
  let inString = false
  let escaped = false

  for (const character of text) {
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === "\"") {
        inString = false
      }
      continue
    }
    if (character === "\"") {
      inString = true
      continue
    }
    if (character === "{" || character === "[") {
      depth++
      if (depth > maxDepth) return true
    } else if (character === "}" || character === "]") {
      depth = Math.max(0, depth - 1)
    }
  }
  return false
}

export function containsNonFiniteNumber(value: unknown): boolean {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return true
      continue
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item)
      continue
    }
    if (current && typeof current === "object") {
      for (const item of Object.values(current)) pending.push(item)
    }
  }
  return false
}

export function assertRepairedTextResources(text: string): void {
  if (utf8ByteLength(text) > JSON_REPAIR_OUTPUT_MAX_BYTES) {
    throw new JsonRepairError("OUTPUT_TOO_LARGE")
  }
  if (exceedsJsonNestingLimit(text)) {
    throw new JsonRepairError("MAX_DEPTH_EXCEEDED")
  }
}
